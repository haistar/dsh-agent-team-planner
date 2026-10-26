#!/usr/bin/env node
/**
 * Browser-free renderer check for the 0.2 workbench.
 *
 * Loads lib/client.js through the real ModuleLoader contract, installs a tiny
 * hook-aware React stub (createElement/useState/useEffect/useCallback), and
 * renders the registered Shell + meeting Dock against fake workspace/session
 * services and a fake Host state payload.
 *
 * It asserts:
 *   - Shell/Board/Meeting views render without throwing (zh + en)
 *   - every requested i18n key exists in BOTH dictionaries (no undefined text)
 *   - workspace uses WorkspaceView.workspaceId and SessionSummary.cwd/sessionIds
 *   - the meeting banner resolves the live session (dock inject/session props)
 *   - finishing the meeting removes the banner and opens the board
 *   - no workspaces service or no workspace renders the empty state, not a crash
 *   - one-page layout keeps page-level overflow hidden
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT = join(HERE, '..', 'lib', 'client.js')

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  — ${detail}` : ''}`)
}
const assert = (condition, message) => { if (!condition) throw new Error(message) }

/* --------------------------------------------------------------- mini React */

function createMiniReact() {
  const instances = new Map()
  let current = null
  let dirty = false

  const getInstance = (key) => {
    if (!instances.has(key)) instances.set(key, { key, hooks: [], index: 0, pendingEffects: [] })
    return instances.get(key)
  }
  const markDirty = () => { dirty = true }
  const depsChanged = (previous, next) => {
    if (!Array.isArray(next)) return true
    if (!Array.isArray(previous)) return true
    if (previous.length !== next.length) return true
    return next.some((value, index) => value !== previous[index])
  }

  const React = {
    createElement(type, props, ...children) {
      return { type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } }
    },
    useState(initial) {
      const instance = current
      const index = instance.index++
      if (!(index in instance.hooks)) {
        instance.hooks[index] = { value: typeof initial === 'function' ? initial() : initial }
      }
      const hook = instance.hooks[index]
      return [hook.value, (next) => {
        hook.value = typeof next === 'function' ? next(hook.value) : next
        markDirty()
      }]
    },
    useEffect(effect, deps) {
      const instance = current
      const index = instance.index++
      const previous = instance.hooks[index]
      if (!previous) {
        const hook = { deps, cleanup: undefined }
        instance.hooks[index] = hook
        instance.pendingEffects.push({ hook, effect })
        return
      }
      if (!depsChanged(previous.deps, deps)) return
      previous.deps = deps
      instance.pendingEffects.push({ hook: previous, effect })
    },
    useCallback(fn, deps) {
      const instance = current
      const index = instance.index++
      const previous = instance.hooks[index]
      if (previous && !depsChanged(previous.deps, deps)) return previous.fn
      instance.hooks[index] = { fn, deps }
      return fn
    },
    useMemo(fn, deps) {
      const instance = current
      const index = instance.index++
      const previous = instance.hooks[index]
      if (previous && !depsChanged(previous.deps, deps)) return previous.value
      const value = fn()
      instance.hooks[index] = { value, deps }
      return value
    },
    useRef(initial) {
      const instance = current
      const index = instance.index++
      if (!(index in instance.hooks)) instance.hooks[index] = { current: initial }
      return instance.hooks[index]
    },
  }

  const renderNode = (node, path) => {
    if (node === null || node === undefined || node === false || node === true) return null
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map((child, index) => renderNode(child, `${path}[${index}]`))
    if (typeof node.type === 'function') {
      const instance = getInstance(`${path}|${node.type.name || 'anonymous'}`)
      const previous = current
      current = instance
      instance.index = 0
      instance.pendingEffects = []
      let output
      try {
        output = node.type(node.props)
      } finally {
        current = previous
      }
      return renderNode(output, `${path}/`)
    }
    const children = renderNode(node.props?.children, `${path}.children`)
    return { ...node, props: { ...node.props, children } }
  }

  const flushEffects = async () => {
    for (const instance of instances.values()) {
      const pending = instance.pendingEffects
      instance.pendingEffects = []
      for (const { hook, effect } of pending) {
        if (typeof hook.cleanup === 'function') hook.cleanup()
        const previous = current
        current = instance
        try {
          hook.cleanup = effect()
        } finally {
          current = previous
        }
      }
    }
  }

  const settle = async (component, props) => {
    let tree = null
    for (let iteration = 0; iteration < 40; iteration += 1) {
      dirty = false
      const previous = current
      current = null
      tree = renderNode(React.createElement(component, props), 'root')
      current = previous
      await flushEffects()
      await new Promise((resolve) => setTimeout(resolve, 0))
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (!dirty) break
    }
    return tree
  }

  return { React, settle }
}

