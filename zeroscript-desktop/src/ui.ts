// SPDX-License-Identifier: GPL-3.0-or-later
// Shared UI helpers: stacked toasts (info/ok/err) and a custom confirm dialog
// (replaces the native confirm(), which looks jarring in a dark app).

export type ToastKind = "info" | "ok" | "err";

const live: HTMLElement[] = [];

function restack(): void {
  live.forEach((t, i) => {
    t.style.bottom = `${22 + i * 56}px`;
  });
}

export function toast(msg: string, kind: ToastKind = "info", ms = 4000): void {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.body.appendChild(t);
  live.push(t);
  restack();
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => {
      t.remove();
      const i = live.indexOf(t);
      if (i !== -1) live.splice(i, 1);
      restack();
    }, 220);
  }, ms);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/**
 * Promise-based confirm dialog. Resolves true when the user confirms, false
 * on cancel / overlay click / Esc. Focus is moved into the dialog and
 * restored when it closes.
 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="zsModalTitle">
        <h3 id="zsModalTitle">${escapeHtml(opts.title)}</h3>
        <p>${escapeHtml(opts.message)}</p>
        <div class="modal-actions">
          <button class="btn ghost js-cancel">${escapeHtml(opts.cancelLabel || "Cancel")}</button>
          <button class="btn ${opts.danger ? "danger" : "primary"} js-confirm">${escapeHtml(opts.confirmLabel || "Confirm")}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const prevFocus = document.activeElement as HTMLElement | null;
    const confirmBtn = overlay.querySelector<HTMLButtonElement>(".js-confirm")!;
    confirmBtn.focus();

    const close = (result: boolean): void => {
      document.removeEventListener("keydown", onKey);
      overlay.classList.add("out");
      setTimeout(() => {
        overlay.remove();
        prevFocus?.focus?.();
      }, 160);
      resolve(result);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        close(false);
      }
      if (e.key === "Enter" && e.target === confirmBtn) {
        e.preventDefault(); // stop the native click from firing a second close()
        close(true);
      }
    };
    overlay.querySelector<HTMLButtonElement>(".js-confirm")!.addEventListener("click", () => close(true));
    overlay.querySelector<HTMLButtonElement>(".js-cancel")!.addEventListener("click", () => close(false));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close(false);
    });
    document.addEventListener("keydown", onKey);
  });
}
