// SPDX-License-Identifier: GPL-3.0-or-later
import { isEnabled, enable, disable } from "@tauri-apps/plugin-autostart";
import { BridgeClient, Snapshot } from "../bridge-ws";
import { getAppInfo, getDataDir, getSettings, openDataDir, setStartBridgeOnLaunch } from "../tauri";
import { toast } from "../ui";

let root: HTMLElement;

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

  client.subscribe((s: Snapshot) => {
    port = s.port;
    render();
  });
  getDataDir()
    .then((d) => {
      dir = d;
      render();
    })
    .catch(() => undefined);
  getAppInfo()
    .then((i) => {
      info = i;
      render();
    })
    .catch(() => undefined);
  isEnabled()
    .then((v) => {
      autostart = v;
      render();
    })
    .catch(() => undefined);
  getSettings()
    .then((s) => {
      startOnLaunch = s.start_bridge_on_launch;
      render();
    })
    .catch(() => undefined);

  function render(): void {
    if (!root) return;
    root.innerHTML = `
      <div class="card">
        <h3 class="card-title">Data location</h3>
        <p class="muted">config.json and logs/ live here. The bridge is started with ZS_DATA_DIR pointing at it.</p>
        <div class="path-row">
          <code id="dataDir" class="mono path">${escapeHtml(dir || "…")}</code>
          <button id="btnOpenDir" class="btn ghost sm" ${dir ? "" : "disabled"}>Open folder</button>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">Startup</h3>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">Start the bridge when ZeroScript opens</div>
            <div class="muted">No manual Start click needed — the bridge boots in the background.</div>
          </div>
          <label class="switch">
            <input id="startOnLaunchToggle" type="checkbox" ${startOnLaunch ? "checked" : ""} />
            <span class="slider"></span>
          </label>
        </div>
        <div class="toggle-row">
          <div>
            <div class="toggle-label">Start ZeroScript with login</div>
            <div class="muted">Uses the OS autostart mechanism for this user.</div>
          </div>
          <label class="switch">
            <input id="autostartToggle" type="checkbox" ${autostart ? "checked" : ""} />
            <span class="slider"></span>
          </label>
        </div>
      </div>

      <div class="card">
        <h3 class="card-title">General</h3>
        <ul class="kv">
          <li><span>App version</span><b class="mono">v${escapeHtml(info.version)}</b></li>
          <li><span>Platform</span><b class="mono">${escapeHtml(info.os)}</b></li>
          <li><span>Bridge port</span><b class="mono">${port}</b></li>
        </ul>
        <p class="muted note">The browser extension is still the way ZeroScript talks to AI chat sites —
        this app runs and supervises the bridge behind a modern interface.
        Version, updates and links live in the About view.</p>
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
        render();
      });
    });
    root.querySelector<HTMLInputElement>("#autostartToggle")!.addEventListener("change", (e) => {
      const on = (e.target as HTMLInputElement).checked;
      autostart = on; // keep the closure var in sync so re-renders keep the state
      (on ? enable() : disable()).catch(() => {
        autostart = !on;
        render();
      });
    });
  }
}