const walk = (node, visit) => {
  if (node === null || node === undefined) return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  if (typeof node === 'string' || typeof node === 'number') return
  visit(node)
  walk(node.props?.children, visit)
}
const textOf = (node) => {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props?.children)
}
const findButton = (tree, needle) => {
  let found = null
  walk(tree, (node) => {
    if (found !== null) return
    if (node.type === 'button' && textOf(node).includes(needle)) found = node
  })
  return found
}
const findAll = (tree, predicate) => {
  const found = []
  walk(tree, (node) => { if (predicate(node)) found.push(node) })
  return found
}

/* ------------------------------------------------------------------- load */

let captured
globalThis.window = { __ModuleLoader__: { load: (entry) => { captured = entry } } }
globalThis.localStorage = {
  values: new Map(),
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null },
  setItem(key, value) { this.values.set(key, String(value)) },
}
// The render check should not leave polling intervals behind.
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

const code = readFileSync(CLIENT, 'utf8')
eval(code)

const ZH = {}
const EN = {}
let language = 'zh'
const requestedKeys = new Set()
const missingKeys = new Set()
const localeSubscribers = []
const selectedPanels = []
const openedSessions = []
const startedSessions = []

const translate = (key) => {
  requestedKeys.add(key)
  const dictionary = language === 'zh' ? ZH : EN
  if (!(key in dictionary)) {
    missingKeys.add(key)
    return undefined
  }
  return dictionary[key]
}

const mini = createMiniReact()

const dataState = {
  schemaVersion: 1,
  revision: 7,
  workspacePath: 'E:\\demo',
  team: { name: '演示团队', leadSessionId: 'sess-lead' },
  settings: { defaultRoleByStage: { requirement: 'product', architecture: 'architect', review: 'architect', testing: 'test' } },
  roles: [{ id: 'product', name: '产品', basePrompt: '' }, { id: 'backend', name: '后端', basePrompt: '' }],
  members: [
    { name: 'product-1', displayName: '产品一号', roleId: 'product', blocked: false, removed: false, creation: { status: 'active' } },
    { name: 'backend-1', displayName: '后端一号', roleId: 'backend', blocked: false, removed: false, creation: { status: 'active' } },
  ],
  requirements: [{
    id: 'req-1',
    title: '健康检查接口',
    description: '提供 GET /health',
    status: 'planned',
    versionId: 'ver-1',
    roleTags: ['backend'],
    taskSpecs: [{ key: '1', objective: '实现 /health', role: 'backend', stage: 'development' }],
    requirementArtifactId: 'art-1',
  }],
  versions: [{
    id: 'ver-1',
    name: 'v1.0.0',
    description: '演示版本',
    planDate: '2026-11-01',
    owner: '产品一号',
    notes: '演示备注',
    status: 'draft',
    stage: 'requirement',
    requirementIds: ['req-1'],
  }],
  bindings: [],
  artifacts: [
    { id: 'art-1', versionId: 'ver-1', requirementId: 'req-1', type: 'requirement_doc', title: '需求文档：健康检查接口', content: '# 需求', status: 'approved', source: { kind: 'manual' } },
    { id: 'art-2', versionId: 'ver-1', requirementId: null, type: 'meeting_minutes', title: '会议纪要：v1 需求澄清会', content: '# 纪要', status: 'draft', source: { kind: 'meeting', meetingId: 'meet-1' } },
  ],
  meetings: [{
    id: 'meet-1',
    leadSessionId: 'sess-lead',
    versionId: 'ver-1',
    type: 'requirement_clarification',
    title: 'v1 需求澄清会',
    goal: '确认首版范围',
    status: 'active',
    hostMemberName: 'product-1',
    participants: ['product-1', 'backend-1'],
    sessionIds: { 'product-1': 'member-product-1', 'backend-1': 'member-backend-1' },
    transcript: [{ id: 't1', at: '2026-11-01T10:00:00.000Z', kind: 'user', text: '首版只做 Web' }],
    requirementDraft: '# Web 首版需求\n\n只做 Web。',
    artifactIds: ['art-2'],
    notes: '',
    createdAt: '2026-11-01T09:00:00.000Z',
    closedAt: null,
  }],
  activity: [{ id: 'act-1', at: '2026-11-01T09:00:00.000Z', summary: '创建 v1.0.0' }],
}

