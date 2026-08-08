// SPDX-License-Identifier: GPL-3.0-or-later
// ---------------------------------------------------------------------------
//  ZeroScript Desktop backend.
//
//  Manages the ZeroScript BRIDGE (the PyInstaller sidecar built from
//  bridge.py) as a hidden child process:
//    - start/stop/restart commands, streamed stdout/stderr -> "bridge-log"
//      events for the Logs view, exit detection -> "bridge-exit".
//    - the bridge gets ZS_DATA_DIR set to Tauri's per-OS app data dir, so
//      config.json + logs/ live in a proper user location on every platform.
//  Plus: system tray (minimize-to-tray), single-instance guard, and the
//  autostart plugin (on-login toggle from the Settings view).
// ---------------------------------------------------------------------------
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// The running bridge child process, if any, plus a generation counter.
///
/// Every spawn bumps `gen` and its task captures the value; the `Terminated`
/// handler only clears state when the generation still matches. Without this,
/// a Stop -> quick Start could let the OLD task's Terminated event clear the
/// NEW child from state (GUI would report "stopped" while a bridge runs, and
/// a later Stop would not kill it).
///
/// `stopping` is set to `true` just before an intentional kill so the
/// background task can tell the frontend this was a manual stop, not a crash.
struct BridgeState {
    child: Mutex<Option<CommandChild>>,
    gen: AtomicU64,
    stopping: AtomicBool,
}

// ---------------------------------------------------------------------------
// bridge-exit event payload
// ---------------------------------------------------------------------------

/// Payload for the "bridge-exit" event.
///
/// FRONTEND MIGRATION NOTE: previously this event carried a bare `i32` exit
/// code. It now carries `{ code: number, intentional: boolean }`.
/// Update your listener accordingly:
///
///   listen<BridgeExitPayload>("bridge-exit", ({ payload }) => {
///     if (!payload.intentional) { /* handle crash */ }
///   });
#[derive(Clone, serde::Serialize)]
struct BridgeExitPayload {
    /// OS exit code of the bridge process (-1 if unknown).
    code: i32,
    /// true  = user explicitly stopped/restarted the bridge.
    /// false = process crashed or was killed externally.
    intentional: bool,
}

// ---------------------------------------------------------------------------
// app data dir + settings
// ---------------------------------------------------------------------------

/// Per-OS data directory for config.json + logs (via ZS_DATA_DIR).
fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
}

/// Per-app GUI settings persisted as JSON next to config.json. Small and
/// dependency-free on purpose (no store plugin): a single struct the Settings
/// view reads and writes.
#[derive(serde::Serialize, serde::Deserialize, Default)]
#[serde(default)]
struct DesktopSettings {
    start_bridge_on_launch: bool,
}

fn settings_path(app: &AppHandle) -> PathBuf {
    data_dir(app).join("desktop-settings.json")
}

fn read_settings(app: &AppHandle) -> DesktopSettings {
    std::fs::read_to_string(settings_path(app))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_settings(app: &AppHandle, s: &DesktopSettings) -> Result<(), String> {
    let dir = data_dir(app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(app), json).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(app: AppHandle) -> DesktopSettings {
    read_settings(&app)
}

#[tauri::command]
fn set_start_bridge_on_launch(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mut s = read_settings(&app);
    s.start_bridge_on_launch = enabled;
    write_settings(&app, &s)
}

// ---------------------------------------------------------------------------
// process-tree kill  ← FIXED: was only killing the direct child
// ---------------------------------------------------------------------------

/// Kill a process AND all its descendants.
///
/// `CommandChild::kill()` only signals the **direct** child process.
/// PyInstaller sidecars unpack and exec a separate Python runtime; if we only
/// kill the launcher that Python process survives as an orphan, continues
/// holding the listen socket, and a subsequent `start_bridge` / restart will
/// fail to bind the port.
///
/// * **Windows** — `taskkill /F /T /PID <pid>` (force + full tree recursion).
///   CREATE_NO_WINDOW prevents a console flash.
/// * **macOS / Linux** — send SIGKILL directly to the PID, then also to the
///   process *group* (`-<pgid>`). PyInstaller typically becomes the group
///   leader so the group kill reaches all its worker children. The second
///   command fails gracefully when the bridge is not a group leader.
fn kill_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const NO_WINDOW: u32 = 0x0800_0000;
        // Errors are intentionally ignored: the process may already be dead.
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .creation_flags(NO_WINDOW)
            .spawn();
    }

    #[cfg(not(target_os = "windows"))]
    {
        // Direct SIGKILL to the process itself.
        let _ = std::process::Command::new("kill")
            .args(["-9", &pid.to_string()])
            .spawn();
        // SIGKILL to the process group (pgid == pid when bridge is leader).
        // Harmless if the bridge is not the group leader.
        let _ = std::process::Command::new("kill")
            .args(["-9", &format!("-{pid}")])
            .spawn();
    }
}

