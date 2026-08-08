// SPDX-License-Identifier: GPL-3.0-or-later
// background.js - service worker.
// Owns ONE resilient WebSocket to the local bridge (ws://127.0.0.1:PORT).
// Keeping the socket here (not in the content script) avoids https→ws mixed
// content issues and centralises reconnect / timeout logic.
//
// Contract with content.js: every sendMessage ALWAYS gets a response object,
// even when the bridge is offline. The agentic loop must never hang waiting.

const PORT = 17613;
const URL = `ws://127.0.0.1:${PORT}`;
const GITHUB_RELEASES_API = "https://api.github.com/repos/valency-studio/ZeroScript/releases/latest";
const GITHUB_RELEASES_PAGE = "https://github.com/valency-studio/ZeroScript/releases/latest";
const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000; // every 6 hours

// Chat sites where a ZeroScript provider content script runs. Status pushes go
// to every tab matching these. Add the new provider's URL pattern here (and in
// manifest.json content_scripts + host_permissions) when integrating another AI.
const PROVIDER_URLS = [
  "https://chatgpt.com/*", "https://chat.openai.com/*",
  "https://claude.ai/*",
  "https://chat.deepseek.com/*", "https://gemini.google.com/*",
  "https://www.kimi.com/*", "https://kimi.com/*",
  "https://chat.z.ai/*", "https://chat.qwen.ai/*",
  "https://arena.ai/*", "https://www.meta.ai/*", "https://meta.ai/*",
  "https://grok.x.ai/*", "https://x.com/i/grok*",
  "https://copilot.microsoft.com/*",
  "https://www.perplexity.ai/*", "https://perplexity.ai/*",
  "https://chat.mistral.ai/*",
  "https://poe.com/*",
  "https://huggingface.co/chat/*",
  "https://pi.ai/*",
  "https://you.com/*",
  "https://www.phind.com/*", "https://phind.com/*",
  "https://www.blackbox.ai/*", "https://blackbox.ai/*",
  "https://chat.lmsys.org/*", "https://lmarena.ai/*",
  "https://duck.ai/*",
  "https://console.groq.com/*",
  "https://aistudio.google.com/*",
  "https://openrouter.ai/*",
  "https://coral.cohere.com/*",
  "https://t3.chat/*",
  "https://chat.together.ai/*",
  "https://v0.dev/*",
  "https://app.clickup.com/*",
];

const RECONNECT_MIN = 1000;
const RECONNECT_MAX = 5000;
const HEARTBEAT_MS = 10000;
// If no message (incl. pong) arrives within this window while we believe we're
// connected, the socket is half-open: force a reconnect instead of letting
// pending requests slowly time out.
const STALE_SOCKET_MS = 25000;
const REQUEST_TIMEOUT_DEFAULT = 130000; // a bit above the 120s tool timeout

let ws = null;
let connected = false;
let reconnectDelay = RECONNECT_MIN;
let reconnectTimer = null;
let heartbeatTimer = null;
let lastMessageAt = 0; // timestamp of the last frame received from the bridge
let nextId = 1;
const pending = new Map(); // id -> {resolve, timer}
let toolsCache = [];
let mcpAlive = false;
let serversCache = [];
// true/false = a PLACE is loaded and usable in Roblox Studio; null = unknown.
// The MCP process stays alive when Studio is closed or its MCP option is off,
// so this is probed separately (bridge "studio_status").
let studioConnected = null;
// true/false = a Roblox Studio app is connected to the MCP server at all; null =
// unknown. studioApp=true with studioConnected=false means "Studio open but no
// place"; studioApp=false means "Studio closed OR its MCP option disabled".
let studioApp = null;
// true/false = a Roblox Studio WINDOW/PROCESS exists on this machine (checked
// bridge-side via tasklist); null = unknown/old bridge. Distinguishes the two
// studioApp=false sub-cases the UI must word differently: Studio genuinely not
// launched ("open Roblox Studio") vs Studio OPEN but its MCP plugin never
// registered with the bridge - the documented fix for the latter is opening
// Assistant Settings > MCP Servers inside Studio (validated live 3x), which
// "open Roblox Studio" wording completely fails to convey.
let studioProc = null;

// Latest GitHub release info (null until first successful check).
let updateInfo = {
  checkedAt: 0,
  latest: null,       // semver string without leading v
  current: chrome.runtime.getManifest().version,
  available: false,
  url: GITHUB_RELEASES_PAGE,
  error: null,
};