const snapshot = () => ({
  state: dataState,
  official: { members: [], tasks: [] },
  team: { bound: true, leadAvailable: true, leadSessionId: 'sess-lead' },
  bridge: { loaded: true },
})

const workspace = {
  workspaceId: 'ws-demo',
  path: 'E:\\demo',
  title: '演示项目',
  sessionIds: ['sess-lead'],
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
}
const sessionRow = {
  id: 'sess-lead',
  title: '主会话',
  displayTitle: '主会话',
  cwd: 'E:\\demo',
  updatedAt: 10,
  blank: false,
  running: false,
  retainedBy: {},
}

let workspacesEnabled = true
const services = {
  workspaces: {
    list: { getSnapshot: () => ({ items: workspacesEnabled ? [workspace] : [], archivedSessionIds: [], pinnedSessionIds: [], state: 'ready', phase: 'ready', error: null }) },
  },
  sessions: {
    list: { getSnapshot: () => ({ ids: ['sess-lead'], byId: { 'sess-lead': sessionRow }, phase: 'ready', projectionsBySession: {} }) },
  },
  uiWorkspace: {
    startSession: (workspaceId) => startedSessions.push(workspaceId),
    openSession: (target) => openedSessions.push(target),
  },
  layout: { selectPanel: (id) => selectedPanels.push(id) },
}

const response = (body) => ({
  ok: body?.ok !== false,
  status: body?.ok === false ? 500 : 200,
  text: async () => JSON.stringify(body),
})

const commandLog = []
const revisionConflict = (body) => {
  if (typeof body.expectedRevision === 'number' && body.expectedRevision !== dataState.revision) {
    return response({ ok: false, error: { code: 'REVISION_CONFLICT', message: `expected ${body.expectedRevision}, current ${dataState.revision}` } })
  }
  return null
}

globalThis.fetch = async (url, init = {}) => {
  const text = String(url)
  if (text.startsWith('/api/atplanner.state')) return response({ ok: true, value: snapshot() })
  if (text.startsWith('/api/atplanner.command')) {
    const body = JSON.parse(init.body ?? '{}')
    if (body.op === 'catalog.get') return response({ ok: true, value: { catalog: { providers: [] } } })
    commandLog.push({ op: body.op, expectedRevision: body.expectedRevision, payload: body.payload })
    const conflict = revisionConflict(body)
    if (conflict !== null) return conflict
    if (body.op === 'requirement.create') {
      const requirement = {
        id: 'req-new',
        title: body.payload.title,
        description: body.payload.description,
        status: 'draft',
        versionId: null,
        roleTags: body.payload.roleTags ?? [],
        taskSpecs: [],
        requirementArtifactId: null,
      }
      dataState.requirements.push(requirement)
      dataState.revision += 1
      return response({ ok: true, value: { state: dataState, requirement } })
    }
    if (body.op === 'requirement.setTaskSpecs') {
      const requirement = dataState.requirements.find((candidate) => candidate.id === body.payload.id)
      if (requirement === undefined) return response({ ok: false, error: { code: 'VALIDATION', message: 'requirement missing' } })
      requirement.taskSpecs = body.payload.specs
      dataState.revision += 1
      return response({ ok: true, value: { state: dataState, requirement } })
    }
    if (body.op === 'meeting.finish') {
      const meeting = dataState.meetings.find((candidate) => candidate.id === body.payload?.meetingId)
      if (meeting !== undefined) {
        meeting.status = 'closed'
        meeting.closedAt = '2026-11-01T11:00:00.000Z'
        dataState.revision += 1
      }
      return response({ ok: true, value: { state: dataState, meeting } })
    }
    dataState.revision += 1
    return response({ ok: true, value: { state: dataState } })
  }
  return response({ ok: false, error: { code: 'NOT_FOUND', message: text } })
}

