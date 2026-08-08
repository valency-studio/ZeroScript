// SPDX-License-Identifier: GPL-3.0-or-later
import { listen } from "@tauri-apps/api/event";
import { BridgeClient } from "./bridge-ws";
import { getAppInfo } from "./tauri";
import { toast } from "./ui";
import { UPDATE_CHECK_MS, updates } from "./update";
import { initAbout } from "./views/about";
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

// Keyboard navigation: Ctrl/Cmd+1..5 jumps between views.
const VIEW_ORDER = ["dashboard", "logs", "servers", "settings", "about"];
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key >= "1" && e.key <= "5") {
    const view = VIEW_ORDER[Number(e.key) - 1];
    if (view) {
      e.preventDefault();
      showView(view);
    }
  }
});

// ── bootstrap views ────────────────────────────────────────────────────────
initDashboard(document.getElementById("dashRoot")!, client);
initLogs(document.getElementById("logs")!);
initServers(document.getElementById("serversRoot")!, client);
initSettings(document.getElementById("settingsRoot")!, client);
initAbout(document.getElementById("aboutRoot")!);

// ── bridge events from Rust (sidecar stdout/stderr) ───────────────────────
listen<string>("bridge-log", (e) => appendLog(e.payload)).catch(() => undefined);

// FIXED: payload was bare number, now { code: number; intentional: boolean }.
// Previously the callback was `() => ...` so the payload was never read at all,
// meaning a manual stop and a crash showed the same message and toast.
interface BridgeExitPayload {
  /** OS exit code of the bridge process; -1 if unknown. */
  code: number;
  /** true = user clicked Stop / Restart; false = crash or external kill. */
  intentional: boolean;
}

listen<BridgeExitPayload>("bridge-exit", (e) => {
  const { code, intentional } = e.payload;

  if (intentional) {
    // User explicitly stopped the bridge — neutral log, neutral toast.
    appendLog("\n[bridge] process stopped by user.\n");
    toast("Bridge stopped");
  } else {
    // Unexpected exit: show exit code so the user can diagnose it.
    appendLog(`\n[bridge] process exited unexpectedly (code ${code}).\n`);
    toast(`Bridge crashed (exit ${code})`);
  }

  // Either way, force the client offline immediately instead of waiting for
  // the dead-socket timeout (which can lag for a long time).
  client.forceOffline();
}).catch(() => undefined);

// ── sidebar mini status ────────────────────────────────────────────────────
const miniDot = document.getElementById("miniDot")!;
const miniState = document.getElementById("miniState")!;
client.subscribe((s) => {
  miniDot.className = "dot mini" + (s.connected ? " on" : "");
  miniState.textContent = s.connected ? "Bridge online" : "Bridge offline";
});

// ── version badge + update checks ─────────────────────────────────────────
// The version is synced from zeroscript-extension/manifest.json at build time
// (scripts/sync-version.mjs), so this is always the manifest version.
getAppInfo()
  .then((info) => {
    document.getElementById("appVer")!.textContent = info.version;
    updates.setCurrent(info.version);
    updates.check().catch(() => undefined); // background check on startup
  })
  .catch(() => undefined);
setInterval(() => updates.check().catch(() => undefined), UPDATE_CHECK_MS);

// Little amber dot on the About nav item when an update is available.
updates.subscribe((info) => {
  const dot = document.getElementById("aboutDot")!;
  dot.style.display = info.available ? "block" : "none";
  dot.className = "dot mini warn";
});

client.connect();

// Keep the status fresh while the app is open.
setInterval(() => {
  client.request("studio_status");
  client.request("list_tools");
}, 5000);