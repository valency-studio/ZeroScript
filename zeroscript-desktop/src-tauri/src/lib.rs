// SPDX-License-Identifier: GPL-3.0-or-later
// ---------------------------------------------------------------------------
// ZeroScript Desktop backend.
//
// Responsibilities:
// - Manage the ZeroScript Bridge sidecar.
// - Start / stop / restart the bridge.
// - Stream bridge stdout/stderr to the frontend.
// - Detect bridge exits.
// - Store bridge configuration/logs in the OS-specific app data directory.
// - System tray integration.
// - Single-instance protection.
// - Autostart support.
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

// ============================================================================
// Bridge state
// ============================================================================

/// State of the currently running Bridge process.
///
/// `generation` prevents an old bridge task from clearing the state of a
/// newer bridge after a fast Stop -> Start sequence.
///
/// `pid` is kept separately because CommandChild::kill() only targets the
/// immediate process. PyInstaller one-file applications can create additional
/// child processes which must also be terminated.
struct BridgeState {
    child: Mutex<Option<CommandChild>>,
    pid: Mutex<Option<u32>>,
    generation: AtomicU64,
}

// ============================================================================
// Application data
// ============================================================================

/// Returns the OS-specific application data directory.
///
/// This directory is used for:
/// - config.json
/// - logs/
/// - desktop-settings.json
fn data_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
}

// ============================================================================
// Desktop settings
// ============================================================================

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
        .and_then(|content| serde_json::from_str::<DesktopSettings>(&content).ok())
        .unwrap_or_default()
}

fn write_settings(
    app: &AppHandle,
    settings: &DesktopSettings,
) -> Result<(), String> {
    let directory = data_dir(app);

    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create data directory: {error}"))?;

    let json = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("failed to serialize settings: {error}"))?;

    std::fs::write(settings_path(app), json)
        .map_err(|error| format!("failed to write settings: {error}"))
}

// ============================================================================
// Tauri commands - settings
// ============================================================================

#[tauri::command]
fn get_settings(app: AppHandle) -> DesktopSettings {
    read_settings(&app)
}

#[tauri::command]
fn set_start_bridge_on_launch(
    app: AppHandle,
    enabled: bool,
) -> Result<(), String> {
    let mut settings = read_settings(&app);

    settings.start_bridge_on_launch = enabled;

    write_settings(&app, &settings)
}

// ============================================================================
// Bridge lifecycle
// ============================================================================

/// Starts the ZeroScript Bridge.
///
/// This function is intentionally idempotent:
/// calling it while the bridge is already running does nothing.
fn spawn_bridge(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<BridgeState>();

    // ------------------------------------------------------------------------
    // Check whether a bridge is already running.
    // ------------------------------------------------------------------------

    {
        let child_guard = state
            .child
            .lock()
            .map_err(|_| "bridge child mutex poisoned".to_string())?;

        if child_guard.is_some() {
            return Ok(());
        }
    }

    // ------------------------------------------------------------------------
    // Create a new generation.
    // ------------------------------------------------------------------------

    let generation = state.generation.fetch_add(1, Ordering::SeqCst) + 1;

    // ------------------------------------------------------------------------
    // Prepare sidecar environment.
    // ------------------------------------------------------------------------

    let directory = data_dir(app);

    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create bridge data directory: {error}"))?;

    let sidecar = app
        .shell()
        .sidecar("ZeroScriptBridge")
        .map_err(|error| format!("sidecar lookup failed: {error}"))?
        .env("ZS_DATA_DIR", &directory);

    // ------------------------------------------------------------------------
    // Spawn bridge.
    // ------------------------------------------------------------------------

    let (mut receiver, child) = sidecar
        .spawn()
        .map_err(|error| format!("bridge spawn failed: {error}"))?;

    let pid = child.pid();

    // ------------------------------------------------------------------------
    // Store process state.
    //
    // Re-check after spawning because another thread could theoretically
    // have started the bridge while we were preparing the sidecar.
    // ------------------------------------------------------------------------

    {
        let mut child_guard = state
            .child
            .lock()
            .map_err(|_| "bridge child mutex poisoned".to_string())?;

        if child_guard.is_some() {
            // Another bridge won the race.
            let _ = child.kill();

            return Ok(());
        }

        *child_guard = Some(child);
    }

    {
        let mut pid_guard = state
            .pid
            .lock()
            .map_err(|_| "bridge PID mutex poisoned".to_string())?;

        *pid_guard = Some(pid);
    }

    // ------------------------------------------------------------------------
    // Monitor bridge events asynchronously.
    // ------------------------------------------------------------------------

    let app_handle = app.clone();

    tauri::async_runtime::spawn(async move {
        loop {
            let event = receiver.recv().await;

            match event {
                // ------------------------------------------------------------
                // stdout / stderr
                // ------------------------------------------------------------

                Some(CommandEvent::Stdout(bytes))
                | Some(CommandEvent::Stderr(bytes)) => {
                    let output = String::from_utf8_lossy(&bytes).to_string();

                    let _ = app_handle.emit("bridge-log", output);
                }

                // ------------------------------------------------------------
                // Process terminated
                // ------------------------------------------------------------

                Some(CommandEvent::Terminated(payload)) => {
                    let exit_code = payload.code.unwrap_or(-1);

                    let _ = app_handle.emit("bridge-exit", exit_code);

                    clear_bridge_state_if_current(
                        &app_handle,
                        generation,
                    );

                    break;
                }

                // ------------------------------------------------------------
                // Shell/plugin error
                // ------------------------------------------------------------

                Some(CommandEvent::Error(error)) => {
                    let _ = app_handle.emit(
                        "bridge-log",
                        format!("[bridge error] {error}\n"),
                    );
                }

                // ------------------------------------------------------------
                // Other shell events
                // ------------------------------------------------------------

                Some(_) => {}

                // ------------------------------------------------------------
                // Channel closed unexpectedly
                // ------------------------------------------------------------

                None => {
                    let _ = app_handle.emit("bridge-exit", -1);

                    clear_bridge_state_if_current(
                        &app_handle,
                        generation,
                    );

                    break;
                }
            }
        }
    });

    let _ = app.emit(
        "bridge-state",
        serde_json::json!({
            "running": true,
            "pid": pid,
        }),
    );

    Ok(())
}

