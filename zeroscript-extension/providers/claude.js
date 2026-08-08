// SPDX-License-Identifier: GPL-3.0-or-later
// providers/claude.js - Claude (claude.ai) provider.
// Exports the same ZSProvider interface as providers/deepseek.js.
//
// Claude DOM notes (last validated: 2026-07 — claude.ai).
//  - Composer: div.ProseMirror[contenteditable].
//  - Turns: [data-testid="user-message"] / [data-testid="assistant-message"].
//  - Send/Stop via aria-label; vision via file input / paste.
//  - Start on a fresh chat — Projects side panels are not conversation turns.
// eslint-disable-next-line no-unused-vars
const ZSProvider = (() => {
  "use strict";
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let diag = () => {};
  let _locked = false;
  let _attachedImages = null;

  const S = {
    user: '[data-testid="user-message"], [data-is-human-message="true"], div[class*="HumanMessage"], div[class*="human-message"]',
    asst: '[data-testid="assistant-message"], [data-is-assistant-message="true"], div[class*="AssistantMessage"], div[class*="assistant-message"]',
    editor: 'div.ProseMirror[contenteditable="true"], [contenteditable="true"].ProseMirror, fieldset [contenteditable="true"], div[contenteditable="true"][data-placeholder]',
    sendBtn: 'button[aria-label*="Send"], button[aria-label*="Envoyer"], button[type="submit"]',
    stopBtn: 'button[aria-label*="Stop"], button[aria-label*="Arrêt"], button[aria-label*="Interrupt"]',
    thinking: '[data-testid="thinking"], [class*="thinking"], [class*="reasoning"], details[class*="thinking"]',
    errorSurfaces: '[role="alert"], [class*="toast"], [class*="error"]',
  };

  const RE = {
    contextLimit: /conversation.{0,20}(too long|trop long)|context.{0,20}(limit|exceeded)|maximum.{0,20}context|(token|context).{0,10}limit/i,
    tooLong: /conversation .{0,20}(too long|getting too long|trop longue)/i,
    busy: /something went wrong|try again later|rate limit|too many requests|une erreur|overloaded/i,
  };

  const timings = {
    GEN_IDLE_MS: 1500,
    REASON_IDLE_MS: 15000,
    WARMUP_MS: 45000,
    REASON_NOREPLY_MS: 120000,
    STABLE_MS: 9000,
    RESPONSE_TIMEOUT_MS: 300000,
  };

  function textWithout(root, excludeSel) {
    if (!root) return "";
    const skip = ".zs-chip, " + S.thinking + (excludeSel ? ", " + excludeSel : "");
    let t = "";
    const walk = (n) => {
      if (n.nodeType === 3) { t += n.nodeValue; return; }
      if (n.nodeType !== 1) return;
      if (n.matches && n.matches(skip)) return;
      if (n.tagName === "PRE") {
        const code = n.querySelector("code") || n;
        t += code.textContent || "";
        return;
      }
      for (const c of n.childNodes) walk(c);
    };
    walk(root);
    return t;
  }

  function turnItems() {
    const users = [...document.querySelectorAll(S.user)];
    const assts = [...document.querySelectorAll(S.asst)];
    const set = new Set([...users, ...assts]);
    // Deduplicate nested matches; keep outermost.
    return [...set].filter((el) => {
      if (el.closest("#zs-root")) return false;
      for (const o of set) {
        if (o !== el && o.contains(el)) return false;
      }
      return true;
    }).sort((a, b) => {
      const pos = a.compareDocumentPosition(b);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
  }

  const isUserItem = (item) => {
    if (!item) return false;
    if (item.matches && item.matches(S.user)) return true;
    if (item.getAttribute("data-is-human-message") === "true") return true;
    return /human|user/i.test(item.getAttribute("data-testid") || item.className || "");
  };
  const isAssistantItem = (item) => {
    if (!item) return false;
    if (isUserItem(item)) return false;
    if (item.matches && item.matches(S.asst)) return true;
    if (item.getAttribute("data-is-assistant-message") === "true") return true;
    return /assistant|claude/i.test(item.getAttribute("data-testid") || item.className || "");
  };

  const allItems = () => turnItems();
  const assistantItems = () => allItems().filter(isAssistantItem);
  const assistantCount = () => assistantItems().length;
  const userCount = () => allItems().filter(isUserItem).length;
  const lastAssistant = () => {
    const it = assistantItems();
    return it.length ? it[it.length - 1] : null;
  };

  const _idMap = new WeakMap();
  let _idSeq = 0;
  function lastAssistantId() {
    const it = lastAssistant();
    if (!it) return null;
    let id = _idMap.get(it);
    if (!id) { id = ++_idSeq; _idMap.set(it, id); }
    return id;
  }
  function itemKey(item) {
    if (!item) return null;
    return item.getAttribute("data-message-id") || item.id || null;
  }

  function itemText(item) { return item ? textWithout(item) : ""; }
  function classifyText(item, excludeSel) { return item ? textWithout(item, excludeSel) : ""; }
  const chatIsEmpty = () => allItems().length === 0;

  function getEditor() {
    for (const sel of S.editor.split(",")) {
      for (const e of document.querySelectorAll(sel.trim())) {
        if (e.closest("#zs-root")) continue;
        if (e.offsetParent !== null || e.getClientRects().length) return e;
      }
    }
    let best = null, bestArea = 0;
    for (const e of document.querySelectorAll('[contenteditable="true"]')) {
      if (e.closest("#zs-root")) continue;
      const r = e.getBoundingClientRect();
      const area = r.width * r.height;
      if (r.top > innerHeight * 0.35 && area > bestArea) { best = e; bestArea = area; }
    }
    return best;
  }
  const editorText = () => {
    const e = getEditor();
    return e ? (e.innerText || e.textContent || "").replace(/\u200b/g, "").trimEnd() : "";
  };

  const isFreshChat = () => chatIsEmpty() && !!getEditor() &&
    (/^\/(new|chat\/new)?\/?$/.test(location.pathname) || location.pathname === "/new" || /\/chat\/?$/.test(location.pathname));

  function composerFrame() {
    const ed = getEditor();
    if (!ed) return null;
    return ed.closest("fieldset") || ed.closest("form") || ed.closest('[class*="composer"]') || ed.parentElement;
  }
  function barAnchor() { return composerFrame(); }
  function barMount() {
    const frame = composerFrame();
    if (!frame || !frame.parentElement) return null;
    return { parent: frame.parentElement, before: frame };
  }

  function setInputLock(on) {
    _locked = on;
    const ed = getEditor();
    if (ed) ed.setAttribute("contenteditable", on ? "false" : "true");
  }

  function nearbyButtons() {
    const frame = composerFrame();
    const root = frame || document.body;
    return [...root.querySelectorAll("button")].filter((b) => b.offsetParent !== null);
  }
  function sendButton() {
    for (const sel of S.sendBtn.split(",")) {
      const b = document.querySelector(sel.trim());
      if (b && b.offsetParent !== null && !/stop|arr[eê]t|interrupt/i.test(b.getAttribute("aria-label") || "")) return b;
    }
    return nearbyButtons().find((b) => {
      if (b.disabled || b.getAttribute("aria-disabled") === "true") return false;
      const al = (b.getAttribute("aria-label") || "") + (b.textContent || "");
      return /send|envoyer|submit/i.test(al) && !/stop|arr[eê]t|interrupt/i.test(al);
    }) || null;
  }
  function stopButton() {
    for (const sel of S.stopBtn.split(",")) {
      const b = document.querySelector(sel.trim());
      if (b && b.offsetParent !== null) return b;
    }
    return nearbyButtons().find((b) => {
      const al = (b.getAttribute("aria-label") || "") + (b.textContent || "");
      return /stop|arr[eê]t|interrupt/i.test(al);
    }) || null;
  }

  function streamText(item) { return item ? textWithout(item, ".zs-chip") : ""; }
  const streamLen = (item) => streamText(item === undefined ? lastAssistant() : item).length;

  let _streamMax = -1, _streamAt = 0, _streamItem = null;
  function sampleStream() {
    const item = lastAssistant();
    const len = streamText(item).length;
    const now = Date.now();
    if (item !== _streamItem || len < _streamMax - 400) {
      _streamItem = item; _streamMax = len; _streamAt = now; return;
    }
    if (len > _streamMax) { _streamMax = len; _streamAt = now; }
  }
  const grewWithin = (ms) => _streamMax > 1 && Date.now() - _streamAt < ms;

  function genActive() {
    sampleStream();
    if (stopButton()) return true;
    return grewWithin(timings.GEN_IDLE_MS);
  }
  const isGenerating = genActive;
  const isBusyNow = genActive;
  const isHardGenerating = () => !!stopButton();
  const turnHalted = () => false;
  const findContinueBtn = () => null;
  const clickContinueBtn = () => false;

  function snapshot() {
    try {
      const a = lastAssistant();
      return { th: 0, rp: a ? textWithout(a).length : 0 };
    } catch { return {}; }
  }
  function readAssistant() {
    const item = lastAssistant();
    if (!item) return { present: false, reply: "", thinking: "", item: null };
    return { present: true, reply: textWithout(item, ".zs-chip").trim(), thinking: "", item };
  }

  async function waitFor(pred, timeout) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (pred()) return true;
      await sleep(120);
    }
    return false;
  }

  function setEditorText(ed, text) {
    ed.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(ed);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand("delete", false, null);
    const lines = String(text).split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i]) document.execCommand("insertText", false, lines[i]);
      if (i < lines.length - 1) document.execCommand("insertLineBreak");
    }
  }

  function fileFromImage(img, i) {
    const mime = img.mimeType || "image/jpeg";
    const bin = atob(img.data);
    const arr = new Uint8Array(bin.length);
    for (let j = 0; j < bin.length; j++) arr[j] = bin.charCodeAt(j);
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    return new File([arr], `zeroscript_${Date.now()}_${i}.${ext}`, { type: mime });
  }
  function fileInputEl() {
    const frame = composerFrame() || document.body;
    for (const inp of frame.querySelectorAll('input[type="file"]')) {
      if (!inp.closest("#zs-root")) return inp;
    }
    return null;
  }
  function hasPendingAttachment() {
    const frame = composerFrame();
    if (!frame) return false;
    return !!(frame.querySelector('img[src^="blob:"], img[src^="data:"], [class*="thumbnail"], [class*="attachment"] img'));
  }
  async function attachImages(images) {
    if (!images || !images.length) return false;
    const dt = new DataTransfer();
    images.forEach((img, i) => { try { dt.items.add(fileFromImage(img, i)); } catch {} });
    if (!dt.items.length) return false;
    const inp = fileInputEl();
    if (inp) {
      try {
        inp.files = dt.files;
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      } catch {}
    } else {
      const ed = getEditor();
      if (!ed) return false;
      ed.focus();
      ed.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    }
    return await waitFor(hasPendingAttachment, 15000);
  }
  function clearAttachments() {
    try {
      const frame = composerFrame();
      if (!frame) return;
      frame.querySelectorAll('button[aria-label*="emove"], button[aria-label*="upprimer"], button[aria-label*="Delete"]').forEach((b) => {
        try { b.click(); } catch {}
      });
    } catch {}
    _attachedImages = null;
  }

  async function typeAndSend(text, images) {
    const ed = getEditor();
    if (!ed) throw new Error("Claude input box not found");
    const relock = _locked;
    if (relock) ed.setAttribute("contenteditable", "true");
    try {
      if (images && images.length && images !== _attachedImages) {
        if (hasPendingAttachment()) clearAttachments();
        try {
          const ok = await attachImages(images);
          if (ok) _attachedImages = images;
          diag("claude.tas.attached", { ok });
        } catch (e) { diag("claude.tas.attachErr", { msg: String((e && e.message) || e) }); }
      }
      if (editorText() !== text) setEditorText(ed, text);
      const sendReady = () => {
        const b = sendButton();
        return !!b && !b.disabled && b.getAttribute("aria-disabled") !== "true";
      };
      await waitFor(sendReady, 30000);
      let sent = false;
      for (let i = 0; i < 6 && !sent; i++) {
        if (sendReady()) {
          try { sendButton().click(); } catch {}
        } else if (!isHardGenerating()) {
          const o = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
          ed.dispatchEvent(new KeyboardEvent("keydown", o));
          ed.dispatchEvent(new KeyboardEvent("keyup", o));
        }
        sent = await waitFor(() => editorText().trim() === "" || isHardGenerating(), 800);
      }
      if (sent) _attachedImages = null;
      diag("claude.tas.sent", { sent });
    } finally {
      if (relock) { const e2 = getEditor(); if (e2) e2.setAttribute("contenteditable", "false"); }
    }
  }

  function stopGeneration() {
    const b = stopButton();
    if (b) { try { b.click(); } catch {} }
  }

  function enforceComposer() {
    if (_locked) {
      const ed = getEditor();
      if (ed) ed.setAttribute("contenteditable", "false");
    }
    return { ready: true };
  }
  async function ensureComposerReady(reason) {
    diag("mode_ready", { reason, provider: "claude", ready: !!getEditor() });
    return { ready: !!getEditor() };
  }

  function scanError() {
    try {
      for (const el of document.querySelectorAll(S.errorSurfaces)) {
        if (el.offsetParent === null) continue;
        if (el.closest(S.user) || el.closest(S.asst)) continue;
        const t = (el.innerText || "").trim();
        if (t.length > 8 && t.length < 600 && RE.contextLimit.test(t)) return t.slice(0, 240);
      }
    } catch {}
    if (!getEditor()) return "The input box disappeared (session ended?).";
    return null;
  }
  const isTooLongMsg = (text) => RE.tooLong.test(text);
  const isBusyMsg = (text) => RE.busy.test(text);

  const conversationKey = () => {
    if (chatIsEmpty()) return "";
    const m = location.pathname.match(/\/chat\/([a-zA-Z0-9-]+)/);
    return m ? m[0] : (location.pathname === "/new" || location.pathname === "/" ? "" : location.pathname);
  };

  function installSendHooks(handlers) {
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
      const ed = getEditor();
      if (!ed || !ed.contains(e.target)) return;
      if (editorText().trim() === "") return;
      if (handlers.isBlocked()) return;
      if (!handlers.isStarted()) {
        if (!chatIsEmpty()) return;
        handlers.onBlockedAttempt();
        return;
      }
      handlers.onUserMessage(assistantCount());
    }, true);

    document.addEventListener("click", (e) => {
      if (!getEditor()) return;
      const btn = e.target && e.target.closest && e.target.closest("button");
      if (!btn) return;
      const stop = stopButton();
      if (stop && (btn === stop || stop.contains(btn))) {
        if (!e.isTrusted) return;
        handlers.onNativeStop();
        return;
      }
      const send = sendButton();
      if (!send || (btn !== send && !send.contains(btn))) return;
      if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return;
      if (handlers.isBlocked()) return;
      if (!handlers.isStarted()) {
        if (!chatIsEmpty()) return;
        handlers.onBlockedAttempt();
        return;
      }
      handlers.onUserMessage(assistantCount());
    }, true);
  }

  const CMD_SHAPE = /"(?:command|tool)"\s*:\s*"|###\s*lua|###mcp_tool###/i;
  function findToolBlockSpot(item) {
    if (!item) return null;
    let hidAny = null;
    item.querySelectorAll("pre, [class*='code-block']").forEach((cw) => {
      if (cw.closest(".zs-chip")) return;
      if (CMD_SHAPE.test(cw.textContent || "")) {
        cw.classList.add("zs-tool-hide");
        item.classList.add("zs-cmd-mask");
        hidAny = hidAny || { parent: cw.parentElement, ref: cw };
      }
    });
    item.querySelectorAll("p, div").forEach((el) => {
      if (el.closest(".zs-chip, .zs-tool-hide, pre")) return;
      if (el.querySelector("pre")) return;
      const t = (el.textContent || "").trim();
      const t0 = t.replace(/^json\s*/i, "");
      const startsAsCmd = /^\{\s*"(?:command|tool)"\s*:/.test(t0) || /^###\s*(?:lua|mcp_tool)/i.test(t0);
      if ((startsAsCmd || t.length < 600) && CMD_SHAPE.test(t) && /^[{#]/.test(t0)) {
        el.classList.add("zs-tool-hide");
        hidAny = hidAny || { parent: el.parentElement, ref: el };
      }
    });
    return hidAny;
  }

  function chipAnchor(item) { return item; }

  function modeWarning() {
    try {
      if (!getEditor()) return "Claude composer not found — open a New chat or refresh.";
    } catch {}
    return "";
  }
  function unstableWarning() {
    return "Use a blank New chat. Long Project threads can confuse turn detection.";
  }

  return {
    id: "claude",
    displayName: "Claude",
    supportsVision: true,
    timings,
    thinkingSel: S.thinking,
    chipAtItemLevel: true,
    chipAnchor,
    chipAppend: true,
    reliableCounts: true,
    init({ diag: d } = {}) { if (d) diag = d; },
    allItems, isUserItem, isAssistantItem, itemText, classifyText,
    assistantCount, userCount, lastAssistant, lastAssistantId, itemKey, readAssistant,
    streamLen, snapshot,
    getEditor, editorText, chatIsEmpty, isFreshChat, composerFrame, barAnchor, barMount,
    setInputLock, typeAndSend, stopGeneration,
    isGenerating, isBusyNow, isHardGenerating,
    enforceComposer, ensureComposerReady,
    turnHalted, findContinueBtn, clickContinueBtn,
    scanError, isTooLongMsg, isBusyMsg,
    attachImages, clearAttachments, conversationKey,
    installSendHooks, findToolBlockSpot,
    modeWarning, unstableWarning,
  };
})();