// ---------------------------------------------------------------------------
// spawn / kill bridge
// ---------------------------------------------------------------------------

/// Spawn the bridge sidecar (hidden, no console window) and start streaming
/// its output to the frontend. No-op if it is already running.
fn spawn_bridge(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<BridgeState>();
    let mut guard = state.child.lock().unwrap();
    if guard.is_some() {
        return Ok(());
    }
    let gen = state.gen.fetch_add(1, Ordering::SeqCst) + 1;
    let dir = data_dir(app);
    let sidecar = app
        .shell()
        .sidecar("ZeroScriptBridge")
        .map_err(|e| format!("sidecar lookup failed: {e}"))?
        .env("ZS_DATA_DIR", &dir);
    let (mut rx, child) = sidecar.spawn().map_err(|e| format!("spawn failed: {e}"))?;
    *guard = Some(child);
    drop(guard);

    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).to_string();
                    let _ = app2.emit("bridge-log", line);
                }
                CommandEvent::Terminated(payload) => {
                    let st = app2.state::<BridgeState>();

                    // Atomically consume the stopping flag.
                    // true  = stop was requested by the user.
                    // false = unexpected crash / external kill.
                    let intentional = st.stopping.swap(false, Ordering::SeqCst);
                    let code = payload.code.unwrap_or(-1);
                    let _ = app2.emit("bridge-exit", BridgeExitPayload { code, intentional });

                    // Only clear state when no NEWER child has replaced this
                    // one (see the generation counter doc on BridgeState).
                    if st.gen.load(Ordering::SeqCst) == gen {
                        *st.child.lock().unwrap() = None;
                    }
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

/// FIXED: was only calling child.kill() which misses PyInstaller subprocesses.
///
/// New order of operations:
///  1. Set `stopping = true` BEFORE taking the child so the Terminated
///     handler sees it even if the process dies between take() and kill_tree().
///  2. Take the child out of the mutex (state appears "stopped" immediately).
///  3. Call kill_tree(pid) — OS-level, kills the full process tree.
///  4. Call child.kill() — belt-and-suspenders via the plugin handle.
///
/// If there is no child, `stopping` is reset so the flag doesn't leak.
fn kill_bridge(app: &AppHandle) {
    let state = app.state::<BridgeState>();

    // Set BEFORE locking so the Terminated handler can never miss it,
    // even on a very fast process death.
    state.stopping.store(true, Ordering::SeqCst);

    let mut guard = state.child.lock().unwrap();
    if let Some(child) = guard.take() {
        let pid = child.pid();
        // Step 1: OS-level kill of the full process tree.
        kill_tree(pid);
        // Step 2: plugin-level kill as a belt-and-suspenders fallback.
        // FIXED: error was silently discarded; now we at least log it.
        if let Err(e) = child.kill() {
            // The process is likely already dead (kill_tree succeeded).
            // Emit as a debug log rather than an error.
            let _ = app.emit(
                "bridge-log",
                format!("[gui] child.kill() after kill_tree: {e}\n"),
            );
        }
    } else {
        // Nothing was running — clear the flag we set above so it doesn't
        // accidentally mark a future Terminated event as intentional.
        state.stopping.store(false, Ordering::SeqCst);
    }
}

// ---------------------------------------------------------------------------
// tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
fn start_bridge(app: AppHandle) -> Result<(), String> {
    spawn_bridge(&app)
}

#[tauri::command]
fn stop_bridge(app: AppHandle) -> Result<(), String> {
    kill_bridge(&app);
    Ok(())
}

#[tauri::command]
async fn restart_bridge(app: AppHandle) -> Result<(), String> {
    kill_bridge(&app);
    // kill_tree() has already fired; give the OS time to release the listen
    // socket before spawning a new instance.  600 ms is conservative but safe
    // — on Windows taskkill runs asynchronously so we need the headroom.
    tokio::time::sleep(Duration::from_millis(600)).await;
    spawn_bridge(&app)
}

#[tauri::command]
fn bridge_running(state: State<'_, BridgeState>) -> bool {
    state.child.lock().unwrap().is_some()
}

#[tauri::command]
fn get_data_dir(app: AppHandle) -> String {
    data_dir(&app).to_string_lossy().to_string()
}

#[tauri::command]
fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let dir = data_dir(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    #[cfg(target_os = "windows")]
    let res = std::process::Command::new("explorer").arg(&dir).spawn();
    #[cfg(target_os = "macos")]
    let res = std::process::Command::new("open").arg(&dir).spawn();
    #[cfg(target_os = "linux")]
    let res = std::process::Command::new("xdg-open").arg(&dir).spawn();
    res.map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(serde::Serialize)]
struct AppInfo {
    version: String,
    os: String,
    arch: String,
}

#[tauri::command]
fn get_app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    }
}

