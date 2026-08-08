// SPDX-License-Identifier: GPL-3.0-or-later
import { Ack, BridgeClient, Snapshot } from "../bridge-ws";
import { confirmDialog, toast } from "../ui";

let root: HTMLElement;
let client: BridgeClient;
let snapshot: Snapshot;
// Re-render only when the data actually changed: render() rebuilds the whole
// DOM (including the add-server form), so doing it on every snapshot emit
// would wipe whatever the user is typing every 5 seconds.
let lastSig = "";

const IC = {
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5v14M5 12h14"/></svg>',
  spinner: '<span class="spinner" aria-hidden="true"></span>'
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function render(): void {
  const s = snapshot;
  const rows = s.servers
    .map(
      (sv) => `
      <tr>
        <td class="col-icon"><span class="dot sm ${sv.alive ? "on" : ""}" aria-hidden="true"></span></td>
        <td class="mono">${escapeHtml(sv.id)}</td>
        <td>${sv.alive ? sv.tools : "—"}</td>
        <td class="muted">${sv.alive ? "alive" : "down"}</td>
        <td class="ta-r">
          <div class="row-actions">
            <button class="btn ghost sm js-restart" data-id="${escapeHtml(sv.id)}" aria-label="Restart ${escapeHtml(sv.id)} server">
              ${IC.refresh} Restart
            </button>
            <button class="btn ghost sm danger js-remove" data-id="${escapeHtml(sv.id)}" aria-label="Remove ${escapeHtml(sv.id)} server">
              ${IC.trash} Remove
            </button>
          </div>
        </td>
      </tr>`,
    )
    .join("");

  root.innerHTML = `
    <div class="card">
      <div class="card-content">
        <div class="card-head" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px;">
          <h3 class="card-title" style="margin: 0;">Configured servers</h3>
          <span class="badge mono">${s.servers.length}</span>
        </div>
        <div class="table-wrap" style="overflow-x: auto;">
          <table class="tbl">
            <thead>
              <tr>
                <th class="col-icon"></th>
                <th>ID</th>
                <th>Tools</th>
                <th>State</th>
                <th class="ta-r">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="5"><p class="muted" style="text-align: center; padding: 20px 0; margin: 0;">No servers configured yet.</p></td></tr>`}
            </tbody>
          </table>
        </div>
        <p class="muted note">The primary Roblox server cannot be edited or removed from here.</p>
      </div>
    </div>

    <div class="card">
      <div class="card-content">
        <h3 class="card-title">Add MCP server</h3>
        <form id="addForm" class="form" novalidate>
          <div class="form-grid">
            <label>Server ID
              <input id="fId" placeholder="e.g. blender" required autocomplete="off" />
            </label>
            <label>Command
              <input id="fCmd" placeholder="e.g. npx -y @some/blender-mcp" required autocomplete="off" />
            </label>
          </div>
          <label>Arguments <span class="muted">(one per line)</span>
            <textarea id="fArgs" rows="3" placeholder="--port=3100"></textarea>
          </label>
          <p id="addError" class="form-error" hidden></p>
          <div class="form-actions">
            <button type="submit" class="btn primary js-add">${IC.plus} Add server</button>
            <span class="muted note">Saving restarts the bridge automatically.</span>
          </div>
        </form>
      </div>
    </div>
  `;

  root.querySelectorAll<HTMLButtonElement>(".js-restart").forEach((b) => {
    b.addEventListener("click", async () => {
      b.disabled = true;
      const originalHTML = b.innerHTML;
      b.innerHTML = `${IC.spinner} Restarting`;
      
      const ack: Ack = await client.restartMcp(b.dataset.id!).catch(() => ({ ok: false, error: "bridge offline" }));
      toast(ack.ok ? `Restarted ${b.dataset.id}` : `Restart failed: ${ack.error}`, ack.ok ? "ok" : "err");
      
      b.disabled = false;
      b.innerHTML = originalHTML;
    });
  });

  root.querySelectorAll<HTMLButtonElement>(".js-remove").forEach((b) => {
    b.addEventListener("click", async () => {
      const id = b.dataset.id || "";
      const ok = await confirmDialog({
        title: `Remove "${id}"?`,
        message:
          "This removes the server from config.json and restarts the bridge. The primary Roblox server is never affected.",
        confirmLabel: "Remove",
        danger: true,
      });
      if (!ok) return;
      
      b.disabled = true;
      const originalHTML = b.innerHTML;
      b.innerHTML = `${IC.spinner} Removing`;
      
      const ack: Ack = await client.removeServer(id).catch(() => ({ ok: false, error: "bridge offline" }));
      toast(ack.ok ? `Removed ${id} — bridge restarting` : `Remove failed: ${ack.error}`, ack.ok ? "ok" : "err");
      
      // Jika berhasil, elemen akan dihapus oleh re-render snapshot.
      // Jika gagal, kembalikan tombol ke semula.
      if (!ack.ok) {
        b.disabled = false;
        b.innerHTML = originalHTML;
      }
    });
  });

  root.querySelector<HTMLFormElement>("#addForm")!.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = root.querySelector<HTMLParagraphElement>("#addError")!;
    const submitBtn = root.querySelector<HTMLButtonElement>(".js-add")!;
    
    const id = (root.querySelector<HTMLInputElement>("#fId")!.value || "").trim();
    const cmd = (root.querySelector<HTMLInputElement>("#fCmd")!.value || "").trim();
    const args = (root.querySelector<HTMLTextAreaElement>("#fArgs")!.value || "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
      
    if (!id || !cmd) {
      errEl.textContent = "Server ID and Command are both required.";
      errEl.hidden = false;
      return;
    }
    
    errEl.hidden = true;
    submitBtn.disabled = true;
    const originalHTML = submitBtn.innerHTML;
    submitBtn.innerHTML = `${IC.spinner} Adding`;

    const ack: Ack = await client.addServer(id, cmd, args).catch(() => ({ ok: false, error: "bridge offline" }));
    toast(ack.ok ? `Added ${id} — bridge restarting` : `Add failed: ${ack.error}`, ack.ok ? "ok" : "err");
    
    if (ack.ok) {
      root.querySelector<HTMLFormElement>("#addForm")!.reset();
    }
    
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalHTML;
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