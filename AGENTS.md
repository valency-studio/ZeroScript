# AGENTS.md

ZeroScript lets AI chat sites (DeepSeek, Kimi, ChatGPT, …) control Bllox Studio through MCP. Three runtime parts, no build step:

- `bridge.py` — Python WebSocket server on `ws://127.0.0.1:17613`. Spawns each MCP server declared in `config.json` as a stdio child, aggregates their tools, routes by tool name. Only dependency: `websockets` (Python 3.9+ required — `asyncio.to_thread`).
- `launch_studio_mcp.py` — finds the NEWEST `StudioMCP.exe` under `%LOCALAPPDATA%\Roblox\Versions` (plus Bloxstrap/Fishstrap), preferring folders that still contain `RobloxStudioBeta.exe`. Override: env `ZS_STUDIO_MCP_PATH`.
- `zeroscript-extension/` — Chrome MV3 extension, loaded unpacked. No build, no bundler.

Ports: **17613** bridge <-> extension; **13469** Roblox Studio's built-in MCP port. A "0 tools" symptom is usually a port conflict (leftover bridge, zombie `StudioMCP.exe`, or a third-party squatter like ropilot) — see the heavily-commented process-recovery code in `bridge.py` before touching it.

## License mismatch (known)

Source files carry `SPDX-License-Identifier: GPL-3.0-or-later`. The `LICENSE` file and `README.md` say MIT. This discrepancy is unresolved — do NOT "fix" one side without being asked, since the intent is ambiguous.

## Adding a new AI site (provider) — sync 4 places

`providers/*.js` each expose a global `ZSProvider` IIFE; the content script loads them in fixed order: `core/config.py`, `core/parser.js`, `providers/<site>.js`, `core/main.js` with `overlay.css`. `core/main.js` is provider-agnostic and must NEVER touch the host site's DOM — all site access goes through `P` (the provider interface). To add a site you must touch:

1. `manifest.json` — content_scripts entry (4 JS + css above) **and** matching `host_permissions`.
2. `background.js` — add the URL pattern to both `PROVIDER_URLS` and `KNOWN_EXCLUDE`.
3. `core/main.js` — `AI_SITES` entry; its `name` must equal the provider's `displayName`.
4. The new file `providers/<site>.js` — mirror an existing provider (kimi.js is the reference one).

Grep for "Keep in sync" — the codebase flags other mirrored lists the same way.

## Conventions

