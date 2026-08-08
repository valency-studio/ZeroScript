// SPDX-License-Identifier: GPL-3.0-or-later
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
import { BridgeClient, Snapshot } from "../bridge-ws";
import { getAppInfo, getDataDir, getSettings, openDataDir, setStartBridgeOnLaunch } from "../tauri";
import { toast } from "../ui";

let root: HTMLElement;

const IC = {
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2a2 2 0 0 0-1.66-.9H3a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2z"/></svg>',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function initSettings(el: HTMLElement, client: BridgeClient): void {
  root = el;
  let autostart = false;
  let startOnLaunch = false;
  let dir = "";
  let info = { version: "—", os: "" };
  let port = 17613;

  function updateStaticUI(): void {
    const dirEl = root.querySelector<HTMLElement>("#dataDir");
    const btnOpen = root.querySelector<HTMLButtonElement>("#btnOpenDir");
    if (dirEl) dirEl.textContent = dir || "…";
    if (dirEl) dirEl.setAttribute("title", dir);
    if (btnOpen) btnOpen.disabled = !dir;

    const versionEl = root.querySelector<HTMLElement>("#appVersion");
    if (versionEl) versionEl.textContent = `v${info.version}`;

    const osEl = root.querySelector<HTMLElement>("#appOs");
    if (osEl) osEl.textContent = info.os || "—";

    const portEl = root.querySelector<HTMLElement>("#bridgePort");
    if (portEl) portEl.textContent = String(port);

    const startToggle = root.querySelector<HTMLInputElement>("#startOnLaunchToggle");
    if (startToggle) startToggle.checked = startOnLaunch;

    const autoToggle = root.querySelector<HTMLInputElement>("#autostartToggle");
    if (autoToggle) autoToggle.checked = autostart;
  }

  function render(): void {
    if (!root) return;
    root.innerHTML = `
      <div class="card">
        <div class="card-content">
          <h3 class="card-title">Data location</h3>
          <p class="muted">config.json and logs/ live here. The bridge is started with ZS_DATA_DIR pointing at it.</p>
          <div class="path-row">
            <div class="path-display">
              <span class="path-icon" aria-hidden="true">${IC.folder}</span>
              <code id="dataDir" class="mono path">…</code>
            </div>
            <button id="btnOpenDir" class="btn ghost sm" disabled aria-label="Open data directory in file explorer">
              Open folder
            </button>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-content">
          <h3 class="card-title">Startup</h3>
          
          <div class="toggle-row">
            <div class="toggle-info">
              <div class="toggle-label">Start the bridge when ZeroScript opens</div>
              <div class="muted">No manual Start click needed — the bridge boots in the background.</div>
            </div>
            <label class="switch">
              <input id="startOnLaunchToggle" type="checkbox" aria-label="Toggle start bridge on launch" />
              <span class="slider"></span>
            </label>
          </div>

          <div class="toggle-row">
            <div class="toggle-info">
              <div class="toggle-label">Start ZeroScript with login</div>
              <div class="muted">Uses the OS autostart mechanism for this user.</div>
            </div>
            <label class="switch">
              <input id="autostartToggle" type="checkbox" aria-label="Toggle start with OS login" />
              <span class="slider"></span>
            </label>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-content">
          <h3 class="card-title">General</h3>
          <ul class="kv">
            <li><span>App version</span><b id="appVersion" class="mono">v—</b></li>
            <li><span>Platform</span><b id="appOs" class="mono">—</b></li>
            <li><span>Bridge port</span><b id="bridgePort" class="mono">—</b></li>
          </ul>
          <p class="muted note">The browser extension is still the way ZeroScript talks to AI chat sites —
          this app runs and supervises the bridge behind a modern interface.
          Version, updates and links live in the About view.</p>
        </div>
      </div>
    `;

    root.querySelector<HTMLButtonElement>("#btnOpenDir")!.addEventListener("click", () => {
      openDataDir().catch(() => undefined);
    });

    root.querySelector<HTMLInputElement>("#startOnLaunchToggle")!.addEventListener("change", (e) => {
      const on = (e.target as HTMLInputElement).checked;
      startOnLaunch = on; // keep the closure var in sync so re-renders keep the state
      setStartBridgeOnLaunch(on).catch(() => {
        startOnLaunch = !on;
        toast("Could not save the setting", "err");
        updateStaticUI();
      });
    });

    root.querySelector<HTMLInputElement>("#autostartToggle")!.addEventListener("change", (e) => {
      const on = (e.target as HTMLInputElement).checked;
      autostart = on; // keep the closure var in sync so re-renders keep the state
      (on ? enable() : disable()).catch(() => {
        autostart = !on;
        toast("Could not change OS autostart setting", "err");
        updateStaticUI();
      });
    });

    updateStaticUI();
  }

  // Initial render
  render();

  // Subscribe to port changes
  client.subscribe((s: Snapshot) => {
    port = s.port;
    updateStaticUI();
  });

  // Fetch async data
  getDataDir()
    .then((d) => {
      dir = d;
      updateStaticUI();
    })
    .catch(() => undefined);
    
  getAppInfo()
    .then((i) => {
      info = i;
      updateStaticUI();
    })
    .catch(() => undefined);
    
  isEnabled()
    .then((v) => {
      autostart = v;
      updateStaticUI();
    })
    .catch(() => undefined);
    
  getSettings()
    .then((s) => {
      startOnLaunch = s.start_bridge_on_launch;
      updateStaticUI();
    })
    .catch(() => undefined);
}