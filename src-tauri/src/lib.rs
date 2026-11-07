//! Notavi's native shell. Deliberately thin: the whole app (including the
//! SQLite library) runs in the WebView. The shell only adds native file save
//! dialogs, file writing for backups, and opening links in the system browser.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running Notavi");
}
