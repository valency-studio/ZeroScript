// SPDX-License-Identifier: GPL-3.0-or-later
import { listen } from "@tauri-apps/api/event";
import { BridgeClient } from "./bridge-ws";
import { getAppInfo } from "./tauri";
import { initDashboard } from "./views/dashboard";
import { appendLog, initLogs } from "./views/logs";
import { initServers } from "./views/servers";
import { initSettings } from "./views/settings";
import "./styles.css";

const client = new BridgeClient();

// ── navigation ─────────────────────────────────────────────────────────────
const navButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".nav-item"));
const panels = Array.from(document.querySelectorAll<HTMLElement>(".view"));

function showView(name: string): void {
  navButtons.forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  panels.forEach((p) => p.classList.toggle("active", p.dataset.viewPanel === name));
}

navButtons.forEach((b) => {
  b.addEventListener("click", () => showView(b.dataset.view!));
});

// ── bootstrap views ────────────────────────────────────────────────────────
initDashboard(document.getElementById("dashRoot")!, client);
initLogs(document.getElementById("logs")!);
initServers(document.getElementById("serversRoot")!, client);
initSettings(document.getElementById("settingsRoot")!, client);

// ── bridge events from Rust (sidecar stdout/stderr) ───────────────────────
listen<string>("bridge-log", (e) => appendLog(e.payload)).catch(() => undefined);
listen<number>("bridge-exit", () => {
  appendLog("\n[bridge] process exited — bridge stopped.\n");
}).catch(() => undefined);

// ── sidebar mini status ────────────────────────────────────────────────────
const miniDot = document.getElementById("miniDot")!;
const miniState = document.getElementById("miniState")!;
client.subscribe((s) => {
  miniDot.className = "dot mini" + (s.connected ? " on" : "");
  miniState.textContent = s.connected ? "Bridge online" : "Bridge offline";
});

// ── version badge ──────────────────────────────────────────────────────────
getAppInfo()
  .then((info) => {
    document.getElementById("appVer")!.textContent = info.version;
  })
  .catch(() => undefined);

client.connect();

// Keep the status fresh while the app is open.
setInterval(() => {
  client.request("studio_status");
  client.request("list_tools");
}, 5000);