/// Open a URL in the user's default browser (About view: update downloads,
/// GitHub, support links).
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    // The URL is handed to `cmd /c start` unquoted on Windows, where & | ^ < >
    // are command metacharacters. Only http(s) URLs are ever opened by this
    // app (repo, releases, issues, support), so reject anything that could be
    // interpreted by the shell.
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("unsafe URL".into());
    }
    #[cfg(target_os = "windows")]
    {
        if url.chars().any(|c| matches!(c, '&' | '|' | '^' | '<' | '>' | '"')) {
            return Err("unsafe URL".into());
        }
    }
    #[cfg(target_os = "windows")]
    let res = std::process::Command::new("cmd")
        .args(["/c", "start", "", &url])
        .spawn();
    #[cfg(target_os = "macos")]
    let res = std::process::Command::new("open").arg(&url).spawn();
    #[cfg(target_os = "linux")]
    let res = std::process::Command::new("xdg-open").arg(&url).spawn();
    res.map_err(|e| e.to_string())?;
    Ok(())
}

// ---------------------------------------------------------------------------
// tray + window behaviour
// ---------------------------------------------------------------------------

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

fn quit(app: &AppHandle) {
    kill_bridge(app);
    app.exit(0);
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show ZeroScript", true, None::<&str>)?;
    let start = MenuItem::with_id(app, "start", "Start Bridge", true, None::<&str>)?;
    let stop = MenuItem::with_id(app, "stop", "Stop Bridge", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit ZeroScript", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &start, &stop, &quit_item])?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("ZeroScript")
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "start" => {
                if let Err(e) = spawn_bridge(app) {
                    let _ = app.emit("bridge-log", format!("[gui] could not start bridge: {e}\n"));
                }
            }
            "stop" => kill_bridge(app),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // Double-click on the tray icon (Windows) shows the window again.
            use tauri::tray::MouseButton;
            use tauri::tray::MouseButtonState;
            if let tauri::tray::TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BridgeState {
            child: Mutex::new(None),
            gen: AtomicU64::new(0),
            stopping: AtomicBool::new(false), // ← new field
        })
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .invoke_handler(tauri::generate_handler![
            start_bridge,
            stop_bridge,
            restart_bridge,
            bridge_running,
            get_data_dir,
            open_data_dir,
            get_app_info,
            open_url,
            get_settings,
            set_start_bridge_on_launch,
        ])
        .setup(|app| {
            setup_tray(app.handle())?;
            // Start the bridge automatically if the user enabled it in
            // Settings - otherwise the app opens to an offline dashboard and
            // the user has to click Start every time.
            if read_settings(app.handle()).start_bridge_on_launch {
                let _ = spawn_bridge(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window hides to tray instead of quitting.
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building ZeroScript")
        .run(|app, event| {
            // Always stop the bridge child when the app really exits.
            if let RunEvent::Exit = event {
                kill_bridge(app);
            }
        });
}