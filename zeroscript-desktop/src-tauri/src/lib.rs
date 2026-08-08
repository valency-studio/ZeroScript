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
use std::sync::atomic::{AtomicU64, Ordering};
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
struct BridgeState {
    child: Mutex<Option<CommandChild>>,
    gen: AtomicU64,
}

/// Per-OS data directory for config.json + logs (via ZS_DATA_DIR).
fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
}

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
                    let code = payload.code.unwrap_or(-1);
                    let _ = app2.emit("bridge-exit", code);
                    let st = app2.state::<BridgeState>();
                    // Only clear the state if no NEWER child has replaced this
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

fn kill_bridge(app: &AppHandle) {
    let state = app.state::<BridgeState>();
    let mut guard = state.child.lock().unwrap();
    if let Some(child) = guard.take() {
        let _ = child.kill();
    }
}

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
    // Give the OS a moment to release the listen socket before respawning.
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
}

#[tauri::command]
fn get_app_info(app: AppHandle) -> AppInfo {
    AppInfo {
        version: app.package_info().version.to_string(),
        os: std::env::consts::OS.to_string(),
    }
}

// ── tray + window behaviour ────────────────────────────────────────────────
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(BridgeState {
            child: Mutex::new(None),
            gen: AtomicU64::new(0),
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
        ])
        .setup(|app| {
            setup_tray(app.handle())?;
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
