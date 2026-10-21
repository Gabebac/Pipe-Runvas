# Building the Pipe Runvas Windows app (Tauri 2 / WebView2)

The full verified build + test record lives in windows-app/BUILD-RECORD.md. Short form:

1. Prereqs (this PC, verified): rustc/cargo 1.98.0 (MSVC, VS 18 BuildTools), Node >= 22.12
   (26.7.0 used), WebView2 Evergreen runtime, internet for crates/NSIS fetch.
2. `cd windows-app && npm ci`
3. `set CARGO_TARGET_DIR=%LOCALAPPDATA%\Temp\pipe-runvas-target` (Avira quarantines build
   artifacts under the repo dir - do not build there)
4. `cmd /c node_modules\.bin\tauri.cmd build`  -> NSIS bundle under the target dir
   `release\bundle\nsis\Pipe Runvas_0.1.0_x64-setup.exe`
5. Verify: compare the installer sha256 with the one in BUILD-RECORD.md.
6. The installer is UNSIGNED (no Pipe publisher certificate exists yet): Windows SmartScreen
   will warn; owner-accepted for this alpha. WR-1 running-app refusal (installer+uninstaller,
   refuser-only, no force-kill) is implemented - see BUILD-RECORD.md's silent test matrix.
