# Pipe for Hermes — fixed-workspace connector trial

A native `/pipe` tab and seven agent tools use **one operator-bound Pipe API**. There is no local project database, iframe, browser token, generic proxy, workflow runner, or board editor. Boards are readable designs; notes can be created, edited, recovered and saved with revision checks.

**Agent-only is a separate, bounded delivery slice; no live installation is implied. Desktop remains unreleased and must stay disabled for agent-only deployment.** The native editor now consumes the isolated H2b host privacy contract; it is not a link-only client. Installing this folder is not proof of the Desktop/authentication boundary. Keep Yaku installed until the parent completes the real test. No Yaku data migration is required for this trial; retain its plugin/config rollback.

## Operator policy — read before enabling

Choose exactly one binding mode. **`agent-only`** grants the fixed trusted process access through the existing seven tools and denies every bridge HTTP route, including `/binding`, with 403 `http_disabled` before reading a request body, returning metadata, accessing the Pipe token or forwarding. It requires explicit `agent_process_grant=true`, `principal=null`, and `local_process_grant=false`; missing or nonboolean grants are invalid. There is no dummy human identity or local HTTP grant. Process/import-time/active-home checks remain mandatory.

For the two existing HTTP modes, the installed host has verified interactive `request.state.session` identities but **no verified OAuth-selected profile** on ordinary plugin REST requests. Their narrow deployment remains:

`allowed host principal + fixed process home → one Pipe connection`

Use a dedicated single-scope backend, normally `hermes serve --isolated` with a separately provisioned home. Ordinary named-profile `serve` may reroute to the machine backend. Isolation is a lifecycle/routing mode, not a sandbox. Do not enable this as a general multi-profile bridge. A query `profile` is only compared with the fixed label; it never chooses or authorizes a connection. Missing selectors do not alter that server-held binding. Any supplied wrong/duplicate selector is refused.

The existing HTTP policies are unchanged:

* **`verified-session` (default):** host `auth_required=True`, host-verified native bearer Session, exact provider/user ID/org ID match, unexpired session, and bearer matching the verified Session. Cookie-only requests and requests with an Origin are refused. No access-token or profile grant is synthesized. The operator must supply the actual approved provider identity; this package cannot discover it by guessing an email.
* **`local-process-capability`:** requires a separate explicit operator grant, actual loopback peer, no Origin, `auth_required=False`, the real installed `hermes_cli.web_server.app`, and its real `_has_valid_session_token(request)` verifier. This is possession of the host process capability, **not a verified human**. It is not an OAuth fallback and not a remote bearer shortcut. Do not authorize this behind a forwarding proxy that turns remote callers into apparent loopback peers.

Agent access is a **separate explicit process grant**. It checks the fixed process and active Hermes home and uses the same scoped upstream token/API/revision semantics. It does not pretend a tool invocation has a verified interactive HTTP Session, infer caller authority from tool arguments, or accept profile/URL/token arguments.

An agent-only grant authorizes permitted tool callers in that fixed home, **not just one chat or a selected Desktop profile**. Same-user code is not sandboxed by path equality. Tool results remain subject to Hermes conversation retention; agent-only does not promise transcript erasure on logout. Pipe scopes remain workspace-wide `projects:read`/`projects:write`, not project-specific. No additional Hermes inference provider or HTTP OAuth server is needed by these handlers. Live process authority, installation, token issuance and private TLS connectivity need separate approval.

## Provision without displaying secrets

Run these on the approved backend, not in the renderer. Example paths and identity placeholders must be replaced by the operator; no credentials belong in argv/chat/logs.

1. In the Pipe application environment, issue a fresh revocable integration token to a new private file:

   ```sh
   python -m pipe_app.cli issue-token --data-dir /private/pipe-data \
     --label hermes-single-workspace --scope projects:read --scope projects:write \
     --output-file /private/pipe-hermes-token
   ```

   The CLI prints only its public identity ID. Keep that ID for revocation. The bridge uses the private token file; never copy its content to a command, Desktop setting or browser storage.

