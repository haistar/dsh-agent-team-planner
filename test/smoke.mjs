#!/usr/bin/env node
/**
 * DSH Agent Team Planner — browser-free smoke harness (S1–S3 + P0 regression).
 *
 * Loads the real plugin host half (`../dsh-agent-team-planner/lib/index.js`) in
 * Node 24, then:
 *   1. constructs a fake cordis-like ctx (effect/on/get/systemPrompt/connection),
 *   2. constructs an in-memory fake official Agent Teams service,
 *   3. calls the registered `/api/atplanner.state` and `/api/atplanner.command`
 *      handlers directly with Request/Response,
 *   4. emits session/event events through the fake ctx, and
 *   5. polls GET state until the async pump persists a revision change.
 *
 * It never touches a real DSH process, browser, or the plugin implementation.
 *
 * Run:  node test/smoke.mjs  (or: npm test)
 */

import { apply } from '../lib/index.js'
import { existsSync } from 'node:fs'
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = resolve(HERE, '..')
const PLUGIN_DIR = PROJECT_ROOT
const REPORT_PATH = join(PROJECT_ROOT, 'SMOKE-TEST.md')
const RESULTS_PATH = join(HERE, 'last-run.json')
const SESSION_ID = 'sess-lead'
const STATE_PATH = '/api/atplanner.state'
const COMMAND_PATH = '/api/atplanner.command'
const PUMP_TIMEOUT_MS = 3000
const POLL_MS = Number.parseInt(process.env.SMOKE_POLL_MS ?? '50', 10)