const GENERIC_SCRIPT_ID = "zs-generic-provider";
const KNOWN_EXCLUDE = [
  "https://chatgpt.com/*", "https://chat.openai.com/*", "https://claude.ai/*",
  "https://chat.deepseek.com/*", "https://deepseek.com/*", "https://gemini.google.com/*",
  "https://www.kimi.com/*", "https://kimi.com/*", "https://chat.z.ai/*",
  "https://chat.qwen.ai/*", "https://arena.ai/*", "https://www.meta.ai/*", "https://meta.ai/*",
  "https://grok.x.ai/*", "https://x.com/i/grok*", "https://copilot.microsoft.com/*",
  "https://www.perplexity.ai/*", "https://perplexity.ai/*", "https://chat.mistral.ai/*",
  "https://poe.com/*", "https://huggingface.co/chat/*", "https://pi.ai/*",
  "https://you.com/*", "https://www.phind.com/*", "https://phind.com/*",
  "https://www.blackbox.ai/*", "https://blackbox.ai/*",
  "https://chat.lmsys.org/*", "https://lmarena.ai/*",
  "https://duck.ai/*",
  "https://console.groq.com/*", "https://aistudio.google.com/*",
  "https://openrouter.ai/*",
  "https://coral.cohere.com/*", "https://t3.chat/*", "https://chat.together.ai/*",
  "https://v0.dev/*",
  "https://app.clickup.com/*",
  "https://chrome.google.com/*", "https://chromewebstore.google.com/*",
];

async function syncGenericProvider(enabled) {
  try {
    await chrome.scripting.unregisterContentScripts({ ids: [GENERIC_SCRIPT_ID] });
  } catch {}
  if (!enabled) {
    log("generic provider disabled");
    return { ok: true, enabled: false };
  }
  try {
    await chrome.scripting.registerContentScripts([{
      id: GENERIC_SCRIPT_ID,
      matches: ["https://*/*"],
      excludeMatches: KNOWN_EXCLUDE,
      js: ["core/config.js", "core/parser.js", "providers/generic.js", "core/main.js"],
      css: ["overlay.css"],
      runAt: "document_idle",
      persistAcrossSessions: true,
    }]);
    log("generic provider registered");
    return { ok: true, enabled: true };
  } catch (e) {
    log("generic register failed", e);
    return { ok: false, enabled: false, error: String((e && e.message) || e) };
  }
}

function restoreGenericFromStorage() {
  try {
    chrome.storage.local.get("zsGenericEnabled", (r) => {
      if (r && r.zsGenericEnabled) syncGenericProvider(true);
    });
  } catch {}
}

function log(...a) {
  console.log("[zs-bg]", ...a);
}

function parseVer(v) {
  return String(v || "").replace(/^v/i, "").split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
}
function cmpVer(a, b) {
  const pa = parseVer(a), pb = parseVer(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

async function checkForUpdate(force = false) {
  const now = Date.now();
  if (!force && updateInfo.checkedAt && now - updateInfo.checkedAt < UPDATE_CHECK_MS) {
    return updateInfo;
  }
  updateInfo.current = chrome.runtime.getManifest().version;
  try {
    const res = await fetch(GITHUB_RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    const tag = (data.tag_name || data.name || "").replace(/^v/i, "");
    updateInfo.latest = tag || null;
    updateInfo.url = data.html_url || GITHUB_RELEASES_PAGE;
    updateInfo.available = !!(tag && cmpVer(tag, updateInfo.current) > 0);
    updateInfo.error = null;
    updateInfo.checkedAt = now;
    log("update check", { current: updateInfo.current, latest: tag, available: updateInfo.available });
    try { chrome.storage.local.set({ zsUpdate: updateInfo }); } catch {}
    broadcastStatus();
  } catch (e) {
    updateInfo.error = String((e && e.message) || e);
    updateInfo.checkedAt = now;
    log("update check failed", updateInfo.error);
  }
  return updateInfo;
}

// ── WebSocket lifecycle ─────────────────────────────────────────────────
function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }
  clearTimeout(reconnectTimer);
  try {
    ws = new WebSocket(URL);
  } catch (e) {
    log("WebSocket ctor failed", e);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    connected = true;
    reconnectDelay = RECONNECT_MIN;
    lastMessageAt = Date.now();
    log("connected to bridge");
    startHeartbeat();
    broadcastStatus();
  };

  ws.onmessage = (ev) => {
    lastMessageAt = Date.now();
    let msg;
    try {
      msg = JSON.parse(ev.data);
    } catch {
      return;
    }
    handleBridgeMessage(msg);
  };

  ws.onclose = () => {
    connected = false;
    mcpAlive = false;
    studioConnected = null;
    studioApp = null;
    studioProc = null;
    serversCache = [];
    stopHeartbeat();
    failAllPending("bridge connection closed");
    broadcastStatus();
    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose will follow; nothing to do here but avoid an unhandled error.
    try { ws.close(); } catch {}
  };
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 1.7, RECONNECT_MAX);
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (connected) {
      // Half-open socket: the WS still reports OPEN but nothing comes through.
      // The pong (and every other frame) refreshes lastMessageAt; if it has
      // gone stale, drop the dead socket so onclose triggers a reconnect.
      if (lastMessageAt && Date.now() - lastMessageAt > STALE_SOCKET_MS) {
        log("socket stale, forcing reconnect");
        try { ws.close(); } catch {}
        return;
      }
      // Keeps the MV3 service worker alive AND detects a half-open socket.
      send({ type: "ping" }).catch(() => {});
      refreshStudioStatus();
    }
  }, HEARTBEAT_MS);
}

function stopHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

// Resolve once the socket is OPEN, or false after `timeout` ms.
function waitForConnection(timeout = 8000) {
  return new Promise((resolve) => {
    if (connected && ws && ws.readyState === WebSocket.OPEN) return resolve(true);
    connect(); // nudge a (re)connection - important after a worker wake-up
    const t0 = Date.now();
    const iv = setInterval(() => {
      if (connected && ws && ws.readyState === WebSocket.OPEN) {
        clearInterval(iv);
        resolve(true);
      } else if (Date.now() - t0 > timeout) {
        clearInterval(iv);
        resolve(false);
      }
    }, 100);
  });
}

// ── request/response over the socket ────────────────────────────────────
async function send(obj, timeout = REQUEST_TIMEOUT_DEFAULT) {
  // The MV3 service worker can be suspended; the first message after a wake-up
  // arrives before the socket has re-opened. Wait for it instead of failing -
  // otherwise Kimi wrongly hears "bridge offline".
  if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
    await waitForConnection(8000);
  }
  return new Promise((resolve) => {
    if (!connected || !ws || ws.readyState !== WebSocket.OPEN) {
      resolve({ ok: false, kind: "disconnected", error: "bridge not connected" });
      return;
    }
    const id = nextId++;
    const payload = { ...obj, id };
    const timer = setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        resolve({ ok: false, kind: "timeout", error: "bridge did not respond in time" });
      }
    }, timeout);
    pending.set(id, { resolve, timer });
    try {
      ws.send(JSON.stringify(payload));
    } catch (e) {
      clearTimeout(timer);
      pending.delete(id);
      resolve({ ok: false, kind: "disconnected", error: String(e) });
    }
  });
}

// Ask the bridge whether a Roblox Studio instance is actually connected to the
// MCP server. Broadcasts only on change so the UI updates promptly but quietly.
let studioProbing = false;
async function refreshStudioStatus() {
  if (studioProbing || !connected) return;
  studioProbing = true;
  try {
    const r = await send({ type: "studio_status" }, 12000);
    const v = r && r.ok && typeof r.studio === "boolean" ? r.studio : null;
    if (v !== studioConnected) {
      studioConnected = v;
      broadcastStatus();
    }
  } finally {
    studioProbing = false;
  }
}

function handleBridgeMessage(msg) {
  if ("studio" in msg && (typeof msg.studio === "boolean" || msg.studio === null)) {
    studioConnected = msg.studio;
  }
  if ("studio_app" in msg && (typeof msg.studio_app === "boolean" || msg.studio_app === null)) {
    studioApp = msg.studio_app;
  }
  if ("studio_proc" in msg && (typeof msg.studio_proc === "boolean" || msg.studio_proc === null)) {
    studioProc = msg.studio_proc;
  }
  if (msg.type === "studio_status") {
    resolvePending(msg.id, { ok: true, studio: studioConnected });
    broadcastStatus();
    return;
  }
  if (msg.type === "connected") {
    mcpAlive = !!msg.mcp_alive;
    if (Array.isArray(msg.tools)) toolsCache = msg.tools;
    if (Array.isArray(msg.servers)) serversCache = msg.servers;
    broadcastStatus();
    return;
  }
  if (msg.type === "pong") {
    resolvePending(msg.id, { ok: true });
    return;
  }
  if (msg.type === "tools") {
    if (Array.isArray(msg.tools)) toolsCache = msg.tools;
    if (Array.isArray(msg.servers)) serversCache = msg.servers;
    mcpAlive = !!msg.mcp_alive;
    resolvePending(msg.id, { ok: true, tools: toolsCache });
    broadcastStatus();
    return;
  }
  if (msg.type === "tool_result") {
    resolvePending(msg.id, msg.ok
      ? { ok: true, text: msg.text, images: msg.images || [] }
      : { ok: false, kind: msg.kind, error: msg.error });
    return;
  }
  if (msg.type === "mcp_status") {
    mcpAlive = !!msg.alive;
    if (Array.isArray(msg.tools)) toolsCache = msg.tools;
    if (Array.isArray(msg.servers)) serversCache = msg.servers;
    resolvePending(msg.id, { ok: !!msg.ok, alive: msg.alive, error: msg.error });
    broadcastStatus();
    return;
  }
  if (msg.type === "server_changed") {
    // The bridge acks, then restarts itself to reload config.json. The socket
    // will drop right after this - the content script shows a spinner until the
    // reconnect lands and a fresh status arrives.
    resolvePending(msg.id, { ok: !!msg.ok, error: msg.error, restarting: !!msg.restarting });
    return;
  }
  if (msg.type === "error") {
    resolvePending(msg.id, { ok: false, error: msg.error });
    return;
  }
}