const registrations = []
const ctx = {
  effect: (effect) => effect(),
  get: (name) => (workspacesEnabled === false && (name === 'workspaces' || name === 'sessions') ? undefined : services[name]),
  locale: {
    register: (ns, locale, dictionary) => {
      if (locale === 'zh') Object.assign(ZH, dictionary)
      else Object.assign(EN, dictionary)
      return () => {}
    },
    bind: () => translate,
    getLocale: () => ({ active: language }),
    subscribe: (fn) => { localeSubscribers.push(fn); return () => {} },
    setLocale: (next) => { language = next; for (const fn of localeSubscribers) fn() },
  },
  layout: services.layout,
  slots: {
    inject: (_name, factory) => { factory(); return () => {} },
    register: (definition, component) => { registrations.push({ definition, component }); return () => {} },
  },
}

let loaded
try {
  loaded = captured.factory((id) => {
    if (id === 'react') return mini.React
    throw new Error(`unexpected require: ${id}`)
  })
  loaded.apply(ctx)
  check('apply() renders registrations', registrations.length === 3, registrations.map((entry) => entry.definition.name).join(','))
} catch (error) {
  check('apply() renders registrations', false, String(error?.stack ?? error))
  process.exit(1)
}

const componentOf = (name) => registrations.find((entry) => entry.definition.name === name)?.component
const definitionOf = (name) => registrations.find((entry) => entry.definition.name === name)?.definition

