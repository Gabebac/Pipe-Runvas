/* Pipe: SDK-native, one operator-bound workspace. No renderer credentials. */
import * as SDK from '@hermes/plugin-sdk'
import {useEffect, useRef, useState} from 'react'
import {jsx, jsxs} from 'react/jsx-runtime'

const ID = 'pipe'
const panel = {padding: 16, border: '1px solid var(--ui-stroke-secondary)', borderRadius: 8, minWidth: 0}
const row = {display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap'}
const muted = {color: 'var(--ui-text-secondary)'}
const help = {
  note: 'A note holds plain text. Save publishes a new version shared with the web app and agents.',
  step: 'A step describes work to do. This board is a design: nothing here runs automatically.',
  reference: 'A reference links ideas or evidence. Its text is not fetched or executed.',
}

export async function captureScope() {
  if (typeof SDK.gatewayActivationEpoch !== 'function' || typeof SDK.host.profileRoutes !== 'function')
    throw new Error('This Desktop lacks supported connection fencing. Ask the operator to verify SDK compatibility.')
  const epoch = SDK.gatewayActivationEpoch()
  const privacy = SDK.host.state.pluginPrivacy?.get()
  if (!privacy?.ready || typeof privacy.generation !== 'string' || !privacy.generation)
    throw new Error('Private plugin access is blocked.')
  const profile = SDK.host.state.profile.get()
  const connectionId = SDK.host.state.connectionId?.get()
  const routes = await SDK.host.profileRoutes()
  if (SDK.gatewayActivationEpoch() !== epoch || SDK.host.state.profile.get() !== profile ||
      SDK.host.state.connectionId?.get() !== connectionId ||
      !SDK.host.state.pluginPrivacy.get().ready || SDK.host.state.pluginPrivacy.get().generation !== privacy.generation)
    throw new Error('Connection or private context changed during route inventory.')
  const matches = routes.filter(route => route.profile === profile)
  if (matches.length !== 1) throw new Error('Pipe needs a single unambiguous connection for this profile.')
  const route = matches[0]
  if (!Number.isInteger(epoch) || typeof route.connectionId !== 'string' || !route.connectionId ||
      typeof route.targetProfile !== 'string' || !route.targetProfile)
    throw new Error('This Desktop does not expose a complete supported route.')
  if (SDK.host.state.connectionId && connectionId !== route.connectionId) throw new Error('Connection changed during route inventory.')
  return {epoch, profile, connectionId: route.connectionId, targetProfile: route.targetProfile, privacyGeneration: privacy.generation}
}

export function sameScope(scope) {
  // Synchronous fence for handlers/render and immediately after every await.
  // Route inventory is validated asynchronously by captureScope/scopedRequest.
  try {
    const connectionId = SDK.host.state.connectionId?.get()
    const privacy = SDK.host.state.pluginPrivacy?.get()
    return !!scope && SDK.gatewayActivationEpoch() === scope.epoch &&
      privacy?.ready === true && privacy.generation === scope.privacyGeneration &&
      SDK.host.state.profile.get() === scope.profile &&
      (!SDK.host.state.connectionId || connectionId === scope.connectionId)
  } catch { return false }
}

export function draftKey(scope, binding, project, document) {
  // Durable key excludes activation epoch; saved draft carries its expected_revision.
  // v2 escapes the legacy namespace delimiter, including dots inside IDs.
  // No legacy key is parsed or migrated to bypass the host's ownership refusal.
  return 'draft-v2-' + encodeURIComponent(JSON.stringify([scope.connectionId, scope.profile, scope.targetProfile,
    binding.binding_id, binding.generation, project, document])).replaceAll('.', '%2E')
}

export async function scopedRequest(ctx, scope, path, options = {}) {
  const before = await captureScope()
  if (!sameScope(scope) || JSON.stringify(before) !== JSON.stringify(scope))
    throw new Error('Connection changed. Return to the original connection to recover the draft.')
  const reply = await ctx.rest(path + (path.includes('?') ? '&' : '?') +
    'profile=' + encodeURIComponent(scope.targetProfile), {...options, timeoutMs: 15000})
  if (!sameScope(scope)) throw new Error('Connection changed. An old response was discarded.')
  const after = await captureScope()
  if (!sameScope(scope) || JSON.stringify(after) !== JSON.stringify(scope))
    throw new Error('Connection changed. An old response was discarded.')
  if (reply?.code) throw new Error(reply.code)
  return reply
}

function message(error) {
  // Never display raw transport errors, paths, URLs or host diagnostics.
  const text = String(error?.message || '')
  if (/changed/.test(text)) return 'Connection changed. Return to the original connection to recover your draft.'
  if (/409|revision_conflict|newer version/i.test(text)) return 'Conflict: someone saved a newer version. Your draft is safe. Review the saved version before reapplying.'
  if (/401|403|sign in|forbidden|unauthorized/i.test(text)) return 'Access denied. Sign in to the approved connection or ask the operator to renew access.'
  return 'Pipe is unavailable or the request could not be confirmed. Keep your draft. Check the saved version before trying again.'
}

function status(text) { return jsx('p', {role: 'status', 'aria-live': 'polite', children: text}) }
function button(text, onClick, disabled = false, key) {
  return jsx(SDK.Button, {type: 'button', onClick, disabled, children: text}, key)
}
function input(label, value, onChange, props = {}) {
  return jsxs('label', {style: {display: 'grid', gap: 5}, children: [label,
    jsx(SDK.Input, {'aria-label': label, value, onChange: event => onChange(event.target.value), ...props})]})
}
// Scoped recovery across resource unmounts. null suppresses stale storage after
// any clean transition with failed cleanup; never a saved content snapshot.
const drafts = new Map()
const uncertainCreates = new Set()
// Plugin-lifetime protection survives resource unmount and hidden panes.
const liveWork = new Map()
let nextWorkId = 0
function workSnapshot() {
  return JSON.stringify([SDK.host.state.pluginPrivacy.get(), [...drafts], [...uncertainCreates],
    [...liveWork].map(([id, check]) => [id, check()])])
}
function hasWork() {
  return uncertainCreates.size > 0 || [...drafts.values()].some(value => value &&
    (value.title || value.text || value.uncertainSave || value.uncertain || value.createdId)) ||
    [...liveWork.values()].some(check => check())
}
let storageProbe = 0
function removeDraft(ctx, key) {
  // SDK get(null) conflates absence and denied reads. A nonprivate readback
  // probe brackets the removal; this is an observation, not a durable guarantee.
  const probe = 'recovery-read-probe'
  const value = ++storageProbe
  try {
    ctx.storage.set(probe, value)
    if (ctx.storage.get(probe, null) !== value) return false
    ctx.storage.remove(key)
    if (ctx.storage.get(key, null) !== null || ctx.storage.get(probe, null) !== value) return false
    drafts.delete(key)
    return true
  } catch { return false }
  finally { try { ctx.storage.remove(probe) } catch { /* No private content. */ } }
}
const removalFailed = 'Draft removal could not be verified. Your draft is still available here; a recovery copy may remain on this Desktop.'
const removalObserved = 'Recovery entry reads absent; the SDK cannot guarantee durable deletion.'
const cleanupFailed = 'Recovery cleanup failed; a stale local draft may remain.'
function cleanRecovery(ctx, key) {
  if (!removeDraft(ctx, key)) drafts.set(key, null)
}
const noteValue = document => ({title: document.title, text: document.content.text, expected_revision: document.revision})
const sameContent = (a, b) => !!b && a.title === b.title && a.text === b.text
const sameNote = (a, b) => sameContent(a, b) && a.expected_revision === b.expected_revision
async function copyDraft(ctx, scope, draft) {
  try {
    if (!sameScope(scope)) return 'Connection changed.'
    return await ctx.os?.writeClipboard(draft.title + '\n\n' + draft.text) === true
      ? 'Draft copied to clipboard.' : 'Copy failed. Select and copy your text manually.'
  } catch { return 'Copy failed. Select and copy your text manually.' }
}
function useLeaveCheck(checks, key, check) {
  const current = useRef(check); current.current = check
  useEffect(() => {
    const id = ++nextWorkId
    const read = () => current.current()
    checks.current.set(key, read)
    liveWork.set(id, read)
    return () => { checks.current.delete(key); liveWork.delete(id) }
  }, [checks, key])
}
function keepDraft(ctx, key, value) {
  drafts.set(key, value)
  try {
    ctx.storage.set(key, value)
    return JSON.stringify(ctx.storage.get(key, null)) === JSON.stringify(value)
  } catch { return false }
}
const recoveryFailed = 'Unsaved draft — local recovery storage failed. Copy your text before leaving. Kept in memory only; reload or closing Desktop can lose it.'
function recoveryNotice(ctx, key, draft) {
  try {
    if (JSON.stringify(ctx.storage.get(key, null)) === JSON.stringify(draft)) return 'Recovered draft — not yet saved'
  } catch { /* Fall through to the visible in-memory-only warning. */ }
  return recoveryFailed
}
function stored(ctx, key, fallback) {
  if (drafts.has(key)) return drafts.get(key) ?? fallback
  try {
    const value = ctx.storage.get(key, null)
    if (value && typeof value.title === 'string' && typeof value.text === 'string' &&
      value.title.length <= 200 && value.text.length <= 100000 &&
      Number.isSafeInteger(value.expected_revision) && value.expected_revision > 0) {
      drafts.set(key, value)
      return value
    }
    return fallback
  } catch { return fallback }
}

function NoteEditor({ctx, scope, binding, projectId, document, refresh, leaveChecks}) {
  const key = draftKey(scope, binding, projectId, document.id)
  const initial = noteValue(document)
  const [draft, setDraft] = useState(() => {
    const value = stored(ctx, key, initial)
    // Only note domain fields and the explicit operation marker are recoverable.
    const next = {title: value.title, text: value.text, expected_revision: value.expected_revision,
      ...(value.uncertainSave === true ? {uncertainSave: true} : {})}
    if (drafts.get(key)) {
      drafts.set(key, next)
      if (sameNote(next, initial) && !next.uncertainSave) cleanRecovery(ctx, key)
    }
    return next
  })
  const current = useRef(draft)
  // An older/newer recovery does not include its original saved content.
  const baseline = useRef(draft.expected_revision === initial.expected_revision ? initial : null)
  const [saved, setSaved] = useState(document)
  const latest = useRef(document)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [state, setState] = useState(() => sameNote(draft, initial) && !draft.uncertainSave
    ? 'Saved' : recoveryNotice(ctx, key, draft))
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [review, setReview] = useState(null)
  const dirty = !!draft.uncertainSave || !sameNote(draft, baseline.current)
  useLeaveCheck(leaveChecks, key, () => lock.current || !!current.current.uncertainSave || !sameNote(current.current, baseline.current))
  function observe(candidate) {
    if (!sameScope(scope) || candidate?.id !== document.id || candidate.project_id !== projectId || candidate.kind !== 'note') return false
    if (candidate.revision > latest.current.revision) { latest.current = candidate; setSaved(candidate) }
    return true
  }
  function adopt(next) {
    current.current = next; baseline.current = next; setDraft(next)
  }
  function becomeClean(next) {
    cleanRecovery(ctx, key)
    adopt(next); setReview(null); setState('Saved — version ' + next.expected_revision)
  }
  function reconcile() {
    if (!mounted.current || !sameScope(scope) || lock.current || current.current.uncertainSave) return
    const next = noteValue(latest.current)
    if (!baseline.current && sameNote(current.current, next)) becomeClean(next)
    // Recheck the synchronous working ref: a keystroke between render and
    // effect must win over the previous render's clean/dirty classification.
    if (sameNote(current.current, baseline.current) && next.expected_revision > current.current.expected_revision) {
      adopt(next); setState('Saved — version ' + next.expected_revision)
    }
  }
  useEffect(() => { if (observe(document)) reconcile() }, [document, busy])
  function edit(next) {
    if (!sameScope(scope) || lock.current) return
    current.current = next
    setDraft(next)
    if (!next.uncertainSave && sameNote(next, baseline.current)) {
      becomeClean(next); reconcile(); return
    }
    setState(keepDraft(ctx, key, next) ? 'Unsaved draft — recovery copy read back on this Desktop' : recoveryFailed)
  }
  async function save() {
    if (lock.current || current.current.uncertainSave || !sameScope(scope)) return
    lock.current = true; setBusy(true); setState('Saving…')
    setReview(null) // A pre-dispatch review cannot reconcile this save's outcome.
    const sent = {...current.current}
    current.current = {...sent, uncertainSave: true}; setDraft(current.current)
    keepDraft(ctx, key, current.current)
    try {
      const saved = await scopedRequest(ctx, scope, `/projects/${projectId}/documents/${document.id}`, {
        method: 'PUT', body: {title: sent.title, content: {text: sent.text}, expected_revision: sent.expected_revision},
      })
      if (!sameScope(scope) || !mounted.current) return
      if (!observe(saved)) throw new Error('Mismatched saved resource')
      becomeClean(noteValue(saved)); refresh()
    } catch (error) { if (sameScope(scope) && mounted.current) setState(message(error)) }
    finally { lock.current = false; if (sameScope(scope) && mounted.current) { setBusy(false); reconcile() } }
  }
  async function readLatest() {
    if (lock.current || !sameScope(scope)) return
    lock.current = true; setBusy(true)
    try {
      const saved = await scopedRequest(ctx, scope, `/projects/${projectId}/documents/${document.id}`)
      if (!sameScope(scope) || !mounted.current) return
      if (!observe(saved)) throw new Error('Mismatched saved resource')
      setReview(latest.current); setState('Saved version loaded below. Your draft has not changed.')
    } catch (error) { if (sameScope(scope) && mounted.current) setState(message(error)) }
    finally { lock.current = false; if (sameScope(scope) && mounted.current) { setBusy(false); reconcile() } }
  }
  function discard() {
    if (!review || !sameScope(scope) || lock.current) return
    if (!removeDraft(ctx, key)) { setState(removalFailed); return }
    adopt(noteValue(review)); setReview(null); reconcile()
    setState('Draft discarded in memory; showing the saved version. ' + removalObserved)
  }
  return jsxs('section', {style: {...panel, display: 'grid', gap: 12}, children: [
    jsx('h2', {children: 'Note'}),
    input('Note title', draft.title, title => edit({...current.current, title}), {maxLength: 200, disabled: busy}),
    jsxs('label', {children: ['Note text', jsx(SDK.Textarea, {'aria-label': 'Note text', value: draft.text,
      maxLength: 100000, rows: 14, disabled: busy, style: {width: '100%'},
      onChange: event => edit({...current.current, text: event.target.value})})]}),
    status(state),
    drafts.get(key) === null ? status(cleanupFailed) : null,
    draft.uncertainSave ? status('Save outcome needs review before another save. Your draft and its base are unchanged.') : null,
    saved.revision > draft.expected_revision ? status('A newer saved version is available. Review it before saving your draft.') : null,
    jsxs('div', {style: row, children: [button('Save note', save, busy || !!draft.uncertainSave || !dirty || !draft.title.trim()),
      button('Review saved version', readLatest, busy),
      button('Copy draft', async () => {
        const result = await copyDraft(ctx, scope, current.current)
        if (sameScope(scope)) setState(result)
      }, busy || !ctx.os?.writeClipboard)]}),
    jsx('p', {style: muted, children: 'Unsaved work stays in memory while this plugin is loaded. Recovery storage can fail: copy before leaving, reloading or signing out. Saving is never retried automatically. Recovery copies are private content, not encrypted storage.'}),
    review ? jsxs('section', {style: panel, children: [jsx('h3', {children: 'Saved version ' + review.revision}),
      jsx('strong', {children: review.title}), jsx('pre', {style: {whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}, children: review.content.text}),
      jsxs('div', {style: row, children: [button('Keep my draft, use this version as its base', () => {
        if (!sameScope(scope) || lock.current) return
        baseline.current = noteValue(review)
        edit({title: current.current.title, text: current.current.text, expected_revision: review.revision}); setReview(null)
      }, busy), button('Discard my draft and use saved version', discard, busy)]})]}) : null,
  ]})
}

function Board({document, novice}) {
  const nodes = document.content.nodes || []
  const labels = new Map(nodes.map(node => [node.id, node.data.label]))
  return jsxs('section', {style: panel, children: [jsx('h2', {children: document.title}),
    status('Board — view only in Hermes. Saved design, not an executable workflow. Edit its layout in the Pipe web app.'),
    ...nodes.map(node => jsxs('article', {style: {...panel, marginBlock: 10}, children: [
      jsx('h3', {children: node.data.label || 'Untitled card'}),
      jsx('p', {style: muted, children: 'Type: ' + node.type}),
      jsx('p', {style: {whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}, children: node.data.text}),
      novice ? jsx('p', {children: help[node.type]}) : null,
    ]}, node.id)),
    jsx('h3', {children: 'Connections'}),
    ...document.content.edges.map(edge => jsx('p', {children: `${labels.get(edge.source) || edge.source} → ${labels.get(edge.target) || edge.target} (${edge.relation === 'dependency' ? 'needs this first' : 'related reference'})`}, edge.id)),
    !nodes.length ? status('This board has no cards yet.') : null,
  ]})
}

function Create({ctx, scope, binding, projectId, done, leaveChecks, selection}) {
  const key = draftKey(scope, binding, projectId || 'projects', 'new')
  const [draft, setDraft] = useState(() => stored(ctx, key, {title: '', text: '', expected_revision: 1}))
  const current = useRef(draft)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [uncertain, setUncertain] = useState(() => uncertainCreates.has(key) || !!draft.uncertain || !!draft.createdId)
  const [notice, setNotice] = useState(() => draft.createdId
    ? 'Created, but recovery cleanup failed. Do not create it again.'
    : uncertainCreates.has(key) || draft.uncertain
    ? 'A previous create may have completed. Check its original project before trying again.'
    : draft.title || draft.text ? recoveryNotice(ctx, key, draft) : '')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useLeaveCheck(leaveChecks, key, () => lock.current || uncertainCreates.has(key) || !!current.current.uncertain || !!current.current.createdId || !!current.current.title || !!current.current.text)
  function edit(next) {
    if (!sameScope(scope) || lock.current) return
    current.current = next; setDraft(next)
    setNotice(keepDraft(ctx, key, next) ? 'Unsaved draft — recovery copy read back on this Desktop' : recoveryFailed)
  }
  async function create() {
    if (lock.current || uncertain || !sameScope(scope)) return
    lock.current = true; setBusy(true)
    const owner = selection.current
    uncertainCreates.add(key); setUncertain(true)
    current.current = {...current.current, uncertain: true}
    setDraft(current.current)
    if (!keepDraft(ctx, key, current.current)) setNotice(recoveryFailed)
    try {
      const path = projectId ? `/projects/${projectId}/documents` : '/projects'
      const body = projectId ? {title: current.current.title, kind: 'note', content: {text: current.current.text}} : {title: current.current.title}
      const result = await scopedRequest(ctx, scope, path, {method: 'POST', body})
      // Keep the old request's draft/uncertain marker for explicit reconciliation.
      if (!sameScope(scope) || !mounted.current || selection.current !== owner) return
      current.current = {...current.current, createdId: result.id}; setDraft(current.current)
      keepDraft(ctx, key, current.current)
      if (!removeDraft(ctx, key)) {
        setNotice('Created, but recovery cleanup failed. Do not create it again. ' + removalFailed)
        setUncertain(true); uncertainCreates.add(key); return
      }
      current.current = {title: '', text: '', expected_revision: 1}; setDraft(current.current)
      uncertainCreates.delete(key); setUncertain(false)
      lock.current = false
      setNotice('Created'); done(result)
    } catch (error) { if (sameScope(scope) && mounted.current) setNotice(message(error)) }
    finally { lock.current = false; if (sameScope(scope) && mounted.current) setBusy(false) }
  }
  return jsxs('section', {style: {...panel, display: 'grid', gap: 10}, children: [
    jsx('h3', {children: projectId ? 'Create a note' : 'Create a project'}),
    input(projectId ? 'New note title' : 'New project title', draft.title,
      title => edit({...current.current, title}), {maxLength: 200, disabled: busy}),
    projectId ? jsxs('label', {style: {display: 'grid', gap: 5}, children: ['New note text', jsx(SDK.Textarea, {'aria-label': 'New note text',
      value: draft.text, maxLength: 100000, rows: 5, disabled: busy, style: {width: '100%'}, 
      onChange: event => edit({...current.current, text: event.target.value})})]}) : null,
    button(busy ? 'Creating…' : projectId ? 'Create note' : 'Create project', create, busy || uncertain || !draft.title.trim()),
    button(projectId ? 'Discard new note draft' : 'Discard new project draft', () => {
      if (!sameScope(scope) || lock.current) return
      if (!removeDraft(ctx, key)) { setNotice(removalFailed); return }
      current.current = {title: '', text: '', expected_revision: 1}; setDraft(current.current)
      uncertainCreates.delete(key); setUncertain(false)
      setNotice('Draft discarded in memory. ' + removalObserved)
    }, busy || (!draft.title && !draft.text)),
    button(projectId ? 'Copy new note draft' : 'Copy new project draft', async () => {
      const result = await copyDraft(ctx, scope, current.current)
      if (sameScope(scope)) setNotice(result)
    }, busy || !ctx.os?.writeClipboard),
    notice ? status(notice) : null,
    draft.createdId ? jsxs('div', {children: [status('Created item: ' + draft.createdId),
      button('Clear recovery and open created item', () => {
        if (!sameScope(scope) || lock.current) return
        if (!removeDraft(ctx, key)) { setNotice(removalFailed); return }
        const id = current.current.createdId
        current.current = {title: '', text: '', expected_revision: 1}; setDraft(current.current)
        uncertainCreates.delete(key); setUncertain(false)
        setNotice('Created'); done({id})
      }, busy)]}) : uncertain ? button('I refreshed the list and checked: it was not created', () => {
      if (!sameScope(scope) || lock.current) return
      uncertainCreates.delete(key); setUncertain(false)
      edit({...current.current, uncertain: false})
    }, busy) : null,
  ]})
}

function Workspace({ctx, scope, binding}) {
  const selection = useRef(0)
  const leaveChecks = useRef(new Map())
  const [leaving, setLeaving] = useState(null)
  function navigate(action) {
    if (!sameScope(scope)) return
    const owner = selection.current
    const apply = () => {
      if (!sameScope(scope) || selection.current !== owner) return
      selection.current++; action()
    }
    if ([...leaveChecks.current.values()].some(check => check())) setLeaving(() => apply)
    else apply()
  }
  const [projectId, setProject] = useState('')
  const [documentId, setDocument] = useState('')
  const [cursor, setCursor] = useState('')
  const [novice, setNovice] = useState(true)
  const prefix = [ID, scope.connectionId, scope.profile, scope.epoch, scope.privacyGeneration, binding.binding_id, binding.generation]
  const projects = SDK.useQuery({queryKey: [...prefix, 'projects', cursor], retry: false,
    queryFn: () => scopedRequest(ctx, scope, '/projects' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')),
    refetchInterval: 5000})
  const documents = SDK.useQuery({queryKey: [...prefix, 'documents', projectId], retry: false, enabled: !!projectId,
    queryFn: () => scopedRequest(ctx, scope, `/projects/${projectId}/documents`), refetchInterval: 5000})
  const document = SDK.useQuery({queryKey: [...prefix, 'document', projectId, documentId], retry: false, enabled: !!documentId,
    queryFn: () => scopedRequest(ctx, scope, `/projects/${projectId}/documents/${documentId}`), refetchInterval: 5000})
  if (!sameScope(scope)) return status('Connection changed. Waiting for the approved connection…')
  const failed = projects.error || (projectId && documents.error) || (documentId && document.error)
  if (failed) return jsxs('section', {children: [status(message(failed)), button('Check connection again', () => {
    if (sameScope(scope)) { projects.refetch(); documents.refetch(); document.refetch() }
  })]})
  return jsxs('div', {style: {display: 'grid', gap: 16}, children: [
    leaving ? jsxs('section', {role: 'alert', style: panel, children: [
      jsx('p', {children: 'Unsaved work or a pending request exists. Leaving keeps drafts only while this plugin stays loaded unless recovery storage succeeded. Copy important text first. A pending write may still finish; check its original project before retrying.'}),
      button('Stay here', () => setLeaving(null)),
      button('Leave this resource', () => { if (sameScope(scope)) leaving(); setLeaving(null) }),
    ]}) : null,
    jsxs('header', {style: row, children: [jsx('h1', {children: 'Pipe'}),
      jsx('span', {style: muted, children: `Workspace: ${binding.binding_id} · ${binding.profile}`}),
      jsxs('label', {children: [jsx('input', {type: 'checkbox', checked: novice, onChange: event => setNovice(event.target.checked)}), ' Show helpful tips']}),
      button('Refresh lists', () => { if (sameScope(scope)) { projects.refetch(); if (projectId) documents.refetch() } }),
    ]}),
    novice ? jsx('p', {style: muted, children: 'Choose a project, then a document. Notes can be edited here; boards are readable designs. Changes are shared with the Pipe web app and agents.'}) : null,
    jsxs('div', {style: {display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16}, children: [
      jsxs('nav', {'aria-label': 'Pipe projects', style: panel, children: [jsx('h2', {children: 'Projects'}),
        projects.isPending ? status('Loading projects…') : null,
        ...(projects.data?.items || []).map(project => button(project.title, () => {
          navigate(() => { setProject(project.id); setDocument('') })
        }, false, project.id)),
        projects.data?.items.length === 0 ? status('No projects yet. Create your first one below.') : null,
        jsxs('div', {style: row, children: [button('First page', () => setCursor(''), !cursor),
          button('Next page', () => setCursor(projects.data.next_cursor), !projects.data?.next_cursor)]}),
        jsx(Create, {ctx, scope, binding, leaveChecks, selection, done: project => { projects.refetch(); navigate(() => { setProject(project.id); setDocument('') }) }}),
      ]}),
      projectId ? jsxs('section', {style: panel, children: [jsx('h2', {children: 'Documents'}),
        documents.isPending ? status('Loading documents…') : null,
        ...(documents.data?.items || []).map(doc => button(`${doc.title} · ${doc.kind === 'board' ? 'Board (view only)' : 'Note'}`, () => {
          navigate(() => setDocument(doc.id))
        }, false, doc.id)),
        documents.data?.items.length === 0 ? status('No documents yet. Start with a note.') : null,
        jsx(Create, {ctx, scope, binding, projectId, leaveChecks, selection, done: doc => { documents.refetch(); navigate(() => setDocument(doc.id)) }}, projectId),
      ]}) : status('Select a project to see its documents.'),
    ]}),
    documentId && document.isPending ? status('Loading document…') : null,
    documentId && document.data?.id === documentId && document.data.project_id === projectId ? document.data.kind === 'note'
      ? jsx(NoteEditor, {ctx, scope, binding, projectId, leaveChecks, document: document.data,
          refresh: () => { document.refetch(); documents.refetch() }}, projectId + ':' + documentId)
      : jsx(Board, {document: document.data, novice}) : null,
  ]})
}

const recoverySignIn = 'Open Settings → Gateways → Saved connections. Choose Edit (pencil) for the approved source, then Sign in with your provider using the same account. Leave connection settings unchanged; no Save connection is needed. Do not Sign out to recover drafts: it deletes private recovery.'

function Page({ctx}) {
  const [retryState, setRetryState] = useState('')
  const [retrying, setRetrying] = useState(false)
  const retryLock = useRef(false)
  const mounted = useRef(true)
  const retryTimer = useRef(null)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(retryTimer.current) }
  }, [])
  async function retryPrivacy() {
    if (retryLock.current) return
    retryLock.current = true; setRetrying(true); setRetryState('Checking private access…')
    retryTimer.current = setTimeout(() => {
      if (mounted.current) setRetryState('The check has not completed. Keep this window open; if it remains blocked, ask the operator to repair Desktop. No cleanup or sign-in is confirmed.')
    }, 12000)
    try {
      await SDK.host.retryPluginPrivacy()
      if (mounted.current) setRetryState('Check finished. If access is still closed, verify recovery ownership. ' + recoverySignIn + ' If that does not restore access, ask the operator to repair private recovery metadata; do not delete recovery files.')
    } catch {
      if (mounted.current) setRetryState('Retry could not restore private access. ' + recoverySignIn + ' Then retry. If it stays blocked, ask the operator to repair private recovery metadata; do not delete recovery files.')
    } finally {
      clearTimeout(retryTimer.current); retryLock.current = false
      if (mounted.current) setRetrying(false)
    }
  }
  const privacy = SDK.useValue(SDK.host.state.pluginPrivacy)
  const profile = SDK.useValue(SDK.host.state.profile)
  const gateway = SDK.useValue(SDK.host.state.gateway)
  // Older SDKs may lack the source atom; epoch support remains mandatory.
  const connection = SDK.useValue(SDK.host.state.connectionId || SDK.host.state.profile)
  const epoch = typeof SDK.gatewayActivationEpoch === 'function' ? SDK.gatewayActivationEpoch() : null
  // Nominal polling only, not a UI-clearing deadline (background/scheduling delays).
  const inventory = SDK.useQuery({queryKey: [ID, 'route-watch', profile, gateway, connection, epoch, privacy.generation],
    queryFn: captureScope, enabled: privacy.ready, refetchInterval: 1000, retry: false})
  const scope = !inventory.error && sameScope(inventory.data) ? inventory.data : null
  const problem = inventory.error ? message(inventory.error) : null
  const key = scope ? JSON.stringify(scope) : 'unsupported'
  const binding = SDK.useQuery({queryKey: [ID, 'binding', key], enabled: !!scope, retry: false,
    queryFn: () => scopedRequest(ctx, scope, '/binding'), refetchInterval: 5000})
  const cache = SDK.useQueryClient()
  useEffect(() => () => {
    const oldScope = query => query.queryKey[0] === ID && (
      (query.queryKey[1] === 'binding' && query.queryKey[2] === key) ||
      (scope && query.queryKey[1] === scope.connectionId && query.queryKey[2] === scope.profile && query.queryKey[3] === scope.epoch && query.queryKey[4] === scope.privacyGeneration))
    cache.cancelQueries({predicate: oldScope})
    cache.removeQueries({predicate: oldScope})
  }, [key])
  if (!privacy.ready) return jsxs('section', {children: [
    status('Private access is closed. Recovery copies may remain on this Desktop. Requests already sent may have completed; review saved work after signing in before another write. ' +
      (retryState || 'After restarting Desktop, verify recovery ownership. ' + recoverySignIn + ' Retry does not sign you in.')),
    button('Retry private cleanup', retryPrivacy, retrying),
  ]})
  if (problem) return status(problem)
  if (binding.error) return jsxs('section', {children: [status(message(binding.error)), button('Check access again', () => binding.refetch())]})
  if (!binding.data || !sameScope(scope)) return status('Checking the approved Pipe connection…')
  if (binding.data.profile !== scope.targetProfile) return status('This profile does not match the operator-approved Pipe connection.')
  return jsx('main', {style: {padding: 20, overflow: 'auto', height: '100%', color: 'var(--ui-text-primary)'},
    children: jsx(Workspace, {ctx, scope, binding: binding.data}, key + binding.data.binding_id + binding.data.generation)})
}