/// Clears bridge state only if it still belongs to the same generation.
///
/// This prevents:
///
/// Start A
/// -> Stop A
/// -> Start B
/// -> old A termination event
///
/// from accidentally clearing Bridge B.
fn clear_bridge_state_if_current(
    app: &AppHandle,
    generation: u64,
) {
    let state = app.state::<BridgeState>();

    if state.generation.load(Ordering::SeqCst) != generation {
        return;
    }

    if let Ok(mut child_guard) = state.child.lock() {
        *child_guard = None;
    }

    if let Ok(mut pid_guard) = state.pid.lock() {
        *pid_guard = None;
    }

    let _ = app.emit("bridge-state", false);
}

// ============================================================================
// Process tree termination
// ============================================================================

/// Terminates the entire bridge process tree.
///
/// Windows:
///     taskkill /T /F
///
/// Unix:
///     recursively terminate descendants first, then the parent.
///
/// This is required because a PyInstaller one-file executable can create
/// additional child processes.
fn kill_process_tree(pid: u32) {
    if pid == 0 {
        return;
    }

    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args([
                "/PID",
                &pid.to_string(),
                "/T",
                "/F",
            ])
            .output();
    }

    #[cfg(not(target_os = "windows"))]
    {
        kill_unix_process_tree(pid);
    }
}

#[cfg(not(target_os = "windows"))]
fn kill_unix_process_tree(pid: u32) {
    use std::process::Command;

    // First attempt to recursively terminate descendants.
    //
    // `pkill -P` only handles direct children, so repeat it a few times
    // to catch deeper process trees.
    for _ in 0..4 {
        let result = Command::new("pkill")
            .args([
                "-TERM",
                "-P",
                &pid.to_string(),
            ])
            .output();

        if result.is_err() {
            break;
        }

        std::thread::sleep(Duration::from_millis(50));
    }

    // Give children a short opportunity to terminate gracefully.
    std::thread::sleep(Duration::from_millis(100));

    // Force-kill remaining descendants.
    let _ = Command::new("pkill")
        .args([
            "-KILL",
            "-P",
            &pid.to_string(),
        ])
        .output();

    // Finally terminate the parent.
    let _ = Command::new("kill")
        .args([
            "-KILL",
            &pid.to_string(),
        ])
        .output();
}

// ============================================================================
// Stop bridge
// ============================================================================

fn kill_bridge(app: &AppHandle) {
    let state = app.state::<BridgeState>();

    // ------------------------------------------------------------------------
    // Invalidate the current generation BEFORE killing the process.
    //
    // This is important:
    //
    // Terminated event can arrive asynchronously while kill_bridge() is
    // executing. Incrementing generation first guarantees that the old
    // termination handler cannot accidentally clear a future process.
    // ------------------------------------------------------------------------

    state.generation.fetch_add(1, Ordering::SeqCst);

    // ------------------------------------------------------------------------
    // Take ownership of state without holding locks while killing.
    // ------------------------------------------------------------------------

    let child = match state.child.lock() {
        Ok(mut guard) => guard.take(),
        Err(_) => None,
    };

    let pid = match state.pid.lock() {
        Ok(mut guard) => guard.take(),
        Err(_) => None,
    };

    // ------------------------------------------------------------------------
    // Kill entire process tree.
    // ------------------------------------------------------------------------

    if let Some(pid) = pid {
        kill_process_tree(pid);
    }

    // ------------------------------------------------------------------------
    // Fallback: kill immediate child through Tauri.
    // ------------------------------------------------------------------------

    if let Some(child) = child {
        let _ = child.kill();
    }

    let _ = app.emit("bridge-state", false);
}

// ============================================================================
// Tauri commands - bridge
// ============================================================================

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

    // Allow the operating system to release the listening socket.
    tokio::time::sleep(Duration::from_millis(600)).await;

    spawn_bridge(&app)
}

#[tauri::command]
fn bridge_running(state: State<'_, BridgeState>) -> bool {
    state
        .child
        .lock()
        .map(|guard| guard.is_some())
        .unwrap_or(false)
}

