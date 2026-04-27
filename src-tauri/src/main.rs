#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod config;
mod error;
mod state;
mod watcher;

use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Manager;

#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::Emitter;

// On macOS, `application:openURLs:` fires BEFORE `applicationDidFinishLaunching:`
// when the app is cold-launched as a file's default editor, which means
// RunEvent::Opened arrives before our setup() has managed AppCtx. Buffer those
// early paths here so setup() can drain them.
#[cfg(any(target_os = "macos", target_os = "ios"))]
static EARLY_OPENED: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            // Portable: both madame.yaml and state.json live next to the binary,
            // so each copy of the exe is an independent, self-contained instance.
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                .unwrap_or_else(|| std::path::PathBuf::from("."));
            let config_path = exe_dir.join("madame_config.yaml");
            let state_path = exe_dir.join("editor_state.json");

            let config = config::load_or_default(&config_path).unwrap_or_default();
            let app_state = state::load_or_default(&state_path);

            // On Windows/Linux, file associations launch the binary with the
            // path as argv. macOS delivers it via RunEvent::Opened instead.
            let mut pending: Vec<PathBuf> = std::env::args()
                .skip(1)
                .filter(|a| !a.starts_with("--"))
                .map(PathBuf::from)
                .collect();

            #[cfg(any(target_os = "macos", target_os = "ios"))]
            pending.extend(std::mem::take(&mut *EARLY_OPENED.lock().unwrap()));

            app.manage(commands::AppCtx {
                state_path,
                config: Mutex::new(config),
                state: Mutex::new(app_state),
                watcher: Mutex::new(watcher::FileWatcher::new()),
                open_queue: Mutex::new(commands::OpenQueue {
                    pending,
                    frontend_ready: false,
                }),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_config,
            commands::read_state,
            commands::write_state,
            commands::get_recent_files,
            commands::remove_recent_file,
            commands::open_file,
            commands::save_file,
            commands::stop_watching,
            commands::take_pending_open_paths,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        // macOS/iOS deliver file-association opens (initial launch and while
        // running) as RunEvent::Opened. On cold launch this can fire BEFORE
        // setup() runs, so AppCtx may not yet be managed — fall back to the
        // EARLY_OPENED static in that case.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = _event {
            let paths: Vec<PathBuf> =
                urls.iter().filter_map(|u| u.to_file_path().ok()).collect();

            match _app_handle.try_state::<commands::AppCtx>() {
                Some(ctx) => {
                    let mut q = ctx.open_queue.lock().unwrap();
                    if q.frontend_ready {
                        drop(q);
                        for p in paths {
                            let _ = _app_handle
                                .emit("cli-open-path", p.to_string_lossy().to_string());
                        }
                    } else {
                        q.pending.extend(paths);
                    }
                }
                None => {
                    EARLY_OPENED.lock().unwrap().extend(paths);
                }
            }
        }
    });
}
