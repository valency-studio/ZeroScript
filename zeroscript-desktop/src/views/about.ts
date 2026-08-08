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

// ── markdown-lite renderer for GitHub release notes ───────────────────────
// Runs inline spans on raw text BEFORE escapeHtml, so special chars and
// markup are handled in the right order.

function inlineRaw(s: string): string {
  // code spans first (protect from other rules)
  s = s.replace(/`([^`]+)`/g, (_m, p1) => `<code>${escapeHtml(p1)}</code>`);
  // bold
  s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  // italic (single * or _ not part of bold)
  s = s.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  // images — drop, keep alt text
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // links
  s = s.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)"\s&|<>^]+)\)/g,
    '<a class="rel-link" data-url="$2">$1</a>',
  );
  return s;
}

function renderMarkdown(src: string): string {
  // Normalize line endings
  const rawLines = src.replace(/\r\n/g, "\n").split("\n");
  const lines: string[] = [];
  
  // Pre-process: remove empty lines BETWEEN list items to prevent breaking nested lists
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line.trim() && i > 0 && i < rawLines.length - 1) {
      const prevTrimmed = rawLines[i-1].trimStart();
      const nextTrimmed = rawLines[i+1].trimStart();
      const isList = (s: string) => s.startsWith("* ") || s.startsWith("- ") || /^\d+\.\s/.test(s);
      
      if (isList(prevTrimmed) && isList(nextTrimmed)) {
        continue; // Skip empty line between list items
      }
    }
    lines.push(line);
  }

  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let subList: string[] = [];
  let code: string[] | null = null;

  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${inlineRaw(para.join("<br>"))}</p>`);
      para = [];
    }
  };

  const flushList = (): void => {
    if (list.length) {
      if (subList.length) {
        const lastIdx = list.length - 1;
        if (lastIdx >= 0) {
          list[lastIdx] += `<ul>${subList.join("")}</ul>`;
        } else {
          out.push(`<ul>${subList.join("")}</ul>`);
        }
        subList = [];
      }
      out.push(`<ul>${list.map((l) => `<li>${l}</li>`).join("")}</ul>`);
      list = [];
    } else if (subList.length) {
      out.push(`<ul>${subList.join("")}</ul>`);
      subList = [];
    }
  };

  const flushCode = (): void => {
    if (code) {
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      code = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // code block fence
    if (code) {
      if (line.trim().startsWith("```")) {
        flushCode();
      } else {
        code.push(line);
      }
      continue;
    }
    if (line.trim().startsWith("```")) {
      flushPara();
      flushList();
      code = [];
      continue;
    }

    // horizontal rule
    if (line.trim() === "---" || line.trim() === "***") {
      flushPara();
      flushList();
      out.push(`<hr/>`);
      continue;
    }

    // headings (mapping # to appropriate HTML tags)
    const head = line.match(/^(#{1,6})\s+(.*)$/);
    if (head) {
      flushPara();
      flushList();
      const level = head[1].length;
      const tag = level === 1 ? "h2" : level === 2 ? "h3" : level === 3 ? "h4" : "h5";
      out.push(`<${tag}>${inlineRaw(head[2])}</${tag}>`);
      continue;
    }

    // Check for list items
    const trimmedLine = line.trimStart();
    const indent = line.length - trimmedLine.length;

    const bullet = trimmedLine.match(/^[-*]\s+(.*)$/);
    const ordered = trimmedLine.match(/^\d+\.\s+(.*)$/);
    
    if (bullet || ordered) {
      flushPara();
      const content = bullet ? bullet[1] : ordered![1];
      const contentHtml = inlineRaw(content);

      if (indent === 0) {
        // Level 1 list
        if (subList.length) {
          const lastIdx = list.length - 1;
          if (lastIdx >= 0) {
            list[lastIdx] += `<ul>${subList.join("")}</ul>`;
          } else {
            out.push(`<ul>${subList.join("")}</ul>`);
          }
          subList = [];
        }
        list.push(contentHtml);
      } else {
        // Level 2+ (indented)
        if (list.length === 0) {
          list.push(contentHtml);
        } else {
          subList.push(`<li>${contentHtml}</li>`);
        }
      }
      continue;
    }

    // blockquote
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushPara();
      flushList();
      out.push(`<blockquote class="rel-quote">${inlineRaw(quote[1])}</blockquote>`);
      continue;
    }

    // blank line — close any open block
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }

    // normal paragraph line
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
  github: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.63.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.36 1.12 2.94.85.09-.67.35-1.12.63-1.38-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.4 9.4 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.25 10.25 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5"/><path d="M4 19h16"/></svg>',
  issue: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5"/><path d="M12 16.5h.01"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 21s-7.5-4.7-10-9.3C.3 8.4 2.6 4.5 6.4 4.5c2.2 0 3.7 1.2 4.6 2.6.9-1.4 2.4-2.6 4.6-2.6 3.8 0 6.1 3.9 4.4 7.2C19.5 16.3 12 21 12 21z"/></svg>',
  fork: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="6" cy="5" r="2.5"/><circle cx="18" cy="5" r="2.5"/><circle cx="12" cy="19" r="2.5"/><path d="M6 7.5v1.5a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7.5"/><path d="M12 12v4.5"/></svg>',
  scale: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 3v18M5 7l7-4 7 4"/><path d="M4 21h16"/><path d="M8 7h8l2.5 5.5a3 3 0 0 1-5.5 1L12 9.5 11 13.5a3 3 0 0 1-5.5-1L8 7z"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2a2 2 0 0 0-1.66-.9H3a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6L9 17l-5-5"/></svg>',
};

function linkRow(icon: string, label: string, url: string): string {
  return `<a class="link-row js-link" data-url="${url}" href="${url}" target="_blank" rel="noopener noreferrer" aria-label="${escapeHtml(label)} (opens in browser)">
    <span class="link-ic">${icon}</span>
    <span class="link-text">${escapeHtml(label)}</span>
    <span class="link-arrow" aria-hidden="true">↗</span>
  </a>`;
}

// ── update card ────────────────────────────────────────────────────────────
function updateCard(info: UpdateInfo): string {
  let status = "";
  if (checking || (!info.checkedAt && !info.error)) {
    status = `<div class="update-status checking" role="status" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span> 
      <span>Checking for updates…</span>
    </div>`;
  } else if (info.error) {
    status = `
      <div class="update-status err" role="alert">
        <div class="status-text">
          <b>Could not check for updates</b>
          <span class="muted">${escapeHtml(info.error)}</span>
        </div>
        <button class="btn ghost sm js-check" aria-label="Try checking for updates again">Try again</button>
      </div>`;
  } else if (info.available) {
    status = `
      <div class="update-status avail" role="status">
        <span class="dot warn" aria-hidden="true"></span>
        <div class="status-text">
          <b>Update available — v${escapeHtml(info.latest || "")}</b>
          <span class="muted">You are on v${escapeHtml(info.current || version)}.</span>
        </div>
        <button class="btn primary sm js-download" aria-label="Download update version ${escapeHtml(info.latest || "")}">
          ${IC.download} Download
        </button>
      </div>`;
  } else {
    status = `
      <div class="update-status ok" role="status">
        <span class="dot on" aria-hidden="true"></span>
        <div class="status-text">
          <b>You are up to date</b>
          <span class="muted">v${escapeHtml(info.current || version)} is the latest release.</span>
        </div>
      </div>`;
  }

  return `
    <div class="card">
      <div class="card-content">
        <h3 class="card-title">Updates</h3>
        ${status}
        <div class="update-foot">
          <span class="muted">Last checked ${timeAgo(info.checkedAt)}</span>
          <button class="btn ghost sm js-check" ${checking ? "disabled" : ""} aria-label="Check for updates now">
            Check now
          </button>
        </div>
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
          <span class="rel-chevron" aria-hidden="true">▾</span>
        </summary>
        <div class="card-content rel-body">${renderMarkdown(info.body)}</div>
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
      <div class="card-content">
        <h3 class="card-title">Features</h3>
        <ul class="feature-list">
          ${feats.map((f) => `<li><span class="feat-check" aria-hidden="true">✓</span><span>${escapeHtml(f)}</span></li>`).join("")}
        </ul>
      </div>
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
      <div class="card-content">
        <h3 class="card-title">Get started</h3>
        <ol class="qs-list">
          ${steps.map(([t, d], i) => `<li class="qs-item">
            <span class="qs-num" aria-hidden="true">${i + 1}</span>
            <div class="qs-text">
              <b>${escapeHtml(t)}</b>
              <span class="muted">${escapeHtml(d)}</span>
            </div>
          </li>`).join("")}
        </ol>
      </div>
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
      <div class="card-content">
        <h3 class="card-title">Technology</h3>
        <ul class="about-stack">
          ${rows.map(([k, v]) => `<li><span>${k}</span><b class="mono">${escapeHtml(v)}</b></li>`).join("")}
        </ul>
      </div>
    </div>`;
}

function systemCard(): string {
  return `
    <div class="card">
      <div class="card-content">
        <h3 class="card-title">System</h3>
        <ul class="about-stack">
          <li><span>App version</span><b class="mono">v${escapeHtml(version || "—")}</b></li>
          <li><span>Platform</span><b class="mono">${escapeHtml(platform || "—")}</b></li>
          <li><span>License</span><b>MIT</b></li>
        </ul>
        <div class="path-row">
          <div class="path-display" title="${escapeHtml(dataDir)}">
            <span class="path-icon" aria-hidden="true">${IC.folder}</span>
            <code class="mono path">${escapeHtml(dataDir || "…")}</code>
          </div>
          <button id="btnOpenDir" class="btn ghost sm" ${dataDir ? "" : "disabled"} aria-label="Open data directory in file explorer">
            Open folder
          </button>
        </div>
        <p class="muted note">config.json, logs/ and desktop-settings.json live in this folder.</p>
        <div class="form-actions">
          <button id="btnCopyInfo" class="btn ghost sm" aria-label="Copy version info to clipboard">
            <span class="btn-copy-default">${IC.copy} Copy version info</span>
            <span class="btn-copy-done">${IC.check} Copied!</span>
          </button>
          <span class="muted note">Paste this when reporting a bug.</span>
        </div>
      </div>
    </div>`;
}

function creditsCard(): string {
  return `
    <div class="card">
      <div class="card-content">
        <h3 class="card-title">Credits</h3>
        <ul class="about-stack">
          <li><span>Author</span><b>Rizki Kotet · ValencyStudio</b></li>
          <li><span>Based on</span><b class="mono">ZeroScript-Free</b></li>
        </ul>
        <p class="muted note">ZeroScript is a modern, improvised take on
        <b>ZeroScript-Free by sebattfg</b> — original code, new ideas, one product.</p>
      </div>
    </div>`;
}

function licenseCard(): string {
  return `
    <div class="card">
      <div class="card-content">
        <h3 class="card-title">License</h3>
        <p class="about-copy">ZeroScript is released under the <b>MIT License</b> — free to use,
        modify and distribute, with attribution. Copyright (c) 2026 Rizki Kotet.</p>
      </div>
      <a class="link-row js-link" data-url="${LICENSE_URL}" href="${LICENSE_URL}" target="_blank" rel="noopener noreferrer">
        <span class="link-ic">${IC.scale}</span>
        <span class="link-text">Read the full MIT license</span>
        <span class="link-arrow" aria-hidden="true">↗</span>
      </a>
    </div>`;
}

function render(info: UpdateInfo): void {
  if (!root) return;
  root.innerHTML = `
    <div class="card about-hero">
      <div class="card-content hero-flex">
        <div class="about-mark" aria-hidden="true"><img src="/icon-1024.png" alt="" /></div>
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
      <div class="card-content">
        <h3 class="card-title">Links</h3>
      </div>
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

  // Event Listeners
  root.querySelectorAll<HTMLAnchorElement>(".js-link").forEach((a) => {
    a.addEventListener("click", (e) => {
      e.preventDefault(); // Prevent default browser navigation, use Tauri's openUrl instead
      openUrl(a.dataset.url!).catch(() => undefined);
    });
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
  const btn = root.querySelector<HTMLButtonElement>("#btnCopyInfo");
  
  const done = (): void => {
    toast("Version info copied", "ok");
    if (btn) {
      btn.classList.add("copied");
      setTimeout(() => btn.classList.remove("copied"), 2000);
    }
  };

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
    if (!checking) render(info);
  });
}