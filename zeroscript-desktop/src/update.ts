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

export function parseVer(v: string): number[] {
  return String(v || "")
    .replace(/^v/i, "")
    .split(/[.+-]/)
    .map((x) => parseInt(x, 10) || 0);
}

export function cmpVer(a: string, b: string): number {
  const pa = parseVer(a);
  const pb = parseVer(b);
  const n = Math.max(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
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
    if (!force && this.info.checkedAt && now - this.info.checkedAt < UPDATE_CHECK_MS) {
      return this.info;
    }
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      try {
        const res = await fetch(GITHUB_RELEASES_API, {
          headers: { Accept: "application/vnd.github+json" },
          cache: "no-store",
          // Never let a hung request stick `inFlight` forever.
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
        this.info.error = String((e as Error).message || e);
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
