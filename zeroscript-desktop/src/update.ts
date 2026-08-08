// SPDX-License-Identifier: GPL-3.0-or-later
// Update checker: compares the app version (synced from
// zeroscript-extension/manifest.json at build time) with the latest GitHub
// Release. Same endpoint and semver logic as the browser extension's
// background.js, so both surfaces agree on "update available".

export const GITHUB_RELEASES_API =
  "https://api.github.com/repos/valency-studio/ZeroScript/releases/latest";
export const GITHUB_RELEASES_PAGE =
  "https://github.com/valency-studio/ZeroScript/releases/latest";

export const UPDATE_CHECK_MS = 6 * 60 * 60 * 1000; // every 6 hours

export interface UpdateInfo {
  checkedAt: number;
  latest: string | null; // semver without leading v
  current: string;
  available: boolean;
  url: string;
  error: string | null;
  name: string; // release title, e.g. "ZeroScript 1.0.0"
  publishedAt: string | null; // ISO date of the release
  body: string | null; // release notes (GitHub markdown)
}

/**
 * Parses a version string into an array of numbers for comparison.
 * Handles pre-release tags (e.g., -beta.1) by treating them as lower than stable releases.
 */
export function parseVer(v: string): number[] {
  const clean = String(v || "").replace(/^v/i, "");
  const [main, pre] = clean.split(/[-+]/);
  
  const mainParts = main.split(".").map((x) => parseInt(x, 10) || 0);
  
  if (pre) {
    // If it's a pre-release, append a negative flag and the pre-release number
    // e.g., 1.2.3-beta.1 -> [1, 2, 3, -1, 1]
    const preNum = parseInt(pre.match(/\d+/)?.[0] || "0", 10);
    mainParts.push(-1, preNum);
  } else {
    // If it's a stable release, append Infinity so it's always higher than any pre-release
    mainParts.push(Infinity);
  }
  
  return mainParts;
}

export function cmpVer(a: string, b: string): number {
  const pa = parseVer(a);
  const pb = parseVer(b);
  const n = Math.max(pa.length, pb.length);
  
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? -1;
    const y = pb[i] ?? -1;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

type Listener = (i: UpdateInfo) => void;

class UpdateService {
  private info: UpdateInfo = {
    checkedAt: 0,
    latest: null,
    current: "",
    available: false,
    url: GITHUB_RELEASES_PAGE,
    error: null,
    name: "",
    publishedAt: null,
    body: null,
  };
  private listeners = new Set<Listener>();
  private inFlight: Promise<UpdateInfo> | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.info);
    return () => {
      this.listeners.delete(fn);
    };
  }

  setCurrent(v: string): void {
    this.info.current = v;
  }

  get(): UpdateInfo {
    return this.info;
  }

  async check(force = false): Promise<UpdateInfo> {
    const now = Date.now();
    
    // Throttle checks
    if (!force && this.info.checkedAt && now - this.info.checkedAt < UPDATE_CHECK_MS) {
      return this.info;
    }
    
    // Prevent concurrent fetches
    if (this.inFlight) return this.inFlight;

    // Don't check if we don't know our own version yet
    if (!this.info.current) {
      return this.info;
    }

    this.inFlight = (async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      try {
        const res = await fetch(GITHUB_RELEASES_API, {
          headers: { Accept: "application/vnd.github+json" },
          cache: "no-store",
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);

        if (res.status === 403) {
          throw new Error("GitHub API rate limit exceeded. Try again later.");
        }
        if (res.status === 404) {
          throw new Error("No releases found.");
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const data = await res.json();
        const tag = String(data.tag_name || data.name || "").replace(/^v/i, "");
        
        this.info.latest = tag || null;
        this.info.url = data.html_url || GITHUB_RELEASES_PAGE;
        this.info.available = !!(tag && cmpVer(tag, this.info.current) > 0);
        this.info.name = String(data.name || "") || tag;
        this.info.publishedAt = typeof data.published_at === "string" ? data.published_at : null;
        this.info.body = typeof data.body === "string" && data.body ? data.body : null;
        this.info.error = null;
      } catch (e) {
        clearTimeout(timeoutId);
        const err = e as Error;
        
        if (err.name === "AbortError") {
          this.info.error = "Request timed out. Check your internet connection.";
        } else {
          this.info.error = String(err.message || err);
        }
        
        this.info.available = false;
      }
      
      this.info.checkedAt = Date.now();
      this.emit();
      return this.info;
    })();

    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.info);
  }
}

export const updates = new UpdateService();