2. In the Hermes Python environment (existing `httpx` required), write a new binding with this package's helper:

   ```sh
   python configure.py --home /private/approved-hermes-home \
     --origin https://pipe.example --token-file /private/pipe-hermes-token \
     --profile default --provider APPROVED_PROVIDER --user-id APPROVED_USER_ID --org-id '' \
     --grant-single-workspace --grant-agent-process
   ```

   `--org-id ''` explicitly requires an empty org; use the actual ID if applicable. In the HTTP modes, `--grant-agent-process` is optional and defaults off. For the separately approved local-capability mode, omit provider/user/org arguments and pass `--auth-mode local-process-capability --grant-local-process`. Never select it merely to get past a rejected identity.

   For **agent-only**, use this instead (only after separate deployment/credential approval):

   ```sh
   python configure.py --home /private/approved-hermes-home \
     --origin https://pipe.example --token-file /private/pipe-hermes-token \
     --profile default --auth-mode agent-only \
     --grant-single-workspace --grant-agent-process
   ```

   Omit all provider/user/org flags and `--grant-local-process`; they are refused in agent-only mode. The helper requires the agent grant, never silently defaults into this mode, and retains `verified-session` as its default.

   `--allow-loopback-http` permits only an explicit numeric loopback HTTP upstream for local backend-to-Pipe transport. It does not permit LAN HTTP, arbitrary URLs or disable HTTPS verification. The helper refuses existing config, symlink final files and nonprivate token files, never changes the token and prints no secret. POSIX config/token files must be owned by the process user and inaccessible to group/other. Windows ACL review remains an operator responsibility; POSIX mode checks are not a Windows ACL guarantee.

3. The helper writes `HOME/pipe-bridge.json` (0600), containing settings and a secret **file reference**, not the credential. Binding/generation are opaque nonsecret IDs. Keep config outside the package/repository. To change policy, disable the integration, preserve rollback config privately, provision a new config/generation, then restart only the approved backend. Active bridge instances freeze their binding; token file contents are read per call. Revoking the upstream token takes effect at the next API operation. No successful mutation is automatically retried.

## Installable package

Install the contents of this directory as `plugins/pipe/` on the approved backend. `plugin.yaml`, `__init__.py`, `service.py`, `dashboard/`, and `desktop/` travel together; the package ID is `pipe`, not its source-directory name `hermes`.

Before enabling, run the installed supported commands under an **isolated scratch HOME/HERMES_HOME/TMPDIR**:

```sh
hermes plugins validate /path/to/pipe
hermes plugins doctor /path/to/pipe --ci
```

No dependency additions are needed on the tested backend: Python stdlib plus its installed FastAPI/Starlette and httpx. This package must not install the standalone Pipe application's dependencies into Hermes.

The parent owns production installation, the supported enable/config flow and any exact-target restart. **For agent-only, install/enable only the agent target after separate approval; do not install, copy to `desktop-plugins/`, or enable the Desktop target.** All HTTP calls remain denied even if the dashboard routes are mounted. The included renderer is review material only for this deployment.

For a future separately approved Desktop trial, Desktop runs on the gaming PC: backend files alone do not install its renderer. The supported unified-package installer with Desktop selected copies `desktop/plugin.js` to the app's `desktop-plugins/pipe/` door. Keep both copies identical; do not use raw IPC or edit global theme settings. Resolve the release gates below before enabling.

The installed-host agent probe explicitly selects `plugins.isolation: in_process` in an isolated test home and exercises the installed manager/loader, real registration and all seven handlers against synthetic Pipe data. It is not a claim about the live host's configuration. Subprocess isolation (`plugins.isolation: host`) is **not verified by that probe**; select and verify the actual deployment mode before enabling. Existing HTTP modes also require a verified request-state transport; copied headers in a subprocess are not an authenticated Session.

## Desktop capability gate and behavior

Required public SDK: `ctx.rest`, `ctx.storage.clear`, `ctx.onPrivacyReset`, readonly `host.state.pluginPrivacy` (`generation`, `ready`), `host.retryPluginPrivacy()`, native React/JSX runtime, query hooks, `host.profileRoutes()`, profile/gateway state, and **`gatewayActivationEpoch()`**. Pipe declares `privateStorage:true` and remains `defaultEnabled:false`. It refuses private work on older hosts or incomplete/ambiguous routes. The isolated source implementation is not installed gaming-PC acceptance. It does not infer the active source when several connections expose the same profile name. The target trial must expose a nonempty connection ID and backend target-profile label.

Reads poll through SDK Query every five seconds; no socket availability is assumed, including OAuth remotes. Route inventory is Promise-returning: Pipe awaits it, rejects failures and checks epoch/profile/source across the await. Requests validate inventory before dispatch and after response, with synchronous epoch/profile/source checks immediately before dispatch and publication. An already-dispatched write cannot be recalled. Cache keys include connection/profile/epoch/binding generation and resource IDs. Supported profile and optional `host.state.connectionId` atom subscriptions cancel/remove Pipe queries even while the page is unmounted; page scope cleanup also retires its old queries. A present but cleared/mismatched source atom fails closed. No raw IPC or duplicate-profile inference is used.

