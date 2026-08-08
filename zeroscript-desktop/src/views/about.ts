// SPDX-License-Identifier: GPL-3.0-or-later
import { getAppInfo, openUrl } from "../tauri";
import { GITHUB_RELEASES_PAGE, UpdateInfo, updates } from "../update";

let root: HTMLElement;
let version = "";
let osName = "";
let checking = false;

const REPO_URL = "https://github.com/valency-studio/ZeroScript";
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

function updateCard(info: UpdateInfo): string {
  let status = "";
  if (checking) {
    status = `<div class="update-status checking"><span class="spinner"></span> Checking for updates…</div>`;
  } else if (info.error) {
    status = `
      <div class="update-status err">
        Could not check for updates (${escapeHtml(info.error)}).
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
          <span class="badge mono">${escapeHtml(osName)}</span>
        </div>
      </div>
    </div>

    ${updateCard(info)}

    <div class="card">
      <h3 class="card-title">About</h3>
      <p class="about-copy">
        ZeroScript lets your favourite AI chat site (DeepSeek, ChatGPT, Claude,
        Gemini and 30+ more) control Roblox Studio in real time — create parts,
        write and run Luau, and inspect your place. This desktop app runs the
        ZeroScript bridge behind a modern interface: no Python, no Node.js, no
        terminal required.
      </p>
      <ul class="about-stack">
        <li><span>Desktop shell</span><b>Tauri 2 (Rust)</b></li>
        <li><span>Interface</span><b>Vite · TypeScript</b></li>
        <li><span>Bridge</span><b>Python (PyInstaller sidecar)</b></li>
        <li><span>Protocol</span><b>MCP · WebSocket :17613</b></li>
      </ul>
    </div>

    <div class="card">
      <h3 class="card-title">Links</h3>
      <div class="link-list">
        <button class="link-row js-link" data-url="${REPO_URL}">
          <span class="link-ic">⌘</span><span>GitHub repository</span><span class="link-arrow">↗</span>
        </button>
        <button class="link-row js-link" data-url="${GITHUB_RELEASES_PAGE}">
          <span class="link-ic">⬇</span><span>Releases & downloads</span><span class="link-arrow">↗</span>
        </button>
        <button class="link-row js-link" data-url="${SUPPORT_URL}">
          <span class="link-ic">♥</span><span>Support on Trakteer</span><span class="link-arrow">↗</span>
        </button>
        <button class="link-row js-link" data-url="${ORIGINAL_URL}">
          <span class="link-ic">⤷</span><span>Original project (ZeroScript-Free)</span><span class="link-arrow">↗</span>
        </button>
      </div>
      <p class="muted note">MIT License · built as a modern take on ZeroScript-Free.</p>
    </div>
  `;

  root.querySelectorAll<HTMLButtonElement>(".js-link").forEach((b) => {
    b.addEventListener("click", () => openUrl(b.dataset.url!).catch(() => undefined));
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
}

export function initAbout(el: HTMLElement): void {
  root = el;
  getAppInfo()
    .then((i) => {
      version = i.version;
      osName = i.os;
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
