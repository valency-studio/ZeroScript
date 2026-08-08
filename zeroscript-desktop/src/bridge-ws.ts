// SPDX-License-Identifier: GPL-3.0-or-later
// WebSocket client for the ZeroScript bridge (ws://127.0.0.1:17613).
// Speaks the same protocol as the browser extension's background.js:
//   -> ping / studio_status / list_tools / restart_mcp / add_server / remove_server
//   <- connected (push) / tools / studio_status / mcp_status / server_changed / pong
// Reconnects forever (2s backoff) and resolves every request even while offline.

export interface ServerStatus {
  id: string;
  alive: boolean;
  tools: number;
}

export interface Snapshot {
  connected: boolean;
  mcpAlive: boolean;
  studio: boolean | null; // a Studio place is connected & usable
  studioApp: boolean | null; // a Studio app is attached to the MCP
  studioProc: boolean | null; // a Studio window process exists
  tools: number;
  servers: ServerStatus[];
  port: number;
}

export interface Ack {
  ok: boolean;
  error?: string;
  restarting?: boolean;
}

type SnapshotListener = (s: Snapshot) => void;

const EMPTY: Snapshot = {
  connected: false,
  mcpAlive: false,
  studio: null,
  studioApp: null,
  studioProc: null,
  tools: 0,
  servers: [],
  port: 17613,
};

export class BridgeClient {
  private ws: WebSocket | null = null;
  private timer: number | null = null;
  private reqId = 1;
  private pending = new Map<number, (msg: any) => void>();
  private snapshot: Snapshot = { ...EMPTY };
  private listeners = new Set<SnapshotListener>();

  constructor(private url = "ws://127.0.0.1:17613") {}

  subscribe(fn: SnapshotListener): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getSnapshot(): Snapshot {
    return this.snapshot;
  }

  connect(): void {
    this.disconnect();
    this.open();
  }

  disconnect(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.close();
      this.ws = null;
    }
  }

  private open(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.schedule();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reqId = 1;
      this.request("studio_status");
      this.request("list_tools");
    };
    ws.onmessage = (ev) => this.handle(ev.data);
    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* noop */
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.snapshot = { ...EMPTY };
      this.emit();
      this.schedule();
    };
  }

  private schedule(): void {
    if (this.timer !== null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.open();
    }, 2000);
  }

  private handle(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const s = this.snapshot;

    switch (msg.type) {
      case "connected":
        this.applyStatus(msg);
        s.connected = true;
        this.emit();
        break;
      case "tools":
        this.applyStatus(msg);
        this.emit();
        break;
      case "studio_status":
        this.applyStatus(msg);
        this.emit();
        break;
      case "mcp_status":
        s.mcpAlive = !!msg.alive;
        if (Array.isArray(msg.servers)) s.servers = msg.servers;
        if (typeof msg.tools === "number") s.tools = msg.tools;
        this.emit();
        break;
      case "server_changed":
        if (msg.id !== undefined) {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            p({ ok: !!msg.ok, error: msg.error, restarting: msg.restarting });
          }
        }
        this.emit();
        break;
      case "pong":
        break;
    }
  }

  private applyStatus(msg: any): void {
    const s = this.snapshot;
    if (typeof msg.mcp_alive === "boolean") s.mcpAlive = msg.mcp_alive;
    if (typeof msg.studio === "boolean" || msg.studio === null) s.studio = msg.studio;
    if (typeof msg.studio_app === "boolean" || msg.studio_app === null) s.studioApp = msg.studio_app;
    if (typeof msg.studio_proc === "boolean" || msg.studio_proc === null) s.studioProc = msg.studio_proc;
    if (Array.isArray(msg.servers)) s.servers = msg.servers;
    if (typeof msg.tools === "number") s.tools = msg.tools;
    if (typeof msg.port === "number") s.port = msg.port;
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.snapshot);
  }

  request(type: string, extra: Record<string, unknown> = {}): number {
    const id = this.reqId++;
    const payload = { type, id, ...extra };
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
    return id;
  }

  /** Send a request and resolve with the matching ack (server_changed / mcp_status). */
  requestAck(
    type: string,
    extra: Record<string, unknown> = {},
    map?: (msg: any) => Ack,
  ): Promise<Ack> {
    return new Promise((resolve) => {
      const id = this.reqId++;
      let settled = false;
      const timer = window.setTimeout(() => {
        if (!settled) {
          settled = true;
          this.pending.delete(id);
          resolve({ ok: false, error: "bridge unreachable" });
        }
      }, 8000);
      this.pending.set(id, (msg) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(map ? map(msg) : { ok: !!msg.ok, error: msg.error, restarting: msg.restarting });
      });
      const payload = { type, id, ...extra };
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify(payload));
      } else {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          this.pending.delete(id);
          resolve({ ok: false, error: "bridge offline" });
        }
      }
    });
  }

  restartMcp(server?: string): Promise<Ack> {
    return this.requestAck("restart_mcp", server ? { server } : {}, (msg) => ({
      ok: !!msg.ok,
      error: msg.error,
    }));
  }

  addServer(serverId: string, command: string, args: string[]): Promise<Ack> {
    return this.requestAck("add_server", { server_id: serverId, command, args });
  }

  removeServer(serverId: string): Promise<Ack> {
    return this.requestAck("remove_server", { server_id: serverId });
  }
}