**Route polling is nominally one second, not a hard UI exposure bound.** Native privacy retirement is separate: Pipe captures its generation with route scope, includes it in query keys, and synchronously retires all `[pipe]` queries, draft memory, uncertain-create state and private UI when the host freezes it. Main fences queued/late requests before renderer notifications arrive. Protected REST is native-bearer-only; cookie/static/local-capability transport is refused without changing ordinary callers. Already-dispatched writes may have committed and are never replayed. Actual Windows IPC, responsive/unresponsive-window behavior and pixel timing remain separate measurements.

Recovery uses plugin-namespaced local storage scoped to connection, profile, binding generation, project and document, with the exact base revision in the draft. No credentials are stored. SDK writes/removes are best-effort and may swallow exceptions. Writes must read back equal before Pipe reports recovery success. Refused writes remain in scoped memory across resource unmounts; memory is not reload/close durability. Removal reads back the target and brackets the observation with a nonprivate storage-read probe. Refused or unavailable verification preserves the draft and reports failure; even a successful observation is not a durable-deletion guarantee. Explicit discard is available for existing notes and new notes/projects. Clipboard actions display the SDK boolean success/failure.

New recovery keys use `draft-v2-` plus URI-encoded authority/resource fields, explicitly escaping dots. They remain stable across same-authority renderer reloads/route activations; auth generation is deliberately not part of the durable key. Historical namespaces are purged only by host privacy retirement, not by ordinary Save/discard. Ambiguous dotted legacy keys remain blocked under H2a; Pipe does not parse, silently migrate or delete them to bypass refusal. Host restart preserves recovery bytes behind closed private admission. Use **Settings → Gateways → Saved connections**: under **Registered gateways**, choose **Edit** (pencil) for the approved source, then **Sign in with …** using the same provider/account. Leave the URL/auth/settings unchanged; no **Save connection** is needed. This existing editor performs fresh native sign-in without a configuration pre-save. **Do not Sign out to recover drafts:** explicit sign-out deletes private recovery; the connected **This window** form's Sign out is not a prerequisite. Fresh authentication must verify the same source/provider/user identity before recovery reopens; automatic reuse or refresh of saved credentials is not enough. Every retained native authority must reconcile. A different verified identity or a genuine pending logout/loss retires the namespaces through checked cleanup. Old records without owner evidence, missing identity fields, corrupt metadata and ambiguous namespaces stay quarantined rather than being guessed or erased; operator repair may be required. Retry re-joins incomplete inventory and runs the normal freeze/cleanup protocol, but does not sign in, waive ownership checks or manufacture deletion success. It shows pending/result/failure feedback and suppresses duplicate pending retries.

A clean note adopts newer matching query results, including fresh data after an ordinary cached reopen. The latest saved version, accepted edit base and working text are separate: dirty or in-flight work keeps its exact text and expected revision; older query results cannot roll back an owned save. Exact recovered-baseline equality, an exact revert to a known base, and successful Save all retire the recovery overlay. If cleanup cannot be observed, only a content-free in-memory suppression marker remains, with a separate warning. It does not suppress recovery after a plugin reload. Recovery from a different revision stays unresolved until review; reapply explicitly chooses the reviewed base. Failed explicit discard still preserves genuine work.

Pipe project/document navigation warns before leaving dirty, pending or uncertain work, with explicit Stay/Leave choices. Create completions are fenced to both their mounted component and selection generation. Late/uncertain creates retain the original scoped draft and an uncertainty marker; no mutation is retried automatically. A confirmed create with failed cleanup retains its returned identity and offers cleanup/open of that item, never “it was not created.” Field edits do not clear operation markers. Late saves from unmounted editors cannot overwrite a newer recovery draft. An unconfirmed save requires saved-version review and explicit rebase/discard before another Save. Private drafts are plaintext, not encrypted storage.

**Release gates still open:** independent H2b host/consumer acceptance, H3 voluntary unsaved-departure admission across host navigation/profile/source/disable/reload/close/quit actions, and actual installed Windows/authenticated private-HTTP/shared-service tests. H2b invalidation is not permission to discard voluntary unsaved work. Socket disconnect is not logout, generic resource 401/403 is not an identity verdict, and generation is not a principal or profile authorization. The bounded native contract does not fix legacy cookie-jar/mirror logout, secure erase, clipboard/backups or forced process death. These are explicit limits, not native acceptance claims.

Everything uses host theme tokens and SDK controls. No global theme override, external fonts, brand-palette injection or unsupported library. Helpful tips explain notes, steps, references and design-only links; safety/save messages remain visible with tips off.

