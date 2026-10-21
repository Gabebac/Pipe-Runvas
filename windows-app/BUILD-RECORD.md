# Pipe Runvas — Windows build record (W1 security gaps closed, unsigned test artifact)

Shell: Tauri 2 (WebView2), per owner directive (overrides plan's Electron recommendation).
Remote-only client: window loads the exact private origin https://pipe-trial.taild8e584.ts.net
(no path, no wildcard). The React client is NOT bundled.

## W1 security gaps implemented (this build)

Runtime (src-tauri/src/main.rs):
- on_navigation(): fail-closed exact-origin guard (scheme/host/port, no userinfo);
  every other navigation, redirect, and frame top-level navigation denied. [was already present]
- on_new_window(): ALL window.open/popup requests denied (NewWindowResponse::Deny => args.SetHandled(true)). [new]
- on_permission_request(): default-DENY for every PermissionKind (camera, mic,
  geolocation, clipboard-read, display-capture, filesystem-access, midi,
  pointer-lock, sensors, local-fonts, window-management, autoplay, ...). [new]
- on_download(): browser-initiated downloads only continue for the exact Pipe
  origin, or blob: URLs wrapping the exact origin (client save flow); all
  others are cancelled at the WebView2 DownloadStarting stage. No auto-open
  of downloaded files. [new]
- No IPC surface: plugins=[], capabilities=[], no commands; devtools feature not
  compiled. Separate per-user data dir %LOCALAPPDATA%\com.piperunvas.desktop.
- Close path = graceful window close only; departure guard (beforeunload
  Stay/Leave) is owned by the shared web client; shell never force-destroys.

Installer/uninstaller (src-tauri/nsis/installer.nsi, custom .nsi template
registered via bundle.windows.nsis.template; base = pinned tauri-cli 2.12.3
template crates/tauri-bundler@2.7.x):
- WR-1 "PipeRunvasWR1Gate": fail-closed, refuse-only running-app boundary.
  Detection = tasklist CSV by image name pipe-runvas.exe (any path), parsed
  via nsis_tauri_utils::StrReplace; ANY tasklist failure other than the
  documented no-match exit => refused (fail-closed). Two passes 200 ms apart.
- Gate placements in the generated installer.nsi (all before file mutation):
  .onInit (before any page, incl. reinstall page), un.onInit, Section Install
  (re-check immediately before file copy), Section Uninstall (re-check
  immediately before file removal), PageLeaveReinstall (immediately before the
  old uninstaller is ExecWait-ed during replacement).
- The stock CheckIfAppIsRunning macro (RestartManager RmShutdown/RmForceShutdown
  => force-kills the app, silently in silent mode) is invoked ZERO times in the
  generated installer.nsi (verified: grep of generated script; only a comment
  mentions RmShutdown). No fallthrough to stock kill behavior.
- Automatic post-install launch removed (no MUI_FINISHPAGE_RUN; /R silent flag
  still explicitly user-invoked). installMode currentUser; no autostart,
  service, firewall rule or protocol registration; userData/recovery data
  preserved across install/uninstall (uninstaller app-data checkbox unchanged,
  off by default).

## Pinned inputs (this build)
- rustc/cargo 1.98.0 (MSVC target), MSVC link 14.50.35717 (VS 18 BuildTools)
- Node 26.7.0, npm 12.0.2
- @tauri-apps/cli 2.12.3 (npm devDependency, package-lock resolved)
- rust crates (Cargo.lock): tauri 2.12.4, tauri-build 2.7.3, tauri-runtime(-wry) 2.12.2,
  tauri-utils 2.10.2, wry 0.57.0, tao 0.37.1
- NSIS v3.13 (fetched by tauri-cli into %LOCALAPPDATA%\tauri\NSIS)
- WebView2 runtime on machine: 155.0.4283.62 (installer: downloadBootstrapper default)

## Build command
cwd: delivery/pipe-runvas; env: RUSTFLAGS=-Ccodegen-units=16 CARGO_TARGET_DIR=C:\Users\Gabriel\AppData\Local\Temp\pipe-runvas-target
cmd: node_modules\.bin\tauri.cmd build
(bundle target: nsis, custom template nsis/installer.nsi; installMode: currentUser; unsigned)

## Outputs
- Installer: <target-dir>\release\bundle\nsis\Pipe Runvas_0.1.0_x64-setup.exe
  (1,878,529 bytes, sha256 d60b6c49cbcaf3f6a6a48f9fecf4b8ba1d49c71bf269043ae3c64be4ea324566)
- Main exe: pipe-runvas.exe sha256 b0f12c274aaabeeb26125214b5a1588d25f1a2da413871af50e4deb0338b15b6
  (8,653,312 bytes)
- Installed/uninstall.exe from this installer: sha256 f42b77fbc118d5b5b93eadb95a077a9b4e972e3dcc6bd3908872d39a9754ee85
- Copied to delivery/pipe-runvas/installers/ (hash verified post-copy);
  previous pre-WR1 build (sha256 8295c10b5d31...d43c) archived at
  installers/previous-unsigned/0.1.0-pre-wr1-setup.exe

## Smoke / WR-1 refusal matrix exercised on this machine (silent paths)
1. App running (built exe launched, window created): silent install => REFUSED
   exit code 2, no install dir, no uninstall registry key written.
2. App closed: silent install => exit 0; files installed; uninstall registry
   entry written (DisplayVersion 0.1.0, per-user HKCU).
3. Installed exe launched (works from %LOCALAPPDATA%\Pipe Runvas): silent
   uninstall => REFUSED (12.3 s detection passes), files AND uninstall registry
   entry intact. Exit code of the silent uninstaller process is 0 (NSIS outer
   stub does not propagate the inner uninstaller's exit code; refusal is still
   complete - nothing is touched).
4. App closed: silent uninstall => exit 0; install dir and uninstall registry
   key removed; %LOCALAPPDATA%\com.piperunvas.desktop (user data/recoveries)
   preserved; test-created dir then removed to restore a clean machine.
5. GUI/passive install and uninstall use the same gate macro (MessageBox branch,
   MB_ICONSTOP, instructs to close Pipe and retry).

## Avira build-path workaround (this machine, still required)
Spawning the MSVC linker is denied (os error 5) when OUT paths live under
pipe-hermes-inventory. Keep CARGO_TARGET_DIR under %TEMP% for any rebuild.
Note: the Hermes write_file/patch tools are also intermittently denied
(WinError 5) on this host; file edits done via Python in execute_code sessions.
