// Pipe Runvas - Tauri 2 shell.
//
// Security posture (WINDOWS-DELIVERY-PLAN.md, security contract items 1-6):
// - Loads ONLY the exact private Pipe HTTPS origin as the window URL. The
//   React client is remote, never bundled under file:/localhost.
// - on_navigation(): fail-closed, exact scheme/host/port (+ user/pass) match;
//   every other navigation, redirect or frame navigation is denied. No HTTP
//   fallback, no lookalikes, no external protocol handlers.
// - on_new_window(): every window.open/popup request is denied -> no child
//   windows, nothing leaves the guarded WebView.
// - on_permission_request(): default-DENY for every permission kind (camera,
//   mic, geolocation, clipboard-read, display-capture, filesystem-access,
//   pointer-lock, sensors, ...). Ordinary copy/paste and <input type=file>
//   do not use these permission requests.
// - on_download(): browser-initiated downloads continue through the
//   authenticated WebView2 session only for the exact Pipe origin (or blob:
//   URLs wrapping the exact origin, e.g. blob:https://host/<uuid> used by the
//   client's save flow); everything else is cancelled. Downloaded files are
//   never auto-opened.
// - No IPC surface: no plugins, no commands, capabilities=[] -> remote
//   content receives zero native authority. No devtools feature compiled in.
// - Persistent separate user-data dir %LOCALAPPDATA%\com.piperunvas.desktop,
//   never shared with Hermes.
// - Close is the normal graceful window close; the shell never forces
//   destruction of a webview while content may hold unsaved work (the shared
//   web client owns the beforeunload departure guard, which WebView2 shows
//   as its standard Stay/Leave prompt). Unsaved work protection for every
//   web form belongs to the shared client, not to a privileged shell bridge.

use tauri::webview::{DownloadEvent, NewWindowResponse, PermissionResponse};
use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Exact private Pipe origin - no path, no wildcard. Recorded deployment
/// origin from docs/STATUS.md, subject to parent confirmation before release
/// packaging.
const PIPE_ORIGIN: &str = "https://pipe-trial.taild8e584.ts.net";

fn origin_allowed(u: &tauri::Url) -> bool {
    match tauri::Url::parse(PIPE_ORIGIN) {
        Ok(base) => {
            // Exact scheme/host/port match; userinfo present makes host_str
            // differ, and the username()/password() checks reject embedded
            // credentials outright.
            u.scheme() == base.scheme()
                && u.host_str() == base.host_str()
                && u.port_or_known_default() == base.port_or_known_default()
                && u.username() == ""
                && u.password().is_none()
        }
        Err(_) => false,
    }
}

/// Download gate: allow only the exact Pipe origin, or blob: URLs whose inner
/// URL is the exact Pipe origin (the client's save flow uses object URLs).
/// Anything unparseable, plain-data, cross-origin or plain-HTTP is denied.
fn download_allowed(u: &tauri::Url) -> bool {
    match u.scheme() {
        "https" => origin_allowed(u),
        "blob" => match tauri::Url::parse(u.path().trim_start_matches('/')) {
            Ok(inner) => inner.scheme() == "https" && origin_allowed(&inner),
            Err(_) => false,
        },
        _ => false,
    }
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let url = tauri::Url::parse(PIPE_ORIGIN)
                .map_err(|e| format!("invalid PIPE_ORIGIN constant: {e}"))?;
            WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Pipe Runvas")
                .inner_size(1360.0, 900.0)
                .min_inner_size(480.0, 360.0)
                // Fail-closed navigation guard: every navigation (initial
                // load, redirect, in-page, frame top-level) to a
                // non-exact-origin URL is denied.
                .on_navigation(|u| origin_allowed(u))
                // Deny all popup / child-window requests.
                .on_new_window(|_url, _features| NewWindowResponse::Deny)
                // Origin-gated downloads; everything else is cancelled at the
                // WebView2 DownloadStarting stage (no partial junk left).
                .on_download(|_webview, event| match event {
                    DownloadEvent::Requested { url, .. } => download_allowed(&url),
                    _ => true,
                })
                // Default-deny every web permission request.
                .on_permission_request(|_webview, _kind| PermissionResponse::Deny)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Pipe Runvas");
}