// ============================================================================
// Data directory
// ============================================================================

#[tauri::command]
fn get_data_dir(app: AppHandle) -> String {
    data_dir(&app)
        .to_string_lossy()
        .to_string()
}

#[tauri::command]
fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let directory = data_dir(&app);

    std::fs::create_dir_all(&directory)
        .map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("explorer")
        .arg(&directory)
        .spawn();

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open")
        .arg(&directory)
        .spawn();

    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open")
        .arg(&directory)
        .spawn();

    result.map_err(|error| error.to_string())?;

    Ok(())
}

// ============================================================================
// Application information
// ============================================================================

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

// ============================================================================
// URL handling
// ============================================================================

/// Opens an HTTP(S) URL in the default browser.
///
/// Only http:// and https:// URLs are accepted.
#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let trimmed = url.trim();

    if !(trimmed.starts_with("https://") || trimmed.starts_with("http://")) {
        return Err("only HTTP(S) URLs are allowed".into());
    }

    #[cfg(target_os = "windows")]
    {
        // Prevent shell metacharacters from reaching `cmd`.
        if trimmed
            .chars()
            .any(|character| {
                matches!(
                    character,
                    '&'
                        | '|'
                        | '^'
                        | '<'
                        | '>'
                        | '"'
                        | '\n'
                        | '\r'
                )
            })
        {
            return Err("unsafe URL".into());
        }
    }

    #[cfg(target_os = "windows")]
    let result = std::process::Command::new("cmd")
        .args([
            "/c",
            "start",
            "",
            trimmed,
        ])
        .spawn();

    #[cfg(target_os = "macos")]
    let result = std::process::Command::new("open")
        .arg(trimmed)
        .spawn();

    #[cfg(target_os = "linux")]
    let result = std::process::Command::new("xdg-open")
        .arg(trimmed)
        .spawn();

    result.map_err(|error| error.to_string())?;

    Ok(())
}

// ============================================================================
// System tray
// ============================================================================

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn quit(app: &AppHandle) {
    kill_bridge(app);
    app.exit(0);
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(
        app,
        "show",
        "Show ZeroScript",
        true,
        None::<&str>,
    )?;

    let start = MenuItem::with_id(
        app,
        "start",
        "Start Bridge",
        true,
        None::<&str>,
    )?;

    let stop = MenuItem::with_id(
        app,
        "stop",
        "Stop Bridge",
        true,
        None::<&str>,
    )?;

    let quit_item = MenuItem::with_id(
        app,
        "quit",
        "Quit ZeroScript",
        true,
        None::<&str>,
    )?;

    let menu = Menu::with_items(
        app,
        &[&show, &start, &stop, &quit_item],
    )?;

    let mut builder = TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("ZeroScript")
        .on_menu_event(|app, event| {
            match event.id().as_ref() {
                "show" => {
                    show_main(app);
                }

                "start" => {
                    if let Err(error) = spawn_bridge(app) {
                        let _ = app.emit(
                            "bridge-log",
                            format!(
                                "[gui] could not start bridge: {error}\n"
                            ),
                        );
                    }
                }

                "stop" => {
                    kill_bridge(app);
                }

                "quit" => {
                    quit(app);
                }

                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            use tauri::tray::{
                MouseButton,
                MouseButtonState,
            };

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

// ============================================================================
// Application entry point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // --------------------------------------------------------------------
        // Shared application state
        // --------------------------------------------------------------------

        .manage(BridgeState {
            child: Mutex::new(None),
            pid: Mutex::new(None),
            generation: AtomicU64::new(0),
        })

        // --------------------------------------------------------------------
        // Plugins
        // --------------------------------------------------------------------

        .plugin(tauri_plugin_shell::init())

        .plugin(
            tauri_plugin_autostart::init(
                MacosLauncher::LaunchAgent,
                None,
            ),
        )

        .plugin(
            tauri_plugin_single_instance::init(
                |app, _args, _cwd| {
                    show_main(app);
                },
            ),
        )

        // --------------------------------------------------------------------
        // Commands
        // --------------------------------------------------------------------

        .invoke_handler(
            tauri::generate_handler![
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
            ],
        )

        // --------------------------------------------------------------------
        // Setup
        // --------------------------------------------------------------------

        .setup(|app| {
            setup_tray(app.handle())?;

            let settings = read_settings(app.handle());

            if settings.start_bridge_on_launch {
                if let Err(error) = spawn_bridge(app.handle()) {
                    let _ = app.emit(
                        "bridge-log",
                        format!(
                            "[startup] could not start bridge: {error}\n"
                        ),
                    );
                }
            }

            Ok(())
        })

        // --------------------------------------------------------------------
        // Window behaviour
        // --------------------------------------------------------------------

        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                // Closing the main window hides the application to tray.
                api.prevent_close();

                let _ = window.hide();
            }
        })

        // --------------------------------------------------------------------
        // Build + runtime
        // --------------------------------------------------------------------

        .build(tauri::generate_context!())
        .expect("error while building ZeroScript")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                kill_bridge(app);
            }
        });
}