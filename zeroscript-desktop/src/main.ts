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

// ============================================================================
// Bridge client
// ============================================================================

const client = new BridgeClient();

// ============================================================================
// Navigation
// ============================================================================

const navButtons = Array.from(
    document.querySelectorAll<HTMLElement>(".nav-item"),
);

const panels = Array.from(
    document.querySelectorAll<HTMLElement>(".view"),
);

function showView(name: string): void {
    navButtons.forEach((button) => {
        button.classList.toggle(
            "active",
            button.dataset.view === name,
        );
    });

    panels.forEach((panel) => {
        panel.classList.toggle(
            "active",
            panel.dataset.viewPanel === name,
        );
    });
}

navButtons.forEach((button) => {
    button.addEventListener("click", () => {
        const view = button.dataset.view;

        if (view) {
            showView(view);
        }
    });
});

// ============================================================================
// Keyboard navigation
// ============================================================================

const VIEW_ORDER = [
    "dashboard",
    "logs",
    "servers",
    "settings",
    "about",
] as const;

window.addEventListener("keydown", (event) => {
    if (
        !event.ctrlKey &&
        !event.metaKey
    ) {
        return;
    }

    if (
        event.altKey ||
        event.shiftKey ||
        event.key < "1" ||
        event.key > "5"
    ) {
        return;
    }

    const index = Number(event.key) - 1;
    const view = VIEW_ORDER[index];

    if (!view) {
        return;
    }

    event.preventDefault();
    showView(view);
});

// ============================================================================
// Bootstrap views
// ============================================================================

const dashRoot = document.getElementById("dashRoot");
const logsRoot = document.getElementById("logs");
const serversRoot = document.getElementById("serversRoot");
const settingsRoot = document.getElementById("settingsRoot");
const aboutRoot = document.getElementById("aboutRoot");

if (!dashRoot) {
    throw new Error("Missing #dashRoot element");
}

if (!logsRoot) {
    throw new Error("Missing #logs element");
}

if (!serversRoot) {
    throw new Error("Missing #serversRoot element");
}

if (!settingsRoot) {
    throw new Error("Missing #settingsRoot element");
}

if (!aboutRoot) {
    throw new Error("Missing #aboutRoot element");
}

initDashboard(dashRoot, client);
initLogs(logsRoot);
initServers(serversRoot, client);
initSettings(settingsRoot, client);
initAbout(aboutRoot);

// ============================================================================
// Bridge events from Rust
// ============================================================================

interface BridgeExitPayload {
    /**
     * OS exit code of the bridge process.
     *
     * -1 means the exit code is unknown.
     */
    code: number;

    /**
     * True when the process was intentionally stopped by the application.
     */
    intentional: boolean;
}

interface BridgeStatePayload {
    running: boolean;
    pid?: number;
}

// ---------------------------------------------------------------------------
// Bridge log
// ---------------------------------------------------------------------------

listen<string>("bridge-log", (event) => {
    appendLog(event.payload);
}).catch((error) => {
    console.error("Failed to listen for bridge-log:", error);
});

// ---------------------------------------------------------------------------
// Bridge state
// ---------------------------------------------------------------------------

listen<BridgeStatePayload | boolean>("bridge-state", (event) => {
    const payload = event.payload;

    const running =
        typeof payload === "boolean"
            ? payload
            : payload.running;

    if (!running) {
        client.forceOffline();
    }
}).catch((error) => {
    console.error("Failed to listen for bridge-state:", error);
});

// ---------------------------------------------------------------------------
// Bridge exit
// ---------------------------------------------------------------------------

listen<number | BridgeExitPayload>("bridge-exit", (event) => {
    const payload = event.payload;

    /*
     * Backward compatibility:
     *
     * Older Rust code emitted:
     *
     *     bridge-exit -> number
     *
     * Newer Rust code may emit:
     *
     *     bridge-exit -> { code, intentional }
     *
     * Accept both formats so frontend upgrades do not immediately break
     * when an older backend is still running.
     */

    const exit: BridgeExitPayload =
        typeof payload === "number"
            ? {
                  code: payload,
                  intentional: false,
              }
            : {
                  code: payload.code ?? -1,
                  intentional: payload.intentional ?? false,
              };

    if (exit.intentional) {
        appendLog(
            "\n[bridge] process stopped by user.\n",
        );

        toast("Bridge stopped");
    } else {
        appendLog(
            `\n[bridge] process exited unexpectedly (code ${exit.code}).\n`,
        );

        toast(
            `Bridge crashed (exit ${exit.code})`,
        );
    }

    /*
     * Immediately mark the WebSocket client offline.
     *
     * Without this, the UI may remain "online" until the WebSocket timeout
     * expires.
     */
    client.forceOffline();
}).catch((error) => {
    console.error("Failed to listen for bridge-exit:", error);
});

// ============================================================================
// Sidebar bridge status
// ============================================================================

const miniDot = document.getElementById("miniDot");
const miniState = document.getElementById("miniState");

if (!miniDot) {
    throw new Error("Missing #miniDot element");
}

if (!miniState) {
    throw new Error("Missing #miniState element");
}

client.subscribe((state) => {
    const connected = state.connected;

    miniDot.className = connected
        ? "dot mini on"
        : "dot mini";

    miniState.textContent = connected
        ? "Bridge online"
        : "Bridge offline";
});

// ============================================================================
// Version badge + update checks
// ============================================================================

const appVersion = document.getElementById("appVer");

getAppInfo()
    .then((info) => {
        if (appVersion) {
            appVersion.textContent = info.version;
        }

        updates.setCurrent(info.version);

        // Background update check.
        return updates.check();
    })
    .catch((error) => {
        console.warn(
            "Failed to initialize application version/update check:",
            error,
        );
    });

const updateInterval = window.setInterval(() => {
    updates.check().catch((error) => {
        console.warn(
            "Background update check failed:",
            error,
        );
    });
}, UPDATE_CHECK_MS);

// ============================================================================
// Update indicator
// ============================================================================

updates.subscribe((info) => {
    const dot = document.getElementById("aboutDot");

    if (!dot) {
        return;
    }

    dot.style.display = info.available
        ? "block"
        : "none";

    dot.className = "dot mini warn";
});

// ============================================================================
// Bridge connection
// ============================================================================

client.connect();

// ============================================================================
// Periodic bridge status refresh
// ============================================================================

const STATUS_REFRESH_MS = 5000;

const bridgeStatusInterval = window.setInterval(() => {
    /*
     * BridgeClient sendiri yang menangani status koneksi.
     *
     * Jangan memanggil client.isConnected() karena method tersebut
     * tidak tersedia pada BridgeClient.
     */
    client.request("studio_status");
    client.request("list_tools");
}, STATUS_REFRESH_MS);

// ============================================================================
// Cleanup
// ============================================================================

window.addEventListener("beforeunload", () => {
    window.clearInterval(updateInterval);
    window.clearInterval(bridgeStatusInterval);

    client.disconnect?.();
});