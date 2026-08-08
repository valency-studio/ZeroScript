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
  private timer: number | null = null; // reconnect timer
  private heartbeat: number | null = null; // liveness timer
  private socketOpen = false;
  private lastMessageAt = 0;
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
    this.socketOpen = false;
    this.stopHeartbeat();
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
      this.socketOpen = true;
      this.lastMessageAt = Date.now();
      this.reqId = 1;
      this.request("studio_status");
      this.request("list_tools");
      this.startHeartbeat();
    };
    ws.onmessage = (ev) => {
      this.lastMessageAt = Date.now();
      this.handle(ev.data);
    };
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
      this.socketOpen = false;
      this.stopHeartbeat();
      this.snapshot = { ...EMPTY };
      this.emit();
      this.schedule();
    };
  }

  /**
   * Ping the bridge every 10s and detect a DEAD socket: when the bridge
   * process is killed, the webview socket can stay "open" from the client's
   * point of view for a long time (no FIN until the OS notices), so onclose
   * may not fire and the UI would keep showing stale status. If nothing has
   * arrived for 25s while we believe we are connected, force-close the socket
   * so the normal onclose path resets the UI to offline (same approach as the
   * extension's background.js).
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = window.setInterval(() => {
      if (!this.socketOpen || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      if (this.lastMessageAt && Date.now() - this.lastMessageAt > 25000) {
        try {
          this.ws.close();
        } catch {
          /* noop */
        }
        return;
      }
      this.request("ping");
    }, 10000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  /**
   * Drop the snapshot to offline immediately and keep the reconnect loop
   * running. Called on the Rust `bridge-exit` event - the reliable signal
   * that the bridge process really terminated - so the UI never waits for
   * the webview to notice the dead socket on its own.
   */
  forceOffline(): void {
    this.socketOpen = false;
    this.stopHeartbeat();
    // Detach FIRST so a close event firing concurrently sees this.ws !== ws
    // and returns early (no double emit).
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* noop */
      }
    }
    this.snapshot = { ...EMPTY };
    this.emit();
    this.schedule();
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