export default {
  id: ID, name: 'Pipe', defaultEnabled: false, privateStorage: true,
  register(ctx) {
    const supported = typeof ctx.rest === 'function' && typeof ctx.storage?.clear === 'function' &&
      typeof ctx.onPrivacyReset === 'function' && typeof SDK.host.state.pluginPrivacy?.get === 'function' &&
      typeof ctx.onBeforeDeparture === 'function' &&
      typeof SDK.host.state.pluginPrivacy?.subscribe === 'function' && typeof SDK.host.retryPluginPrivacy === 'function'
    const retire = () => {
      SDK.queryClient.cancelQueries({queryKey: [ID]})
      SDK.queryClient.removeQueries({queryKey: [ID]})
    }
    if (supported) {
      const approvals = new WeakMap()
      ctx.onBeforeDeparture(transition => {
        if (transition.signal.aborted) return false
        if (transition.phase === 'commit') return approvals.get(transition) === workSnapshot()
        const snapshot = workSnapshot()
        approvals.set(transition, snapshot)
        if (!hasWork()) return true
        if (transition.automatic) return false
        return transition.confirm().then(answer => answer === true && !transition.signal.aborted &&
          approvals.get(transition) === workSnapshot())
      })
      ctx.onPrivacyReset(() => { retire(); drafts.clear(); uncertainCreates.clear(); liveWork.clear() })
    }
    // Supported readonly atoms work even when the Pipe page is unmounted.
    // Neither gateway socket state nor plugin disposal is a logout signal.
    for (const atom of [SDK.host.state.profile, SDK.host.state.connectionId]) {
      if (!atom?.subscribe) continue
      let previous = atom.get()
      ctx.onDispose(atom.subscribe(value => {
        if (value === previous) return
        previous = value; retire()
      }))
    }
    ctx.register({id: 'page', area: SDK.ROUTES_AREA, data: {path: '/pipe'}, render: () => supported
      ? jsx(Page, {ctx}) : status('This Desktop lacks the required private-plugin lifecycle. Pipe is unavailable; ask the operator to verify host compatibility.')})
    ctx.register({id: 'nav', area: SDK.SIDEBAR_NAV_AREA, data: {path: '/pipe', label: 'Pipe', codicon: 'project'}})
    ctx.register({id: 'open', area: SDK.PALETTE_AREA, data: {id: 'pipe.open', label: 'Open Pipe', keywords: ['pipe', 'project', 'notes'], run: () => SDK.host.navigate('/pipe')}})
    ctx.onDispose(() => { retire(); drafts.clear(); uncertainCreates.clear(); liveWork.clear() })
  },
}