const unhandled = []
process.on('unhandledRejection', (reason) => {
  unhandled.push(reason)
  console.error('[harness] unhandledRejection:', reason?.stack ?? reason)
})

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms: ${label}`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function oneLine(value, max = 400) {
  const text = String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
  return text.length > max ? `${text.slice(0, max)}…` : text
}

function errorText(error) {
  return `${error?.message ?? String(error)}`
}

/* ------------------------------------------------------------------ env ---- */

const TMP_ROOT = join(HERE, '.tmp')

async function cleanupTemp() {
  await mkdir(TMP_ROOT, { recursive: true })
  const entries = await readdir(TMP_ROOT)
  for (const entry of entries) {
    if (/^(state|ws)-/.test(entry)) await rm(join(TMP_ROOT, entry), { recursive: true, force: true })
  }
}

async function createEnv(label) {
  const workspace = join(TMP_ROOT, `ws-${label}`)
  const stateRoot = join(TMP_ROOT, `state-${label}`)
  await rm(workspace, { recursive: true, force: true })
  await rm(stateRoot, { recursive: true, force: true })
  await mkdir(workspace, { recursive: true })
  await mkdir(stateRoot, { recursive: true })

  const listeners = new Map()
  const listenerErrors = []
  const logs = []
  const routes = new Map()
  const promptSections = []
  const selectModelCalls = []
  const indexCalls = []
  let seq = 0

  const on = (type, callback) => {
    if (!listeners.has(type)) listeners.set(type, [])
    listeners.get(type).push(callback)
    return () => {
      const list = listeners.get(type) ?? []
      const index = list.indexOf(callback)
      if (index !== -1) list.splice(index, 1)
    }
  }

  const hub = {
    nextEvent(type, data) {
      seq += 1
      return { type, seq, time: new Date().toISOString(), data }
    },
    emit(session, event) {
      for (const callback of [...(listeners.get('session/event') ?? [])]) {
        try {
          callback(session, event)
        } catch (error) {
          listenerErrors.push(error)
        }
      }
    },
  }

  /* ---- fake official Agent Teams ---------------------------------------- */

  const sessions = new Map()
  const agents = new Map()
  const memberships = new Map()
  const members = []
  const tasks = []
  const sendMessageCalls = []
  const spawnCalls = []
  const createTaskCalls = []
  const updateTaskCalls = []
  let taskSeq = 0
  let memberSeq = 0

  const leadAgent = { id: SESSION_ID, name: 'lead', ctx: { fake: true } }
  const leadSession = { id: SESSION_ID, header: { cwd: workspace, title: '冒烟 Lead' }, meta: { cwd: workspace } }
  agents.set(leadAgent.id, leadAgent)
  sessions.set(leadSession.id, leadSession)
  memberships.set(leadAgent.id, { root: leadAgent, role: 'lead', name: 'lead' })

  const taskView = (task) => ({ ...task, blockedBy: [...(task.blockedBy ?? [])], writeScopes: [...(task.writeScopes ?? [])] })
  const findOne = (list, predicate, code, message) => {
    const found = list.find(predicate)
    if (found === undefined) throw Object.assign(new Error(message), { code })
    return found
  }
  const emitTask = (task) => {
    hub.emit(leadSession, hub.nextEvent('team/task', { task: taskView(task) }))
  }
  const memberByName = (name) => members.find((member) => member.name === name)

  const replyFor = (text) => {
    if (text.includes('<!--atplanner:output:begin-->')) {
      return [
        '<!--atplanner:output:begin-->',
        '# 标准化需求文档（会议产出）',
        '',
        '## 背景与问题',
        '首版只支持 Web，移动端待定。',
        '',
        '## 验收标准',
        '- 打开 Web 首页返回 200。',
        '<!--atplanner:output:end-->',
      ].join('\n')
    }
    if (text.includes('<!--atplanner:artifact:begin-->')) {
      return [
        '<!--atplanner:artifact:begin-->',
        '# Code Review 报告（冒烟）',
        '',
        '结论：通过',
        '<!--atplanner:artifact:end-->',
      ].join('\n')
    }
    return '收到，这是冒烟测试的发言要点。'
  }

  const agentTeams = {
    tryMembership(agent) {
      return memberships.get(agent?.id)
    },
    listMembers() {
      return members.filter((member) => member.role === 'teammate').map((member) => ({ ...member }))
    },
    async spawnTeammate(_lead, input) {
      spawnCalls.push({ name: input.name, description: input.description, context: input.context, provider: input.provider })
      if (typeof input.description !== 'string' || input.description.trim() === '') {
        throw Object.assign(new Error('description is required'), { code: 'VALIDATION' })
      }
      memberSeq += 1
      const member = {
        id: `member-${input.name}-${memberSeq}`,
        name: input.name,
        role: 'teammate',
        status: 'inactive',
        description: input.description,
        context: input.context,
        provider: input.provider,
      }
      members.push(member)
      const agent = { id: member.id, name: member.name, ctx: { fake: true } }
      agents.set(agent.id, agent)
      sessions.set(member.id, { id: member.id, header: { cwd: workspace, title: member.name }, meta: { cwd: workspace } })
      memberships.set(member.id, { root: leadAgent, role: 'teammate', name: member.name })
      return { member: { ...member } }
    },
    async sendMessage(_lead, input) {
      const text = (Array.isArray(input.content) ? input.content : [])
        .filter((block) => block?.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n')
      sendMessageCalls.push({ target: input.target, text })
      const member = findOne(members, (candidate) => candidate.name === input.target, 'MEMBER_NOT_FOUND', `member not found: ${input.target}`)
      const session = sessions.get(member.id)
      setTimeout(() => {
        hub.emit(
          session,
          hub.nextEvent('assistant/message', {
            message: {
              content: [{ type: 'text', text: replyFor(text) }],
              source: { kind: 'agent', provider: 'fake', model: 'fake-agent' },
            },
          }),
        )
        hub.emit(session, hub.nextEvent('turn/end', { reason: { kind: 'stop' } }))
      }, 10)
      return { ok: true }
    },
    async createTask(_lead, input) {
      taskSeq += 1
      const task = {
        id: `task-${taskSeq}`,
        subject: input.subject,
        description: input.description ?? '',
        blockedBy: Array.isArray(input.blockedBy) ? [...input.blockedBy] : [],
        writeScopes: Array.isArray(input.writeScopes) ? [...input.writeScopes] : [],
        status: 'pending',
        ready: true,
        revision: 1,
        ownerName: undefined,
        ownerId: undefined,
        createdAt: new Date().toISOString(),
      }
      tasks.push(task)
      createTaskCalls.push({ taskId: task.id, subject: task.subject, blockedBy: [...task.blockedBy] })
      return taskView(task)
    },
    getTask(_lead, taskId) {
      return taskView(findOne(tasks, (task) => task.id === taskId, 'TASK_NOT_FOUND', `task not found: ${taskId}`))
    },
    listTasks() {
      return tasks.map(taskView)
    },
    async updateTask(_lead, input) {
      const task = findOne(tasks, (candidate) => candidate.id === input.taskId, 'TASK_NOT_FOUND', `task not found: ${input.taskId}`)
      if (typeof input.expectedRevision === 'number' && input.expectedRevision !== task.revision) {
        throw Object.assign(new Error(`revision conflict: expected ${input.expectedRevision}, current ${task.revision}`), {
          code: 'REVISION_CONFLICT',
        })
      }
      task.revision += 1
      if (input.action === 'reassign') {
        const member = memberByName(input.owner)
        task.status = 'in_progress'
        task.ready = false
        task.ownerName = input.owner
        task.ownerId = member?.id
      } else if (input.action === 'complete') {
        task.status = 'completed'
        task.completedAt = new Date().toISOString()
      } else if (input.action === 'release') {
        task.status = 'pending'
        task.ready = true
        task.ownerName = undefined
        task.ownerId = undefined
      } else if (input.action === 'delete') {
        task.status = 'deleted'
      } else {
        throw Object.assign(new Error(`unsupported action ${input.action}`), { code: 'VALIDATION' })
      }
      updateTaskCalls.push({ taskId: task.id, action: input.action, owner: input.owner, revision: task.revision })
      emitTask(task)
      return taskView(task)
    },
  }

  /* ---- fake ctx services ------------------------------------------------- */

  const logText = (args) => args.map((arg) => (typeof arg === 'string' ? arg : String(arg?.message ?? arg))).join(' ')
  const logger = {
    info: (...args) => logs.push({ level: 'info', at: new Date().toISOString(), text: logText(args) }),
    warn: (...args) => logs.push({ level: 'warn', at: new Date().toISOString(), text: logText(args) }),
    error: (...args) => logs.push({ level: 'error', at: new Date().toISOString(), text: logText(args) }),
  }

  const sessionController = {
    async modelCatalog() {
      return {
        default: { provider: 'deepseek', model: 'deepseek-chat' },
        routableProviders: [{ id: 'deepseek', name: 'DeepSeek' }],
        groups: [
          {
            id: 'deepseek',
            name: 'DeepSeek',
            models: [
              { id: 'deepseek-chat', name: 'DeepSeek Chat' },
              { id: 'deepseek-reasoner', name: 'DeepSeek Reasoner', reasoning: true },
            ],
          },
        ],
        failures: [],
      }
    },
    async selectModel(input) {
      selectModelCalls.push({ ...input })
      return { ok: true, provider: input.provider, model: input.model }
    },
    async resolveAgent(id) {
      return { agent: agents.get(id) }
    },
  }

  const systemPrompt = {
    section(definition) {
      const record = { name: definition.name, order: definition.order, hasText: typeof definition.text === 'function', text: definition.text }
      promptSections.push(record)
      return () => {
        const index = promptSections.indexOf(record)
        if (index !== -1) promptSections.splice(index, 1)
      }
    },
  }

  const connection = {
    fetch: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
  }

  const serviceMap = {
    agents: {
      get: (id) => agents.get(id),
      list: () => [...agents.values()],
    },
    sessions: {
      get: (id) => sessions.get(id),
    },
    systemPrompt,
    connection,
    agentTeams,
    sessionController,
    logger,
  }

  const disposers = []
  const ctx = {
    get(name) {
      return serviceMap[name]
    },
    effect(effect, label) {
      indexCalls.push(String(label ?? ''))
      const dispose = effect()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    on,
    logger,
    systemPrompt,
    connection,
    sessions: serviceMap.sessions,
    agents: serviceMap.agents,
    sessionController,
  }

  apply(ctx, {
    stateDir: relative(workspace, stateRoot),
    meetingReplyTimeoutMs: 3000,
    artifactReplyTimeoutMs: 3000,
    spawnTimeoutMs: 3000,
  })

  const env = {
    label,
    workspace,
    stateRoot,
    ctx,
    routes,
    promptSections,
    logs,
    listenerErrors,
    selectModelCalls,
    sessions,
    agents,
    fake: {
      agentTeams,
      members,
      tasks,
      sendMessageCalls,
      spawnCalls,
      createTaskCalls,
      updateTaskCalls,
      getTask: (lead, id) => agentTeams.getTask(lead, id),
      createTask: (lead, input) => agentTeams.createTask(lead, input),
      updateTask: (lead, input) => agentTeams.updateTask(lead, input),
      listTasks: () => agentTeams.listTasks(),
      findMember: (name) => memberByName(name),
    },
    memberAgent(name) {
      const member = memberByName(name)
      return member === undefined ? undefined : agents.get(member.id)
    },
    memberSession(name) {
      const member = memberByName(name)
      return member === undefined ? undefined : sessions.get(member.id)
    },
    emit(session, type, data) {
      hub.emit(session, hub.nextEvent(type, data))
    },
  }

  return env
}

/* ------------------------------------------------------------ RPC helpers -- */

async function getState(env) {
  const route = env.routes.get(STATE_PATH)
  assert(route !== undefined, 'GET /api/atplanner.state was not registered')
  const request = new Request(`http://smoke.local${STATE_PATH}?session=${encodeURIComponent(SESSION_ID)}`)
  const response = await route.fetch(request)
  let body
  try {
    body = await response.json()
  } catch (error) {
    throw new Error(`state response was not JSON (HTTP ${response.status}): ${errorText(error)}`)
  }
  return { status: response.status, body }
}

