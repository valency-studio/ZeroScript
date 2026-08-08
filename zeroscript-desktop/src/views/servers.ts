// SPDX-License-Identifier: GPL-3.0-or-later
import { Ack, BridgeClient, Snapshot } from "../bridge-ws";

let root: HTMLElement;
let client: BridgeClient;
let snapshot: Snapshot;
// Re-render only when the data actually changed: render() rebuilds the whole
// DOM (including the add-server form), so doing it on every snapshot emit
// would wipe whatever the user is typing every 5 seconds.
let lastSig = "";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function toast(msg: string, ok: boolean): void {
  const t = document.createElement("div");
  t.className = `toast ${ok ? "ok" : ""}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

function render(): void {
  const s = snapshot;
  const rows = s.servers
    .map(
      (sv) => `
      <tr>
        <td><span class="dot sm ${sv.alive ? "on" : ""}"></span></td>
        <td class="mono">${escapeHtml(sv.id)}</td>
        <td>${sv.alive ? sv.tools : "—"}</td>
        <td class="muted">${sv.alive ? "alive" : "down"}</td>
        <td class="ta-r">
          <button class="btn ghost sm js-restart" data-id="${escapeHtml(sv.id)}">Restart</button>
          <button class="btn ghost sm danger js-remove" data-id="${escapeHtml(sv.id)}">Remove</button>
        </td>
      </tr>`,
    )
    .join("");

  root.innerHTML = `
    <div class="card">
      <h3 class="card-title">Configured servers <span class="count">${s.servers.length}</span></h3>
      <table class="tbl">
        <thead><tr><th></th><th>ID</th><th>Tools</th><th>State</th><th class="ta-r">Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="muted">No servers configured yet.</td></tr>`}</tbody>
      </table>
      <p class="muted note">The primary Roblox server cannot be edited or removed from here.</p>
    </div>

    <div class="card">
      <h3 class="card-title">Add MCP server</h3>
      <form id="addForm" class="form">
        <div class="form-grid">
          <label>Server ID
            <input id="fId" placeholder="e.g. blender" required />
          </label>
          <label>Command
            <input id="fCmd" placeholder="e.g. npx  -y  @some/blender-mcp" required />
          </label>
        </div>
        <label>Arguments <span class="muted">(one per line)</span>
          <textarea id="fArgs" rows="3" placeholder="--port=3100"></textarea>
        </label>
        <div class="form-actions">
          <button type="submit" class="btn primary">Add server</button>
          <span class="muted note">Saving restarts the bridge automatically.</span>
        </div>
      </form>
    </div>
  `;

  root.querySelectorAll<HTMLButtonElement>(".js-restart").forEach((b) => {
    b.addEventListener("click", async () => {
      b.disabled = true;
      const ack: Ack = await client.restartMcp(b.dataset.id).catch(() => ({ ok: false, error: "bridge offline" }));
      toast(ack.ok ? `Restarted ${b.dataset.id}` : `Restart failed: ${ack.error}`, ack.ok);
      b.disabled = false;
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".js-remove").forEach((b) => {
    b.addEventListener("click", async () => {
      if (!confirm(`Remove MCP server "${b.dataset.id}"?`)) return;
      b.disabled = true;
      const ack: Ack = await client.removeServer(b.dataset.id!).catch(() => ({ ok: false, error: "bridge offline" }));
      toast(ack.ok ? `Removed ${b.dataset.id} — bridge restarting` : `Remove failed: ${ack.error}`, ack.ok);
    });
  });

  root.querySelector<HTMLFormElement>("#addForm")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = (root.querySelector<HTMLInputElement>("#fId")!.value || "").trim();
    const cmd = (root.querySelector<HTMLInputElement>("#fCmd")!.value || "").trim();
    const args = (root.querySelector<HTMLTextAreaElement>("#fArgs")!.value || "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    if (!id || !cmd) return;
    const ack: Ack = await client.addServer(id, cmd, args).catch(() => ({ ok: false, error: "bridge offline" }));
    toast(ack.ok ? `Added ${id} — bridge restarting` : `Add failed: ${ack.error}`, ack.ok);
    if (ack.ok) {
      root.querySelector<HTMLFormElement>("#addForm")!.reset();
    }
  });
}

export function initServers(el: HTMLElement, c: BridgeClient): void {
  root = el;
  client = c;
  c.subscribe((s) => {
    const sig = `${s.connected}|${s.tools}|${s.servers
      .map((x) => `${x.id}:${x.alive}:${x.tools}`)
      .join(",")}`;
    if (sig === lastSig) return;
    lastSig = sig;
    snapshot = s;
    render();
  });
}
