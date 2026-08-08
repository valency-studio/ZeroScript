// SPDX-License-Identifier: GPL-3.0-or-later
let consoleEl: HTMLElement;
let paused = false;
let maxLines = 2000;

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function classify(line: string): string {
  if (line.includes("ACTION NEEDED") || line.includes(">>>")) return "act";
  if (line.includes("ERROR") || line.includes("FATAL") || line.includes("failed")) return "err";
  if (line.includes("WARNING") || line.includes("warn")) return "warn";
  if (line.includes("connected") || line.includes("ready") || line.includes("up")) return "ok";
  return "dim";
}

let hydrated = false;

function emptyState(): string {
  return `<div class="console-empty">Waiting for bridge output…
  <span>Start the bridge — its logs appear here in real time.</span></div>`;
}

export function initLogs(el: HTMLElement): void {
  consoleEl = el;
  consoleEl.innerHTML = emptyState();
  document.getElementById("logsPause")!.addEventListener("click", (e) => {
    paused = !paused;
    (e.target as HTMLButtonElement).textContent = paused ? "Resume" : "Pause";
  });
  document.getElementById("logsClear")!.addEventListener("click", () => {
    consoleEl.textContent = "";
    hydrated = false;
    consoleEl.innerHTML = emptyState();
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
    consoleEl.appendChild(div);
  }
  const children = consoleEl.children;
  while (children.length > maxLines) {
    consoleEl.removeChild(children[0]);
  }
  if (!paused) {
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }
}
