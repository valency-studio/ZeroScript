// SPDX-License-Identifier: GPL-3.0-or-later
import { listen } from "@tauri-apps/api/event";
import { BridgeClient, Snapshot } from "../bridge-ws";
import { bridgeRunning, restartBridge, startBridge, stopBridge } from "../tauri";
import { toast } from "../ui";

let root: HTMLElement;
let running = false;
let busy: "start" | "restart" | null = null;
let snapshot: Snapshot;

function dotClass(s: Snapshot): string {
  if (!s.connected) return "";
  const up = s.servers.filter((x) => x.alive).length;
  const mcpOk = s.mcpAlive || up > 0 || s.tools > 0;
  const studioOff = mcpOk && s.studio === false;
  return mcpOk && !studioOff ? "on" : "warn";
}

function stateText(s: Snapshot): string {
  if (!s.connected) return "Bridge offline — start the bridge below.";
  const up = s.servers.filter((x) => x.alive).length;
  const mcpOk = s.mcpAlive || up > 0 || s.tools > 0;
  const studioOff = mcpOk && s.studio === false;
  if (mcpOk && !studioOff) return "Connected · Roblox Studio ready";
  if (studioOff) return "Studio not connected · enable the MCP server in Studio";
  return "Bridge OK · open Roblox Studio";
}

function mcpOkOf(s: Snapshot): boolean {
  const up = s.servers.filter((x) => x.alive).length;
  return s.mcpAlive || up > 0 || s.tools > 0;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function btnSpinner(label: string): string {
  return `<span class="spinner"></span>${label}…`;
}

/**
 * Getting-started guidance. Only rendered while something is NOT ready - once
 * the bridge + Studio are fully connected the card disappears.
 */
function quickStartCard(s: Snapshot): string {
  const mcpOk = mcpOkOf(s);
  const studioReady = mcpOk && s.studio === true;
  if (s.connected && mcpOk && studioReady) return "";

  const steps = [
    {
      t: "Start the bridge",
      d: s.connected
        ? "The bridge is running."
        : "Click Start Bridge above, or enable auto-start in Settings.",
      done: s.connected,
    },
    {
      t: "Connect Roblox Studio",
      d: mcpOk
        ? "The MCP server is alive."
        : "Open a place, then Assistant Settings → MCP Servers → enable \u201CStudio as MCP server\u201D.",
      done: mcpOk,
    },
    {
      t: "Open an AI chat site",
      d: "Load the browser extension, then press Start Roblox Agent on ChatGPT, DeepSeek, Claude…",
      done: studioReady,
    },
  ];

  return `
    <div class="card quickstart">
      <h3 class="card-title">Quick start</h3>
      <ol class="qs-list">
        ${steps
          .map(
            (st) => `
          <li class="${st.done ? "qs-done" : "qs-next"}">
            <span class="qs-num">${st.done ? "✓" : '<span class="qs-dot"></span>'}</span>
            <div>
              <b>${escapeHtml(st.t)}</b>
              <span class="muted">${escapeHtml(st.d)}</span>
            </div>
          </li>`,
          )
          .join("")}
      </ol>
    </div>`;
}

function render(): void {
  if (!root) return;
  const s = snapshot;
  const up = s.servers.filter((x) => x.alive).length;
  const mcpOk = mcpOkOf(s);

  const serverCards = s.servers
    .map(
      (sv) => `
      <div class="card server-card">
        <div class="server-row">
          <span class="dot sm ${sv.alive ? "on" : ""}"></span>
          <span class="server-id">${escapeHtml(sv.id)}</span>
          <span class="server-tools">${sv.alive ? sv.tools + " tools" : "down"}</span>
        </div>
      </div>`,
    )
    .join("");

  root.innerHTML = `
    <div class="hero card">
      <div class="hero-dot"><span class="dot xl ${dotClass(s)}"></span></div>
      <div class="hero-body">
        <div class="hero-state">${escapeHtml(stateText(s))}</div>
        <div class="hero-meta">
          ${s.connected ? `${s.tools} tools · ${up}/${s.servers.length} servers up` : "not connected"}
        </div>
        <div class="hero-actions">
          <button id="btnStart" class="btn primary" ${running && !busy ? "" : "disabled"}>
            ${busy === "start" ? btnSpinner("Starting") : "Start Bridge"}
          </button>
          <button id="btnStop" class="btn ghost" ${running && !busy ? "" : "disabled"}>Stop Bridge</button>
          <button id="btnRestart" class="btn ghost" ${running && !busy ? "" : "disabled"}>
            ${busy === "restart" ? btnSpinner("Restarting") : "Restart"}
          </button>
        </div>
      </div>
    </div>

    ${quickStartCard(s)}

    <div class="grid-2">
      <div class="card">
        <h3 class="card-title">Roblox Studio</h3>
        <ul class="kv">
          <li><span>MCP server</span><b>${s.studioApp === true ? "Connected" : s.studioApp === false ? "Not connected" : "Unknown"}</b></li>
          <li><span>Place loaded</span><b>${s.studio === true ? "Yes" : s.studio === false ? "No" : "Unknown"}</b></li>
          <li><span>Studio window</span><b>${s.studioProc === true ? "Running" : s.studioProc === false ? "Not running" : "Unknown"}</b></li>
        </ul>
      </div>
      <div class="card">
        <h3 class="card-title">Bridge</h3>
        <ul class="kv">
          <li><span>Process</span><b>${running ? "Running" : "Stopped"}</b></li>
          <li><span>Endpoint</span><b class="mono">ws://127.0.0.1:${s.port}</b></li>
          <li><span>MCP alive</span><b>${mcpOk ? "Yes" : "No"}</b></li>
        </ul>
      </div>
    </div>

    <h3 class="section-title">MCP Servers</h3>
    ${s.servers.length ? `<div class="server-grid">${serverCards}</div>` : `<p class="muted">No MCP servers configured.</p>`}
  `;

  const btn = (id: string) => root.querySelector<HTMLButtonElement>(id)!;
  btn("#btnStart").addEventListener("click", () => {
    busy = "start";
    render();
    startBridge()
      .catch((e) => toast(`Could not start bridge: ${e}`, "err"))
      .finally(() => {
        busy = null;
        refreshRunning();
      });
  });
  btn("#btnStop").addEventListener("click", async () => {
    await stopBridge().catch(() => undefined);
    running = false;
    render();
  });
  btn("#btnRestart").addEventListener("click", () => {
    busy = "restart";
    render();
    restartBridge()
      .catch((e) => toast(`Could not restart bridge: ${e}`, "err"))
      .finally(() => {
        busy = null;
        setTimeout(refreshRunning, 800);
      });
  });
}

async function refreshRunning(): Promise<void> {
  try {
    running = await bridgeRunning();
  } catch {
    running = false;
  }
  render();
}

export function initDashboard(el: HTMLElement, client: BridgeClient): void {
  root = el;
  client.subscribe((s) => {
    snapshot = s;
    render();
  });
  // The sidecar terminating (stop button, tray, crash) is the authoritative
  // "process is gone" signal - update the running flag immediately instead of
  // waiting up to 4s for the bridgeRunning() poll (which would leave the
  // Bridge card and buttons contradicting the offline hero).
  listen("bridge-exit", () => {
    running = false;
    busy = null;
    render();
  }).catch(() => undefined);
  refreshRunning();
  setInterval(refreshRunning, 4000);
}
