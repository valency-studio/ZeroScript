// SPDX-License-Identifier: GPL-3.0-or-later
import { toast } from "../ui";

let consoleEl: HTMLElement;
let paused = false;
let maxLines = 2000;
let search = "";
let pendingWhilePaused = 0;

const ANSI_RE = /\x1b\[[0-9;]*m/g;

const IC = {
  pause: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 5v14l11-7z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
};

function classify(line: string): string {
  const lower = line.toLowerCase();
  if (lower.includes("action needed") || lower.includes(">>>")) return "act";
  if (lower.includes("error") || lower.includes("fatal") || lower.includes("failed")) return "err";
  if (lower.includes("warning") || lower.includes("warn")) return "warn";
  // Memakai \b (word boundary) agar "up" tidak mendeteksi "startup" atau "backup"
  if (lower.includes("connected") || lower.includes("ready") || /\bup\b/.test(lower)) return "ok";
  return "dim";
}

function matchesFilter(text: string): boolean {
  return !search || text.includes(search);
}

function updateLiveBadge(): void {
  const b = document.getElementById("logsLive");
  if (!b) return;
  if (paused && pendingWhilePaused > 0) {
    b.textContent = `Paused · +${pendingWhilePaused}`;
    b.hidden = false;
  } else {
    b.hidden = true;
  }
}

function applyFilter(): void {
  if (!consoleEl) return;
  for (const el of Array.from(consoleEl.children) as HTMLElement[]) {
    if (el.classList.contains("console-empty")) continue;
    el.classList.toggle("filtered", !matchesFilter(el.dataset.raw || ""));
  }
}

let hydrated = false;

function emptyStateHTML(): string {
  return `<div class="console-empty">Waiting for bridge output…
    <span>Start the bridge — its logs appear here in real time.</span>
  </div>`;
}

function showEmptyState(): void {
  if (!consoleEl.querySelector(".console-empty")) {
    consoleEl.innerHTML = emptyStateHTML();
  }
}

function hideEmptyState(): void {
  const empty = consoleEl.querySelector(".console-empty");
  if (empty) empty.remove();
}

async function copyAll(): Promise<void> {
  const lines: string[] = [];
  if (consoleEl) {
    for (const el of Array.from(consoleEl.children) as HTMLElement[]) {
      if (el.classList.contains("console-empty")) continue;
      const t = (el.textContent || "").trim();
      if (t) lines.push(t);
    }
  }
  const text = lines.join("\n") || "(no log lines yet)";
  try {
    await navigator.clipboard.writeText(text);
    toast("Log copied to clipboard", "ok");
  } catch {
    // Clipboard API can be unavailable in some webviews - fall back to a
    // hidden textarea + execCommand.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("Log copied to clipboard", "ok");
    } catch {
      toast("Could not copy logs", "err");
    }
    ta.remove();
  }
}

export function initLogs(el: HTMLElement): void {
  consoleEl = el;
  showEmptyState();

  document.getElementById("logsPause")?.addEventListener("click", (e) => {
    paused = !paused;
    const btn = e.currentTarget as HTMLButtonElement;
    
    if (btn) {
      btn.innerHTML = paused ? `${IC.play} Resume` : `${IC.pause} Pause`;
      btn.setAttribute("aria-pressed", String(paused));
    }
    
    if (!paused) {
      pendingWhilePaused = 0;
      // Jika resume, dan user ada di bawah, langsung scroll ke bawah
      const isNearBottom = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 50;
      if (isNearBottom) {
        consoleEl.scrollTop = consoleEl.scrollHeight;
      }
    }
    updateLiveBadge();
  });

  document.getElementById("logsSearch")?.addEventListener("input", (e) => {
    search = (e.target as HTMLInputElement).value.trim().toLowerCase();
    applyFilter();
  });

  document.getElementById("logsCopy")?.addEventListener("click", () => copyAll());

  document.getElementById("logsClear")?.addEventListener("click", () => {
    consoleEl.textContent = "";
    hydrated = false;
    pendingWhilePaused = 0;
    showEmptyState();
    updateLiveBadge();
  });
}

export function appendLog(raw: string): void {
  if (!consoleEl) return;
  
  if (!hydrated) {
    hydrated = true;
    hideEmptyState();
  }

  // Cek apakah user sedang melihat di bawah sebelum menambah log baru
  const isNearBottom = consoleEl.scrollHeight - consoleEl.scrollTop - consoleEl.clientHeight < 50;

  // A single event may carry several lines.
  for (const line of raw.split("\n")) {
    const clean = line.replace(ANSI_RE, "").trim();
    if (!clean) continue;

    const div = document.createElement("div");
    div.className = `line ${classify(clean)}`;
    div.textContent = clean;
    
    // Simpan string lowercase di dataset untuk filtering performa tinggi
    div.dataset.raw = clean.toLowerCase();
    div.classList.toggle("filtered", !matchesFilter(div.dataset.raw));

    consoleEl.appendChild(div);
    if (paused) pendingWhilePaused++;
  }

  // Hapus log lama jika melebihi batas maksimal
  const children = consoleEl.children;
  while (children.length > maxLines) {
    consoleEl.removeChild(children[0]);
  }

  // Hanya auto-scroll jika tidak di-pause DAN user ada di bagian bawah layar
  if (!paused && isNearBottom) {
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  updateLiveBadge();
}