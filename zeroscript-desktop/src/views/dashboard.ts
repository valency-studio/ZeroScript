// SPDX-License-Identifier: GPL-3.0-or-later

import { listen } from "@tauri-apps/api/event";

import { BridgeClient, Snapshot } from "../bridge-ws";
import {
    bridgeRunning,
    restartBridge,
    startBridge,
    stopBridge,
} from "../tauri";
import { toast } from "../ui";

// ============================================================================
// State
// ============================================================================

let root: HTMLElement | null = null;
let running = false;
let busy: "start" | "restart" | "stop" | null = null;
let snapshot: Snapshot | null = null;

// ============================================================================
// Icons
// ============================================================================

const IC = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true" focusable="false"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
    globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9" y="9" width="6" height="6" rx="1"/><path d="M9 1v3M15 1v3M9 20v3M15 20v3M1 9h3M1 15h3M20 9h3M20 15h3"/></svg>',
    box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true" focusable="false"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></svg>',
};

// ============================================================================
// Helpers
// ============================================================================

function escapeHtml(value: string): string {
    return value.replace(
        /[&<>"']/g,
        (character) => {
            switch (character) {
                case "&": return "&amp;";
                case "<": return "&lt;";
                case ">": return "&gt;";
                case '"': return "&quot;";
                case "'": return "&#039;";
                default: return character;
            }
        },
    );
}

function btnSpinner(label: string): string {
    return `<span class="spinner"></span>${escapeHtml(label)}…`;
}

function boolText(val: boolean | undefined | null, yes: string, no: string, unknown: string = "Unknown"): string {
    if (val === true) return yes;
    if (val === false) return no;
    return unknown;
}

// ============================================================================
// Connection map (signature element)
// ============================================================================

function connectionMap(s: Snapshot): string {
    const bridgeUp = s.connected;
    const studioUp = bridgeUp && (s.mcpAlive || s.servers.filter((sv) => sv.alive).length > 0 || s.tools > 0);
    const studioConnected = studioUp && s.studio === true;

    return `
        <div class="connection-map" role="status" aria-live="polite">
            <div class="cm-nodes">
                <!-- AI Chat node -->
                <div class="cm-node ${bridgeUp ? "active" : ""}">
                    <div class="cm-node-icon">${IC.globe}</div>
                    <span class="cm-node-label">AI Chat</span>
                </div>

                <!-- Connector: AI Chat → Bridge -->
                <div class="cm-connector ${bridgeUp ? "active" : ""}"></div>

                <!-- Bridge node -->
                <div class="cm-node ${bridgeUp ? "active" : ""}">
                    <div class="cm-node-icon">${IC.cpu}</div>
                    <span class="cm-node-label">Bridge</span>
                </div>

                <!-- Connector: Bridge → Studio -->
                <div class="cm-connector ${studioUp ? "active" : ""} ${studioConnected ? "reverse" : ""}"></div>

                <!-- Studio node -->
                <div class="cm-node ${studioConnected ? "active" : ""}">
                    <div class="cm-node-icon">${IC.box}</div>
                    <span class="cm-node-label">Studio</span>
                </div>
            </div>

            <div class="cm-status-bar">
                <div class="cm-status-item">
                    <span class="dot sm ${bridgeUp ? "on" : ""}" aria-hidden="true"></span>
                    <span>Bridge <b>${bridgeUp ? "online" : "offline"}</b></span>
                </div>
                <div class="cm-status-item">
                    <span class="dot sm ${studioUp ? "on" : ""}" aria-hidden="true"></span>
                    <span>MCP <b>${studioUp ? "alive" : "down"}</b></span>
                </div>
                <div class="cm-status-item">
                    <span class="dot sm ${studioConnected ? "on" : ""}" aria-hidden="true"></span>
                    <span>Place <b>${studioConnected ? "loaded" : "no"}</b></span>
                </div>
                <div class="cm-status-item">
                    <span class="dot sm ${s.tools > 0 ? "on" : ""}" aria-hidden="true"></span>
                    <span><b>${s.tools}</b> tools</span>
                </div>
            </div>
        </div>
    `;
}

// ============================================================================
// Action bar
// ============================================================================

function actionBar(s: Snapshot): string {
    const toolsMeta = s.connected
        ? `${s.tools} tools · ${s.servers.filter((sv) => sv.alive).length}/${s.servers.length} servers up`
        : "not connected";

    return `
        <div class="action-bar">
            <button id="btnStart" class="btn primary" ${!running && !busy ? "" : "disabled"} aria-label="Start bridge">
                ${busy === "start" ? btnSpinner("Starting") : `${IC.play} Start Bridge`}
            </button>

            <button id="btnStop" class="btn ghost danger" ${running && !busy ? "" : "disabled"} aria-label="Stop bridge">
                ${busy === "stop" ? btnSpinner("Stopping") : `${IC.stop} Stop`}
            </button>

            <button id="btnRestart" class="btn ghost" ${running && !busy ? "" : "disabled"} aria-label="Restart bridge">
                ${busy === "restart" ? btnSpinner("Restarting") : `${IC.refresh} Restart`}
            </button>

            <span class="spacer"></span>

            <span class="muted mono" style="font-size: var(--text-sm)">${escapeHtml(toolsMeta)}</span>
        </div>
    `;
}

// ============================================================================
// Quick start
// ============================================================================

function quickStartCard(s: Snapshot): string {
    const mcpOk = s.mcpAlive || s.servers.filter((sv) => sv.alive).length > 0 || s.tools > 0;
    const studioReady = mcpOk && s.studio === true;

    if (s.connected && mcpOk && studioReady) {
        return "";
    }

    const steps = [
        {
            title: "Start the bridge",
            description: s.connected
                ? "The bridge is running."
                : "Click Start Bridge above, or enable auto-start in Settings.",
            done: s.connected,
        },
        {
            title: "Connect Roblox Studio",
            description: mcpOk
                ? "The MCP server is alive."
                : 'Open a place, then Assistant Settings → MCP Servers → enable "Studio as MCP server".',
            done: mcpOk,
        },
        {
            title: "Open an AI chat site",
            description: "Load the browser extension, then press Start Roblox Agent on ChatGPT, DeepSeek, Claude…",
            done: studioReady,
        },
    ];

    return `
        <div class="card quickstart">
            <div class="card-content">
                <h3 class="card-title">Quick start</h3>
                <ol class="qs-list">
                    ${steps.map((step, i) => `
                        <li class="qs-item ${step.done ? "qs-done" : ""}">
                            <span class="qs-num" aria-hidden="true">${i + 1}</span>
                            <div class="qs-text">
                                <b>${escapeHtml(step.title)}</b>
                                <span class="muted">${escapeHtml(step.description)}</span>
                            </div>
                        </li>
                    `).join("")}
                </ol>
            </div>
        </div>
    `;
}

// ============================================================================
// Dashboard rendering
// ============================================================================

function render(): void {
    if (!root || !snapshot) {
        return;
    }

    const s = snapshot;
    const mcpOk = s.mcpAlive || s.servers.filter((sv) => sv.alive).length > 0 || s.tools > 0;

    const serverCards = s.servers
        .map((server) => `
            <div class="card server-card">
                <div class="server-row">
                    <span class="dot sm ${server.alive ? "on" : ""}" aria-hidden="true"></span>
                    <span class="server-id">${escapeHtml(server.id)}</span>
                    <span class="server-tools">
                        ${server.alive ? `${server.tools} tools` : "down"}
                    </span>
                </div>
            </div>
        `)
        .join("");

    const studioAppStatus = boolText(s.studioApp, "Connected", "Not connected");
    const studioStatus = boolText(s.studio, "Yes", "No");
    const studioProcessStatus = boolText(s.studioProc, "Running", "Not running");

    root.innerHTML = `
        ${connectionMap(s)}
        ${actionBar(s)}
        ${quickStartCard(s)}

        <div class="grid-2">
            <div class="card">
                <div class="card-content">
                    <h3 class="card-title">Roblox Studio</h3>
                    <ul class="kv">
                        <li><span>MCP server</span><b>${studioAppStatus}</b></li>
                        <li><span>Place loaded</span><b>${studioStatus}</b></li>
                        <li><span>Studio window</span><b>${studioProcessStatus}</b></li>
                    </ul>
                </div>
            </div>

            <div class="card">
                <div class="card-content">
                    <h3 class="card-title">Bridge</h3>
                    <ul class="kv">
                        <li><span>Process</span><b>${running ? "Running" : "Stopped"}</b></li>
                        <li><span>Endpoint</span><b class="mono">ws://127.0.0.1:${s.port}</b></li>
                        <li><span>MCP alive</span><b>${mcpOk ? "Yes" : "No"}</b></li>
                    </ul>
                </div>
            </div>
        </div>

        <h3 class="section-title">MCP Servers</h3>

        ${
            s.servers.length
                ? `<div class="server-grid">${serverCards}</div>`
                : `
                    <div class="card">
                        <div class="card-content">
                            <p class="muted" style="text-align: center; margin: 0;">No MCP servers configured.</p>
                        </div>
                    </div>
                `
        }
    `;

    // ========================================================================
    // Button handlers
    // ========================================================================

    root.querySelector<HTMLButtonElement>("#btnStart")?.addEventListener("click", async () => {
        if (busy || running) return;
        busy = "start";
        render();
        try {
            await startBridge();
            running = true;
            toast("Bridge started", "ok");
        } catch (error) {
            toast(`Could not start bridge: ${String(error)}`, "err");
        } finally {
            busy = null;
            await refreshRunning();
        }
    });

    root.querySelector<HTMLButtonElement>("#btnStop")?.addEventListener("click", async () => {
        if (busy || !running) return;
        busy = "stop";
        render();
        try {
            await stopBridge();
            running = false;
            toast("Bridge stopped", "ok");
        } catch (error) {
            toast(`Could not stop bridge: ${String(error)}`, "err");
        } finally {
            busy = null;
            await refreshRunning();
        }
    });

    root.querySelector<HTMLButtonElement>("#btnRestart")?.addEventListener("click", async () => {
        if (busy || !running) return;
        busy = "restart";
        render();
        try {
            await restartBridge();
            running = true;
            toast("Bridge restarted", "ok");
        } catch (error) {
            toast(`Could not restart bridge: ${String(error)}`, "err");
        } finally {
            busy = null;
            await refreshRunning();
        }
    });
}

// ============================================================================
// Bridge process state
// ============================================================================

async function refreshRunning(): Promise<void> {
    try {
        running = await bridgeRunning();
    } catch {
        running = false;
    }
    render();
}

// ============================================================================
// Initialization
// ============================================================================

export function initDashboard(element: HTMLElement, client: BridgeClient): void {
    root = element;

    client.subscribe((state) => {
        snapshot = state;
        render();
    });

    listen<boolean | { running: boolean }>("bridge-state", (event) => {
        const payload = event.payload;
        const isRunning = typeof payload === "boolean" ? payload : payload.running;
        running = isRunning;
        if (!isRunning) {
            busy = null;
        }
        render();
    }).catch((error) => {
        console.warn("Failed to listen for bridge-state:", error);
    });

    listen<number | { code: number; intentional: boolean }>("bridge-exit", () => {
        running = false;
        busy = null;
        render();
    }).catch((error) => {
        console.warn("Failed to listen for bridge-exit:", error);
    });

    void refreshRunning();

    window.setInterval(() => {
        void refreshRunning();
    }, 4000);
}