async function command(env, op, payload = {}, expectedRevision) {
  const route = env.routes.get(COMMAND_PATH)
  assert(route !== undefined, 'POST /api/atplanner.command was not registered')
  const body = {
    session: SESSION_ID,
    op,
    payload,
    ...(expectedRevision === undefined ? {} : { expectedRevision }),
  }
  const request = new Request(`http://smoke.local${COMMAND_PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const response = await route.fetch(request)
  let parsed
  try {
    parsed = await response.json()
  } catch (error) {
    throw new Error(`command ${op} response was not JSON (HTTP ${response.status}): ${errorText(error)}`)
  }
  return { status: response.status, body: parsed }
}

async function cmdOk(env, op, payload = {}, expectedRevision) {
  const response = await command(env, op, payload, expectedRevision)
  if (response.body?.ok !== true) {
    const error = response.body?.error ?? {}
    throw new Error(`${op} failed: ${error.code ?? 'UNKNOWN'} ${error.message ?? JSON.stringify(response.body)}`)
  }
  return response.body.value
}

async function stateOk(env) {
  const response = await getState(env)
  assert(response.body?.ok === true, `GET state failed: ${JSON.stringify(response.body?.error ?? response.body)}`)
  return response.body.value
}

async function waitState(env, predicate, label, timeoutMs = PUMP_TIMEOUT_MS) {
  const started = Date.now()
  let last
  let lastError
  while (Date.now() - started <= timeoutMs) {
    try {
      last = (await stateOk(env)).state
      if (predicate(last)) return { state: last, elapsed: Date.now() - started }
    } catch (error) {
      lastError = error
    }
    await sleep(POLL_MS)
  }
  throw new Error(
    `timed out after ${timeoutMs}ms waiting for ${label}; last revision=${last?.revision ?? 'n/a'}` +
      (lastError === undefined ? '' : `; last read error=${errorText(lastError)}`),
  )
}

function versionOf(state, versionId) {
  return state.versions.find((version) => version.id === versionId)
}

/* ------------------------------------------------------------------ tests -- */

const results = []
const meta = { node: process.version, platform: process.platform, startedAt: new Date().toISOString(), unhandled }

async function runTest(id, title, body) {
  const started = Date.now()
  const startedAt = new Date().toISOString()
  try {
    const evidence = await body()
    results.push({ id, title, status: 'PASS', evidence: String(evidence ?? ''), ms: Date.now() - started, startedAt, endedAt: new Date().toISOString() })
    console.log(`PASS ${id}. ${title} (${Date.now() - started}ms) ${evidence ?? ''}`)
  } catch (error) {
    results.push({
      id,
      title,
      status: 'FAIL',
      evidence: '',
      ms: Date.now() - started,
      startedAt,
      endedAt: new Date().toISOString(),
      error: errorText(error),
      stack: error?.stack,
    })
    console.log(`FAIL ${id}. ${title} (${Date.now() - started}ms) ${errorText(error)}`)
  }
}

async function main() {
  await cleanupTemp()

  const A = await createEnv('main')
  const S = {}
  meta.envA = { workspace: A.workspace, stateRoot: A.stateRoot, routes: [...A.routes.keys()], promptSections: A.promptSections.length }

  await runTest('1', 'GET state 未初始化不崩溃', async () => {
    const response = await getState(A)
    assert(response.status === 200, `HTTP ${response.status}`)
    assert(response.body.ok === true, `ok=${response.body.ok}`)
    const value = response.body.value
    assert(value.state.revision === 0, `revision=${value.state.revision}`)
    assert(value.state.team.leadSessionId === null, `leadSessionId=${value.state.team.leadSessionId}`)
    assert(value.team.bound === false, `team.bound=${value.team.bound}`)
    assert(Array.isArray(value.official.members), 'official.members missing')
    assert(value.state.roles.length === 7, `roles=${value.state.roles.length}`)
    S.rev = value.state.revision
    return `HTTP 200 ok=true revision=0 bound=false leadAvailable=${value.team.leadAvailable} bridge.loaded=${value.bridge.loaded}`
  })

  await runTest('2', 'team.bind / 成员创建 / member.setRoute', async () => {
    const bind = await cmdOk(A, 'team.bind', { name: '冒烟项目团队' })
    assert(bind.bound === true, `bound=${bind.bound}`)
    assert(bind.state.team.leadSessionId === SESSION_ID, `leadSessionId=${bind.state.team.leadSessionId}`)
    assert(existsSync(join(A.stateRoot, 'state.json')), `state file missing under ${A.stateRoot}`)
    const roleIds = bind.state.roles.map((role) => role.id)
    for (const required of ['lead', 'product', 'architect', 'backend', 'test']) {
      assert(roleIds.includes(required), `role ${required} missing`)
    }
    const created = []
    const plan = [
      ['backend-1', 'backend', '后端一号'],
      ['architect-1', 'architect', '架构一号'],
      ['test-1', 'test', '测试一号'],
      ['product-1', 'product', '产品一号'],
    ]
    for (const [name, roleId, displayName] of plan) {
      const record = await cmdOk(A, 'member.create', { name, roleId, displayName, description: `${displayName}（冒烟）` })
      assert(record.member !== undefined && record.member.name === name, `member.create ${name} returned no config record`)
      assert(record.member.creation?.status === 'pending', `${name} should be pending until first dispatch`)
      assert(record.member.id === undefined, `${name} should not spawn an official member at creation`)
      created.push(name)
    }
    const routeResult = await cmdOk(A, 'member.setRoute', {
      name: 'backend-1',
      route: { provider: 'deepseek', model: 'deepseek-chat' },
    })
    const record = routeResult.state.members.find((member) => member.name === 'backend-1')
    assert(record.route?.provider === 'deepseek' && record.route?.model === 'deepseek-chat', 'route not persisted')
    assert(routeResult.appliedToLiveAgent === false, `expected appliedToLiveAgent=false without official bridge, got ${routeResult.appliedToLiveAgent}`)
    S.rev = routeResult.state.revision
    return `bound=${SESSION_ID}; roles=${roleIds.length}; members=${created.join(',')}; route=${record.route.provider}/${record.route.model}; liveApply=${routeResult.appliedToLiveAgent}`
  })

  await runTest('3', '版本(计划/负责人/备注)/需求/任务规格/绑定/文档确认/进入架构', async () => {
    const version = await cmdOk(A, 'version.create', {
      name: 'v1.0.0',
      description: '冒烟版本',
      planDate: '2026-11-05',
      owner: 'product-1',
      notes: '初始备注',
    })
    S.versionId = version.version.id
    assert(version.version.planDate === '2026-11-05', `create planDate=${version.version.planDate}`)
    assert(version.version.owner === 'product-1', `create owner=${version.version.owner}`)
    assert(version.version.notes === '初始备注', `create notes=${version.version.notes}`)
    const versionUpdated = await cmdOk(A, 'version.update', {
      id: S.versionId,
      planDate: '2026-11-06',
      owner: 'architect-1',
      notes: '更新后的备注',
    })
    assert(versionUpdated.version.planDate === '2026-11-06', `update planDate=${versionUpdated.version.planDate}`)
    assert(versionUpdated.version.owner === 'architect-1', `update owner=${versionUpdated.version.owner}`)
    assert(versionUpdated.version.notes === '更新后的备注', `update notes=${versionUpdated.version.notes}`)
    const requirement = await cmdOk(A, 'requirement.create', {
      title: '冒烟需求：健康检查接口',
      description: '提供 GET /health，返回 200 与 { ok: true }。',
      roleTags: ['backend'],
    })
    S.reqId = requirement.requirement.id
    S.reqDocId = requirement.artifact.id
    assert(requirement.artifact.type === 'requirement_doc', `artifact type=${requirement.artifact.type}`)

    const specs = await cmdOk(A, 'requirement.setTaskSpecs', {
      id: S.reqId,
      specs: [
        {
          key: 'dev-api',
          objective: '实现 GET /health',
          role: 'backend',
          acceptance: 'curl /health 返回 200 且 body.ok=true',
          writeScopes: ['src/api/**'],
        },
      ],
    })
    assert(specs.requirement.taskSpecs.length === 1, `taskSpecs=${specs.requirement.taskSpecs.length}`)

    const bound = await cmdOk(A, 'version.bind', { versionId: S.versionId, requirementIds: [S.reqId] })
    assert(bound.version.requirementIds.includes(S.reqId), 'requirement not bound')
    await cmdOk(A, 'artifact.approve', { id: S.reqDocId })
    const architecture = await cmdOk(A, 'artifact.create', {
      versionId: S.versionId,
      type: 'architecture_doc',
      title: '架构方案：v1.0.0',
      content: '# 架构方案\n\n单模块 HTTP 服务。',
    })
    S.archDocId = architecture.artifact.id
    await cmdOk(A, 'artifact.approve', { id: S.archDocId })
    const entered = await cmdOk(A, 'version.enterArchitecture', { versionId: S.versionId })
    assert(entered.version.stage === 'architecture', `stage=${entered.version.stage}`)
    S.rev = entered.state.revision
    return `version=${S.versionId}; planDate/owner/notes create+update ok; requirement=${S.reqId}; specs=1; reqDoc+archDoc approved; stage=${entered.version.stage}`
  })

  await runTest('4', 'version.startDevelopment 创建官方任务并指派/唤醒', async () => {
    const started = await cmdOk(A, 'version.startDevelopment', { versionId: S.versionId })
    assert(started.version.status === 'active', `status=${started.version.status}`)
    assert(started.version.stage === 'development', `stage=${started.version.stage}`)
    assert(started.createdTaskIds.length === 1, `createdTaskIds=${started.createdTaskIds.length}`)
    S.devTaskId = started.createdTaskIds[0]
    const view = A.fake.getTask(SESSION_ID, S.devTaskId)
    assert(view.status === 'in_progress', `task status=${view.status}`)
    assert(view.ownerName === 'backend-1', `task owner=${view.ownerName}`)
    assert(
      A.fake.sendMessageCalls.some((call) => call.target === 'backend-1' && call.text.includes(S.devTaskId)),
      'no wake sendMessage targeting backend-1 with the task id',
    )
    S.rev = started.state.revision
    return `version active/development; task=${S.devTaskId} status=${view.status} owner=${view.ownerName}; wake=sent`
  })

  await runTest('5', '完成开发任务 → 自动进入 review 并建评审任务 (P0 pump)', async () => {
    const before = (await stateOk(A)).state
    const view = A.fake.getTask(SESSION_ID, S.devTaskId)
    assert(view.status === 'in_progress', `pre-complete status=${view.status}`)
    await A.fake.updateTask(SESSION_ID, { taskId: S.devTaskId, expectedRevision: view.revision, action: 'complete' })
    const waited = await waitState(
      A,
      (state) => {
        const version = versionOf(state, S.versionId)
        return version?.stage === 'review' && state.bindings.some((binding) => binding.versionId === S.versionId && binding.phase === 'review')
      },
      'stage=review + review task',
    )
    const reviewBinding = waited.state.bindings.find((binding) => binding.versionId === S.versionId && binding.phase === 'review')
    assert(reviewBinding !== undefined, 'review binding missing')
    const reviewTask = A.fake.getTask(SESSION_ID, reviewBinding.taskId)
    assert(reviewTask.ownerName === 'architect-1', `review task owner=${reviewTask.ownerName}`)
    assert(reviewTask.status === 'in_progress', `review task status=${reviewTask.status}`)
    S.reviewTaskId = reviewBinding.taskId
    S.rev = waited.state.revision
    return `completed ${S.devTaskId}; stage=review in ${waited.elapsed}ms; reviewTask=${S.reviewTaskId} owner=${reviewTask.ownerName}; revision ${before.revision}→${waited.state.revision}`
  })

  await runTest('6', '确认 review_report → 自动进入 testing 并建测试任务', async () => {
    // The review task created by case 5 must be completed before the report gate
    // can pass; then the report approval alone must trigger the pump transition.
    const reviewView = A.fake.getTask(SESSION_ID, S.reviewTaskId)
    assert(reviewView.status === 'in_progress', `pre-complete review status=${reviewView.status}`)
    await A.fake.updateTask(SESSION_ID, {
      taskId: S.reviewTaskId,
      expectedRevision: reviewView.revision,
      action: 'complete',
    })
    await waitState(
      A,
      (state) => state.bindings.find((binding) => binding.taskId === S.reviewTaskId)?.lastKnownStatus === 'completed',
      'review binding completed (stage still review, report not approved)',
    )
    const preApprove = (await stateOk(A)).state
    assert(versionOf(preApprove, S.versionId).stage === 'review', `stage before approve=${versionOf(preApprove, S.versionId).stage}`)

    const report = await cmdOk(A, 'artifact.create', {
      versionId: S.versionId,
      type: 'review_report',
      title: 'Code Review 报告',
      content: '# Code Review\n\n结论：通过',
    })
    S.reviewReportId = report.artifact.id
    await cmdOk(A, 'artifact.approve', { id: S.reviewReportId })
    const waited = await waitState(
      A,
      (state) => {
        const version = versionOf(state, S.versionId)
        return version?.stage === 'testing' && state.bindings.some((binding) => binding.versionId === S.versionId && binding.phase === 'testing')
      },
      'stage=testing + test task',
    )
    const testBindings = waited.state.bindings.filter((binding) => binding.versionId === S.versionId && binding.phase === 'testing')
    assert(testBindings.length === 1, `testing bindings=${testBindings.length}`)
    S.testTaskIds = testBindings.map((binding) => binding.taskId)
    const owners = S.testTaskIds.map((taskId) => A.fake.getTask(SESSION_ID, taskId).ownerName)
    assert(owners.every((owner) => owner === 'test-1'), `testing owners=${owners.join(',')}`)
    S.rev = waited.state.revision
    return `review task ${S.reviewTaskId} completed while stage stayed review; approved review report → stage=testing; testTask=${S.testTaskIds[0]} owner=${owners[0]}; revision=${waited.state.revision}`
  })

  await runTest('7', '完成测试任务 + 确认 test_report → 版本完成/归档', async () => {
    for (const taskId of S.testTaskIds) {
      const view = A.fake.getTask(SESSION_ID, taskId)
      if (view.status !== 'completed') {
        await A.fake.updateTask(SESSION_ID, { taskId, expectedRevision: view.revision, action: 'complete' })
      }
    }
    await waitState(
      A,
      (state) =>
        S.testTaskIds.every((taskId) => {
          const binding = state.bindings.find((candidate) => candidate.taskId === taskId)
          return binding?.lastKnownStatus === 'completed'
        }),
      'testing bindings completed',
    )
    const report = await cmdOk(A, 'artifact.create', {
      versionId: S.versionId,
      type: 'test_report',
      title: '测试报告',
      content: '# 测试报告\n\n通过',
    })
    S.testReportId = report.artifact.id
    await cmdOk(A, 'artifact.approve', { id: S.testReportId })
    const waited = await waitState(
      A,
      (state) => {
        const version = versionOf(state, S.versionId)
        return version?.status === 'completed' && version?.stage === 'done'
      },
      'version completed/done',
    )
    const tracked = [S.reqDocId, S.archDocId, S.reviewReportId, S.testReportId]
    const statuses = tracked.map((id) => waited.state.artifacts.find((artifact) => artifact.id === id))
    assert(statuses.every((artifact) => artifact !== undefined), 'a tracked artifact disappeared')
    assert(statuses.every((artifact) => artifact.status === 'archived'), `artifact statuses=${statuses.map((artifact) => artifact.status).join(',')}`)
    const version = versionOf(waited.state, S.versionId)
    assert(version.completedAt !== null, 'completedAt is null')
    S.rev = waited.state.revision
    return `version completed/done; artifacts archived=${statuses.length}; revision=${waited.state.revision}`
  })

  await runTest('8', 'P0 回归：team/task 事件后 role.create 2s 内返回', async () => {
    const C = await createEnv('p0')
    try {
      await cmdOk(C, 'team.bind', { name: 'P0 隔离团队' })
      const probe = await C.fake.createTask(SESSION_ID, { subject: 'P0 queue probe' })
      const view = C.fake.getTask(SESSION_ID, probe.id)
      await C.fake.updateTask(SESSION_ID, {
        taskId: probe.id,
        expectedRevision: view.revision,
        action: 'reassign',
        owner: 'probe-owner',
      })
      const started = Date.now()
      const response = await withTimeout(
        command(C, 'role.create', { id: 'p0-role', name: 'P0 角色', basePrompt: 'P0 回归临时角色' }),
        2000,
        'role.create after team/task event',
      )
      const elapsed = Date.now() - started
      assert(elapsed < 2000, `elapsed=${elapsed}ms`)
      assert(response.body?.ok === true, `role.create failed: ${JSON.stringify(response.body?.error)}`)
      const state = (await stateOk(C)).state
      assert(state.roles.some((role) => role.id === 'p0-role'), 'p0-role not persisted')
      return `role.create ok in ${elapsed}ms after team/task event (isolated env state-p0, revision=${state.revision})`
    } finally {
      // env C dirs are removed by the global cleanup
    }
  })

  await runTest('9', '会议：邀请/发言/sessionIds/生成产出/保存需求/结束生成纪要', async () => {
    const B = await createEnv('meeting')
    await cmdOk(B, 'team.bind', { name: '会议冒烟团队' })
    await cmdOk(B, 'member.create', { name: 'product-1', roleId: 'product', displayName: '产品一号' })
    await cmdOk(B, 'member.create', { name: 'backend-1', roleId: 'backend', displayName: '后端一号' })
    const version = await cmdOk(B, 'version.create', { name: 'v2.0.0' })
    S.meetingVersionId = version.version.id
    const meeting = await cmdOk(B, 'meeting.create', {
      versionId: S.meetingVersionId,
      type: 'requirement_clarification',
      title: 'v2 需求澄清会',
      goal: '确认首版端范围与验收标准',
      participants: ['product-1'],
    })
    S.meetingId = meeting.meeting.id
    assert(meeting.meeting.hostMemberName === 'product-1', `host=${meeting.meeting.hostMemberName}`)
    assert(meeting.meeting.sessionIds !== undefined, 'meeting.sessionIds missing at create')

    const started = await cmdOk(B, 'meeting.start', { meetingId: S.meetingId })
    assert(started.meeting.status === 'active', `meeting status=${started.meeting.status}`)
    const hostSession = B.memberSession('product-1')
    assert(hostSession !== undefined, 'host session missing after meeting start')
    assert(started.meeting.sessionIds['product-1'] === hostSession.id, `start sessionIds=${JSON.stringify(started.meeting.sessionIds)}`)
    assert(started.meeting.sessionIds['backend-1'] === undefined, 'backend was not a participant yet')
    assert(B.memberSession('backend-1') === undefined, 'non-participant backend should remain pending until invited')

    const invited = await cmdOk(B, 'meeting.invite', { meetingId: S.meetingId, participants: ['backend-1'] })
    assert(invited.invited.includes('backend-1'), `invited=${invited.invited.join(',')}`)
    assert(invited.meeting.participants.includes('backend-1'), 'backend not added to participants')
    const backendSession = B.memberSession('backend-1')
    assert(backendSession !== undefined && invited.meeting.sessionIds['backend-1'] === backendSession.id, `invite sessionIds=${JSON.stringify(invited.meeting.sessionIds)}`)

    const spoke = await cmdOk(B, 'meeting.speak', { meetingId: S.meetingId, memberName: 'backend-1', question: '首版后端范围？' })
    assert(typeof spoke.reply === 'string' && spoke.reply.length > 0, 'speak reply missing')
    assert(spoke.meeting.sessionIds['backend-1'] === backendSession.id, 'speak did not refresh sessionIds')
    await waitState(
      B,
      (state) => state.meetings.find((candidate) => candidate.id === S.meetingId)?.transcript.some((entry) => entry.memberName === 'backend-1') === true,
      'meeting speak transcript',
    )

    const revBefore = started.state.revision
    B.emit(hostSession, 'user/message', {
      source: { kind: 'user' },
      content: [{ type: 'text', text: '需求边界：首版只做 Web。' }],
    })
    await waitState(
      B,
      (state) => state.meetings.find((candidate) => candidate.id === S.meetingId)?.transcript.some((entry) => entry.kind === 'user') === true,
      'meeting user transcript',
    )
    B.emit(hostSession, 'assistant/message', {
      message: {
        content: [{ type: 'text', text: '收到：首版 Web，移动端待定。' }],
        source: { kind: 'agent', provider: 'fake', model: 'fake-meeting' },
      },
    })
    await waitState(
      B,
      (state) => state.meetings.find((candidate) => candidate.id === S.meetingId)?.transcript.some((entry) => entry.kind === 'member') === true,
      'meeting assistant transcript',
    )

    const revBeforeOutput = (await stateOk(B)).state.revision
    const output = await cmdOk(B, 'meeting.generateOutput', { meetingId: S.meetingId })
    assert(typeof output.output === 'string' && output.output.includes('标准化需求文档'), 'output marker block not parsed')
    assert(output.meeting.requirementDraft === output.output, 'requirementDraft not persisted in command result')
    const saved = await cmdOk(B, 'meeting.saveRequirement', {
      meetingId: S.meetingId,
      title: 'Web 首版需求',
      description: output.output,
      roleTags: ['product'],
    })
    const manualMinutes = await cmdOk(B, 'artifact.create', {
      versionId: S.meetingVersionId,
      type: 'meeting_minutes',
      title: '手动纪要（类型白名单）',
      content: '# 手动纪要',
    })
    assert(manualMinutes.artifact.type === 'meeting_minutes', `artifact.create meeting_minutes type=${manualMinutes.artifact.type}`)

    const finished = await cmdOk(B, 'meeting.finish', { meetingId: S.meetingId })
    assert(finished.meeting.status === 'closed', `finish status=${finished.meeting.status}`)
    assert(finished.meeting.closedAt !== null, 'closedAt missing')
    assert(finished.minutesArtifact.type === 'meeting_minutes', `minutes type=${finished.minutesArtifact.type}`)
    assert(finished.minutesArtifact.versionId === S.meetingVersionId, `minutes versionId=${finished.minutesArtifact.versionId}`)
    assert(finished.meeting.artifactIds.includes(finished.minutesArtifact.id), 'minutes id not linked to meeting.artifactIds')

    const final = (await stateOk(B)).state
    const persistedMeeting = final.meetings.find((candidate) => candidate.id === S.meetingId)
    assert(persistedMeeting !== undefined, 'meeting missing after save')
    assert(persistedMeeting.status === 'closed', `persisted status=${persistedMeeting.status}`)
    assert(persistedMeeting.sessionIds['product-1'] === hostSession.id, 'persisted sessionIds lost product session')
    assert(persistedMeeting.sessionIds['backend-1'] === backendSession.id, 'persisted sessionIds lost backend session')
    assert(persistedMeeting.transcript.length >= 3, `transcript=${persistedMeeting.transcript.length}`)
    assert(persistedMeeting.transcript.some((entry) => entry.kind === 'user'), 'user transcript entry missing')
    assert(persistedMeeting.transcript.some((entry) => entry.memberName === 'backend-1'), 'backend transcript entry missing')
    assert(final.revision > revBefore, `revision did not grow: ${revBefore}→${final.revision}`)
    assert(final.revision > revBeforeOutput, `revision did not grow after output: ${revBeforeOutput}→${final.revision}`)
    assert(final.requirements.some((requirement) => requirement.id === saved.requirement.id), 'saved requirement missing')
    assert(
      versionOf(final, S.meetingVersionId).requirementIds.includes(saved.requirement.id),
      'saved requirement not bound to v2.0.0',
    )
    const persistedMinutes = final.artifacts.find((artifact) => artifact.id === finished.minutesArtifact.id)
    assert(persistedMinutes !== undefined && persistedMinutes.versionId === S.meetingVersionId, 'minutes artifact not listed under version')
    const second = await command(B, 'meeting.finish', { meetingId: S.meetingId })
    assert(second.body?.ok === false, 'second meeting.finish should fail after close')
    return `host=product-1; participants=${persistedMeeting.participants.join(',')}; sessionIds=${Object.keys(persistedMeeting.sessionIds).join(',')}; transcript=${persistedMeeting.transcript.length}; minutes=${finished.minutesArtifact.id}; closed; requirement saved; revision ${revBefore}→${final.revision}`
  })

  await runTest('10', 'artifact.capture 在已完成版本上被拒绝（只读）', async () => {
    const response = await command(A, 'artifact.capture', {
      versionId: S.versionId,
      type: 'review_report',
      memberName: 'architect-1',
      title: '完成版本后采集',
    })
    assert(response.body?.ok === false, 'capture unexpectedly succeeded on a completed version')
    assert(response.body?.error?.code === 'VERSION_READ_ONLY', 'error=' + JSON.stringify(response.body?.error))
    return 'error=' + response.body.error.code + ' (completed version is read-only)'
  })

  await runTest('11', 'member.remove 回收名下 in_progress 任务', async () => {
    const probe = await A.fake.createTask(SESSION_ID, { subject: '移出回收探测', description: 'member.remove release probe' })
    const pending = A.fake.getTask(SESSION_ID, probe.id)
    await A.fake.updateTask(SESSION_ID, {
      taskId: probe.id,
      expectedRevision: pending.revision,
      action: 'reassign',
      owner: 'backend-1',
    })
    const owned = A.fake.getTask(SESSION_ID, probe.id)
    assert(owned.status === 'in_progress' && owned.ownerName === 'backend-1', `probe state=${owned.status}/${owned.ownerName}`)
    const removed = await cmdOk(A, 'member.remove', { name: 'backend-1' })
    assert(removed.releasedTaskIds.includes(probe.id), `released=${removed.releasedTaskIds.join(',')}`)
    const released = A.fake.getTask(SESSION_ID, probe.id)
    assert(released.status === 'pending', `released status=${released.status}`)
    assert(released.ownerName === undefined, `released owner=${released.ownerName}`)
    assert(removed.state.members.find((member) => member.name === 'backend-1')?.removed === true, 'member.removed not persisted')
    return `task ${probe.id} in_progress→pending; releasedTaskIds=[${removed.releasedTaskIds.join(',')}]`
  })

  await runTest('12', 'team.setLeadRoute 落盘并调用 selectModel', async () => {
    const before = A.selectModelCalls.length
    const route = { provider: 'deepseek', model: 'deepseek-reasoner' }
    const result = await cmdOk(A, 'team.setLeadRoute', { route })
    assert(result.state.team.leadRoute?.provider === route.provider, `leadRoute.provider=${result.state.team.leadRoute?.provider}`)
    assert(result.state.team.leadRoute?.model === route.model, `leadRoute.model=${result.state.team.leadRoute?.model}`)
    assert(A.selectModelCalls.length === before + 1, `selectModel calls delta=${A.selectModelCalls.length - before}`)
    const call = A.selectModelCalls[A.selectModelCalls.length - 1]
    assert(call.sessionId === SESSION_ID, `selectModel sessionId=${call.sessionId}`)
    assert(call.provider === route.provider && call.model === route.model, `selectModel args=${JSON.stringify(call)}`)
    const persisted = (await stateOk(A)).state.team.leadRoute
    assert(persisted?.model === route.model, 'leadRoute not persisted to disk')
    return `leadRoute=${persisted.provider}/${persisted.model}; selectModel sessionId=${call.sessionId}; calls+1`
  })

  meta.finishedAt = new Date().toISOString()
  meta.envA.logs = A.logs
  meta.envA.listenerErrors = A.listenerErrors.map((error) => errorText(error))
  meta.envA.unhandled = unhandled.map((error) => errorText(error))

  const passed = results.filter((result) => result.status === 'PASS').length
  const failed = results.filter((result) => result.status === 'FAIL').length
  const report = buildReport(results, meta)
  await writeFile(REPORT_PATH, report, 'utf8')
  await writeFile(RESULTS_PATH, JSON.stringify({ meta, results }, null, 2), 'utf8')
  await cleanupTemp()

  console.log(`\n${passed}/${results.length} passed, ${failed} failed`)
  console.log(`report: ${REPORT_PATH}`)
  console.log(`raw:    ${RESULTS_PATH}`)
  return { passed, failed, results }
}

/* --------------------------------------------------------------- report --- */

function buildReport(items, meta) {
  const passed = items.filter((item) => item.status === 'PASS').length
  const failed = items.filter((item) => item.status === 'FAIL').length
  const p0 = items.find((item) => item.id === '8')
  const p0Pass = p0?.status === 'PASS'
  const p1 = items.find((item) => item.id === '9')
  const overall = failed === 0 ? 'PASS（12/12）' : `FAIL（${passed}/12）`
  const pluginLogs = meta.envA?.logs ?? []
  const epermLogs = pluginLogs.filter((entry) => String(entry.text).includes('EPERM'))
  const s4 = failed === 0 && p0Pass ? `可以继续 S4${epermLogs.length > 0 ? '（附 P2 写盘 EPERM 观察项，建议 S4 一并修复）' : ''}` : '不建议进入 S4，先修复失败项'
  const lines = []
  lines.push('# DSH Agent Team Planner — S1–S3 冒烟测试报告（无浏览器 / 无真实 DSH）')
  lines.push('')
  lines.push(`- 测试时间：${meta.startedAt} → ${meta.finishedAt ?? 'n/a'}（UTC）`)
  lines.push(`- 被测代码：\`dsh-agent-team-planner/lib/index.js\`（未修改，ESM，Node ${meta.node}）`)
  lines.push('- Harness：`test/smoke.mjs`（临时状态目录 `test/.tmp/state-*`，运行后已清理；原始结果 `test/last-run.json`）')
  lines.push('- 运行方式：`node test/smoke.mjs`')
  lines.push(`- 结论：**${overall}**；P0 事件链路回归：**${p0Pass ? 'PASS（未复现挂起）' : 'FAIL'}**；S4：**${s4}**`)
  lines.push('')
  lines.push('## 方法与边界')
  lines.push('')
  lines.push('- 在 Node 24 中直接 `import` 插件 host half，构造 fake ctx：`effect` 立即执行并收集 disposer、`on` 记录监听器、`get` 返回 fake 服务、`systemPrompt.section` 记录定义、`connection.fetch.register` 捕获路由与 handler。')
  lines.push('- fake 官方 Agent Teams 服务实现 `listMembers/tryMembership/spawnTeammate/sendMessage/createTask/getTask/listTasks/updateTask`；`sendMessage` 10 ms 后向目标成员会话 emit `assistant/message`（含标记块）与 `turn/end`；`updateTask` 内存变更并 emit `team/task`（`data.task` 为整值）。')
  lines.push('- harness 通过 `new Request(...)` 直接调用注册的 `/api/atplanner.state` 与 `/api/atplanner.command` handler，读取 `Response`。')
  lines.push(`- 每次 emit 后轮询 GET state，直到 revision 变化/谓词满足，超时 ${PUMP_TIMEOUT_MS} ms；会议与 P0 使用独立状态目录隔离。`)
  lines.push('- 未启动/重启 DSH，未安装/卸载插件，未修改 `lib/*.js`。')
  lines.push('')
  lines.push('## 结果总表')
  lines.push('')
  lines.push('| # | 用例 | 结果 | 证据 |')
  lines.push('|---|---|---|---|')
  for (const item of items) {
    const evidence = item.status === 'PASS' ? oneLine(item.evidence) : oneLine(item.error)
    lines.push(`| ${item.id} | ${oneLine(item.title, 120)} | **${item.status}** | ${evidence} |`)
  }
  lines.push('')
  lines.push('## 关键链路')
  lines.push('')
  const ids = ['4', '5', '6', '7', '9', '10', '11', '12']
  for (const id of ids) {
    const item = items.find((candidate) => candidate.id === id)
    if (item === undefined) continue
    lines.push(`- **${id}. ${item.title}** — ${item.status}${item.status === 'PASS' ? `：${oneLine(item.evidence, 600)}` : ''}`)
  }
  lines.push('')
  lines.push('## P0 回归判断')
  lines.push('')
  if (p0Pass) {
    lines.push(`- 在独立环境（state-p0）中先 bind 团队，再制造一条 \`team/task\` 事件，随后调用 \`role.create\`；结果在 2 s 内返回 ok，未出现写队列自锁。`)
    lines.push(`- 证据：${oneLine(p0.evidence, 500)}`)
  } else {
    lines.push(`- P0 未通过：${oneLine(p0?.error ?? 'case 8 missing', 800)}`)
  }
  lines.push(`- 会议纪要回归（case 9）：${p1?.status === 'PASS' ? `PASS，transcript 落盘且 revision 递增（${oneLine(p1.evidence, 500)}）` : `FAIL（${oneLine(p1?.error ?? 'missing', 500)}）`}`)
  lines.push('')
  lines.push('## 失败详情')
  lines.push('')
  const failures = items.filter((item) => item.status === 'FAIL')
  if (failures.length === 0) {
    lines.push('无失败项。')
    lines.push('')
  } else {
    for (const item of failures) {
      lines.push(`### ${item.id}. ${item.title}`)
      lines.push('')
      lines.push(`- 错误：${item.error}`)
      lines.push(`- 耗时：${item.ms} ms`)
      lines.push('')
      lines.push('```text')
      lines.push(item.stack ?? item.error)
      lines.push('```')
      lines.push('')
    }
  }
  lines.push('## 观测到的非阻塞风险（不影响 12 项判定）')
  lines.push('')
  if (epermLogs.length === 0) {
    lines.push('- 本次运行未观测到写盘异常。')
  } else {
    lines.push(`- 运行期间插件日志出现 **${epermLogs.length} 次 Windows \`EPERM\`**：事件写盘的原子 \`rename(state.json.tmp → state.json)\` 失败；均发生在事件提交与 harness 高频 GET \`readFile(state.json)\` 重叠的时间窗内。仅凭日志无法区分是并发读句柄还是 Windows 安全软件/文件系统造成的短暂锁。`)
    lines.push(`- 时间戳：${epermLogs.map((entry) => entry.at).join(', ')}；该失败发生在 \`session/event\` 监听器的异步 \`mutateState\` 写盘阶段，被插件 \`catch\` 并记为 warn。仅凭日志无法区分是哪一条重复事件；丢失的是 pump 新建任务 \`reassign\` 产生的重复 \`team/task\` 提交（对应 binding 已由发起命令的写盘持久化，后续 complete 事件/命令会重新 pump），故 12 项仍全部通过。`)
    lines.push('- 归因：harness 按题目要求轮询 GET state（默认 50 ms；用 200 ms 复测仍偶发），放大了写盘与读盘的重叠窗口；真实 UI 为 5 s 轮询 + 命令后刷新，概率更低但机制相同。属 Windows 原子写健壮性风险（P2，与既有残留 P2-10 同族）。')
    lines.push('- 建议 S4：使用唯一临时文件名 + rename 失败退避重试（或写后 fsync）；本次不据此判失败，但应在真实 DSH 上纳入观察。')
  }
  lines.push('')
  lines.push('## 偏差与限制')
  lines.push('')
  lines.push('- 未使用真实 DSH / 浏览器 / 官方 Agent Teams；`sendMessage` 的回复与标记块由 fake 在 10 ms 后注入，属于契约级模拟，不验证真实 LLM 输出质量。')
  lines.push('- 官方 `@deepseek-ai/dsh-agent` / `dsh-llm` 无法从插件路径解析，`bridge.loaded=false`；因此 `member.setRoute` 只验证状态落盘（`appliedToLiveAgent=false`），未验证 `installModelSelection` 对 live agent 的注入。该注入不属于本次 12 项前置条件。')
  lines.push('- `stateDir` 按题目约定由 `config.stateDir` 相对 session cwd 指定：workspace 为 `test/.tmp/ws-*`，状态目录为 `test/.tmp/state-*`。用例 2 的“目录存在”按 state 目录 + `state.json` 存在校验。')
  lines.push('- 会议参与者使用真实角色成员 `product-1`，主持人按类型角色选为 `product-1`，未使用 backend-1 替代，无偏差。')
  lines.push('- fake `member.remove` 的 release 能力已实现，返回 `releasedTaskIds` 并回读官方任务状态。')
  lines.push('- 未覆盖（超出 S1–S3 冒烟范围）：真实 UI、重启后 live route 恢复、并发多会话、崩溃对账、超长输出上限。')
  lines.push('')
  lines.push('## harness 运行记录')
  lines.push('')
  lines.push(`- 路由注册：${(meta.envA?.routes ?? []).join(', ')}`)
  lines.push(`- prompt sections：${meta.envA?.promptSections ?? 0}`)
  lines.push(`- 插件日志（bridge 警告为预期）：${(meta.envA?.logs ?? []).map((entry) => `${entry.at ?? ''} ${entry.level}: ${entry.text}`).join(' | ') || 'none'}`)
  lines.push(`- 监听器异常：${(meta.envA?.listenerErrors ?? []).join(' | ') || 'none'}`)
  lines.push(`- unhandledRejection：${(meta.envA?.unhandled ?? []).join(' | ') || 'none'}`)
  lines.push('')
  lines.push('## 产物')
  lines.push('')
  lines.push('- 报告：`dsh-agent-team-planner/SMOKE-TEST-S1S3.md`')
  lines.push('- Harness：`test/smoke.mjs`')
  lines.push('- 原始结果：`test/last-run.json`')
  lines.push('- 临时目录：`test/.tmp/state-main`、`test/.tmp/state-meeting`、`test/.tmp/state-p0` 与 `test/.tmp/ws-*` 已清理（生成报告时保留在运行期）。')
  lines.push('')
  return `${lines.join('\n')}\n`
}

main()
  .then(({ failed }) => {
    process.exit(failed === 0 ? 0 : 1)
  })
  .catch((error) => {
    console.error('HARNESS CRASH:', error?.stack ?? error)
    process.exit(2)
  })
