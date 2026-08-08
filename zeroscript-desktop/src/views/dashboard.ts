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
};

// ============================================================================
// Helpers
// ============================================================================

function dotClass(s: Snapshot): string {
    if (!s.connected) {
        return "";
    }

    const up = s.servers.filter((server) => server.alive).length;
    const mcpOk = s.mcpAlive || up > 0 || s.tools > 0;
    const studioOff = mcpOk && s.studio === false;

    return mcpOk && !studioOff ? "on" : "warn";
}

function stateText(s: Snapshot): string {
    if (!s.connected) {
        return "Bridge offline — start the bridge below.";
    }

    const up = s.servers.filter((server) => server.alive).length;
    const mcpOk = s.mcpAlive || up > 0 || s.tools > 0;
    const studioOff = mcpOk && s.studio === false;

    if (mcpOk && !studioOff) {
        return "Connected · Roblox Studio ready";
    }

    if (studioOff) {
        return "Studio not connected · enable the MCP server in Studio";
    }

    return "Bridge OK · open Roblox Studio";
}

function mcpOkOf(s: Snapshot): boolean {
    const up = s.servers.filter((server) => server.alive).length;
    return s.mcpAlive || up > 0 || s.tools > 0;
}

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
// Quick start
// ============================================================================

/**
 * Getting-started guidance.
 *
 * Only rendered while something is not ready.
 * Once Bridge + MCP + Studio are fully connected,
 * the card disappears.
 */
function quickStartCard(s: Snapshot): string {
    const mcpOk = mcpOkOf(s);
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
    const up = s.servers.filter((server) => server.alive).length;
    const mcpOk = mcpOkOf(s);

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

    const toolsMeta = s.connected
        ? `${s.tools} tools · ${up}/${s.servers.length} servers up`
        : "not connected";

    const studioAppStatus = boolText(s.studioApp, "Connected", "Not connected");
    const studioStatus = boolText(s.studio, "Yes", "No");
    const studioProcessStatus = boolText(s.studioProc, "Running", "Not running");

    root.innerHTML = `
        <div class="hero card" role="status" aria-live="polite">
            <div class="hero-dot">
                <span class="dot xl ${dotClass(s)}" aria-hidden="true"></span>
            </div>

            <div class="hero-body">
                <div class="hero-state">
                    ${escapeHtml(stateText(s))}
                </div>

                <div class="hero-meta">
                    ${escapeHtml(toolsMeta)}
                </div>

                <div class="hero-actions">
                    <button id="btnStart" class="btn primary" ${!running && !busy ? "" : "disabled"} aria-label="Start bridge">
                        ${busy === "start" ? btnSpinner("Starting") : `${IC.play} Start Bridge`}
                    </button>

                    <button id="btnStop" class="btn ghost danger" ${running && !busy ? "" : "disabled"} aria-label="Stop bridge">
                        ${busy === "stop" ? btnSpinner("Stopping") : `${IC.stop} Stop Bridge`}
                    </button>

                    <button id="btnRestart" class="btn ghost" ${running && !busy ? "" : "disabled"} aria-label="Restart bridge">
                        ${busy === "restart" ? btnSpinner("Restarting") : `${IC.refresh} Restart`}
                    </button>
                </div>
            </div>
        </div>

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