function resolvePending(id, value) {
  const p = pending.get(id);
  if (!p) return;
  clearTimeout(p.timer);
  pending.delete(id);
  p.resolve(value);
}

function failAllPending(reason) {
  for (const [, p] of pending) {
    clearTimeout(p.timer);
    p.resolve({ ok: false, kind: "disconnected", error: reason });
  }
  pending.clear();
}

// ── status push to any open DeepSeek tab + popup ─────────────────────────
function statusObj() {
  return {
    type: "zs-status",
    connected, mcpAlive, studio: studioConnected, studioApp, studioProc,
    tools: toolsCache.length, servers: serversCache,
    update: {
      available: !!updateInfo.available,
      current: updateInfo.current,
      latest: updateInfo.latest,
      url: updateInfo.url,
    },
  };
}

function broadcastStatus() {
  chrome.runtime.sendMessage(statusObj()).catch(() => {});
  chrome.tabs.query({ url: PROVIDER_URLS }, (tabs) => {
    for (const t of tabs) chrome.tabs.sendMessage(t.id, statusObj()).catch(() => {});
  });
}

// ── messages from content.js / popup.js ─────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case "status":
        if (!connected) connect(); // self-heal after a worker wake-up
        sendResponse(statusObj());
        break;
      case "list_tools": {
        // Prefer a live refresh; fall back to cache so the loop never stalls.
        const r = await send({ type: "list_tools" }, 25000);
        if (r.ok) sendResponse({ ok: true, tools: r.tools });
        else sendResponse({ ok: toolsCache.length > 0, tools: toolsCache, error: r.error });
        break;
      }
      case "call_tool": {
        const timeout = (msg.timeout || 120000) + 10000;
        const r = await send(
          { type: "call_tool", name: msg.name, arguments: msg.arguments, timeout: msg.timeout },
          timeout
        );
        sendResponse(r);
        break;
      }
      case "restart_mcp": {
        const r = await send({ type: "restart_mcp" }, 30000);
        sendResponse(r);
        break;
      }
      case "add_server": {
        const r = await send({
          type: "add_server", server_id: msg.server_id,
          command: msg.command, args: msg.args, env: msg.env,
        }, 15000);
        sendResponse(r);
        break;
      }
      case "remove_server": {
        const r = await send({ type: "remove_server", server_id: msg.server_id }, 15000);
        sendResponse(r);
        break;
      }
      case "reconnect":
        reconnectDelay = RECONNECT_MIN;
        connect();
        sendResponse({ ok: true });
        break;
      case "check_update": {
        const info = await checkForUpdate(!!msg.force);
        sendResponse({ ok: true, update: info });
        break;
      }
      case "set_generic": {
        const enabled = !!msg.enabled;
        try { await chrome.storage.local.set({ zsGenericEnabled: enabled }); } catch {}
        const r = await syncGenericProvider(enabled);
        sendResponse(r);
        break;
      }
      case "get_generic": {
        const st = await new Promise((resolve) => {
          try { chrome.storage.local.get("zsGenericEnabled", resolve); }
          catch { resolve({}); }
        });
        sendResponse({ ok: true, enabled: !!(st && st.zsGenericEnabled) });
        break;
      }
      default:
        sendResponse({ ok: false, error: "unknown message" });
    }
  })();
  return true; // async sendResponse
});

// Wake/keepalive hooks.
chrome.runtime.onStartup.addListener(() => { connect(); checkForUpdate(true); restoreGenericFromStorage(); });
chrome.runtime.onInstalled.addListener(() => { connect(); checkForUpdate(true); restoreGenericFromStorage(); });

connect();
checkForUpdate(true);
restoreGenericFromStorage();
setInterval(() => checkForUpdate(false), UPDATE_CHECK_MS);