- Every file starts with `// SPDX-License-Identifier: GPL-3.0-or-later` (Python: `#`). Keep it.
- `bridge.py`'s `BRIDGE_VERSION` (line 86) is meant to track `manifest.json` "version" (printed at startup so a terminal screenshot identifies the build). Bump both together.
- The terminal is the diagnostic surface for **non-technical users**: console output stays strictly ASCII, noisy detail goes through `log(..., terminal=False)` (only `logs/bridge_debug.log`, which is append-only), user action steps go through `action_banner()`. Don't add glyphs/emoji to console output.
- Primary server protection: `PRIMARY_SERVER_ID = "roblox"` in `bridge.py:144` is hardcoded. `config_json_add_server` / `config_remove_server` (and the extension's add/remove_server messages) refuse to touch it. Add-ons get rewritten into config.json and the bridge restarts itself. Note: the current `config.json` uses key `roblox-mcp` — the protection targets the constant `"roblox"`, not the config key.
- Windows process handling is deliberately careful: only kills processes it can PROVE are leftovers (cmdline/process-tree checks, port ownership via `netstat -ano` both `TCP` and `TCPv6`), uses `taskkill /F /T` for trees. Preserve the "never kill on suspicion" guard if you edit it.
- `logs/*.log` are gitignored; never commit them. `.gitattributes` pins LF for `*.sh`/`*.command` (CRLF breaks the macOS launcher) — keep that.

## CI workflows (`.github/workflows/`)

- `release.yml` — **unified** release. Triggered on push to main that changes `zeroscript-extension/manifest.json`, or manually (`workflow_dispatch`). Creates the GitHub Release with the extension zip attached, then builds the Tauri desktop GUI on Win/macOS/Linux and attaches those installers to the same release.
- `build-desktop-gui.yml` — standalone Tauri desktop build, triggered on `release: published` or manually. Superseded by `release.yml`'s desktop job but kept for manual rebuilds.
- `delete.yml` — housekeeping, deletes old workflow runs on a daily schedule.

There is no separate `build-desktop.yml` or `build-extension.yml` — those were merged into `release.yml`.

## Desktop packaging

- `packaging/build.py` builds PyInstaller bridge binaries (`--binaries-only` flag produces sidecars only). Full desktop packages (Windows NSIS, macOS DMG, Linux AppImage) are built inside the `release.yml` / `build-desktop-gui.yml` workflows, not by `build.py` directly.
- bridge.py is **frozen-aware**: `config.json` + `logs/` live next to the executable (`~/.zeroscript` on Linux AppImage, which is a read-only mount), a bare `.py` command in config.json maps to the bundled sibling executable (`_sibling_exe`), `restart_self()` and `_reclaim_bridge_port()` handle the packaged executable, and macOS windowed builds get devnull std streams.
- If a configured Roblox MCP server needs Node.js (`npx/npm/node` in its command) and none is installed, the bridge prints an ACTION NEEDED banner and falls back to Roblox Studio's built-in StudioMCP via `launch_studio_mcp` (`_needs_node_fallback` / `_apply_node_fallback`, once per process).
- Keep `BRIDGE_VERSION`, `manifest.json` "version", and `CHANGELOG.md` in sync when packaging; the build workflow passes the release tag as `--version`.

## Desktop GUI (Tauri)

- `zeroscript-desktop/` is a **Tauri v2** app (Vite + vanilla TypeScript) that runs the PyInstaller bridge as a hidden **sidecar** (`bundle.externalBin` -> `src-tauri/binaries`, named with the Rust host target-triple suffix). `_sibling_exe` in bridge.py globs for those suffixed names. `config.json` + `logs/` go to Tauri's per-OS app-data dir via the `ZS_DATA_DIR` env set when spawning the sidecar.
- `src-tauri/src/lib.rs` owns start/stop/restart, streams sidecar output to the GUI (`bridge-log` / `bridge-exit` events), tray + minimize-to-tray, single-instance guard, and the autostart plugin. The GUI talks to the bridge over the SAME `ws://127.0.0.1:17613` protocol as the extension (`src/bridge-ws.ts`); the browser extension remains the AI-chat UI.
- Local dev: `npm run prepare:sidecars:stub` (placeholders — run `python bridge.py` in a terminal for a real bridge) or real sidecars via `packaging/build.py --binaries-only` + `npm run prepare:sidecars`, then `npm run tauri dev`.

## Commands

- Parser tests (the only automated tests in the repo): `node test-parser.js` from `zeroscript-extension/` (expects `node`; uses `require`, so no bundler).
- Run the bridge during dev (Windows): `pip install websockets`, then `python bridge.py` from the repo root. `start.bat` / `MacOS_Start.command` are the user-facing launchers (Python 3.9+, frees port 17613 from a previous bridge, logs to `logs/start.log`). `ZS_BRIDGE_PORT` overrides the port — sync it with `background.js` `PORT` if you choose another.
- Extension ↔ bridge protocol (bridges in `bridge.py` handle in `handler()`): `ping/pong`, `studio_status`, `list_tools`, `call_tool`, `add_server/remove_server`, `restart_mcp`. `background.js` owns the single reconnecting socket and resolves every request even offline — keep that contract when changing either side.

## Testing notes

- No CI, no linters, no typecheck config. Unit tests are only the parser smoke tests.
- The command format the model emits is defined in `core/config.js` system prompt + parsed in `core/parser.js` (pure string logic, no DOM): `###LUA### … ###END_LUA###` (optional `:Edit|:Client|:Server`, defaults Edit) or `{"command": …, "params": {…}}`. `###LUA###` always maps to `execute_luau`. Parser changes MUST stay compatible with the existing tests and the system prompt text in config.js.
- Provider files carry "last validated: <date> — <url>" notes; site DOM changes break them (that's the norm, not a bug).