const run = async () => {
  const main = componentOf('main')
  let tree
  try {
    tree = await mini.settle(main, {})
    check('Shell + BoardView render without throwing', tree !== null)
  } catch (error) {
    check('Shell + BoardView render without throwing', false, String(error?.stack ?? error))
    process.exitCode = 1
    return
  }

  const text = textOf(tree)
  check('workspace title uses WorkspaceView.workspaceId/title', text.includes('演示项目'), text.slice(0, 120))
  check('session selected by cwd/sessionIds', text.includes('v1.0.0') && text.includes('健康检查接口'), text.includes('v1.0.0') ? 'version rendered' : 'version missing')
  check('version planDate/owner/notes rendered', text.includes('2026-11-01') && text.includes('产品一号') && text.includes('演示备注'))
  check('meeting minutes artifact visible in board', text.includes('会议纪要：v1 需求澄清会'))
  check('no undefined/NaN text in tree', !/\b(undefined|NaN)\b/.test(text), text.slice(0, 160))

  const rootElement = (() => {
    let found = null
    walk(tree, (node) => {
      const style = node.props?.style
      if (found === null && style?.overflow === 'hidden' && style?.height === '100%') found = node
    })
    return found
  })()
  check('one-page layout root hides page overflow', rootElement !== null)

  check('zh render requested no missing i18n keys', missingKeys.size === 0, [...missingKeys].join(','))

  // English switch through the real locale subscription path.
  language = 'en'
  for (const subscriber of localeSubscribers) subscriber()
  tree = await mini.settle(main, {})
  const english = textOf(tree)
  check('en switch re-renders translated shell', english.includes('Version Board') && english.includes('Project'), english.slice(0, 120))
  check('en render requested no missing i18n keys', missingKeys.size === 0, [...missingKeys].join(','))

  // Requirement create lives on the dedicated Requirements tab. The create form
  // intentionally has no task-spec editor: the Host generates a baseline.
  language = 'zh'
  for (const subscriber of localeSubscribers) subscriber()
  tree = await mini.settle(main, {})
  const requirementsTab = findAll(tree, (node) => node.type === 'div' && textOf(node).trim() === '需求' && typeof node.props.onClick === 'function').pop()
  check('requirements tab is reachable', requirementsTab !== undefined)
  if (requirementsTab !== undefined) requirementsTab.props.onClick()
  tree = await mini.settle(main, {})
  const newRequirement = findButton(tree, '新建需求')
  check('requirements tab exposes new-requirement dialog', newRequirement !== null)
  if (newRequirement !== null) {
    const before = commandLog.length
    newRequirement.props.onClick()
    tree = await mini.settle(main, {})
    const inputs = findAll(tree, (node) => node.type === 'input' && node.props.type !== 'checkbox' && node.props.type !== 'file')
    const textareas = findAll(tree, (node) => node.type === 'textarea')
    check('requirement dialog renders title/description fields', inputs.length >= 1 && textareas.length >= 1, `${inputs.length}/${textareas.length}`)
    check('requirement dialog hides task specs on create', findAll(tree, (node) => node.type === 'textarea' && String(node.props.value).includes('objective')).length === 0)
    inputs[0].props.onChange({ target: { value: '序列修订测试需求' } })
    textareas[0].props.onChange({ target: { value: '补充需求说明' } })
    tree = await mini.settle(main, {})
    const save = findButton(tree, '保存')
    check('requirement dialog save enabled after input', save !== null && save.props.disabled !== true)
    save.props.onClick()
    tree = await mini.settle(main, {})
    const ops = commandLog.slice(before)
    const createOp = ops.find((entry) => entry.op === 'requirement.create')
    check('requirement.create runs', createOp !== undefined)
    check('requirement dialog closes after create', findButton(tree, '保存') === null)
    const created = dataState.requirements.find((candidate) => candidate.title === '序列修订测试需求')
    check('requirement persisted', created !== undefined, JSON.stringify(created))
  }
  // Return to the board for the version-settings assertions below.
  const boardTab = findAll(tree, (node) => node.type === 'div' && textOf(node).trim() === '版本看板' && typeof node.props.onClick === 'function').pop()
  if (boardTab !== undefined) boardTab.props.onClick()
  tree = await mini.settle(main, {})

  // Version settings: existing values prefill and save calls version.update.
  const settings = findButton(tree, '版本设置')
  check('board exposes version settings', settings !== null)
  if (settings !== null) {
    const before = commandLog.length
    settings.props.onClick()
    tree = await mini.settle(main, {})
    const inputs = findAll(tree, (node) => node.type === 'input')
    check('version settings prefills name/date/owner', inputs[0]?.props.value === 'v1.0.0' && inputs[1]?.props.value === '2026-11-01' && inputs[2]?.props.value === '产品一号', inputs.map((input) => input.props.value).join('|'))
    check('draft version exposes delete action', findButton(tree, '删除版本') !== null)
    const saveVersion = findButton(tree, '保存')
    check('version settings exposes save', saveVersion !== null)
    saveVersion.props.onClick()
    tree = await mini.settle(main, {})
    const update = commandLog.slice(before).find((entry) => entry.op === 'version.update')
    check('version settings calls version.update with prefilled fields', update !== undefined && update.payload.name === 'v1.0.0' && update.payload.planDate === '2026-11-01' && update.payload.owner === '产品一号' && update.payload.notes === '演示备注', JSON.stringify(update?.payload))
    check('version settings closes after update', findButton(tree, '保存') === null)
  }

  // Return-to-conversation calls layout.selectPanel(null).
  const backToChat = findButton(tree, '返回对话')
  check('shell exposes back-to-conversation', backToChat !== null)
  if (backToChat !== null) {
    backToChat.props.onClick()
    check('back-to-conversation selects no panel', selectedPanels.includes(null), selectedPanels.join(','))
  }

  // Empty states. Session selection also drives a fresh GET, which matters
  // because the fake transport (like JSON) hands the component a copy.
  const savedVersions = dataState.versions
  const savedSessionIds = workspace.sessionIds
  const savedCwd = sessionRow.cwd
  dataState.versions = []
  workspace.sessionIds = []
  sessionRow.cwd = 'E:\\another-project'
  tree = await mini.settle(main, {})
  check('empty state for a workspace without sessions', textOf(tree).includes('该工作区还没有会话'), textOf(tree).slice(0, 100))
  workspace.sessionIds = savedSessionIds
  sessionRow.cwd = savedCwd
  tree = await mini.settle(main, {})
  check('empty state for a workspace without versions', textOf(tree).includes('还没有版本'), textOf(tree).slice(0, 120))
  dataState.versions = savedVersions
  tree = await mini.settle(main, {})

  // Meetings page renders translated types; "enter discussion" targets a
  // bare SessionId (SessionTarget), never a parent/child object.
  const meetingTab = findAll(tree, (node) => node.type === 'div' && textOf(node) === '会议')[0]
  check('meetings tab is reachable', meetingTab !== undefined)
  if (meetingTab !== undefined) {
    meetingTab.props.onClick()
    tree = await mini.settle(main, {})
    const meetingText = textOf(tree)
    check('meetings page renders translated type and host', meetingText.includes('需求澄清会') && meetingText.includes('产品一号'), meetingText.slice(0, 120))
    const enter = findButton(tree, '进入讨论')
    check('meetings page exposes enter-discussion', enter !== null)
    if (enter !== null) {
      const before = openedSessions.length
      enter.props.onClick()
      check('enter-discussion opens the host SessionId', openedSessions.length === before + 1 && openedSessions[before] === 'member-product-1', openedSessions.join(','))
    }
  }

  // Meeting dock: match by SessionSnapshot.sessionId, not a workspaceId.
  language = 'zh'
  const dock = componentOf('conversation.input.dock')
  const dockDefinition = definitionOf('conversation.input.dock')
  const injected = dockDefinition.inject?.('member-product-1') ?? {}
  let dockTree = await mini.settle(dock, { ...injected, session: { sessionId: 'member-product-1' } })
  const dockText = textOf(dockTree)
  check('meeting dock renders for a tracked session', dockText.includes('会议进行中') && dockText.includes('v1 需求澄清会') && dockText.includes('确认首版范围'), dockText.slice(0, 120))
  check('meeting dock resolves Host sessionIds', dockText.includes('产品一号'))

  const otherTree = await mini.settle(dock, { sessionId: 'sess-unrelated', session: { sessionId: 'sess-unrelated' } })
  check('meeting dock hides for unrelated session', otherTree === null)

  const leadDockTree = await mini.settle(dock, { sessionId: 'sess-lead', session: { sessionId: 'sess-lead' } })
  check('meeting dock falls back to leadSessionId', leadDockTree !== null && textOf(leadDockTree).includes('会议进行中'), textOf(leadDockTree).slice(0, 80))
  dockTree = await mini.settle(dock, { ...injected, session: { sessionId: 'member-product-1' } })

  const finishButton = findButton(dockTree, '结束会议')
  check('meeting dock has finish button', finishButton !== null)
  if (finishButton !== null) {
    finishButton.props.onClick()
    dockTree = await mini.settle(dock, { ...injected, session: { sessionId: 'member-product-1' } })
    check('finish hides meeting banner', dockTree === null, textOf(dockTree).slice(0, 80))
    check('finish opens the board panel', selectedPanels.includes('devteam'), selectedPanels.join(','))
  }

  // Empty state: workspaces/sessions services unavailable must not throw.
  workspacesEnabled = false
  language = 'zh'
  try {
    const emptyTree = await mini.settle(main, {})
    check('no workspaces service renders empty state without crash', textOf(emptyTree).includes('没有可用的工作区'), textOf(emptyTree).slice(0, 120))
  } catch (error) {
    check('no workspaces service renders empty state without crash', false, String(error?.stack ?? error))
  }

  // Static i18n completeness: literal t('...') plus dynamic families.
  const literalKeys = new Set([...code.matchAll(/\bt\(\s*'([^']+)'/g)].map((match) => match[1]))
  const dynamicKeys = [
    'panel.label', 'nav.board', 'nav.meetings', 'nav.settings',
    'stage.requirement', 'stage.architecture', 'stage.development', 'stage.review', 'stage.testing', 'stage.done',
    'meeting.type.requirement', 'meeting.type.architecture', 'meeting.type.test', 'meeting.type.custom',
  ]
  const absent = [...literalKeys, ...dynamicKeys].filter((key) => !(key in ZH) || !(key in EN))
  check('all literal/dynamic i18n keys exist in zh+en', absent.length === 0, absent.join(','))
  const zhKeys = Object.keys(ZH).sort()
  const enKeys = Object.keys(EN).sort()
  check('zh/en dictionaries have identical key sets', JSON.stringify(zhKeys) === JSON.stringify(enKeys), `${zhKeys.length}/${enKeys.length}`)
  check('render requested keys exist in both dictionaries', [...requestedKeys].every((key) => key in ZH && key in EN), [...requestedKeys].filter((key) => !(key in ZH) || !(key in EN)).join(','))
}

await run()

const failed = results.filter((result) => !result.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length > 0) process.exitCode = 1
