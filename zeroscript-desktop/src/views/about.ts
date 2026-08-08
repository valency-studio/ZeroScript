// SPDX-License-Identifier: GPL-3.0-or-later
import { getAppInfo, getDataDir, openDataDir, openUrl } from "../tauri";
import { GITHUB_RELEASES_PAGE, UpdateInfo, updates } from "../update";
import { toast } from "../ui";

let root: HTMLElement;
let version = "";
let platform = "";
let dataDir = "";
let checking = false;

const REPO_URL = "https://github.com/valency-studio/ZeroScript";
const ISSUES_URL = "https://github.com/valency-studio/ZeroScript/issues";
const LICENSE_URL = "https://github.com/valency-studio/ZeroScript/blob/main/LICENSE";
const SUPPORT_URL = "https://trakteer.id/rtaserver";
const ORIGINAL_URL = "https://github.com/sebattfg/ZeroScript-Free";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function timeAgo(ts: number): string {
  if (!ts) return "never";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`;
  return `${Math.floor(h / 24)} day${h / 24 >= 2 ? "s" : ""} ago`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// ── tiny markdown-lite renderer (release notes) ────────────────────────────
// Everything is HTML-escaped FIRST, then light formatting is applied, so the
// output can never contain raw user markup from GitHub.

function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // strip images, keep alt text
    // URL charset is deliberately restricted (no & | < > ^ "): these links
    // are handed to `openUrl`, and on Windows cmd would interpret them.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)"\s&|<>^]+)\)/g, '<a class="rel-link" data-url="$2">$1</a>');
}

function renderMarkdown(src: string): string {
  const lines = escapeHtml(src).split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  let code: string[] | null = null;

  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${inline(para.join("<br>"))}</p>`);
      para = [];
    }
  };
  const flushList = (): void => {
    if (list) {
      out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`);
      list = null;
    }
  };
  const flushCode = (): void => {
    if (code) {
      out.push(`<pre>${code.join("\n")}</pre>`);
      code = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (code) {
      if (line.trim().startsWith("```")) flushCode();
      else code.push(line);
      continue;
    }
    if (line.trim().startsWith("```")) {
      flushPara();
      flushList();
      code = [];
      continue;
    }
    const head = line.match(/^(#{1,3})\s+(.*)$/);
    if (head) {
      flushPara();
      flushList();
      out.push(`<h4>${inline(head[2])}</h4>`);
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushPara();
      (list ||= []).push(bullet[1]);
      continue;
    }
    const quote = line.match(/^&gt;\s?(.*)$/);
    if (quote) {
      flushPara();
      flushList();
      out.push(`<p class="rel-quote">${inline(quote[1])}</p>`);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    flushList();
    para.push(line);
  }
  flushPara();
  flushList();
  flushCode();
  return out.join("");
}

// ── small inline SVG icon set ──────────────────────────────────────────────
const IC = {
  github: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.85.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.25 10.25 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5"/><path d="M4 19h16"/></svg>',
  issue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><path d="M12 16.5h.01"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7.5-4.7-10-9.3C.3 8.4 2.6 4.5 6.4 4.5c2.2 0 3.7 1.2 4.6 2.6.9-1.4 2.4-2.6 4.6-2.6 3.8 0 6.1 3.9 4.4 7.2C19.5 16.3 12 21 12 21z"/></svg>',
  fork: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="5" r="2.5"/><circle cx="18" cy="5" r="2.5"/><circle cx="12" cy="19" r="2.5"/><path d="M6 7.5v1.5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7.5"/><path d="M12 12v4.5"/></svg>',
  scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v18M5 7l7-4 7 4"/><path d="M4 21h16"/><path d="M8 7h8l2.5 5.5a3 3 0 0 1-5.5 1L12 9.5 11 13.5a3 3 0 0 1-5.5-1L8 7z"/></svg>',
};

function linkRow(icon: string, label: string, url: string): string {
  return `<button class="link-row js-link" data-url="${url}">
    <span class="link-ic">${icon}</span><span>${escapeHtml(label)}</span><span class="link-arrow">↗</span>
  </button>`;
}

// ── update card ────────────────────────────────────────────────────────────
function updateCard(info: UpdateInfo): string {
  let status = "";
  if (checking || (!info.checkedAt && !info.error)) {
    // Before the first check has resolved, don't claim "up to date".
    status = `<div class="update-status checking"><span class="spinner"></span> Checking for updates…</div>`;
  } else if (info.error) {
    status = `
      <div class="update-status err">
        <div>
          <b>Could not check for updates</b>
          <span class="muted">${escapeHtml(info.error)}</span>
        </div>
        <button class="btn ghost sm js-check">Try again</button>
      </div>`;
  } else if (info.available) {
    status = `
      <div class="update-status avail">
        <span class="dot warn"></span>
        <div>
          <b>Update available — v${escapeHtml(info.latest || "")}</b>
          <span class="muted">You are on v${escapeHtml(info.current || version)}.</span>
        </div>
        <button class="btn primary sm js-download">Download</button>
      </div>`;
  } else {
    status = `
      <div class="update-status ok">
        <span class="dot on"></span>
        <div>
          <b>You are up to date</b>
          <span class="muted">v${escapeHtml(info.current || version)} is the latest release.</span>
        </div>
      </div>`;
  }

  return `
    <div class="card">
      <h3 class="card-title">Updates</h3>
      ${status}
      <div class="update-foot">
        <span class="muted">Last checked ${timeAgo(info.checkedAt)}</span>
        <button class="btn ghost sm js-check" ${checking ? "disabled" : ""}>Check now</button>
      </div>
    </div>`;
}

// ── release notes card ─────────────────────────────────────────────────────
function releaseNotesCard(info: UpdateInfo): string {
  if (!info.latest || !info.body) return "";
  const when = fmtDate(info.publishedAt);
  const label = `${info.name ? escapeHtml(info.name) : `v${escapeHtml(info.latest)}`}${when ? ` · ${when}` : ""}`;
  return `
    <div class="card">
      <details class="rel-details" ${info.available ? "open" : ""}>
        <summary>
          <span class="rel-sum-title">Release notes</span>
          <span class="rel-sum-sub mono">${label}</span>
        </summary>
        <div class="rel-body">${renderMarkdown(info.body)}</div>
      </details>
    </div>`;
}

// ── static cards ───────────────────────────────────────────────────────────
function featuresCard(): string {
  const feats = [
    "30+ AI chat sites — ChatGPT, DeepSeek, Claude, Gemini, Kimi and more",
    "Full Roblox Studio control via MCP — parts, Luau scripts, screenshots",
    "External MCP servers — add Blender, filesystem, databases and more",
    "Automatic recovery — crashes, zombie processes and port conflicts",
    "Auto-updates straight from GitHub Releases",
    "No Python or Node.js required",
  ];
  return `
    <div class="card">
      <h3 class="card-title">Features</h3>
      <ul class="feature-list">
        ${feats.map((f) => `<li><span class="feat-check">✓</span>${escapeHtml(f)}</li>`).join("")}
      </ul>
    </div>`;
}

function quickStartCard(): string {
  const steps = [
    ["Start the bridge", "Hit Start Bridge on the Dashboard (or enable auto-start in Settings)."],
    ["Load the browser extension", "chrome://extensions → Developer mode → Load unpacked → select the zeroscript-extension folder."],
    ["Connect Roblox Studio", "Open a place, then Assistant Settings → MCP Servers → enable \u201CStudio as MCP server\u201D."],
    ["Open an AI chat site", "Visit ChatGPT, DeepSeek, Claude… and press Start Roblox Agent."],
  ];
  return `
    <div class="card">
      <h3 class="card-title">Get started</h3>
      <ol class="qs-list">
        ${steps.map(([t, d], i) => `<li><span class="qs-num">${i + 1}</span><div><b>${escapeHtml(t)}</b><span class="muted">${escapeHtml(d)}</span></div></li>`).join("")}
      </ol>
    </div>`;
}

function stackCard(): string {
  const rows: [string, string][] = [
    ["Desktop shell", "Tauri 2 (Rust)"],
    ["Interface", "Vite · TypeScript"],
    ["Bridge", "Python (PyInstaller sidecar)"],
    ["Protocol", "MCP · WebSocket :17613"],
  ];
  return `
    <div class="card">
      <h3 class="card-title">Technology</h3>
      <ul class="about-stack">
        ${rows.map(([k, v]) => `<li><span>${k}</span><b class="mono">${escapeHtml(v)}</b></li>`).join("")}
      </ul>
    </div>`;
}

function systemCard(): string {
  return `
    <div class="card">
      <h3 class="card-title">System</h3>
      <ul class="about-stack">
        <li><span>App version</span><b class="mono">v${escapeHtml(version || "—")}</b></li>
        <li><span>Platform</span><b class="mono">${escapeHtml(platform || "—")}</b></li>
        <li><span>License</span><b>MIT</b></li>
      </ul>
      <div class="path-row">
        <code class="mono path" title="${escapeHtml(dataDir)}">${escapeHtml(dataDir || "…")}</code>
        <button id="btnOpenDir" class="btn ghost sm" ${dataDir ? "" : "disabled"}>Open folder</button>
      </div>
      <p class="muted note">config.json, logs/ and desktop-settings.json live in this folder.</p>
      <div class="form-actions">
        <button id="btnCopyInfo" class="btn ghost sm">Copy version info</button>
        <span class="muted note">Paste this when reporting a bug.</span>
      </div>
    </div>`;
}

function creditsCard(): string {
  return `
    <div class="card">
      <h3 class="card-title">Credits</h3>
      <ul class="about-stack">
        <li><span>Author</span><b>Rizki Kotet · ValencyStudio</b></li>
        <li><span>Based on</span><b class="mono">ZeroScript-Free</b></li>
      </ul>
      <p class="muted note">ZeroScript is a modern, improvised take on
      <b>ZeroScript-Free by sebattfg</b> — original code, new ideas, one product.</p>
    </div>`;
}

function licenseCard(): string {
  return `
    <div class="card">
      <h3 class="card-title">License</h3>
      <p class="about-copy">ZeroScript is released under the <b>MIT License</b> — free to use,
      modify and distribute, with attribution. Copyright (c) 2026 Rizki Kotet.</p>
      <button class="link-row js-link" data-url="${LICENSE_URL}">
        <span class="link-ic">${IC.scale}</span><span>Read the full MIT license</span><span class="link-arrow">↗</span>
      </button>
    </div>`;
}

function render(info: UpdateInfo): void {
  if (!root) return;
  root.innerHTML = `
    <div class="card about-hero">
      <div class="about-mark" aria-hidden="true"></div>
      <div class="about-hero-body">
        <div class="about-name">ZeroScript</div>
        <div class="about-tagline">Connect AI chat to Roblox Studio via MCP</div>
        <div class="about-badges">
          <span class="badge">v${escapeHtml(version || "—")}</span>
          <span class="badge mono">${escapeHtml(platform || "os")}</span>
          <span class="badge">MIT License</span>
        </div>
      </div>
    </div>

    ${updateCard(info)}

    ${releaseNotesCard(info)}

    <div class="grid-2">
      ${featuresCard()}
      ${quickStartCard()}
    </div>

    <div class="grid-2">
      ${stackCard()}
      ${systemCard()}
    </div>

    ${creditsCard()}

    <div class="card">
      <h3 class="card-title">Links</h3>
      <div class="link-list">
        ${linkRow(IC.github, "GitHub repository", REPO_URL)}
        ${linkRow(IC.download, "Releases & downloads", GITHUB_RELEASES_PAGE)}
        ${linkRow(IC.issue, "Report an issue", ISSUES_URL)}
        ${linkRow(IC.heart, "Support on Trakteer", SUPPORT_URL)}
        ${linkRow(IC.fork, "Original project (ZeroScript-Free)", ORIGINAL_URL)}
      </div>
    </div>

    ${licenseCard()}
  `;

  root.querySelectorAll<HTMLButtonElement>(".js-link").forEach((b) => {
    b.addEventListener("click", () => openUrl(b.dataset.url!).catch(() => undefined));
  });
  root.querySelectorAll<HTMLAnchorElement>(".rel-link").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      openUrl(a.dataset.url!).catch(() => undefined);
    });
  });
  root.querySelectorAll<HTMLButtonElement>(".js-download").forEach((b) => {
    b.addEventListener("click", () => openUrl(info.url || GITHUB_RELEASES_PAGE).catch(() => undefined));
  });
  root.querySelectorAll<HTMLButtonElement>(".js-check").forEach((b) => {
    b.addEventListener("click", async () => {
      checking = true;
      render(updates.get());
      await updates.check(true);
      checking = false;
      render(updates.get());
    });
  });
  root.querySelector<HTMLButtonElement>("#btnOpenDir")?.addEventListener("click", () => {
    openDataDir().catch(() => undefined);
  });
  root.querySelector<HTMLButtonElement>("#btnCopyInfo")?.addEventListener("click", copyInfo);
}

function copyInfo(): void {
  const text = `ZeroScript v${version || "?"} — ${platform || "unknown"} — ${dataDir || "unknown data dir"}`;
  const done = (): void => toast("Version info copied", "ok");
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(() => done());
  } else {
    done();
  }
}

export function initAbout(el: HTMLElement): void {
  root = el;
  getAppInfo()
    .then((i) => {
      version = i.version;
      platform = i.arch ? `${i.os} ${i.arch}` : i.os;
      render(updates.get());
    })
    .catch(() => undefined);
  getDataDir()
    .then((d) => {
      dataDir = d;
      render(updates.get());
    })
    .catch(() => undefined);
  updates.subscribe((info) => {
    version = version || info.current;
    // Skip the render triggered by the check() emit itself - the click handler
    // renders the final state after checking flips back to false.
    if (!checking) render(info);
  });
}
