# Pipe

Hermes Desktop plugin: a node canvas where you **design** protocols, pipelines,
workflows, reference guides, libraries, wiring diagrams and build plans — and
**use** what you made (run pipelines, hand graphs to the agent, reuse graphs as
libraries). Successor to Yaku Canvas (v0.1.0), rebuilt around execution.

## What you can do

| Board kind | You design | "Use it" means |
|---|---|---|
| `reference` | boards of sources/notes (YouTube/TikTok/Reddit/web + notes) | grounded chat citing `[S1]`… — the original Yaku flow |
| `pipeline` | action graphs wired node→node | **Run** executes it (n8n actions, agent tools) |
| `model` | AI-model graphs | **Run** on ComfyUI (gaming PC GPU) |
| `diagram` | wiring / electronic / build-plan nodes | visual reference the agent can read |
| `library` | reusable nodes/subgraphs | drop into any other board |

## Install

Hermes Desktop → plugin manager → **Install from Git** →
`https://github.com/Gabebac/Pipe-Runvas` → check **Desktop** + **Agent**.

## Architecture (short)

- **Boards** are JSON graphs (nodes + typed ports + edges) in
  `plugin-data/pipe/boards/`. The desktop canvas and the agent's `pipe_*`
  tools read/write the same store.
- **Runner** (`runner.py`) executes a `pipeline`/`model` graph topologically:
  - `n8n` backend — real action pipelines, your provider keys (verified: healthz OK)
  - `comfy` backend — local model workflows (gaming PC at 192.168.0.68:8188;
    offline-aware: queues + notifies instead of failing)
  - `agent` backend — runs an agent tool as a node
- **Canvas** (desktop/plugin.js): transform `{x,y,scale}`, ctrl+wheel zoom,
  port-drag wiring, resize handles, marquee select — interaction model recovered
  by decompiling the real Yaku 1.1.7 app (see `docs/DECISIONS.md`).

## Repo layout

```
plugin.yaml       plugin manifest (id: pipe) + agent tools
__init__.py       tool registration (pipe_* — 7 tools, schema-driven)
service.py        one operator-bound Pipe bridge (revisions, auth checks)
configure.py      operator-only binding helper (never run in chat)
desktop/plugin.js canvas UI for Hermes Desktop (unified-package half)
dashboard/        manifest.json · plugin_api.py backend routes
docs/             DECISIONS.md · RUNNER.md · YAKU-EVIDENCE.md · HERMES-PLUGIN-PACKAGE.md (operator/install policy)
```

## Dev notes

- Backend services verified from the Hermes backend 2026-10-15:
  n8n `http://192.168.0.78:5678/healthz` → ok; ComfyUI `192.168.0.68:8188` →
  timeout (PC asleep — runner treats it as offline).
- Yaku upstream provenance: interaction model + fetch chain via REA
  decompilation, clean-room reimplementation — no Yaku code copied.