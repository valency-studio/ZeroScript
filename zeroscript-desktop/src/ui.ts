// SPDX-License-Identifier: GPL-3.0-or-later
// Shared UI helpers: stacked toasts (info/ok/err) and a custom confirm dialog
// (replaces the native confirm(), which looks jarring in a dark app).

export type ToastKind = "info" | "ok" | "err";

const live: HTMLElement[] = [];

const TOAST_ICONS = {
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  err: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
};

const MODAL_ICONS = {
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>'
};

function restack(): void {
  let bottomOffset = 24;
  // Iterasi dari bawah ke atas: elemen paling baru (indeks 0) ada di posisi paling bawah
  for (let i = 0; i < live.length; i++) {
    const t = live[i];
    t.style.bottom = `${bottomOffset}px`;
    // Tambahkan tinggi elemen + jarak 10px untuk toast berikutnya
    bottomOffset += t.offsetHeight + 10;
  }
}

export function toast(msg: string, kind: ToastKind = "info", ms = 4000): void {
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.setAttribute("role", kind === "err" ? "alert" : "status");
  t.setAttribute("aria-live", kind === "err" ? "assertive" : "polite");
  
  t.style.display = "flex";
  t.style.alignItems = "center";
  t.style.gap = "10px";

  t.innerHTML = `
    <span class="toast-icon" style="display:flex;align-items:center;flex-shrink:0;">${TOAST_ICONS[kind]}</span>
    <span class="toast-msg" style="flex:1;">${escapeHtml(msg)}</span>
    <button class="toast-close" aria-label="Dismiss notification" style="background:none;border:none;color:inherit;cursor:pointer;opacity:0.6;padding:0 4px;font-size:16px;line-height:1;">×</button>
  `;

  document.body.appendChild(t);
  live.push(t);
  restack();

  const removeToast = (): void => {
    if (!t.parentElement) return;
    t.classList.add("out");
    setTimeout(() => {
      t.remove();
      const i = live.indexOf(t);
      if (i !== -1) live.splice(i, 1);
      restack();
    }, 220);
  };

  const timeoutId = setTimeout(removeToast, ms);

  t.querySelector<HTMLButtonElement>(".toast-close")!.addEventListener("click", () => {
    clearTimeout(timeoutId);
    removeToast();
  });
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
    let closed = false;
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    
    const confirmIcon = opts.danger ? MODAL_ICONS.trash : MODAL_ICONS.check;
    
    overlay.innerHTML = `
      <div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="zsModalTitle" aria-describedby="zsModalMsg">
        <h3 id="zsModalTitle">${escapeHtml(opts.title)}</h3>
        <p id="zsModalMsg">${escapeHtml(opts.message)}</p>
        <div class="modal-actions">
          <button class="btn ghost js-cancel">${MODAL_ICONS.x} ${escapeHtml(opts.cancelLabel || "Cancel")}</button>
          <button class="btn ${opts.danger ? "danger" : "primary"} js-confirm">${confirmIcon} ${escapeHtml(opts.confirmLabel || "Confirm")}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const prevFocus = document.activeElement as HTMLElement | null;
    const modal = overlay.querySelector<HTMLElement>(".modal")!;
    const confirmBtn = overlay.querySelector<HTMLButtonElement>(".js-confirm")!;
    const cancelBtn = overlay.querySelector<HTMLButtonElement>(".js-cancel")!;
    
    confirmBtn.focus();

    const close = (result: boolean): void => {
      if (closed) return;
      closed = true;
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
      if (e.key === "Enter") {
        e.preventDefault();
        close(true);
      }
      
      // Trap focus inside modal
      if (e.key === "Tab") {
        const focusable = modal.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return;
        const firstFocusable = focusable[0];
        const lastFocusable = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstFocusable) {
            lastFocusable.focus();
            e.preventDefault();
          }
        } else {
          if (document.activeElement === lastFocusable) {
            firstFocusable.focus();
            e.preventDefault();
          }
        }
      }
    };

    confirmBtn.addEventListener("click", () => close(true));
    cancelBtn.addEventListener("click", () => close(false));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close(false);
    });
    document.addEventListener("keydown", onKey);
  });
}