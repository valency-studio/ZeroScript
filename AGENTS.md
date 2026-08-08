# AGENTS.md

ZeroScript lets AI chat sites (DeepSeek, Kimi, ChatGPT, …) control Blender/Roblox Studio through MCP. Three parts, no build step:

- `bridge.py` — Python WebSocket server on `ws://127.0.0.1:17613`. Spawns each MCP server declared in `config.json` as a stdio child, aggregates their tools, routes by tool name. Only dependency: `websockets` (Python 3.9+ required — `asyncio.to_thread`).
- `launch_studio_mcp.py` — finds the NEWEST `StudioMCP.exe` under `%LOCALAPPDATA%\Roblox\Versions` (plus Bloxstrap/Fishstrap), preferring folders that still contain `RobloxStudioBeta.exe`. Override: env `ZS_STUDIO_MCP_PATH`.
- `zeroscript-extension/` — Chrome MV3 extension, loaded unpacked. No build, no bundler.

Ports: **17613** bridge <-> extension; **13469** Roblox Studio's own MCP port. A "0 tools" symptom is usually a port conflict (leftover bridge, zombie `StudioMCP.exe`, or a third-party squatter like ropilot) — see the heavily-commented process-recovery code in `bridge.py` before touching it.

## Adding a new AI site (provider) — sync 4 places

`providers/*.js` each expose a global `ZSProvider` IIFE; the content script loads them in fixed order: `core/config.js`, `core/parser.js`, `providers/<site>.js`, `core/main.js` with `overlay.css`. `core/main.js` is provider-agnostic and must NEVER touch the host site's DOM — all site access goes through `P` (the provider interface). To add a site you must touch:

1. `manifest.json` — content_scripts entry (4 JS + css above) **and** matching `host_permissions`.
2. `background.js` — add the URL pattern to both `PROVIDER_URLS` and `KNOWN_EXCLUDE`.
3. `core/main.js` — `AI_SITES` entry; its `name` must equal the provider's `displayName`.
4. The new file `providers/<site>.js` — mirror an existing provider (kimi.js is the reference one).

Grep for "Keep in sync" — the codebase flags other mirrored lists the same way.

## Conventions

- Every file starts with `// SPDX-License-Identifier: GPL-3.0-or-later` (Python: `#`). Keep it.
- `bridge.py`'s `BRIDGE_VERSION` is meant to track `manifest.json` "version" (printed at startup so a terminal screenshot identifies the build).
- The terminal is the diagnostic surface for **non-technical users**: console output stays strictly ASCII, noisy detail goes through `log(..., terminal=False)` (only `logs/bridge_debug.log`, which is append-only), user action steps go through `action_banner()`. Don't add glyphs/emoji to console output.
- `config.json` primary server `roblox` is protected: `config_add_server` / `config_remove_server` (and the extension's add/remove_server messages) refuse to touch it. Add-ons get rewritten into config.json and the bridge restarts itself.
- Windows process handling is deliberately careful: only kills processes it can PROVE are leftovers (cmdline/process-tree checks, port ownership via `netstat -ano` both `TCP` and `TCPv6`), uses `taskkill /F /T` for trees. Preserve the "never kill on suspicion" guard if you edit it.
- `logs/*.log` are gitignored; never commit them. `.gitattributes` pins LF for `*.sh`/`*.command` (CRLF breaks the macOS launcher) — keep that.

## Commands

- Parser tests (the only automated tests in the repo): `node test-parser.js` from `zeroscript-extension/` (expects `node`; uses `require`, so no bundler).
- Run the bridge during dev (Windows): `pip install websockets`, then `python bridge.py` from the repo root. `start.bat` / `MacOS_Start.command` are the user-facing launchers (Python 3.9+, frees port 17613 from a previous bridge, logs to `logs/start.log`). `ZS_BRIDGE_PORT` overrides the port — sync it with `background.js` `PORT` if you choose another.
- Extension ↔ bridge protocol (bridges in `bridge.py` handle in `handler()`): `ping/pong`, `studio_status`, `list_tools`, `call_tool`, `add_server/remove_server`, `restart_mcp`. `background.js` owns the single reconnecting socket and resolves every request even offline — keep that contract when changing either side.

## Testing notes

- No CI, no linters, no typecheck config. Unit tests are only the parser smoke tests.
- The command format the model emits is defined in `core/config.js` system prompt + parsed in `core/parser.js` (pure string logic, no DOM): `###LUA### … ###END_LUA###` (optional `:Edit|:Client|:Server`, defaults Edit) or `{"command": …, "params": {…}}`. `###LUA###` always maps to `execute_luau`. Parser changes MUST stay compatible with the existing tests and the system prompt text in config.js.
- Provider files carry "last validated: <date> — <url>" notes; site DOM changes break them (that's the norm, not a bug).