## API and tools

Bridge namespace: `/api/plugins/pipe`. Every route below is disabled in `agent-only` mode, including binding metadata.

* `GET /binding`: credential-free fixed-binding metadata after authorization.
* `GET/POST /projects`; `GET /projects/{project_id}`.
* `GET/POST /projects/{project_id}/documents`.
* `GET/PUT /projects/{project_id}/documents/{document_id}`.

Seven tool names: `pipe_list_projects`, `pipe_get_project`, `pipe_create_project`, `pipe_list_documents`, `pipe_get_document`, `pipe_create_document`, `pipe_update_document`. Each declares a JSON schema and returns JSON text. Updates require `expected_revision`; IDs are canonical lowercase UUIDs, never repaired. Project/body/content validation remains authoritative in Pipe. Tools may edit supported boards through that API; Desktop boards are explicitly view-only.

Bounds: 1 MiB serialized request, 4 MiB raw response, 10-second total upstream deadline with five-second HTTP phase timeouts; ten-second request-body deadline. Pagination defaults/limits come from Pipe (50/100 projects); cursors max 512 characters. Larger document lists fail closed instead of silently truncating. Compressed responses are refused even if an upstream ignores `Accept-Encoding: identity`; proxy compression must respect that request. Redirects and environment proxies are disabled. No forwarding of host bearer/cookies/headers. Errors are fixed safe text; 409 preserves `current_revision`. All bridge responses are no-store. There is no automatic retry of reads or mutations in the bridge; polling is separately scheduled client reads.

## Checks and acceptance left to parent

From the Pipe foundation checkout:

```sh
.venv/bin/python -m pytest tests/test_bridge.py -q --tb=short \
  --basetemp=/opt/data/cache/scratch/pipe-task5-tests
PIPE_HERMES_PYTHON=/opt/hermes/.venv/bin/python PIPE_HERMES_ROOT=/opt/hermes \
  .venv/bin/python -m pytest tests/test_bridge.py -q --tb=short \
  --basetemp=/opt/data/cache/scratch/pipe-agent-only-tests
node --experimental-vm-modules tests/test_hermes_desktop.mjs
PLAYWRIGHT_BROWSERS_PATH=/opt/data/.cache/ms-playwright node tests/test_hermes_ui.mjs
```

The Python tests start the **real Pipe API on loopback using synthetic data**, plus authored host identity/capability fixtures. The installed-host test is opt-in through the two environment variables above (otherwise explicitly skipped); it uses an isolated home/config, the installed in-process loader and registry, real seven-tool requests/CAS conflicts, home/grant denials and refusal after synthetic credential revocation. It neither installs nor persistently enables a plugin. It does not verify subprocess plugin isolation, live private routing, or Desktop/OAuth authentication. Never distribute test temp directories or credential files with the review archive.

The Node tests exercise scope functions and real Chromium/React UI with an **authored SDK/API fixture**. The renderer check reuses the web checkout's already-installed Vite/React/Playwright; it adds no dependency and does not change web source.

`tests/hermes_native_privacy.test.tsx` additionally runs the external Pipe module through the isolated host's production SDK/context/privacy/native-auth/IPC-handler modules, real jsdom Storage and actual React Query, with synthetic HTTP delivery. In this authorized workspace, run from `/opt/data/workspace/hermes-pipe-host`: `npm exec --workspace apps/desktop -- vitest run --config /opt/data/workspace/pipe-foundation/tests/hermes_native_privacy.config.mjs --maxWorkers=1`. The two checkouts are siblings; other locations require the corresponding absolute config path. This is not a real Electron/Windows HTTP test. Use a fresh `PIPE_UI_EVIDENCE` directory for browser reruns so earlier screenshots remain intact.

Agent-only live acceptance still requires independent review, an approved fixed process/home and verified runtime mode, separately issued revocable credential, approved certificate-validated private route, agent-only installation/enablement, and a fresh-session disposable-project web↔agent revision/conflict/revocation check. The bridge disables environment proxies; unresolved private DNS is not fixed by choosing agent-only. Do not issue production credentials, alter connectivity or infer live readiness from these tests.

Actual release gate: parent installs the package in the approved topology; verifies real host identity, rejection of wrong/missing identity/profile, SDK capability and polling; creates in web → edits in native `/pipe` → observes exact shared revision in web; conflicts in both directions preserve drafts; switches connection/profile during reads/saves; verifies revoked-token refusal. Only after that gate may Yaku be removed, preserving plugin/config rollback. Do not call fixture success a passing Desktop test.
