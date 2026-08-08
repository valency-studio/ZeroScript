// SPDX-License-Identifier: GPL-3.0-or-later
import { toast } from "../ui";

let consoleEl: HTMLElement;
let paused = false;
let maxLines = 2000;
let search = "";
let pendingWhilePaused = 0;

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function classify(line: string): string {
  if (line.includes("ACTION NEEDED") || line.includes(">>>")) return "act";
  if (line.includes("ERROR") || line.includes("FATAL") || line.includes("failed")) return "err";
  if (line.includes("WARNING") || line.includes("warn")) return "warn";
  if (line.includes("connected") || line.includes("ready") || line.includes("up")) return "ok";
  return "dim";
}

function matchesFilter(text: string): boolean {
  return !search || text.toLowerCase().includes(search);
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
  for (const el of Array.from(consoleEl.children)) {
    el.classList.toggle("filtered", !matchesFilter(el.textContent || ""));
  }
}

let hydrated = false;

function emptyState(): string {
  return `<div class="console-empty">Waiting for bridge output…
  <span>Start the bridge — its logs appear here in real time.</span></div>`;
}

async function copyAll(): Promise<void> {
  const lines: string[] = [];
  if (consoleEl) {
    for (const el of Array.from(consoleEl.children)) {
      const t = (el.textContent || "").trim();
      if (t && !el.classList.contains("console-empty")) lines.push(t);
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
  consoleEl.innerHTML = emptyState();

  document.getElementById("logsPause")!.addEventListener("click", (e) => {
    paused = !paused;
    (e.target as HTMLButtonElement).textContent = paused ? "Resume" : "Pause";
    if (!paused) pendingWhilePaused = 0;
    updateLiveBadge();
  });

  document.getElementById("logsSearch")!.addEventListener("input", (e) => {
    search = (e.target as HTMLInputElement).value.trim().toLowerCase();
    applyFilter();
  });

  document.getElementById("logsCopy")!.addEventListener("click", () => copyAll());

  document.getElementById("logsClear")!.addEventListener("click", () => {
    consoleEl.textContent = "";
    hydrated = false;
    pendingWhilePaused = 0;
    consoleEl.innerHTML = emptyState();
    updateLiveBadge();
  });
}

export function appendLog(raw: string): void {
  if (!consoleEl) return;
  if (!hydrated) {
    hydrated = true;
    consoleEl.textContent = "";
  }
  // A single event may carry several lines.
  for (const line of raw.split("\n")) {
    const clean = line.replace(ANSI_RE, "");
    if (!clean) continue;
    const div = document.createElement("div");
    div.className = `line ${classify(clean)}`;
    div.textContent = clean;
    div.classList.toggle("filtered", !matchesFilter(clean));
    consoleEl.appendChild(div);
    if (paused) pendingWhilePaused++;
  }
  const children = consoleEl.children;
  while (children.length > maxLines) {
    consoleEl.removeChild(children[0]);
  }
  if (!paused) {
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }
  updateLiveBadge();
}
