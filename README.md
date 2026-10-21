# Pipe Runvas

Pipe — project/document workspace with a web app (desktop + mobile), a native
Hermes Desktop plugin, and a standalone Windows shell. Successor to Yaku Canvas.

This repository currently ships the **v0.1 unified Hermes plugin** at its root.
The docs in `docs/` mix shipped design and the v0.2 product vision; the vision
(n8n/ComfyUI runner, board products, library) is **planned, not in this repo**.

## What is shipped

| Piece | Where | Status |
|---|---|---|
| Web app (desktop + mobile) | https://pipe-trial.taild8e584.ts.net/ (private tailscale HTTPS) | live, cert-validated, unauthenticated reads 401 |
| Hermes Desktop plugin | this repo root (`plugin.yaml`, see `docs/HERMES-PLUGIN-PACKAGE.md`) | v0.1.0, tag `pipe-v0.1.0` |
| Windows shell app | `windows-app/` (Tauri 2 / WebView2, NSIS per-user installer) | v0.1.0 alpha, unsigned, owner-installed |

## Install the Hermes Desktop plugin

Hermes Desktop -> plugin manager -> **Install from Git** ->
`https://github.com/Gabebac/Pipe-Runvas`

Provides the seven agent tools (`pipe_list_projects`, `pipe_get_project`,
`pipe_create_project`, `pipe_list_documents`, `pipe_get_document`,
`pipe_create_document`, `pipe_update_document`) and the native `/pipe` tab.

**Binding policy: read `docs/HERMES-PLUGIN-PACKAGE.md` before enabling.** Choose
exactly one mode (`agent-only`, `verified-session`, `local-process-capability`).
In this release scope the desktop/editor binding is not to be enabled before its
operator gate; agent-only tools are the reviewed slice. Configuration runs
through `configure.py` on the approved backend; no credentials belong in
argv, chat, or logs.

## Windows app

Source in `windows-app/`, build steps in `windows-app/README-BUILD.md`, verified
record in `windows-app/BUILD-RECORD.md`. The shell loads exactly
`https://pipe-trial.taild8e584.ts.net` (origin-locked, no IPC, no popups,
default-deny permissions, per-user install with a mandatory running-app refusal
in installer and uninstaller). The v1.0 installer will be signed (plan WR-2);
this alpha is unsigned by owner decision.

## v0.2 vision (docs only)

Canvas runner with n8n/ComfyUI targets, board kinds, libraries: see
`docs/PLAN.md` (build plan v0.2) — none of it is implemented here yet.
