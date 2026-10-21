# PLAN.md — Pipe v0.2 build plan (post-recon)

Ordered by "makes editing usable" → "makes it a runner" → "makes it a toolbox".
Every phase ends runnable + verified, committed to `Gabebac/Pipe-Runvas`.

## Phase A — canvas core rebuild (the editing complaint)
1. **Board transform layer**: one `{x,y,scale}` on a transformed `<div>`; nodes
   absolutely positioned children; plain wheel = pan, ctrl+wheel = exponential
   zoom clamp 0.10–3 (real docs: 0.01–5, but DOM nodes <0.5 get unusable —
   start 0.10–3, knob exists), zoom-to-cursor via
   `x' = cx − (cx−x)·ratio`. Space-hold → grab-pan.
2. **Node drag redo**: pointer-capture drag on whole card header (not
   stopPropagation roulette); drop commits `PATCH x/y` once (not per frame);
   multi-select (marquee + shift-click) drags together.
3. **Ports & wires**: typed ports (`text`,`media`,`json`,`trigger`) color-coded,
   in=left out=right; drag from port → live bezier tether; drop on node body =
   default compatible port. Invalid = red snap-back. Wire click = cut
   (with Ctrl+Alt+drop = disconnect-all like ComfyUI).
4. **Edge `+` insert** button on hover; node search palette on double-click/right-click canvas.
5. **Snapshot undo/redo** (50-deep, ctrl+z/y) + delete/marquee/duplicate keys (yaku evidence: Ctrl+C/V/D already half-wired). Per-mutation history commit, one commit per gesture.
6. Resize handle + autosave: debounced 5s + save-on-flush (existing `board-flush` pattern exists in desktop host? — reuse ctx.rest store; optimistic UI).
Verify: widget-cdp-test loop against a local probe page before desktop install.

## Phase B — rename + graphs as products
1. plugin.yaml `name: pipe`; tools `pipe_add_source / pipe_list / pipe_chat /
   pipe_get_board / pipe_put_board`; route `/pipe` «Open Pipe».
2. Board kinds: `reference|pipeline|model|diagram|library` (a `kind` field;
   toolbar switch; default node palette per kind — diagram kinds get
   wiring/plan node shapes: box, junction, terminal, note, arrow-annot).
3. Store: `plugin-data/pipe/boards/*.json` (migrate existing yaku-canvas boards on first load, keep reader for old id `yaku-canvas`).

## Phase C — runner (the "use it" part)
1. `runner.py`: topo-sort, per-node state (pending/running/done/error/skipped/cached),
   run records in `runs/`. **Snapshot semantics**: node output cached from last
   success; unchanged inputs → `skipped(cached)` (ComfyUI behavior).
   Partial run: `run(node_ids=…)`.
2. Targets:
   - `n8n` (reachable ✓): webhook-trigger workflows; per skill rules —
     deploy → re-GET → one bounded live action. API key sourced from config.
   - `comfy` (offline-aware): health → `POST /prompt` API-graph → poll
     `/history` → `/view`; offline ⇒ node state `queued` + notify, retry later.
   - `agent` node: calls an agent tool in-process (pipe_chat, image_gen…).
3. REST: `POST /api/plugins/pipe/run` (+GET runs). Canvas shows live node
   overlays (colored border) + per-node outputs in inspector.
4. Test inputs ("pin data"): per-node `testInput` used when upstream not run.

## Phase D — library & subgraphs
1. Pack selection → library node (flattened on run — RFC-0005 model); library
   board = list of packed graphs; drag/copy into any board.
2. Collapsible groups (persisted default), markdown sticky notes.
3. Breadcrumb navigation when inside packed node (Rensei model).

## Phase E — polish backlog (only if used)
- ELK auto-arrange button; exec Gantt timeline; minimap; Reroute dots;
  ComfyUI `partial_execution_targets`-style backend-side partial runs.

## Verification gates (from skills)
- Canvas: browser_exec/CDP check — drag/zoom/ports at 150% & 75% zoom, undo
  roundtrip, keyboard-only path, reduced-motion; one `assert` self-check in
  `runner.py` (`python runner.py` → topo order + cached-skip demo).
- Runner: one bounded live n8n execution + re-GET before claiming DEPLOYED;
  comfy target: state offline-queue explicitly when host down (it is right now).
- Desktop half: install-from-git on Pooh's machine only at phase-complete tags.