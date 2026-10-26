/**
 * Agent Team Planner — Host half (S1 foundation).
 *
 * Scope of this slice:
 *   - project team binding (workspace -> Team Session)
 *   - role catalogue CRUD (built-in defaults, editable)
 *   - member configuration CRUD + block / unblock / remove / restore
 *   - per-member model route (installModelSelection) + lead route (selectModel)
 *   - lead/member system-prompt sections
 *   - exact Fetch routes for the client half
 *
 * Requirements/versions/meetings/artifacts arrive in later slices; the state
 * file already carries their empty collections for forward compatibility.
 */

import { mkdir, readFile, writeFile, rename, copyFile, open, readdir, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { defaultRoles } from './roles.js'

export const name = 'agent-team-planner'
export const inject = ['agents', 'sessions', 'systemPrompt', 'connection']

const MEETING_RULES = '【会议强制规则】会议阶段禁止生成或修改任何代码，禁止修改流程、配置或任务；只讨论会议核心议题，致力于达成结论、形成会议纪要和明确要求生成的文件。'
const STATE_ROUTE = '/api/atplanner.state'
const COMMAND_ROUTE = '/api/atplanner.command'
const ATTACHMENT_ROUTE = '/api/atplanner.attachment'
const ATTACHMENT_EXTENSIONS = ['.txt', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg']
const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
const STATE_VERSION = 1

/* ------------------------------------------------------------------ helpers */

function locatePackage(specifier) {
  const bases = []
  if (typeof process.argv[1] === 'string' && process.argv[1] !== '') bases.push(process.argv[1])
  bases.push(import.meta.url)
  for (const base of bases) {
    try {
      return createRequire(base).resolve(specifier)
    } catch {
      // try next base
    }
  }
  return undefined
}

async function loadBridge() {
  const agentPath = locatePackage('@deepseek-ai/dsh-agent')
  const llmPath = locatePackage('@deepseek-ai/dsh-llm')
  if (agentPath === undefined || llmPath === undefined) {
    throw new Error('cannot resolve official @deepseek-ai packages from the host installation')
  }
  const [agentModule, llmModule] = await Promise.all([
    import(pathToFileURL(agentPath).href),
    import(pathToFileURL(llmPath).href),
  ])
  return {
    agentPath,
    llmPath,
    installModelSelection: agentModule.installModelSelection,
    createUserMessage: llmModule.createUserMessage,
  }
}

const nowIso = () => new Date().toISOString()
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

function fail(code, message, details) {
  return { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } }
}

function ok(value) {
  return { ok: true, value }
}

/* -------------------------------------------------------------------- apply */

export function apply(ctx, rawConfig = {}) {
  const config = {
    stateDir: '.dsh_teams/planner',
    promptSectionOrder: 601,
    spawnTimeoutMs: 60000,
    ...rawConfig,
  }

  const st = {
    workspaceHints: new Map(),
    bridge: undefined,
    bridgeError: undefined,
    /** memberName -> route (installed on agent/created) */
    routeByMember: new Map(),
    /** agentId -> { ref, dispose, route, memberName } */
    selections: new Map(),
    /** memberName -> if true, the member was created by this plugin (vs by the Lead tools) */
    createdByPlugin: new Set(),
    queue: Promise.resolve(),
  }

  let bridgePromise
  const ensureBridge = async () => {
    if (st.bridge !== undefined) return st.bridge
    if (bridgePromise === undefined) {
      bridgePromise = loadBridge()
        .then((bridge) => {
          st.bridge = bridge
          return bridge
        })
        .catch((error) => {
          st.bridgeError = String(error?.message ?? error)
          throw error
        })
    }
    return await bridgePromise
  }
  ensureBridge().catch((error) => ctx.logger?.warn?.('agent-team-planner: bridge load failed: %o', error))

  const optional = (serviceName) => {
    try {
      return typeof ctx.get === 'function' ? ctx.get(serviceName) : undefined
    } catch {
      return undefined
    }
  }

  const agentTeams = () => {
    const service = optional('agentTeams')
    if (service === undefined) throw Object.assign(new Error('official Agent Teams is not mounted'), { code: 'OFFICIAL_UNAVAILABLE' })
    return service
  }

  const sessionOf = (sessionId) => {
    try {
      return ctx.sessions.get(sessionId)
    } catch {
      return undefined
    }
  }

  const cwdOf = (sessionId) => {
    const hinted = st.workspaceHints?.get(sessionId)
    if (typeof hinted === 'string' && hinted.trim() !== '') return hinted
    const session = sessionOf(sessionId)
    return session?.header?.cwd ?? session?.meta?.cwd ?? (typeof process.cwd === 'function' ? process.cwd() : '.')
  }

  const statePath = (sessionId) => join(cwdOf(sessionId), config.stateDir, 'state.json')

  /* ------------------------------------------------------------ state store */

  const emptyState = (sessionId) => ({
    schemaVersion: STATE_VERSION,
    revision: 0,
    workspacePath: cwdOf(sessionId),
    createdAt: nowIso(),
    updatedAt: nowIso(),
    team: {
      name: '项目研发团队',
      leadSessionId: null,
      leadSessionTitle: null,
      boundAt: null,
      boundBy: null,
      leadRoute: null,
    },
    settings: {
      workflow: ['requirement', 'architecture', 'development', 'review', 'testing'],
      defaultRoleByStage: { requirement: 'product', architecture: 'architect', review: 'architect', testing: 'test' },
      requireArtifacts: true,
      highEfficiencyMode: false,
    },
    roles: defaultRoles(),
    members: [],
    requirements: [],
    versions: [],
    bindings: [],
    artifacts: [],
    meetings: [],
    activations: [],
    activity: [],
  })

  /** Forward-migrate persisted state written by an older plugin build. */
  const ensureStateShape = (state) => {
    for (const key of ['roles', 'members', 'requirements', 'versions', 'bindings', 'artifacts', 'meetings', 'activations', 'activity']) {
      if (!Array.isArray(state[key])) state[key] = []
    }
    if (!isPlainObject(state.team)) state.team = {}
    if (state.team.leadRoute === undefined) state.team.leadRoute = null
    if (state.team.previousLeadSessionId === undefined) state.team.previousLeadSessionId = null
    if (!isPlainObject(state.settings)) state.settings = {}
    if (!isPlainObject(state.settings.defaultRoleByStage)) {
      state.settings.defaultRoleByStage = { requirement: 'product', architecture: 'architect', review: 'architect', testing: 'test' }
    }
    if (!Array.isArray(state.settings.workflow)) {
      state.settings.workflow = ['requirement', 'architecture', 'development', 'review', 'testing']
    }
    if (state.settings.requireArtifacts === undefined) state.settings.requireArtifacts = true
    if (state.settings.highEfficiencyMode === undefined) state.settings.highEfficiencyMode = false
    return state
  }

  const isTransientFsError = (error) =>
    error?.code === 'EPERM' || error?.code === 'EBUSY' || error?.code === 'EACCES'

  /** Read bytes, retrying transient Windows locks; only ENOENT means "no state". */
  const readStateRaw = async (sessionId) => {
    const path = statePath(sessionId)
    let lastError
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        return { raw: await readFile(path, 'utf8') }
      } catch (error) {
        lastError = error
        if (error?.code === 'ENOENT') return { missing: true }
        if (isTransientFsError(error) && attempt < 3) {
          await sleep(40 * (attempt + 1))
          continue
        }
        throw Object.assign(new Error(`state read failed: ${error?.message ?? error}`), { code: 'STATE_READ_FAILED' })
      }
    }
    throw Object.assign(new Error(`state read failed: ${lastError?.message ?? lastError}`), { code: 'STATE_READ_FAILED' })
  }

  const hasPlannerData = (state) =>
    ['versions', 'requirements', 'bindings', 'artifacts', 'meetings', 'activations'].some(
      (key) => Array.isArray(state?.[key]) && state[key].length > 0,
    )

  /** Newest parseable backup that actually contains planner data. */
  const newestDataBackup = async (sessionId) => {
    const backupDir = join(dirname(statePath(sessionId)), 'backups')
    let names = []
    try {
      names = (await readdir(backupDir)).filter((name) => name.endsWith('.json')).sort().reverse()
    } catch {
      return undefined
    }
    for (const name of names.slice(0, 12)) {
      try {
        const parsed = JSON.parse(await readFile(join(backupDir, name), 'utf8'))
        if (isPlainObject(parsed) && parsed.schemaVersion === STATE_VERSION && hasPlannerData(parsed)) {
          return { state: ensureStateShape(parsed), name }
        }
      } catch {
        // try older backup
      }
    }
    return undefined
  }

  /** Fill empty planning arrays from a backup and record the recovery in the timeline. */
  const mergeRecoveredState = (state, backup) => {
    let recovered = 0
    for (const key of ['versions', 'requirements', 'bindings', 'artifacts', 'meetings', 'activations']) {
      if ((state[key] ?? []).length === 0 && Array.isArray(backup[key]) && backup[key].length > 0) {
        state[key] = backup[key]
        recovered += 1
      }
    }
    if (recovered > 0) {
      appendActivity(state, 'state.recovered', '从备份恢复规划数据（检测到空状态）')
    }
    return recovered
  }

  const readState = async (sessionId) => {
    const result = await readStateRaw(sessionId)
    if (result.missing === true) {
      const backup = await newestDataBackup(sessionId)
      if (backup === undefined) return undefined
      const recovered = ensureStateShape(backup.state)
      recovered.workspacePath = cwdOf(sessionId)
      appendActivity(recovered, 'state.recovered', `状态文件缺失，从备份 ${backup.name} 恢复`)
      return recovered
    }
    let parsed
    try {
      parsed = JSON.parse(result.raw)
    } catch {
      throw Object.assign(new Error(`state file is not valid JSON: ${statePath(sessionId)}`), { code: 'STATE_CORRUPT' })
    }
    if (!isPlainObject(parsed) || parsed.schemaVersion !== STATE_VERSION) {
      throw Object.assign(new Error('unsupported planner state schemaVersion'), { code: 'STATE_CORRUPT' })
    }
    const state = ensureStateShape(parsed)
    // Guard against a transient read/rename race having produced an empty file:
    // only an actually-empty document (no planning data, revision 0) is recovered.
    if (!hasPlannerData(state) && (state.revision ?? 0) === 0) {
      const backup = await newestDataBackup(sessionId)
      if (backup !== undefined) mergeRecoveredState(state, backup.state)
    }
    return state
  }

  const renameWithRetry = async (from, to) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rename(from, to)
        return
      } catch (error) {
        const retryable = error?.code === 'EPERM' || error?.code === 'EBUSY' || error?.code === 'EACCES'
        if (!retryable || attempt === 4) throw error
        await sleep(30 * (attempt + 1))
      }
    }
  }

  const writeState = async (sessionId, state) => {
    const path = statePath(sessionId)
    const dir = dirname(path)
    const backupDir = join(dir, 'backups')
    await mkdir(dir, { recursive: true })
    state.updatedAt = nowIso()
    // Best-effort backup rotation (last 10 data-bearing snapshots). Never let an
    // empty snapshot displace a recoverable one.
    try {
      await mkdir(backupDir, { recursive: true })
      let shouldBackup = true
      try {
        const previous = JSON.parse(await readFile(path, 'utf8'))
        shouldBackup = (previous.revision ?? 0) > 0 || hasPlannerData(previous)
      } catch {
        // no previous file: first write is the baseline, not a backup
        shouldBackup = false
      }
      if (shouldBackup) {
        await copyFile(path, join(backupDir, `state-${Date.now()}.json`))
        const backups = (await readdir(backupDir)).filter((name) => name.endsWith('.json')).sort()
        while (backups.length > 10) await unlink(join(backupDir, backups.shift()))
      }
    } catch {
      // backups are optional
    }
    // Unique temp name avoids two writers sharing one .tmp (observed as EPERM on Windows).
    const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`
    const handle = await open(tmp, 'w')
    try {
      await handle.writeFile(JSON.stringify(state, null, 2), 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameWithRetry(tmp, path)
  }

  /** Serialized read-modify-write with optimistic revision checking. */
  const mutateState = (sessionId, expectedRevision, mutator) =>
    new Promise((resolve, reject) => {
      st.queue = st.queue.then(async () => {
        try {
          let state = await readState(sessionId)
          if (state === undefined) {
            state = emptyState(sessionId)
            state.revision = 0
            await writeState(sessionId, state)
          }
          if (typeof expectedRevision === 'number' && state.revision !== expectedRevision) {
            throw Object.assign(new Error(`revision conflict: expected ${expectedRevision}, current ${state.revision}`), {
              code: 'REVISION_CONFLICT',
            })
          }
          const result = await mutator(state)
          state.revision = (state.revision ?? 0) + 1
          await writeState(sessionId, state)
          hydrateRoutes(state)
          const leadSessionId = state.team?.leadSessionId
          if (typeof leadSessionId === 'string' && leadSessionId !== '') {
            st.promptCache = { leadSessionId, state }
          }
          resolve(result ?? state)
        } catch (error) {
          reject(error)
        }
      })
    })

  // 2026 Chinese statutory holidays (official State Council notice). Weekends and
  // these dates are idle all day. Peak = Mon–Fri 09:00–12:00 / 14:00–18:00 Beijing.
  const CN_HOLIDAYS = new Set([
    '2026-01-01', '2026-01-02', '2026-01-03',
    '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
    '2026-04-04', '2026-04-05', '2026-04-06',
    '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
    '2026-06-19', '2026-06-20', '2026-06-21',
    '2026-09-25', '2026-09-26', '2026-09-27',
    '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
  ])

  const inDiscountWindow = (now = new Date()) => {
    const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const day = beijing.getUTCDay()
    const date = beijing.toISOString().slice(0, 10)
    const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes()
    const weekday = day >= 1 && day <= 5 && !CN_HOLIDAYS.has(date)
    const peak = weekday && ((minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60))
    return !peak
  }

  const appendActivity = (state, kind, summary) => {
    state.activity.push({ id: `act-${randomUUID()}`, at: nowIso(), kind, summary })
    if (state.activity.length > 200) state.activity.splice(0, state.activity.length - 200)
  }

  /* ------------------------------------------------------------- team/agent */

  const resolveAgent = async (sessionId) => {
    let agent = ctx.agents.get(sessionId)
    if (agent !== undefined) return agent
    const controller = optional('sessionController')
    if (controller !== undefined && typeof controller.resolveAgent === 'function') {
      const resolved = await controller.resolveAgent(sessionId)
      if (resolved?.agent !== undefined) return resolved.agent
      if (resolved?.error !== undefined) {
        // Subagent sessions are owned by their durable parent address; when a
        // command is issued from a teammate conversation, resolve its root/lead
        // instead of surfacing session/agent-busy.
        if (resolved.error.code === 'session/agent-busy') {
          const parentId = sessionOf(sessionId)?.header?.parentSession
          if (typeof parentId === 'string' && parentId !== '') {
            const parent = ctx.agents.get(parentId)
            if (parent !== undefined) return parent
            const parentResolved = await controller.resolveAgent(parentId)
            if (parentResolved?.agent !== undefined) return parentResolved.agent
          }
        }
        throw Object.assign(new Error(`resolveAgent failed: ${resolved.error.code ?? 'unknown'}`), {
          code: resolved.error.code,
        })
      }
    }
    return undefined
  }

  const resolveLead = async (sessionId) => {
    const agent = await resolveAgent(sessionId)
    if (agent === undefined) throw Object.assign(new Error('session agent is not live'), { code: 'LEAD_NOT_LIVE' })
    const membership = agentTeams().tryMembership(agent)
    if (membership === undefined) throw Object.assign(new Error('session is not a Team member'), { code: 'NOT_TEAM_MEMBER' })
    return {
      lead: membership.role === 'lead' ? agent : membership.root,
      leadSessionId: membership.root.id,
      role: membership.role,
      name: membership.name,
      agent,
    }
  }

  /** Resolve the bound project Lead; falls back to the current session's Lead. */
  const resolveProjectLead = async (sessionId) => {
    const state = await readState(sessionId)
    const boundId = state?.team?.leadSessionId
    if (typeof boundId === 'string') {
      try {
        return await resolveLead(boundId)
      } catch (error) {
        if (error?.code === 'LEAD_NOT_LIVE') {
          throw Object.assign(new Error('bound Team Session is not live; open it or rebind'), {
            code: 'TEAM_SESSION_LOST',
          })
        }
        throw error
      }
    }
    return await resolveLead(sessionId)
  }

  const listMembers = (lead) => {
    try {
      return agentTeams().listMembers(lead)
    } catch {
      return []
    }
  }

  const findOfficialMember = (lead, memberName) => listMembers(lead).find((member) => member.name === memberName)

  const listTasksSafely = (lead) => {
    try {
      return agentTeams().listTasks(lead)
    } catch {
      return []
    }
  }

  /** Rehydrate per-member routes from persisted state (survives process restart). */
  const hydrateRoutes = (state) => {
    if (state === undefined || !Array.isArray(state.members)) return
    for (const member of state.members) {
      if (member.route !== null && member.route !== undefined) st.routeByMember.set(member.name, member.route)
      else st.routeByMember.delete(member.name)
    }
  }

  const installRoute = (agent, memberName, route) => {
    if (agent === undefined || route === null || route === undefined) return false
    const installModelSelection = st.bridge?.installModelSelection
    if (typeof installModelSelection !== 'function') return false
    const previous = st.selections.get(agent.id)
    try {
      previous?.dispose?.()
    } catch {
      // ignore
    }
    const ref = {
      current: {
        provider: route.provider,
        model: route.model,
        ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
      },
      assembled: undefined,
    }
    const dispose = installModelSelection(agent.ctx, ref)
    st.selections.set(agent.id, { ref, dispose, route, memberName })
    return true
  }

  const applyRouteToLiveAgent = (lead, memberName, route) => {
    const member = findOfficialMember(lead, memberName)
    if (member === undefined) return false
    const live = ctx.agents.get(member.id)
    if (live === undefined) return false
    return installRoute(live, memberName, route)
  }

  const memberConfig = (state, memberName) => state.members.find((member) => member.name === memberName)

  const spawnMember = async (lead, input) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('spawn timeout')), config.spawnTimeoutMs)
    try {
      const result = await agentTeams().spawnTeammate(lead, {
        name: input.name,
        description: input.description,
        prompt: [{ type: 'text', text: input.initialPrompt }],
        context: input.context,
        provider: input.provider,
        signal: controller.signal,
      })
      return result.member
    } finally {
      clearTimeout(timer)
    }
  }

  /** Official spawnTeammate requires a non-empty description (<=200). */
  const memberDescription = (role, displayName, raw) => {
    const trimmed = typeof raw === 'string' ? raw.trim() : ''
    const fallback = `${role?.name ?? '成员'} · ${displayName}`.trim()
    return (trimmed !== '' ? trimmed : fallback).slice(0, 200)
  }

  /**
   * A role prompt is the default; a member prompt is an explicit override.
   * Editing the role therefore updates every member that never customized its
   * prompt (empty, or still the previous role default), and leaves overrides alone.
   */
  const syncRolePromptToMembers = (state, role, previousBasePrompt) => {
    let synced = 0
    for (const member of state.members) {
      if (member.roleId !== role.id) continue
      const current = typeof member.rolePrompt === 'string' ? member.rolePrompt : ''
      const isInherited = current === '' || (typeof previousBasePrompt === 'string' && current === previousBasePrompt)
      if (!isInherited) continue
      member.rolePrompt = role.basePrompt
      member.promptRevision = (member.promptRevision ?? 0) + 1
      member.promptAppliedAt = nowIso()
      synced += 1
    }
    return synced
  }

  /* ------------------------------------------------- planning models (S2a) */

  const findRequirement = (state, id) => state.requirements.find((requirement) => requirement.id === id)
  const findVersion = (state, id) => state.versions.find((version) => version.id === id)
  const requirementDoc = (state, requirementId) =>
    state.artifacts.find((artifact) => artifact.type === 'requirement_doc' && artifact.requirementId === requirementId)
  const versionDoc = (state, versionId, type) =>
    state.artifacts.find((artifact) => artifact.versionId === versionId && artifact.type === type)
  const isApproved = (artifact) =>
    artifact !== undefined && (artifact.status === 'approved' || artifact.status === 'archived')
  /** Gate helper: auto-captured drafts may coexist with a human-confirmed report. */
  const hasApprovedDoc = (state, versionId, type) =>
    state.artifacts.some(
      (artifact) =>
        artifact.versionId === versionId &&
        artifact.type === type &&
        (artifact.status === 'approved' || artifact.status === 'archived'),
    )

  const createArtifactRecord = (state, input) => {
    const artifact = {
      id: `art-${randomUUID()}`,
      versionId: input.versionId ?? null,
      requirementId: input.requirementId ?? null,
      type: input.type,
      title: input.title,
      format: 'markdown',
      content: String(input.content ?? ''),
      status: 'draft',
      source: input.source ?? { kind: 'manual' },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    state.artifacts.push(artifact)
    return artifact
  }

  const requirementDocTemplate = (requirement) =>
    `# ${requirement.title}\n\n## 背景与问题\n\n${requirement.description || ''}\n\n## 目标与非目标\n\n## 功能范围（分角色）\n\n## 验收标准\n\n## 角色标签\n\n${(requirement.roleTags || []).join(', ')}\n\n## 开放问题\n`

  const stageGateMissing = (state, version) => {
    const missing = []
    if (version.stage === 'requirement') {
      if (version.requirementIds.length === 0) missing.push('版本未绑定任何需求')
      for (const requirementId of version.requirementIds) {
        const requirement = findRequirement(state, requirementId)
        if (requirement === undefined) {
          missing.push(`需求 ${requirementId} 不存在`)
          continue
        }
        if (!isApproved(requirementDoc(state, requirementId))) {
          missing.push(`需求「${requirement.title}」的标准化需求文档未确认`)
        }
      }
    }
    if (version.stage === 'architecture' && !hasApprovedDoc(state, version.id, 'architecture_doc')) {
      missing.push('架构方案文档未确认')
    }
    return missing
  }

  const bindRequirementToVersion = (state, version, requirement, now) => {
    if (requirement.versionId !== null && requirement.versionId !== version.id) {
      throw Object.assign(new Error(`需求「${requirement.title}」已绑定到其他版本`), { code: 'REQUIREMENT_BOUND' })
    }
    requirement.versionId = version.id
    requirement.status = 'planned'
    requirement.updatedAt = now
    if (!version.requirementIds.includes(requirement.id)) version.requirementIds.push(requirement.id)
    version.updatedAt = now
  }

  const unbindRequirementFromVersion = (state, version, requirement, now) => {
    requirement.versionId = null
    requirement.status = 'draft'
    requirement.updatedAt = now
    version.requirementIds = version.requirementIds.filter((id) => id !== requirement.id)
    version.updatedAt = now
  }

  /* ------------------------------------------------------- workflow engine */

  const stageDefaultRole = (state, stage) => state.settings?.defaultRoleByStage?.[stage]

  const memberCandidateForRole = (state, roleId) => {
    const candidates = state.members.filter(
      (member) =>
        member.roleId === roleId &&
        member.removed !== true &&
        member.blocked !== true,
    )
    if (candidates.length === 0) return undefined
    const load = (member) =>
      state.bindings.filter((binding) => binding.memberName === member.name && binding.lastKnownStatus === 'in_progress').length
    return [...candidates].sort((left, right) => load(left) - load(right) || (left.createdAt < right.createdAt ? -1 : 1))[0]
  }

  const taskWakeText = (task) =>
    `团队任务板已把你列为任务 ${task.id}（${task.subject}）的执行人（in_progress）。请用 team_task_get 读取详情后直接执行；完成后 team_task_update action="complete" 并附最新 expected_revision。若无法完成，请 send_message 告知 lead。`

  const activateMember = async (resolved, state, member) => {
    if (member.creation?.status === 'active') return true
    // The official teammate may already exist (created by an earlier plugin
    // version, a manual tool call, or a previous failed spawn). Adopt it instead
    // of spawning a duplicate name, which the Team roster rejects.
    const existing = findOfficialMember(resolved.lead, member.name)
    if (existing !== undefined) {
      member.creation = { status: 'active', officialMemberId: existing.id }
      member.promptAppliedAt = nowIso()
      appendActivity(state, 'member.activate.adopt', `复用已存在的官方成员 ${member.name}`)
      return true
    }
    try {
      const initialPrompt = initialPromptFor(state, member)
      const spawned = await spawnMember(resolved.lead, {
        name: member.name,
        description: member.description,
        context: member.context,
        provider: member.provider,
        initialPrompt,
      })
      member.creation = { status: 'active', officialMemberId: spawned.id }
      member.promptAppliedAt = nowIso()
      st.createdByPlugin.add(member.name)
      appendActivity(state, 'member.activate', `首次派发，激活成员 ${member.name}`)
      return true
    } catch (error) {
      const raced = findOfficialMember(resolved.lead, member.name)
      if (raced !== undefined) {
        member.creation = { status: 'active', officialMemberId: raced.id }
        member.promptAppliedAt = nowIso()
        appendActivity(state, 'member.activate.adopt', 复用已存在的官方成员 )
        return true
      }
      member.creation = { ...(member.creation ?? {}), status: 'failed', error: String(error?.message ?? error) }
      appendActivity(state, 'member.activate.failed', `激活成员失败 ${member.name}: ${member.creation.error}`)
      return false
    }
  }

  const assignBinding = async (resolved, state, binding) => {
    if (state.settings?.highEfficiencyMode === true && !inDiscountWindow()) {
      return { ok: false, skipped: true, error: 'DISCOUNT_WINDOW_CLOSED' }
    }
    let view
    try {
      view = agentTeams().getTask(resolved.lead, binding.taskId)
    } catch {
      binding.lastKnownStatus = 'deleted'
      return { ok: false, error: 'TASK_LOST' }
    }
    if (view.status !== 'pending') {
      binding.lastKnownStatus = view.status
      if (view.ownerName !== undefined) binding.memberName = view.ownerName
      return { ok: false, skipped: true }
    }
    if (view.ready !== true || view.ownerName !== undefined) return { ok: false, skipped: true }
    const preferred = binding.preferredMember === undefined
      ? undefined
      : state.members.find(
          (member) =>
            member.name === binding.preferredMember &&
            member.roleId === binding.role &&
            member.removed !== true &&
            member.blocked !== true,
        )
    const member = preferred ?? memberCandidateForRole(state, binding.role)
    if (member === undefined) return { ok: false, error: 'ROLE_NO_MEMBER' }
    const activeMeeting = state.meetings.find(
      (meeting) => meeting.status === 'active' && meeting.versionId === binding.versionId,
    )
    if (activeMeeting !== undefined && !activeMeeting.participants.includes(member.name)) {
      return { ok: false, skipped: true, error: 'MEETING_IN_PROGRESS' }
    }
    const activated = await activateMember(resolved, state, member)
    if (activated !== true) return { ok: false, error: 'MEMBER_ACTIVATION_FAILED' }
    try {
      await agentTeams().updateTask(resolved.lead, {
        taskId: view.id,
        expectedRevision: view.revision,
        action: 'reassign',
        owner: member.name,
      })
    } catch (error) {
      return { ok: false, error: error?.code ?? 'OFFICIAL_ERROR' }
    }
    try {
      await agentTeams().sendMessage(resolved.lead, {
        target: member.name,
        content: [{ type: 'text', text: taskWakeText(view) }],
        signal: new AbortController().signal,
      })
    } catch {
      // assignment succeeded; wake is best effort
    }
    binding.memberName = member.name
    binding.lastKnownStatus = 'in_progress'
    binding.updatedAt = nowIso()
    return { ok: true, memberName: member.name }
  }

  const createBindingTask = async (resolved, state, input) => {
    const view = await agentTeams().createTask(resolved.lead, {
      subject: input.subject,
      description: input.description,
      blockedBy: Array.isArray(input.blockedBy) ? input.blockedBy : [],
      ...(Array.isArray(input.writeScopes) && input.writeScopes.length > 0 ? { writeScopes: input.writeScopes } : {}),
    })
    const binding = {
      taskKey: input.taskKey,
      taskId: view.id,
      versionId: input.versionId,
      requirementId: input.requirementId ?? null,
      role: input.role,
      phase: input.phase,
      subject: input.subject,
      preferredMember: input.preferredMember,
      memberName: null,
      lastKnownStatus: 'pending',
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    state.bindings.push(binding)
    return binding
  }

  const topoSortSpecs = (specs) => {
    const remaining = [...specs]
    const ordered = []
    while (remaining.length > 0) {
      const index = remaining.findIndex((spec) =>
        (spec.dependsOn || []).every((dependency) => ordered.some((entry) => entry.key === dependency)),
      )
      if (index === -1) throw Object.assign(new Error('任务规格依赖存在环'), { code: 'VALIDATION' })
      ordered.push(remaining.splice(index, 1)[0])
    }
    return ordered
  }

  const enterReview = async (state, resolved, version) => {
    const roleId = stageDefaultRole(state, 'review') ?? 'architect'
    const architecture = versionDoc(state, version.id, 'architecture_doc')
    const requirements = version.requirementIds.map((id) => findRequirement(state, id)).filter(Boolean)
    const description = `对照架构方案与需求文档审查本版本代码。\n\n架构方案：${architecture?.title ?? '未提供'}\n需求：${requirements.map((requirement) => requirement.title).join('、')}\n\n完成后由团队长请求你输出 Code Review 报告并确认。`
    const binding = await createBindingTask(resolved, state, {
      taskKey: `${version.id}#review`,
      versionId: version.id,
      requirementId: null,
      role: roleId,
      phase: 'review',
      subject: `Code Review: ${version.name}`,
      description,
    })
    version.stage = 'review'
    version.updatedAt = nowIso()
    appendActivity(state, 'version.review', `${version.name} 进入 Code Review`)
    await assignBinding(resolved, state, binding)
  }

  const enterTesting = async (state, resolved, version) => {
    const roleId = stageDefaultRole(state, 'testing') ?? 'test'
    for (const requirementId of version.requirementIds) {
      const requirement = findRequirement(state, requirementId)
      if (requirement === undefined) continue
      const doc = requirementDoc(state, requirementId)
      const description = `按需求文档与验收标准测试「${requirement.title}」，覆盖单元/集成/冒烟/回归，记录缺陷与结论。\n\n需求文档：\n${(doc?.content ?? requirement.description ?? '').slice(0, 4000)}\n\n完成后由团队长请求你输出测试报告并确认。`
      const binding = await createBindingTask(resolved, state, {
        taskKey: `${requirementId}#test`,
        versionId: version.id,
        requirementId,
        role: roleId,
        phase: 'testing',
        subject: `测试：${requirement.title}`,
        description,
      })
      await assignBinding(resolved, state, binding)
    }
    version.stage = 'testing'
    version.updatedAt = nowIso()
    appendActivity(state, 'version.testing', `${version.name} 进入测试`)
  }

  const finalizeVersion = (state, version) => {
    version.status = 'completed'
    version.stage = 'done'
    version.completedAt = nowIso()
    version.updatedAt = nowIso()
    for (const requirementId of version.requirementIds) {
      const requirement = findRequirement(state, requirementId)
      if (requirement !== undefined) requirement.status = 'done'
    }
    for (const artifact of state.artifacts) {
      const belongsToVersion = artifact.versionId === version.id || version.requirementIds.includes(artifact.requirementId)
      if (artifact.status === 'approved' && belongsToVersion) {
        artifact.status = 'archived'
        artifact.updatedAt = nowIso()
      }
    }
    appendActivity(state, 'version.completed', version.name)
  }

  const latestAssistantText = (resolved, memberName) => {
    const member = findOfficialMember(resolved.lead, memberName)
    if (member === undefined) return undefined
    const texts = eventsOf(member.id)
      .filter((event) => event.type === 'assistant/message' && typeof event.text === 'string' && event.text.trim() !== '')
      .map((event) => event.text)
    return texts.length === 0 ? undefined : texts[texts.length - 1]
  }

  /**
   * PRD §6.9/§7: when a phase finished and its report artifact is missing, take the
   * responsible member's latest assistant message (unwrapping the artifact marker when
   * present) and register it as a DRAFT artifact for the human to confirm.
   */
  const autoCaptureReport = (state, resolved, version, type, title, memberName) => {
    if (memberName === undefined) return undefined
    const existing = versionDoc(state, version.id, type)
    if (existing !== undefined && !(existing.status === 'draft' && existing.source?.auto === true)) return undefined
    const last = latestAssistantText(resolved, memberName)
    if (last === undefined) return undefined
    const extracted = extractMarked(last, 'artifact') ?? last
    const content = extracted.length > 256 * 1024 ? `${extracted.slice(0, 256 * 1024)}\n\n…（截断）` : extracted
    if (existing !== undefined) {
      if (existing.content !== content) {
        existing.content = content
        existing.updatedAt = nowIso()
        appendActivity(state, 'artifact.autoRefresh', `${type} <- ${memberName}`)
      }
      return existing
    }
    const artifact = createArtifactRecord(state, {
      versionId: version.id,
      type,
      title,
      content,
      source: { kind: 'agent', agentName: memberName, auto: true },
    })
    appendActivity(state, 'artifact.autoCapture', `${type} <- ${memberName}`)
    return artifact
  }

  const pumpVersion = async (state, resolved) => {
    const version = state.versions.find((candidate) => candidate.status === 'active')
    if (version === undefined) return
    const bindings = state.bindings.filter((binding) => binding.versionId === version.id && binding.abandonedAt === undefined)
    for (const requirementId of version.requirementIds) {
      const requirement = findRequirement(state, requirementId)
      if (requirement === undefined) continue
      const own = bindings.filter((binding) => binding.requirementId === requirementId)
      if (own.length === 0) continue
      if (own.every((binding) => binding.lastKnownStatus === 'completed')) requirement.status = 'done'
      else if (own.some((binding) => binding.lastKnownStatus === 'in_progress')) requirement.status = 'in_progress'
      else if (requirement.status !== 'done') requirement.status = 'planned'
    }
    for (const binding of bindings.filter((candidate) => candidate.phase === version.stage && candidate.lastKnownStatus === 'pending')) {
      await assignBinding(resolved, state, binding)
    }
    const phaseBindings = bindings.filter((binding) => binding.phase === version.stage)
    if (version.stage === 'development' && phaseBindings.length > 0 && phaseBindings.every((binding) => binding.lastKnownStatus === 'completed')) {
      await enterReview(state, resolved, version)
      return
    }
    if (version.stage === 'review') {
      if (hasApprovedDoc(state, version.id, 'review_report')) {
        await enterTesting(state, resolved, version)
        return
      }
      const review = phaseBindings[0]
      if (review !== undefined && review.lastKnownStatus === 'completed') {
        if (versionDoc(state, version.id, 'review_report') === undefined) {
          const memberName =
            review.memberName ?? memberCandidateForRole(state, stageDefaultRole(state, 'review') ?? 'architect')?.name
          autoCaptureReport(state, resolved, version, 'review_report', `${version.name} 评审报告`, memberName)
        }
      }
      return
    }
    if (version.stage === 'testing' && hasApprovedDoc(state, version.id, 'test_report')) {
      finalizeVersion(state, version)
      return
    }
    if (
      version.stage === 'testing' &&
      phaseBindings.length > 0 &&
      phaseBindings.every((binding) => binding.lastKnownStatus === 'completed')
    ) {
      if (versionDoc(state, version.id, 'test_report') === undefined) {
        const completed = [...phaseBindings].reverse().find((binding) => binding.lastKnownStatus === 'completed' && binding.memberName)
        const memberName =
          completed?.memberName ?? memberCandidateForRole(state, stageDefaultRole(state, 'testing') ?? 'test')?.name
        autoCaptureReport(state, resolved, version, 'test_report', `${version.name} 测试报告`, memberName)
      }
    }
  }

  /* ------------------------------------------------------- meeting support */

  const capturedEvents = new Map()
  const meetingSessions = new Map() // sessionId -> { meetingId, leadSessionId, memberName }
  const EVENT_CAP = 300
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const waitFor = async (probe, timeoutMs, intervalMs = 150) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const value = await probe()
      if (value !== undefined) return value
      if (Date.now() >= deadline) return undefined
      await sleep(intervalMs)
    }
  }

  const slimEvent = (event) => {
    const type = event.type
    const base = { type, seq: event.seq, time: event.time }
    if (type === 'assistant/message') {
      const message = event.data?.message
      return {
        ...base,
        sourceKind: message?.source?.kind,
        provider: message?.source?.provider,
        model: message?.source?.model,
        text: textOfMessage(message),
      }
    }
    if (type === 'user/message') {
      return { ...base, sourceKind: event.data?.source?.kind, text: textOfMessage(event.data) }
    }
    if (type === 'turn/end') return { ...base, reason: event.data?.reason }
    return base
  }

  const textOfMessage = (message) => {
    const content = message?.content
    if (!Array.isArray(content)) return ''
    return content
      .filter((block) => block !== null && typeof block === 'object' && block.type === 'text')
      .map((block) => block.text)
      .filter((text) => typeof text === 'string')
      .join('\n')
  }

  const eventsOf = (sessionId) => capturedEvents.get(sessionId) ?? []
  const appendCaptured = (sessionId, record) => {
    let list = capturedEvents.get(sessionId)
    if (list === undefined) {
      list = []
      capturedEvents.set(sessionId, list)
    }
    list.push(record)
    if (list.length > EVENT_CAP) list.splice(0, list.length - EVENT_CAP)
  }

  /** Ask one member and capture the assistant text of the completed turn. */
  /** Ask the Lead itself (a followup in its own session) and capture the completed turn. */
  const askLeadCapture = async (resolved, text, timeoutMs) => {
    const bridge = st.bridge
    if (bridge === undefined || typeof bridge.createUserMessage !== 'function') {
      throw Object.assign(new Error('宿主 bridge 不可用，无法请求团队长'), { code: 'BRIDGE_UNAVAILABLE' })
    }
    if (typeof resolved.lead?.followup !== 'function') {
      throw Object.assign(new Error('团队长 Agent 不支持 followup'), { code: 'BRIDGE_UNAVAILABLE' })
    }
    const baseline = eventsOf(resolved.leadSessionId).length
    const message = bridge.createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
    await resolved.lead.followup(message)
    const finished = await waitFor(() => {
      const fresh = eventsOf(resolved.leadSessionId).slice(baseline)
      return fresh.some((event) => event.type === 'turn/end') ? fresh : undefined
    }, timeoutMs)
    const fresh = finished ?? eventsOf(resolved.leadSessionId).slice(baseline)
    return {
      turnEnded: finished !== undefined,
      reply: fresh
        .filter((event) => event.type === 'assistant/message')
        .map((event) => event.text)
        .filter(Boolean)
        .join('\n'),
    }
  }

  const askMember = async (lead, memberName, text, timeoutMs) => {
    const member = findOfficialMember(lead, memberName)
    if (member === undefined) throw Object.assign(new Error(`成员不存在：${memberName}`), { code: 'VALIDATION' })
    const baseline = eventsOf(member.id).length
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('wait timeout')), timeoutMs)
    try {
      await agentTeams().sendMessage(lead, {
        target: memberName,
        content: [{ type: 'text', text }],
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    const finished = await waitFor(() => {
      const fresh = eventsOf(member.id).slice(baseline)
      return fresh.some((event) => event.type === 'turn/end') ? fresh : undefined
    }, timeoutMs)
    const fresh = finished ?? eventsOf(member.id).slice(baseline)
    const assistant = fresh.filter((event) => event.type === 'assistant/message')
    return {
      sessionId: member.id,
      turnEnded: finished !== undefined,
      reply: assistant.map((event) => event.text).filter(Boolean).join('\n'),
      assistantCount: assistant.length,
      capturedTypes: [...new Set(fresh.map((event) => event.type))],
    }
  }

  const extractMarked = (text, marker) => {
    if (typeof text !== 'string') return null
    const begin = `<!--atplanner:${marker}:begin-->`
    const end = `<!--atplanner:${marker}:end-->`
    // PRD §6.9: the LAST complete marked block wins.
    const start = text.lastIndexOf(begin)
    if (start === -1) return null
    const stop = text.indexOf(end, start + begin.length)
    if (stop === -1) return null
    return text.slice(start + begin.length, stop).trim()
  }

  const appendTranscript = (meeting, sessionId, entry) => {
    meeting.lastSeq = meeting.lastSeq ?? {}
    const previous = meeting.lastSeq[sessionId] ?? 0
    if (typeof entry.seq === 'number' && entry.seq <= previous) return false
    meeting.transcript.push({ id: `mt-${randomUUID()}`, at: nowIso(), ...entry })
    if (typeof entry.seq === 'number') meeting.lastSeq[sessionId] = entry.seq
    if (meeting.transcript.length > 200) meeting.transcript.splice(0, meeting.transcript.length - 200)
    return true
  }

  const trackMeetingSessions = (lead, meeting) => {
    meeting.sessionIds = meeting.sessionIds ?? {}
    for (const memberName of [meeting.hostMemberName, ...meeting.participants]) {
      const member = findOfficialMember(lead, memberName)
      if (member === undefined) continue
      meetingSessions.set(member.id, { meetingId: meeting.id, leadSessionId: meeting.leadSessionId, memberName })
      meeting.sessionIds[memberName] = member.id
    }
  }

  const MEETING_TYPES = ['requirement_clarification', 'architecture_review', 'test_review', 'custom']
  const MEETING_ARTIFACT_TYPE = {
    requirement_clarification: 'requirement_doc',
    architecture_review: 'architecture_doc',
    test_review: 'test_plan',
    custom: 'custom',
  }

  const meetingOutputPrompt = (meeting) => {
    const template =
      meeting.type === 'requirement_clarification'
        ? '标准需求文档模板：标题/背景与问题/目标与非目标/功能范围（分角色）/验收标准/角色标签/开放问题，Markdown。'
        : meeting.type === 'architecture_review'
          ? '架构设计文档模板：背景与目标/总体架构/模块边界/接口与数据/部署与运行/风险与开放问题/待确认项，Markdown。'
          : 'Markdown 文档：背景/目标/方案或范围/关键结论/风险与开放问题。'
    return `【会议产出】${meeting.title}\n会议目标：${meeting.goal}\n\n${MEETING_RULES}\n请基于本次会议讨论，输出最终文档。${template}\n\n必须严格用以下标记包裹，标记外不要输出任何内容：\n<!--atplanner:output:begin-->\n（Markdown 正文）\n<!--atplanner:output:end-->`
  }

  const roleNameOf = (state, roleId) => state.roles.find((role) => role.id === roleId)?.name ?? roleId

  const requirementVersion = (state, requirement) =>
    requirement?.versionId === null || requirement?.versionId === undefined
      ? undefined
      : findVersion(state, requirement.versionId)

  const assertVersionWritable = (version, action) => {
    if (version !== undefined && (version.status === 'completed' || version.status === 'archived')) {
      throw Object.assign(new Error(`版本「${version.name}」已完成/归档，${action}为只读操作`), {
        code: 'VERSION_READ_ONLY',
        details: { versionId: version.id, status: version.status },
      })
    }
  }

  const assertRequirementWritable = (state, requirement, action) =>
    assertVersionWritable(requirementVersion(state, requirement), action)

  const attachmentDir = (sessionId, requirementId) =>
    join(dirname(statePath(sessionId)), 'attachments', requirementId)

  const safeAttachmentName = (name) => String(name ?? 'file').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80)

  const attachmentExtension = (name) => {
    const lower = String(name ?? '').toLowerCase()
    return ATTACHMENT_EXTENSIONS.find((extension) => lower.endsWith(extension))
  }

  const IMPLEMENTATION_ROLES = new Set(['frontend', 'backend', 'ops'])

  const implementationRoles = (state, requirement) => {
    const selected = (requirement.assignees ?? [])
      .map((name) => state.members.find((member) => member.name === name))
      .filter((member) => member !== undefined && member.removed !== true && member.blocked !== true)
    const explicit = [...new Set(selected.map((member) => member.roleId).filter((roleId) => IMPLEMENTATION_ROLES.has(roleId)))]
    if (explicit.length > 0) return explicit
    const architecture = state.artifacts
      .filter((artifact) => artifact.versionId === requirement.versionId && artifact.type === 'architecture_doc')
      .sort((left, right) => String(right.updatedAt ?? right.createdAt ?? '').localeCompare(String(left.updatedAt ?? left.createdAt ?? '')))[0]
    const text = `${requirement.title ?? ''} ${requirement.description ?? ''} ${architecture?.content ?? ''}`.toLowerCase()
    const inferred = []
    if (/前端|frontend|页面|html|css|浏览器|网页|官网|ui|交互/.test(text)) inferred.push('frontend')
    if (/后端|backend|接口|api|数据库|服务端|持久化|鉴权/.test(text)) inferred.push('backend')
    if (/运维|部署|devops|docker|ci\/cd/.test(text)) inferred.push('ops')
    if (inferred.length > 0) return [...new Set(inferred)]
    const tagged = (requirement.roleTags ?? []).filter((roleId) => IMPLEMENTATION_ROLES.has(roleId))
    return tagged.length > 0 ? [...new Set(tagged)] : ['backend']
  }

  /** Split into implementation tasks; product/architect/test participation does not
   * make those members the developers. Selected implementation members win, then
   * the architecture document / requirement text decides the implementing role. */
  const autoTaskSpecs = (state, requirement) => {
    const selected = (requirement.assignees ?? [])
      .map((name) => state.members.find((member) => member.name === name))
      .filter((member) => member !== undefined && member.removed !== true && member.blocked !== true)
    const developers = selected.filter((member) => IMPLEMENTATION_ROLES.has(member.roleId))
    if (developers.length > 0) {
      return developers.map((member, index) => ({
        key: `dev-${index + 1}`,
        objective: `${requirement.title}：${roleNameOf(state, member.roleId)}实现`,
        role: member.roleId,
        preferredMember: member.name,
        dependsOn: [],
        acceptance: String(requirement.description ?? '').slice(0, 300) || '满足需求文档与验收标准',
        writeScopes: [],
        stage: 'development',
      }))
    }
    return implementationRoles(state, requirement).map((roleId, index) => ({
      key: `dev-${index + 1}`,
      objective: `${requirement.title}：${roleNameOf(state, roleId)}实现`,
      role: roleId,
      dependsOn: [],
      acceptance: String(requirement.description ?? '').slice(0, 300) || '满足需求文档与验收标准',
      writeScopes: [],
      stage: 'development',
    }))
  }

  const initialPromptFor = (state, configRecord) => {
    const role = state.roles.find((candidate) => candidate.id === configRecord.roleId)
    return `你是「${state.team.name}」团队成员「${configRecord.displayName}」，角色：${role?.name ?? configRecord.roleId}（${configRecord.roleId}）。

## 角色职责
${configRecord.rolePrompt || role?.basePrompt || ''}

## 专有要求
${configRecord.customPrompt || ''}

## 协作规则
- 任务在团队共享任务板：team_task_list / team_task_get。
- 指派给你的任务状态为 in_progress：直接执行，完成后 team_task_update(action="complete", expected_revision=最新)。
- 共享池中未指派且 ready 的任务可 claim。
- 被 blockedBy 阻塞时不要领取，等待队长消息。
- 需要澄清/支援时 send_message 通知 lead；不要创建新成员。
- 评审/测试等任务的最终交付文档，请放进 \`<!--atplanner:artifact:begin-->\` 与 \`<!--atplanner:artifact:end-->\` 之间（插件会自动归档为草稿产出物，供人类确认）。
- 产出物写入工作区，并遵守 AGENTS.md 与项目规范.`
  }

  /** Reconcile config records with the official roster (read-only side effects). */
  const inferRoleId = (state, member) => {
    const text = `${member?.name ?? ''} ${member?.displayName ?? ''} ${member?.description ?? ''}`.toLowerCase()
    const aliases = [
      ['product', ['product', 'pm', '产品']],
      ['architect', ['architect', 'arch', '架构']],
      ['frontend', ['frontend', 'front', 'fe', '前端']],
      ['backend', ['backend', 'back', 'be', '后端']],
      ['test', ['test', 'qa', '测试']],
      ['ops', ['ops', 'devops', '运维']],
    ]
    for (const [roleId, words] of aliases) {
      if (state.roles.some((role) => role.id === roleId) && words.some((word) => text.includes(word))) return roleId
    }
    return null
  }

  const reconcileMembers = (state, lead) => {
    let added = 0
    const official = listMembers(lead).filter((member) => member.role === 'teammate')
    for (const member of official) {
      if (memberConfig(state, member.name) === undefined) {
        state.members.push({
          name: member.name,
          displayName: member.name,
          roleId: inferRoleId(state, member),
          rolePrompt: '',
          customPrompt: '',
          description: member.description ?? '',
          context: member.context ?? 'fresh',
          provider: member.provider ?? 'spawn',
          route: null,
          blocked: false,
          blockedAt: null,
          blockedReason: '',
          removed: false,
          removedAt: null,
          creation: { status: 'active', officialMemberId: member.id },
          createdAt: nowIso(),
          promptRevision: 0,
          promptAppliedAt: null,
        })
        added += 1
      }
    }
    for (const record of state.members) {
      const live = official.find((member) => member.name === record.name)
      if (live === undefined) {
        if (record.creation.status === 'active') record.creation.status = 'missing'
      } else {
        record.creation.status = 'active'
        record.creation.officialMemberId = live.id
        if (!record.roleId) record.roleId = inferRoleId(state, { ...live, displayName: record.displayName, description: record.description })
      }
    }
    return added
  }

  /** Ensure one member config exists even for members created outside this plugin. */
  const ensureMemberConfig = async (sessionId, state, memberName) => {
    if (memberConfig(state, memberName) !== undefined) return true
    try {
      const resolved = await resolveProjectLead(sessionId)
      reconcileMembers(state, resolved.lead)
    } catch {
      // leave missing; caller reports
    }
    return memberConfig(state, memberName) !== undefined
  }

  const enqueue = (fn) => {
    const run = st.queue.then(fn)
    st.queue = run.catch((error) => ctx.logger?.warn?.('agent-team-planner: queued write failed %o', error))
    return run
  }

  /* ---------------------------------------------------------------- prompt */

  const renderLeadSection = (state) => {
    const activeMembers = state.members.filter((member) => !member.removed)
    const lines = activeMembers.map((member) => {
      const role = state.roles.find((candidate) => candidate.id === member.roleId)
      const flags = [member.blocked ? '已屏蔽' : '', member.creation.status === 'missing' ? '缺失' : '']
        .filter(Boolean)
        .join('/')
      return `- ${member.displayName}（${role?.name ?? '未配置角色'} / ${member.name}${flags ? ` / ${flags}` : ''}）`
    })
    const leadPrompt = state.roles.find((candidate) => candidate.id === 'lead')?.basePrompt ?? ''
    const activeVersion = state.versions.find((version) => version.status === 'active')
    return `## 研发团队（Agent Team Planner 管理）
${leadPrompt ? `${leadPrompt}\n\n` : ''}项目团队：${state.team.name}
当前阶段：${activeVersion ? `${activeVersion.name} · ${activeVersion.stage}` : '需求/版本工作流尚未开始'}
成员（${activeMembers.length}）：
${lines.length === 0 ? '- （暂无成员）' : lines.join('\n')}

规划操作（角色/成员/需求/版本/会议）由人类在右侧栏页面完成；你负责用官方团队工具协调成员、回应提问、汇报阻塞。`
  }

  const renderMemberSection = (state, memberName) => {
    const member = state.members.find((candidate) => candidate.name === memberName)
    if (member === undefined || member.removed) return ''
    const role = state.roles.find((candidate) => candidate.id === member.roleId)
    const activeMeeting = state.meetings.find((meeting) => meeting.status === 'active' && meeting.closedAt === null)
    const meetingSection = activeMeeting === undefined
      ? ''
      : activeMeeting.participants.includes(memberName)
        ? `\n## 会议进行中\n${MEETING_RULES}\n当前会议：${activeMeeting.title}\n`
        : `\n## 会议进行中（你未参会）\n${MEETING_RULES}\n禁止开始新工作或修改代码，等待会议结论后再继续。\n`
    return `## 你的角色（Agent Team Planner）
显示名：${member.displayName}
角色：${role?.name ?? '未配置'}（${member.roleId ?? 'unset'}）
${member.rolePrompt || role?.basePrompt || ''}
${member.customPrompt ? `\n专有要求：\n${member.customPrompt}` : ''}

交付约定：完成评审/测试等需要文档的任务时，把最终文档放进 \`<!--atplanner:artifact:begin-->\` 与 \`<!--atplanner:artifact:end-->\` 之间，团队长会自动归档为草稿产出物。${meetingSection}`
  }

  const identify = (agent) => {
    try {
      const membership = agentTeams().tryMembership(agent)
      if (membership === undefined) return undefined
      return { role: membership.role, leadSessionId: membership.root.id, name: membership.name }
    } catch {
      return undefined
    }
  }

  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'agent-team-planner:team',
        order: config.promptSectionOrder,
        text: (assembly) => {
          try {
            const agent = assembly?.agent
            if (agent === undefined) return ''
            const identity = identify(agent)
            if (identity === undefined) return ''
            // Sections are async-free; read the last state snapshot from disk synchronously is not possible,
            // so this closure only renders once the plugin cached it. S1 caches on every snapshot/command.
            const cached = st.promptCache
            if (cached === undefined || cached.leadSessionId !== identity.leadSessionId) return ''
            if (identity.role === 'lead') return renderLeadSection(cached.state)
            return renderMemberSection(cached.state, identity.name)
          } catch (error) {
            ctx.logger?.warn?.('agent-team-planner: prompt section failed %o', error)
            return ''
          }
        },
      }),
    'agent-team-planner: prompt section',
  )

  /* --------------------------------------------------------------- routes */

  const attachmentHandler = async (request) => {
    try {
      const url = new URL(request.url)
      const sessionId = url.searchParams.get('session') ?? ''
      const requirementId = url.searchParams.get('requirementId') ?? ''
      const attachmentId = url.searchParams.get('attachmentId') ?? ''
      if (sessionId === '' || requirementId === '' || attachmentId === '') {
        return json(fail('BAD_REQUEST', 'session, requirementId and attachmentId are required'), 400)
      }
      const state = await readState(sessionId)
      const requirement = state === undefined ? undefined : findRequirement(state, requirementId)
      const attachment = requirement?.attachments?.find((item) => item.id === attachmentId)
      if (attachment === undefined) return json(fail('NOT_FOUND', 'attachment not found'), 404)
      const bytes = await readFile(join(attachmentDir(sessionId, requirementId), attachment.storedName))
      return new Response(bytes, {
        status: 200,
        headers: {
          'content-type': attachment.mime || 'application/octet-stream',
          'content-disposition': `inline; filename="${encodeURIComponent(attachment.name)}"`,
          'cache-control': 'no-store',
        },
      })
    } catch (error) {
      return json(fail(error?.code ?? 'ATTACHMENT_FAILED', String(error?.message ?? error)), 500)
    }
  }

  const stateHandler = async (request) => {
    try {
      const url = new URL(request.url)
      const sessionId = url.searchParams.get('session') ?? ''
      if (sessionId === '') return json(fail('BAD_REQUEST', 'session query parameter is required'), 400)
      const workspace = url.searchParams.get('workspace') ?? ''
      if (workspace !== '') st.workspaceHints.set(sessionId, workspace)
      const state = (await readState(sessionId)) ?? emptyState(sessionId)
      let official = { members: [], tasks: [] }
      let teamInfo = { bound: false, leadAvailable: false, role: undefined, officialRole: undefined }
      try {
        const resolved = await resolveProjectLead(sessionId)
        official = { members: listMembers(resolved.lead), tasks: listTasksSafely(resolved.lead) }
        teamInfo = {
          bound: state.team.leadSessionId === resolved.leadSessionId,
          leadAvailable: true,
          role: resolved.role,
          officialRole: resolved.role,
          leadSessionId: resolved.leadSessionId,
        }
        const added = reconcileMembers(state, resolved.lead)
        if (added > 0) {
          await enqueue(() => writeState(sessionId, state))
        }
        hydrateRoutes(state)
        let resumed = false
        if (state.settings?.highEfficiencyMode === true && inDiscountWindow()) {
          const before = JSON.stringify({
            versions: state.versions.map((version) => [version.id, version.stage, version.status]),
            bindings: state.bindings.map((binding) => [binding.taskId, binding.lastKnownStatus, binding.memberName, binding.abandonedAt]),
          })
          await pumpVersion(state, resolved)
          resumed = before !== JSON.stringify({
            versions: state.versions.map((version) => [version.id, version.stage, version.status]),
            bindings: state.bindings.map((binding) => [binding.taskId, binding.lastKnownStatus, binding.memberName, binding.abandonedAt]),
          })
        }
        if (resumed) await enqueue(() => writeState(sessionId, state))
        st.promptCache = { leadSessionId: resolved.leadSessionId, state }
      } catch (error) {
        let currentRole
        try {
          currentRole = (await resolveLead(sessionId)).role
        } catch {
          // current session is not a live Lead either
        }
        teamInfo = {
          bound: typeof state.team.leadSessionId === 'string',
          leadAvailable: false,
          role: currentRole,
          officialRole: currentRole,
          currentRole,
          error: { code: error?.code ?? 'LEAD_NOT_LIVE', message: String(error?.message ?? error) },
          leadSessionId: state.team.leadSessionId ?? undefined,
        }
      }
      return json(ok({ state, official, team: teamInfo, bridge: { loaded: st.bridge !== undefined, error: st.bridgeError } }))
    } catch (error) {
      return json(fail(error?.code ?? 'STATE_FAILED', String(error?.message ?? error), error?.details), 500)
    }
  }

  const commandHandler = async (request) => {
    let body
    try {
      body = await request.json()
    } catch {
      return json(fail('BAD_REQUEST', 'request body must be JSON'), 400)
    }
    const sessionId = typeof body?.session === 'string' ? body.session : ''
    const workspace = typeof body?.workspace === 'string' ? body.workspace : ''
    if (workspace !== '') st.workspaceHints.set(sessionId, workspace)
    const op = typeof body?.op === 'string' ? body.op : ''
    const expectedRevision = body?.expectedRevision
    const payload = body?.payload ?? {}
    if (sessionId === '' || op === '') return json(fail('BAD_REQUEST', 'session and op are required'), 400)
    try {
      const result = await runCommand(sessionId, op, payload, expectedRevision)
      return json(ok(result))
    } catch (error) {
      return json(fail(error?.code ?? 'COMMAND_FAILED', String(error?.message ?? error), error?.details))
    }
  }

  const runCommand = async (sessionId, op, payload, expectedRevision) => {
    // Backward/PRD-compatible aliases.
    if (op === 'team.recover') return await runCommand(sessionId, 'team.recreateMissing', payload, expectedRevision)
    if (op === 'catalog.get') {
      const controller = optional('sessionController')
      if (controller === undefined || typeof controller.modelCatalog !== 'function') {
        throw Object.assign(new Error('model catalog is not available in this deployment'), { code: 'CATALOG_UNAVAILABLE' })
      }
      const catalog = await controller.modelCatalog()
      return {
        catalog: {
          default: catalog.default,
          routableProviders: catalog.routableProviders,
          groups: (catalog.groups ?? []).map((group) => ({
            id: group.id,
            name: group.name,
            models: (group.models ?? []).map((model) => ({
              id: model.id,
              name: model.name,
              description: model.description,
              reasoning: model.reasoning,
            })),
          })),
          failures: catalog.failures,
        },
      }
    }

    if (op === 'team.bind') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const resolved = await resolveLead(sessionId)
        if (resolved.role !== 'lead') throw Object.assign(new Error('bind requires the Team Session'), { code: 'NOT_LEAD' })
        const previousLeadSessionId = state.team.leadSessionId
        state.team.previousLeadSessionId = previousLeadSessionId ?? null
        state.team.leadSessionId = resolved.leadSessionId
        state.team.leadSessionTitle = payload?.title ?? sessionOf(sessionId)?.header?.title ?? '项目团队'
        state.team.boundAt = nowIso()
        state.team.boundBy = 'ui'
        if (typeof payload?.name === 'string' && payload.name.trim() !== '') state.team.name = payload.name.trim()
        appendActivity(
          state,
          previousLeadSessionId === null || previousLeadSessionId === undefined ? 'team.bind' : 'team.rebind',
          `项目团队绑定到 ${resolved.leadSessionId}${previousLeadSessionId && previousLeadSessionId !== resolved.leadSessionId ? `（原 ${previousLeadSessionId}）` : ''}`,
        )
        if (typeof previousLeadSessionId === 'string' && previousLeadSessionId !== resolved.leadSessionId) {
          // The official team state lives in the old session log; in-flight versions lose their tasks.
          for (const version of state.versions) {
            if (version.status !== 'active') continue
            version.status = 'interrupted'
            version.updatedAt = nowIso()
            appendActivity(state, 'version.interrupted', `${version.name}（Team Session 重绑）`)
          }
          for (const binding of state.bindings) {
            if (binding.abandonedAt === undefined && binding.lastKnownStatus !== 'completed') binding.abandonedAt = nowIso()
          }
        }
        st.promptCache = { leadSessionId: resolved.leadSessionId, state }
        reconcileMembers(state, resolved.lead)
        hydrateRoutes(state)
        return { state, bound: true, previousLeadSessionId: previousLeadSessionId ?? null }
      })
    }

    if (op === 'settings.update') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        if (payload?.highEfficiencyMode !== undefined) {
          state.settings.highEfficiencyMode = payload.highEfficiencyMode === true
          appendActivity(state, 'settings.highEfficiency', state.settings.highEfficiencyMode ? '开启高能效模式' : '关闭高能效模式')
        }
        return { state, settings: state.settings }
      })
    }

    if (op === 'team.setLeadRoute') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const resolved = await resolveProjectLead(sessionId)
        if (resolved.role !== 'lead') throw Object.assign(new Error('只有团队长会话可以设置团队长模型'), { code: 'NOT_LEAD' })
        const route = normalizeRoute(payload?.route)
        let selected = null
        if (route !== null) {
          const controller = optional('sessionController')
          if (controller === undefined || typeof controller.selectModel !== 'function') {
            throw Object.assign(new Error('sessionController.selectModel 不可用'), { code: 'CATALOG_UNAVAILABLE' })
          }
          selected = await controller.selectModel({
            sessionId: resolved.leadSessionId,
            provider: route.provider,
            model: route.model,
            ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
          })
        }
        state.team.leadRoute = route
        appendActivity(state, 'team.setLeadRoute', route === null ? '继承默认' : `${route.provider}/${route.model}`)
        return { state, selected }
      })
    }

    if (op === 'role.create') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const id = String(payload?.id ?? '').trim()
        if (!/^[a-z][a-z0-9-]{1,31}$/.test(id)) throw Object.assign(new Error('invalid role id'), { code: 'VALIDATION' })
        if (state.roles.some((role) => role.id === id)) throw Object.assign(new Error('role id already exists'), { code: 'VALIDATION' })
        const basePrompt = String(payload?.basePrompt ?? '').trim()
        if (basePrompt === '') throw Object.assign(new Error('角色默认提示词不能为空'), { code: 'VALIDATION' })
        state.roles.push({
          id,
          name: String(payload?.name ?? id),
          description: String(payload?.description ?? ''),
          basePrompt,
          stageHints: Array.isArray(payload?.stageHints) ? payload.stageHints : [],
          builtin: false,
          order: Number.isFinite(payload?.order) ? payload.order : state.roles.length * 10,
          createdAt: nowIso(),
        })
        appendActivity(state, 'role.create', `新增角色 ${id}`)
        return { state }
      })
    }

    if (op === 'role.update') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const role = state.roles.find((candidate) => candidate.id === payload?.id)
        if (role === undefined) throw Object.assign(new Error('role not found'), { code: 'ROLE_NOT_FOUND' })
        if (role.id === 'lead' && payload?.id !== 'lead') throw Object.assign(new Error('lead role is fixed'), { code: 'VALIDATION' })
        const previousBasePrompt = role.basePrompt
        if (typeof payload?.name === 'string') role.name = payload.name
        if (typeof payload?.description === 'string') role.description = payload.description
        if (typeof payload?.basePrompt === 'string') role.basePrompt = payload.basePrompt
        if (Array.isArray(payload?.stageHints)) role.stageHints = payload.stageHints
        if (Number.isFinite(payload?.order)) role.order = payload.order
        const synced =
          typeof payload?.basePrompt === 'string' && payload.basePrompt !== previousBasePrompt
            ? syncRolePromptToMembers(state, role, previousBasePrompt)
            : 0
        appendActivity(
          state,
          'role.update',
          `更新角色 ${role.id}${synced > 0 ? `，同步 ${synced} 个继承该角色的成员提示词` : ''}`,
        )
        return { state, syncedMembers: synced }
      })
    }

    if (op === 'role.delete') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const id = payload?.id
        if (id === 'lead') throw Object.assign(new Error('lead role cannot be deleted'), { code: 'VALIDATION' })
        const usedByMember = state.members.some((member) => member.roleId === id)
        const usedByRequirement = state.requirements.some(
          (requirement) =>
            (requirement.roleTags ?? []).includes(id) ||
            (requirement.taskSpecs ?? []).some((spec) => spec.role === id),
        )
        const usedBySettings = Object.values(state.settings.defaultRoleByStage ?? {}).includes(id)
        if (usedByMember || usedByRequirement || usedBySettings) {
          throw Object.assign(new Error('role is still referenced'), { code: 'ROLE_IN_USE' })
        }
        state.roles = state.roles.filter((role) => role.id !== id)
        appendActivity(state, 'role.delete', `删除角色 ${id}`)
        return { state }
      })
    }

    if (op === 'role.restoreDefaults') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const defaults = defaultRoles()
        for (const role of defaults) {
          const existing = state.roles.find((candidate) => candidate.id === role.id)
          if (existing === undefined) state.roles.push(role)
        }
        appendActivity(state, 'role.restoreDefaults', '恢复默认角色')
        return { state }
      })
    }

    if (op === 'role.reset') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const target = state.roles.find((candidate) => candidate.id === payload?.id)
        if (target === undefined) throw Object.assign(new Error('role not found'), { code: 'ROLE_NOT_FOUND' })
        if (target.builtin !== true) {
          throw Object.assign(new Error('only built-in roles have a packaged default'), { code: 'VALIDATION' })
        }
        const preset = defaultRoles().find((candidate) => candidate.id === target.id)
        if (preset === undefined) throw Object.assign(new Error('no packaged default for this role'), { code: 'VALIDATION' })
        const previousBasePrompt = target.basePrompt
        target.name = preset.name
        target.description = preset.description
        target.basePrompt = preset.basePrompt
        target.stageHints = preset.stageHints
        const synced = syncRolePromptToMembers(state, target, previousBasePrompt)
        appendActivity(state, 'role.reset', `恢复角色默认 ${target.id}${synced > 0 ? `，同步 ${synced} 个成员` : ''}`)
        return { state, syncedMembers: synced }
      })
    }

    if (op === 'role.syncMembers') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const role = state.roles.find((candidate) => candidate.id === payload?.id)
        if (role === undefined) throw Object.assign(new Error('role not found'), { code: 'ROLE_NOT_FOUND' })
        let synced = 0
        for (const member of state.members) {
          if (member.roleId !== role.id) continue
          member.rolePrompt = role.basePrompt
          member.promptRevision = (member.promptRevision ?? 0) + 1
          member.promptAppliedAt = nowIso()
          synced += 1
        }
        appendActivity(state, 'role.syncMembers', `角色 ${role.id} 提示词覆盖 ${synced} 个成员`)
        return { state, syncedMembers: synced }
      })
    }

    if (op === 'member.create') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const name = String(payload?.name ?? '')
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64 || name === 'lead') {
          throw Object.assign(new Error('invalid member name'), { code: 'VALIDATION' })
        }
        if (state.members.some((member) => member.name === name)) {
          const existing = state.members.find((member) => member.name === name)
          if (existing.removed === true) {
            throw Object.assign(
              new Error(
                '该成员已被移出团队，但配置与官方成员记录仍保留，成员名不可复用。请换一个名字，或在“显示已移出成员”中恢复该成员。',
              ),
              { code: 'MEMBER_NAME_RESERVED' },
            )
          }
          throw Object.assign(new Error('同名成员已存在，请直接编辑该成员配置，或换一个名字。'), {
            code: 'MEMBER_NAME_TAKEN',
          })
        }
        const roleId = String(payload?.roleId ?? '')
        if (roleId === 'lead') throw Object.assign(new Error('lead 角色不能分配给普通成员'), { code: 'VALIDATION' })
        const role = state.roles.find((candidate) => candidate.id === roleId)
        if (role === undefined) throw Object.assign(new Error('role not found'), { code: 'ROLE_NOT_FOUND' })
        const route = normalizeRoute(payload?.route)
        const displayName = String(payload?.displayName ?? name)
        const record = {
          name,
          displayName,
          roleId,
          rolePrompt: String(payload?.rolePrompt ?? role.basePrompt),
          customPrompt: String(payload?.customPrompt ?? ''),
          description: memberDescription(role, displayName, payload?.description),
          context: payload?.context === 'fork' ? 'fork' : 'fresh',
          provider: payload?.provider === 'fork' ? 'fork' : 'spawn',
          route,
          blocked: false,
          blockedAt: null,
          blockedReason: '',
          removed: false,
          removedAt: null,
          // Official teammate is created lazily on the first dispatch/claim.
          creation: { status: 'pending', officialMemberId: null },
          createdAt: nowIso(),
          promptRevision: 0,
          promptAppliedAt: null,
        }
        state.members.push(record)
        if (route !== null) st.routeByMember.set(name, route)
        appendActivity(state, 'member.create.pending', `创建成员配置 ${name}（待首次派发激活）`)
        return { state, member: record }
      })
    }

    if (op === 'member.update') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        await ensureMemberConfig(sessionId, state, payload?.name)
        const record = memberConfig(state, payload?.name)
        if (record === undefined) throw Object.assign(new Error('member config not found'), { code: 'VALIDATION' })
        if (typeof payload?.displayName === 'string') record.displayName = payload.displayName
        if (typeof payload?.roleId === 'string') {
          if (payload.roleId === 'lead') throw Object.assign(new Error('lead 角色不能分配给普通成员'), { code: 'VALIDATION' })
          const previousRole = state.roles.find((candidate) => candidate.id === record.roleId)
          const role = state.roles.find((candidate) => candidate.id === payload.roleId)
          if (role === undefined) throw Object.assign(new Error('role not found'), { code: 'ROLE_NOT_FOUND' })
          if (payload?.rolePrompt === undefined) {
            const current = typeof record.rolePrompt === 'string' ? record.rolePrompt : ''
            const isInherited = current === '' || (previousRole !== undefined && current === previousRole.basePrompt)
            if (isInherited) record.rolePrompt = role.basePrompt
          }
          record.roleId = role.id
        }
        if (typeof payload?.rolePrompt === 'string') record.rolePrompt = payload.rolePrompt
        if (typeof payload?.customPrompt === 'string') record.customPrompt = payload.customPrompt
        let appliedToLiveAgent = false
        if (payload !== null && typeof payload === 'object' && 'route' in payload) {
          const route = normalizeRoute(payload.route)
          record.route = route
          if (route === null) st.routeByMember.delete(record.name)
          else st.routeByMember.set(record.name, route)
          const resolved = await resolveLead(sessionId).catch(() => undefined)
          if (resolved !== undefined) appliedToLiveAgent = applyRouteToLiveAgent(resolved.lead, record.name, route)
        }
        record.promptRevision += 1
        record.promptAppliedAt = nowIso()
        appendActivity(state, 'member.update', `更新成员配置 ${record.name}`)
        return { state, appliedToLiveAgent }
      })
    }

    if (op === 'member.setRoute') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        await ensureMemberConfig(sessionId, state, payload?.name)
        const record = memberConfig(state, payload?.name)
        if (record === undefined) throw Object.assign(new Error('member config not found'), { code: 'VALIDATION' })
        const route = normalizeRoute(payload?.route)
        record.route = route
        if (route === null) st.routeByMember.delete(record.name)
        else st.routeByMember.set(record.name, route)
        const resolved = await resolveLead(sessionId).catch(() => undefined)
        let applied = false
        if (resolved !== undefined) applied = applyRouteToLiveAgent(resolved.lead, record.name, route)
        appendActivity(state, 'member.setRoute', `${record.name} -> ${route === null ? 'inherit' : `${route.provider}/${route.model}`}`)
        return { state, appliedToLiveAgent: applied }
      })
    }

    if (op === 'member.block' || op === 'member.unblock') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        await ensureMemberConfig(sessionId, state, payload?.name)
        const record = memberConfig(state, payload?.name)
        if (record === undefined) throw Object.assign(new Error('member config not found'), { code: 'VALIDATION' })
        const blocking = op === 'member.block'
        record.blocked = blocking
        record.blockedAt = blocking ? nowIso() : null
        record.blockedReason = blocking ? String(payload?.reason ?? '') : ''
        let released = []
        if (blocking) {
          const resolved = await resolveProjectLead(sessionId).catch(() => undefined)
          if (resolved !== undefined) {
            const member = findOfficialMember(resolved.lead, record.name)
            if (member !== undefined) {
              const tasks = agentTeams().listTasks(resolved.lead)
              for (const task of tasks) {
                if (task.ownerName !== record.name || task.status !== 'in_progress') continue
                try {
                  await agentTeams().updateTask(resolved.lead, {
                    taskId: task.id,
                    expectedRevision: task.revision,
                    action: 'release',
                  })
                  released.push(task.id)
                } catch {
                  // best effort; surfaced through activity below
                }
              }
            }
          }
        }
        appendActivity(state, blocking ? 'member.block' : 'member.unblock', `${record.name}${released.length ? ` 回收任务 ${released.join(',')}` : ''}`)
        return { state, releasedTaskIds: released }
      })
    }

    if (op === 'member.remove' || op === 'member.restore') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        await ensureMemberConfig(sessionId, state, payload?.name)
        const record = memberConfig(state, payload?.name)
        if (record === undefined) throw Object.assign(new Error('member config not found'), { code: 'VALIDATION' })
        const removing = op === 'member.remove'
        record.removed = removing
        record.removedAt = removing ? nowIso() : null
        let releasedTaskIds = []
        if (removing) {
          // Logical removal also releases tasks still owned by the member (Lead release).
          try {
            const resolved = await resolveProjectLead(sessionId)
            const member = findOfficialMember(resolved.lead, record.name)
            if (member !== undefined) {
              for (const task of listTasksSafely(resolved.lead)) {
                if (task.ownerName !== record.name || task.status !== 'in_progress') continue
                try {
                  await agentTeams().updateTask(resolved.lead, {
                    taskId: task.id,
                    expectedRevision: task.revision,
                    action: 'release',
                  })
                  releasedTaskIds.push(task.id)
                } catch {
                  // best effort
                }
              }
            }
          } catch {
            // leave tasks to the operator
          }
        }
        appendActivity(state, removing ? 'member.remove' : 'member.restore', record.name)
        return { state, releasedTaskIds }
      })
    }

    if (op === 'member.forget') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        await ensureMemberConfig(sessionId, state, payload?.name)
        const record = memberConfig(state, payload?.name)
        if (record === undefined) {
          throw Object.assign(new Error('成员配置不存在'), { code: 'VALIDATION' })
        }
        if (
          record.creation?.status === 'active' &&
          typeof record.creation?.officialMemberId === 'string' &&
          record.creation.officialMemberId !== ''
        ) {
          throw Object.assign(
            new Error(
              '该成员的官方记录仍在（官方成员名不可复用）。删除配置将无法再用该名字创建成员；请改用“移出团队”，或保留配置。',
            ),
            { code: 'MEMBER_ACTIVE_CANNOT_FORGET' },
          )
        }
        state.members = state.members.filter((member) => member.name !== payload?.name)
        appendActivity(state, 'member.forget', String(payload?.name ?? ''))
        return { state }
      })
    }

    if (op === 'member.recreate') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        await ensureMemberConfig(sessionId, state, payload?.name)
        const record = memberConfig(state, payload?.name)
        if (record === undefined) throw Object.assign(new Error('member config not found'), { code: 'VALIDATION' })
        const resolved = await resolveProjectLead(sessionId)
        const role = state.roles.find((candidate) => candidate.id === record.roleId)
        record.description = memberDescription(role, record.displayName, record.description)
        const initialPrompt = initialPromptFor(state, record)
        if (record.route !== null) st.routeByMember.set(record.name, record.route)
        try {
          const member = await spawnMember(resolved.lead, {
            name: record.name,
            description: record.description,
            context: record.context,
            provider: record.provider,
            initialPrompt,
          })
          record.creation.status = 'active'
          record.creation.officialMemberId = member.id
          record.creation.error = undefined
          appendActivity(state, 'member.recreate', record.name)
          return { state, member }
        } catch (error) {
          record.creation.status = 'failed'
          record.creation.error = String(error?.message ?? error)
          appendActivity(state, 'member.recreate.failed', `${record.name}: ${record.creation.error}`)
          await writeState(sessionId, state)
          throw Object.assign(new Error(`成员重建失败：${record.creation.error}`), { code: 'OFFICIAL_ERROR' })
        }
      })
    }

    if (op === 'team.recreateMissing') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const resolved = await resolveProjectLead(sessionId)
        const targets = state.members.filter((member) => member.removed !== true && member.creation?.status !== 'active')
        const results = []
        for (const record of targets) {
          try {
            const role = state.roles.find((candidate) => candidate.id === record.roleId)
            record.description = memberDescription(role, record.displayName, record.description)
            if (record.route !== null) st.routeByMember.set(record.name, record.route)
            const member = await spawnMember(resolved.lead, {
              name: record.name,
              description: record.description,
              context: record.context,
              provider: record.provider,
              initialPrompt: initialPromptFor(state, record),
            })
            record.creation = { status: 'active', officialMemberId: member.id }
            results.push({ name: record.name, ok: true })
          } catch (error) {
            record.creation = { status: 'failed', officialMemberId: null, error: String(error?.message ?? error) }
            results.push({ name: record.name, ok: false, error: record.creation.error })
          }
        }
        appendActivity(state, 'team.recreateMissing', `重建缺失成员 ${results.filter((r) => r.ok).length}/${results.length}`)
        await writeState(sessionId, state)
        return { state, results }
      })
    }

    /* ---------------------------------------------------------- requirements */

    if (op === 'requirement.create') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const title = String(payload?.title ?? '').trim()
        if (title === '') throw Object.assign(new Error('需求标题不能为空'), { code: 'VALIDATION' })
        const assignees = [...new Set((Array.isArray(payload?.assignees) ? payload.assignees : []).map(String))].filter(
          (name) => state.members.some((member) => member.name === name && member.removed !== true && !member.blocked),
        )
        const derivedRoles = assignees
          .map((name) => state.members.find((member) => member.name === name)?.roleId)
          .filter((roleId) => typeof roleId === 'string' && roleId !== '')
        const roleTags = Array.isArray(payload?.roleTags)
          ? payload.roleTags.filter((id) => state.roles.some((role) => role.id === id))
          : [...new Set(derivedRoles)]
        const requirement = {
          id: `req-${randomUUID()}`,
          title,
          description: String(payload?.description ?? ''),
          status: 'draft',
          versionId: null,
          roleTags,
          assignees,
          taskSpecs: [],
          attachments: [],
          requirementArtifactId: null,
          source: { kind: 'manual' },
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        requirement.taskSpecs = autoTaskSpecs(state, requirement)
        state.requirements.push(requirement)
        const artifact = createArtifactRecord(state, {
          requirementId: requirement.id,
          type: 'requirement_doc',
          title: `需求文档：${title}`,
          content: requirementDocTemplate(requirement),
        })
        requirement.requirementArtifactId = artifact.id
        appendActivity(state, 'requirement.create', title)
        return { state, requirement, artifact }
      })
    }

    if (op === 'requirement.update') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const requirement = findRequirement(state, payload?.id)
        if (requirement === undefined) throw Object.assign(new Error('需求不存在'), { code: 'VALIDATION' })
        assertRequirementWritable(state, requirement, '编辑需求')
        if (typeof payload?.title === 'string' && payload.title.trim() !== '') requirement.title = payload.title.trim()
        if (typeof payload?.description === 'string') requirement.description = payload.description
        if (Array.isArray(payload?.roleTags)) {
          requirement.roleTags = payload.roleTags.filter((id) => state.roles.some((role) => role.id === id))
        }
        if (Array.isArray(payload?.assignees)) {
          requirement.assignees = [...new Set(payload.assignees.map(String))].filter(
            (name) => state.members.some((member) => member.name === name && member.removed !== true && !member.blocked),
          )
        }
        requirement.updatedAt = nowIso()
        appendActivity(state, 'requirement.update', requirement.title)
        return { state, requirement }
      })
    }

    if (op === 'requirement.delete') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const requirement = findRequirement(state, payload?.id)
        if (requirement === undefined) throw Object.assign(new Error('需求不存在'), { code: 'VALIDATION' })
        if (requirement.versionId !== null) {
          throw Object.assign(new Error('需求已绑定版本，不能删除；请先解绑'), { code: 'REQUIREMENT_BOUND' })
        }
        if (requirement.status !== 'draft') {
          throw Object.assign(new Error('只有草稿状态的需求可以删除'), { code: 'VALIDATION' })
        }
        state.requirements = state.requirements.filter((candidate) => candidate.id !== requirement.id)
        state.artifacts = state.artifacts.filter((artifact) => artifact.requirementId !== requirement.id)
        appendActivity(state, 'requirement.delete', requirement.title)
        return { state }
      })
    }

    if (op === 'requirement.setTaskSpecs') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const requirement = findRequirement(state, payload?.id)
        if (requirement === undefined) throw Object.assign(new Error('需求不存在'), { code: 'VALIDATION' })
        assertRequirementWritable(state, requirement, '编辑任务规格')
        const specs = Array.isArray(payload?.specs) ? payload.specs : []
        const keys = new Set()
        for (const spec of specs) {
          const key = String(spec?.key ?? '').trim()
          if (key === '' || keys.has(key)) throw Object.assign(new Error('任务规格 key 必须非空且唯一'), { code: 'VALIDATION' })
          keys.add(key)
          if (String(spec?.objective ?? '').trim() === '') throw Object.assign(new Error(`任务规格 ${key} 的目标不能为空`), { code: 'VALIDATION' })
          const roleId = String(spec?.role ?? '')
          if (!state.roles.some((role) => role.id === roleId)) throw Object.assign(new Error(`任务规格 ${key} 的角色不存在`), { code: 'VALIDATION' })
        }
        for (const spec of specs) {
          for (const dependency of Array.isArray(spec?.dependsOn) ? spec.dependsOn : []) {
            if (!keys.has(String(dependency))) throw Object.assign(new Error(`任务规格 ${spec.key} 依赖的 ${dependency} 不存在`), { code: 'VALIDATION' })
          }
        }
        requirement.taskSpecs = specs.map((spec) => ({
          key: String(spec.key),
          objective: String(spec.objective),
          role: String(spec.role),
          dependsOn: Array.isArray(spec.dependsOn) ? spec.dependsOn.map(String) : [],
          acceptance: String(spec.acceptance ?? ''),
          writeScopes: Array.isArray(spec.writeScopes) ? spec.writeScopes.map(String) : [],
          stage: spec.stage === 'testing' ? 'testing' : 'development',
          ...(typeof spec.preferredMember === 'string' && state.members.some((member) => member.name === spec.preferredMember)
            ? { preferredMember: spec.preferredMember }
            : {}),
        }))
        requirement.updatedAt = nowIso()
        appendActivity(state, 'requirement.setTaskSpecs', `${requirement.title} (${requirement.taskSpecs.length} 个任务规格)`)
        return { state, requirement }
      })
    }

    if (op === 'workflow.requestLeadSplit') {
      // Local deterministic split: asking the live team lead here makes the
      // button unusable whenever the lead session is busy. The requirement's
      // selected members / role tags carry enough information to split safely.
      return await mutateState(sessionId, expectedRevision, (state) => {
        const requirement = findRequirement(state, payload?.requirementId)
        if (requirement === undefined) throw Object.assign(new Error('需求不存在'), { code: 'VALIDATION' })
        const version = requirement.versionId === null ? undefined : findVersion(state, requirement.versionId)
        if (version !== undefined && (version.status === 'completed' || version.status === 'archived')) {
          throw Object.assign(new Error('版本已完成/归档，不能再拆分'), { code: 'VERSION_STATE' })
        }
        const specs = autoTaskSpecs(state, requirement)
        if (specs.length === 0) {
          throw Object.assign(new Error('没有可用的成员或角色，请先在需求中指定成员'), { code: 'TASK_SPECS_EMPTY' })
        }
        requirement.taskSpecs = specs
        requirement.updatedAt = nowIso()
        appendActivity(state, 'workflow.leadSplit.local', `${requirement.title}：拆分 ${specs.length} 个任务规格`)
        return { state, specs, requirementId: requirement.id }
      })
    }

    if (op === 'workflow.autoTaskSpecs') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const requirement = findRequirement(state, payload?.requirementId)
        if (requirement === undefined) throw Object.assign(new Error('需求不存在'), { code: 'VALIDATION' })
        const version = requirement.versionId === null ? undefined : findVersion(state, requirement.versionId)
        if (version !== undefined && (version.status === 'completed' || version.status === 'archived')) {
          throw Object.assign(new Error('版本已完成/归档，不能再生成任务规格'), { code: 'VERSION_STATE' })
        }
        if ((requirement.taskSpecs ?? []).length > 0 && payload?.overwrite !== true) {
          throw Object.assign(new Error('已有任务规格；如需覆盖请确认 overwrite'), { code: 'TASK_SPECS_EXIST' })
        }
        const roleIds = (requirement.roleTags ?? []).filter((id) => state.roles.some((role) => role.id === id))
        const targets = roleIds.length > 0 ? roleIds : ['backend']
        if (!targets.every((id) => state.roles.some((role) => role.id === id))) {
          throw Object.assign(new Error('角色标签中包含不存在的角色'), { code: 'VALIDATION' })
        }
        const acceptance = String(requirement.description ?? '').trim().slice(0, 300) || '满足需求文档与验收标准'
        const specs = targets.map((roleId, index) => {
          const role = state.roles.find((candidate) => candidate.id === roleId)
          return {
            key: String(index + 1),
            objective: `${requirement.title}：${role?.name ?? roleId}开发`,
            role: roleId,
            dependsOn: [],
            acceptance,
            writeScopes: [],
            stage: 'development',
          }
        })
        requirement.taskSpecs = specs
        requirement.updatedAt = nowIso()
        appendActivity(state, 'workflow.autoTaskSpecs', `${requirement.title}：自动生成 ${specs.length} 个任务规格`)
        return { state, specs, requirementId: requirement.id }
      })
    }

    /* ------------------------------------------------------------- artifacts */

    if (op === 'requirement.attach') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const requirement = findRequirement(state, payload?.requirementId)
        if (requirement === undefined) throw Object.assign(new Error('需求不存在'), { code: 'VALIDATION' })
        assertRequirementWritable(state, requirement, '上传需求附件')
        const name = String(payload?.name ?? '').trim()
        const extension = attachmentExtension(name)
        if (extension === undefined) {
          throw Object.assign(new Error('仅支持 txt/doc/docx/xls/xlsx/png/jpg/jpeg 文件'), { code: 'ATTACHMENT_TYPE' })
        }
        const buffer = Buffer.from(String(payload?.dataBase64 ?? ''), 'base64')
        if (buffer.length === 0) throw Object.assign(new Error('附件内容为空'), { code: 'VALIDATION' })
        if (buffer.length > ATTACHMENT_MAX_BYTES) throw Object.assign(new Error('附件超过 10MB 上限'), { code: 'ATTACHMENT_TOO_LARGE' })
        const attachmentId = `att-${randomUUID()}`
        const storedName = `${attachmentId}-${safeAttachmentName(name)}`
        const dir = attachmentDir(sessionId, requirement.id)
        await mkdir(dir, { recursive: true })
        await writeFile(join(dir, storedName), buffer)
        const attachment = {
          id: attachmentId,
          name,
          mime: String(payload?.mime ?? 'application/octet-stream'),
          size: buffer.length,
          storedName,
          createdAt: nowIso(),
        }
        requirement.attachments = [...(requirement.attachments ?? []), attachment]
        appendActivity(state, 'requirement.attach', `${requirement.title} · ${name}`)
        return { state, requirement, attachment }
      })
    }

    if (op === 'requirement.detach') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const requirement = findRequirement(state, payload?.requirementId)
        if (requirement === undefined) throw Object.assign(new Error('需求不存在'), { code: 'VALIDATION' })
        assertRequirementWritable(state, requirement, '删除需求附件')
        const attachment = (requirement.attachments ?? []).find((item) => item.id === payload?.attachmentId)
        if (attachment === undefined) throw Object.assign(new Error('附件不存在'), { code: 'VALIDATION' })
        requirement.attachments = (requirement.attachments ?? []).filter((item) => item.id !== attachment.id)
        try { await unlink(join(attachmentDir(sessionId, requirement.id), attachment.storedName)) } catch {}
        appendActivity(state, 'requirement.detach', `${requirement.title} · ${attachment.name}`)
        return { state, requirement }
      })
    }

    if (op === 'artifact.create') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const type = String(payload?.type ?? '')
        const allowed = ['requirement_doc', 'architecture_doc', 'review_report', 'test_report', 'test_plan', 'meeting_minutes', 'custom']
        if (!allowed.includes(type)) throw Object.assign(new Error('未知的产出物类型'), { code: 'VALIDATION' })
        const title = String(payload?.title ?? '').trim()
        if (title === '') throw Object.assign(new Error('产出物标题不能为空'), { code: 'VALIDATION' })
        const requirementId = typeof payload?.requirementId === 'string' ? payload.requirementId : null
        if (requirementId !== null && findRequirement(state, requirementId) === undefined) {
          throw Object.assign(new Error('需求不存在'), { code: 'VALIDATION' })
        }
        const versionId = typeof payload?.versionId === 'string' ? payload.versionId : null
        if (versionId !== null && findVersion(state, versionId) === undefined) {
          throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
        }
        if (versionId !== null) assertVersionWritable(findVersion(state, versionId), '新增产出物')
        const artifact = createArtifactRecord(state, {
          versionId,
          requirementId,
          type,
          title,
          content: String(payload?.content ?? ''),
        })
        if (type === 'requirement_doc' && requirementId !== null) {
          const requirement = findRequirement(state, requirementId)
          requirement.requirementArtifactId = artifact.id
        }
        appendActivity(state, 'artifact.create', `${type}: ${title}`)
        return { state, artifact }
      })
    }

    if (op === 'artifact.update') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const artifact = state.artifacts.find((candidate) => candidate.id === payload?.id)
        if (artifact === undefined) throw Object.assign(new Error('产出物不存在'), { code: 'VALIDATION' })
        if (artifact.versionId !== null) assertVersionWritable(findVersion(state, artifact.versionId), '编辑产出物')
        if (artifact.status !== 'draft') throw Object.assign(new Error('只有草稿状态的产出物可以编辑'), { code: 'VALIDATION' })
        if (typeof payload?.title === 'string' && payload.title.trim() !== '') artifact.title = payload.title.trim()
        if (typeof payload?.content === 'string') artifact.content = payload.content
        artifact.updatedAt = nowIso()
        appendActivity(state, 'artifact.update', artifact.title)
        return { state, artifact }
      })
    }

    if (op === 'artifact.approve') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const artifact = state.artifacts.find((candidate) => candidate.id === payload?.id)
        if (artifact === undefined) throw Object.assign(new Error('产出物不存在'), { code: 'VALIDATION' })
        if (artifact.versionId !== null) assertVersionWritable(findVersion(state, artifact.versionId), '确认产出物')
        artifact.status = artifact.type === 'architecture_doc' ? 'archived' : 'approved'
        artifact.updatedAt = nowIso()
        appendActivity(state, artifact.type === 'architecture_doc' ? 'artifact.archive' : 'artifact.approve', artifact.title)
        // Confirming a review/test report is a workflow gate: let the pump advance the stage.
        if (artifact.type === 'review_report' || artifact.type === 'test_report') {
          try {
            const resolved = await resolveProjectLead(sessionId)
            await pumpVersion(state, resolved)
          } catch {
            // the manual "推进阶段" button remains available
          }
        }
        return { state, artifact }
      })
    }

    if (op === 'artifact.archive') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const artifact = state.artifacts.find((candidate) => candidate.id === payload?.id)
        if (artifact === undefined) throw Object.assign(new Error('产出物不存在'), { code: 'VALIDATION' })
        if (artifact.versionId !== null) assertVersionWritable(findVersion(state, artifact.versionId), '归档产出物')
        if (artifact.status !== 'approved') throw Object.assign(new Error('只有已确认的产出物可以归档'), { code: 'VALIDATION' })
        artifact.status = 'archived'
        artifact.updatedAt = nowIso()
        appendActivity(state, 'artifact.archive', artifact.title)
        return { state, artifact }
      })
    }

    if (op === 'artifact.delete') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const artifact = state.artifacts.find((candidate) => candidate.id === payload?.id)
        if (artifact === undefined) throw Object.assign(new Error('产出物不存在'), { code: 'VALIDATION' })
        if (artifact.versionId !== null) assertVersionWritable(findVersion(state, artifact.versionId), '删除产出物')
        if (artifact.status !== 'draft') throw Object.assign(new Error('只有草稿状态的产出物可以删除'), { code: 'VALIDATION' })
        state.artifacts = state.artifacts.filter((candidate) => candidate.id !== artifact.id)
        if (artifact.requirementId !== null) {
          const requirement = findRequirement(state, artifact.requirementId)
          if (requirement !== undefined && requirement.requirementArtifactId === artifact.id) requirement.requirementArtifactId = null
        }
        appendActivity(state, 'artifact.delete', artifact.title)
        return { state }
      })
    }

    /* -------------------------------------------------------------- versions */

    if (op === 'version.create') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const name = String(payload?.name ?? '').trim()
        if (name === '') throw Object.assign(new Error('版本名不能为空'), { code: 'VALIDATION' })
        if (state.versions.some((version) => version.name === name)) {
          throw Object.assign(new Error('版本名已存在'), { code: 'VALIDATION' })
        }
        const version = {
          id: `ver-${randomUUID()}`,
          name,
          description: String(payload?.description ?? ''),
          planDate: String(payload?.planDate ?? ''),
          owner: String(payload?.owner ?? ''),
          notes: String(payload?.notes ?? ''),
          status: 'draft',
          stage: 'requirement',
          requirementIds: [],
          startedAt: null,
          completedAt: null,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        state.versions.push(version)
        appendActivity(state, 'version.create', name)
        return { state, version }
      })
    }

    if (op === 'version.update') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const version = findVersion(state, payload?.id)
        if (version === undefined) throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
        if (version.status !== 'draft') throw Object.assign(new Error('只有草稿版本可以编辑'), { code: 'VERSION_STATE' })
        if (typeof payload?.name === 'string' && payload.name.trim() !== '') {
          if (state.versions.some((candidate) => candidate.id !== version.id && candidate.name === payload.name.trim())) {
            throw Object.assign(new Error('版本名已存在'), { code: 'VALIDATION' })
          }
          version.name = payload.name.trim()
        }
        if (typeof payload?.description === 'string') version.description = payload.description
        if (typeof payload?.planDate === 'string') version.planDate = payload.planDate
        if (typeof payload?.owner === 'string') version.owner = payload.owner
        if (typeof payload?.notes === 'string') version.notes = payload.notes
        version.updatedAt = nowIso()
        appendActivity(state, 'version.update', version.name)
        return { state, version }
      })
    }

    if (op === 'version.delete') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const version = findVersion(state, payload?.id)
        if (version === undefined) throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
        if (version.status !== 'draft') throw Object.assign(new Error('只有草稿版本可以删除'), { code: 'VERSION_STATE' })
        for (const requirementId of version.requirementIds) {
          const requirement = findRequirement(state, requirementId)
          if (requirement !== undefined && requirement.versionId === version.id) {
            requirement.versionId = null
            requirement.status = 'draft'
          }
        }
        state.versions = state.versions.filter((candidate) => candidate.id !== version.id)
        state.meetings = state.meetings.filter((meeting) => meeting.versionId !== version.id)
        state.artifacts = state.artifacts.filter((artifact) => artifact.versionId !== version.id)
        state.bindings = state.bindings.filter((binding) => binding.versionId !== version.id)
        appendActivity(state, 'version.delete', version.name)
        return { state }
      })
    }

    if (op === 'version.bind') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const version = findVersion(state, payload?.versionId)
        if (version === undefined) throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
        if (version.status !== 'draft') throw Object.assign(new Error('只有草稿版本可以绑定需求'), { code: 'VERSION_STATE' })
        const ids = Array.isArray(payload?.requirementIds) ? payload.requirementIds : []
        for (const requirementId of ids) {
          const requirement = findRequirement(state, requirementId)
          if (requirement === undefined) throw Object.assign(new Error(`需求 ${requirementId} 不存在`), { code: 'VALIDATION' })
          bindRequirementToVersion(state, version, requirement, nowIso())
        }
        appendActivity(state, 'version.bind', `${version.name} <- ${ids.length} 个需求`)
        return { state, version }
      })
    }

    if (op === 'version.unbind') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const version = findVersion(state, payload?.versionId)
        if (version === undefined) throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
        if (version.status !== 'draft') throw Object.assign(new Error('只有草稿版本可以解绑需求'), { code: 'VERSION_STATE' })
        const requirement = findRequirement(state, payload?.requirementId)
        if (requirement === undefined) throw Object.assign(new Error('需求不存在'), { code: 'VALIDATION' })
        unbindRequirementFromVersion(state, version, requirement, nowIso())
        appendActivity(state, 'version.unbind', `${version.name} -x ${requirement.title}`)
        return { state, version }
      })
    }

    if (op === 'version.checkGate') {
      const state = (await readState(sessionId)) ?? emptyState(sessionId)
      const version = findVersion(state, payload?.versionId)
      if (version === undefined) throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
      return { versionId: version.id, stage: version.stage, missing: stageGateMissing(state, version) }
    }

    if (op === 'version.enterArchitecture') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const version = findVersion(state, payload?.versionId)
        if (version === undefined) throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
        if (version.status !== 'draft' || version.stage !== 'requirement') {
          throw Object.assign(new Error('当前版本不处于需求澄清阶段'), { code: 'VERSION_STATE' })
        }
        const missing = stageGateMissing(state, version)
        if (missing.length > 0) {
          throw Object.assign(new Error('需求澄清门禁未通过'), { code: 'STAGE_GATE', details: { missing } })
        }
        version.stage = 'architecture'
        version.updatedAt = nowIso()
        appendActivity(state, 'version.enterArchitecture', version.name)
        return { state, version }
      })
    }

    if (op === 'version.startDevelopment') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const resolved = await resolveProjectLead(sessionId)
        const version = findVersion(state, payload?.versionId)
        if (version === undefined) throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
        if (version.status !== 'draft' || version.stage !== 'architecture') {
          throw Object.assign(new Error('只有架构设计阶段的草稿版本可以开始开发'), { code: 'VERSION_STATE' })
        }
        if (state.versions.some((candidate) => candidate.status === 'active')) {
          throw Object.assign(new Error('已有进行中的版本，请先完成它'), { code: 'VERSION_STATE' })
        }
        const missing = stageGateMissing(state, version)
        if (missing.length > 0) throw Object.assign(new Error('架构门禁未通过'), { code: 'STAGE_GATE', details: { missing } })
        if (version.requirementIds.length === 0) throw Object.assign(new Error('版本未绑定需求'), { code: 'VALIDATION' })

        const plan = []
        for (const requirementId of version.requirementIds) {
          const requirement = findRequirement(state, requirementId)
          if (requirement === undefined) throw Object.assign(new Error(`需求 ${requirementId} 不存在`), { code: 'VALIDATION' })
          if ((requirement.taskSpecs || []).filter((spec) => spec.stage !== 'testing').length === 0) {
            requirement.taskSpecs = autoTaskSpecs(state, requirement)
          }
          const developmentSpecs = (requirement.taskSpecs || []).filter((spec) => spec.stage !== 'testing')
          if (developmentSpecs.length === 0) {
            throw Object.assign(
              new Error(`需求「${requirement.title}」缺少可用成员，无法自动生成开发任务规格`),
              { code: 'TASK_SPECS_MISSING', details: { requirementId: requirement.id, title: requirement.title } },
            )
          }
          for (const spec of developmentSpecs) {
            if (memberCandidateForRole(state, spec.role) === undefined) {
              throw Object.assign(new Error(`角色「${spec.role}」没有可用成员（需未屏蔽/未移出/创建成功）`), {
                code: 'ROLE_NO_MEMBER',
                details: { requirement: requirement.title, spec: spec.key, role: spec.role },
              })
            }
          }
          plan.push({ requirement, specs: topoSortSpecs(developmentSpecs) })
        }

        // Review/testing stages need their responsible roles available before the version starts.
        for (const stageId of ['review', 'testing']) {
          const roleId = stageDefaultRole(state, stageId)
          if (roleId !== undefined && memberCandidateForRole(state, roleId) === undefined) {
            throw Object.assign(new Error(`角色「${roleId}」没有可用成员，无法进入 ${stageId} 阶段`), {
              code: 'ROLE_NO_MEMBER',
              details: { stage: stageId, role: roleId },
            })
          }
        }

        const createdTaskIds = []
        const activation = {
          id: `act-${randomUUID()}`,
          versionId: version.id,
          phase: 'development',
          status: 'activating',
          createdTaskIds: [],
          startedAt: nowIso(),
          finishedAt: null,
          error: null,
        }
        state.activations.push(activation)
        try {
          for (const { requirement, specs } of plan) {
            const taskIdByKey = new Map()
            for (const spec of specs) {
              const blockedBy = (spec.dependsOn || []).map((key) => taskIdByKey.get(key)).filter((taskId) => taskId !== undefined)
              const binding = await createBindingTask(resolved, state, {
                taskKey: `${requirement.id}#${spec.key}`,
                versionId: version.id,
                requirementId: requirement.id,
                role: spec.role,
                preferredMember: spec.preferredMember,
                phase: 'development',
                subject: spec.objective,
                description: `${spec.acceptance || ''}\n\n[planner] version=${version.id} req=${requirement.id} spec=${spec.key} role=${spec.role}`,
                blockedBy,
                writeScopes: spec.writeScopes,
              })
              createdTaskIds.push(binding.taskId)
              activation.createdTaskIds.push(binding.taskId)
              taskIdByKey.set(spec.key, binding.taskId)
              // Persist after each task so a crash can be reconciled against the official board.
              await writeState(sessionId, state)
            }
          }
        } catch (error) {
          for (const taskId of [...createdTaskIds].reverse()) {
            try {
              const view = agentTeams().getTask(resolved.lead, taskId)
              await agentTeams().updateTask(resolved.lead, {
                taskId,
                expectedRevision: view.revision,
                action: 'delete',
              })
            } catch {
              // best-effort rollback
            }
          }
          state.bindings = state.bindings.filter((binding) => !createdTaskIds.includes(binding.taskId))
          activation.status = 'failed'
          activation.error = String(error?.message ?? error)
          activation.finishedAt = nowIso()
          await writeState(sessionId, state)
          throw error
        }

        version.status = 'active'
        version.stage = 'development'
        version.startedAt = nowIso()
        version.updatedAt = nowIso()
        activation.status = 'active'
        activation.finishedAt = nowIso()
        appendActivity(state, 'version.startDevelopment', `${version.name} 激活，创建 ${createdTaskIds.length} 个任务`)
        await pumpVersion(state, resolved)
        await writeState(sessionId, state)
        return { state, version, createdTaskIds, activationId: activation.id }
      })
    }

    if (op === 'version.advance') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const resolved = await resolveProjectLead(sessionId)
        const version = findVersion(state, payload?.versionId)
        if (version === undefined) throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
        if (version.status !== 'active') throw Object.assign(new Error('只有进行中的版本可以推进阶段'), { code: 'VERSION_STATE' })
        const before = version.stage
        await pumpVersion(state, resolved)
        if (version.status === 'active' && version.stage === 'review' && hasApprovedDoc(state, version.id, 'review_report')) {
          await enterTesting(state, resolved, version)
        }
        if (version.status === 'active' && version.stage === 'testing' && hasApprovedDoc(state, version.id, 'test_report')) {
          finalizeVersion(state, version)
        }
        if (version.status === 'active' && before === 'review' && version.stage === 'review') {
          const missing = []
          if (!hasApprovedDoc(state, version.id, 'review_report')) missing.push('评审报告未确认')
          if (missing.length > 0) throw Object.assign(new Error('Code Review 门禁未通过'), { code: 'STAGE_GATE', details: { missing } })
        }
        if (version.status === 'active' && before === 'testing' && version.stage === 'testing') {
          const missing = []
          if (!hasApprovedDoc(state, version.id, 'test_report')) missing.push('测试报告未确认')
          if (missing.length > 0) throw Object.assign(new Error('测试门禁未通过'), { code: 'STAGE_GATE', details: { missing } })
        }
        appendActivity(state, 'version.advance', `${version.name} 阶段检查 ${before} -> ${version.stage}`)
        return { state, version, previousStage: before }
      })
    }

    if (op === 'version.confirmDevelopment') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const resolved = await resolveProjectLead(sessionId)
        const version = findVersion(state, payload?.versionId)
        if (version === undefined) throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
        if (version.status !== 'active' || version.stage !== 'development') {
          throw Object.assign(new Error('当前版本不处于开发阶段'), { code: 'VERSION_STATE' })
        }
        for (const binding of state.bindings.filter((candidate) => candidate.versionId === version.id && candidate.phase === 'development' && candidate.abandonedAt === undefined)) {
          if (binding.lastKnownStatus !== 'completed') binding.lastKnownStatus = 'completed'
          binding.updatedAt = nowIso()
        }
        await enterReview(state, resolved, version)
        appendActivity(state, 'version.confirmDevelopment', `${version.name}：人工确认开发完成，进入评审`)
        return { state, version }
      })
    }

    if (op === 'version.rejectDevelopment') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const resolved = await resolveProjectLead(sessionId)
        const version = findVersion(state, payload?.versionId)
        if (version === undefined) throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
        if (version.status !== 'active' || version.stage !== 'development') {
          throw Object.assign(new Error('当前版本不处于开发阶段'), { code: 'VERSION_STATE' })
        }
        const reason = String(payload?.reason ?? '').trim()
        if (reason === '') throw Object.assign(new Error('请填写不通过原因'), { code: 'VALIDATION' })
        version.lastRejectReason = reason
        version.lastRejectAt = nowIso()
        appendActivity(state, 'version.rejectDevelopment', `${version.name}：开发确认不通过 — ${reason.slice(0, 500)}`)
        const binding = state.bindings.find((candidate) => candidate.versionId === version.id && candidate.phase === 'development' && candidate.memberName)
        if (binding !== undefined) {
          try {
            await agentTeams().sendMessage(resolved.lead, {
              target: binding.memberName,
              content: [{ type: 'text', text: `【开发确认不通过】${version.name}\n原因：${reason}\n请修复后重新完成开发任务，并提醒团队长再次请求人工确认。` }],
              signal: new AbortController().signal,
            })
          } catch {
            // delivery is best effort; the reason is persisted either way
          }
        }
        return { state, version }
      })
    }

    if (op === 'version.forceComplete') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const version = findVersion(state, payload?.versionId)
        if (version === undefined) throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
        if (version.status !== 'active') throw Object.assign(new Error('只有进行中的版本可以强制完成'), { code: 'VERSION_STATE' })
        const reason = String(payload?.reason ?? '').trim()
        if (reason === '') throw Object.assign(new Error('强制完成必须填写原因'), { code: 'VALIDATION' })
        // Leave official tasks untouched (they may still block dependents); the bindings are
        // abandoned in the planner state and the version is closed with an audit reason.
        for (const binding of state.bindings.filter((candidate) => candidate.versionId === version.id && candidate.abandonedAt === undefined)) {
          if (binding.lastKnownStatus !== 'completed') binding.abandonedAt = nowIso()
          binding.updatedAt = nowIso()
        }
        version.forcedCompleteReason = reason
        finalizeVersion(state, version)
        appendActivity(state, 'version.forceComplete', `${version.name}: ${reason}`)
        return { state, version }
      })
    }

    if (op === 'version.archive') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const version = findVersion(state, payload?.versionId)
        if (version === undefined) throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
        if (version.status !== 'completed') throw Object.assign(new Error('只有已完成版本可以归档'), { code: 'VERSION_STATE' })
        version.status = 'archived'
        version.updatedAt = nowIso()
        for (const requirementId of version.requirementIds) {
          const requirement = findRequirement(state, requirementId)
          if (requirement !== undefined) requirement.status = 'archived'
        }
        appendActivity(state, 'version.archive', version.name)
        return { state, version }
      })
    }

    if (op === 'version.reopenInterrupted') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const version = findVersion(state, payload?.versionId)
        if (version === undefined) throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
        if (version.status !== 'interrupted') throw Object.assign(new Error('只有中断版本可以回退'), { code: 'VERSION_STATE' })
        version.status = 'draft'
        version.stage = 'requirement'
        version.startedAt = null
        version.updatedAt = nowIso()
        for (const binding of state.bindings.filter((candidate) => candidate.versionId === version.id)) {
          binding.abandonedAt = binding.abandonedAt ?? nowIso()
        }
        appendActivity(state, 'version.reopenInterrupted', version.name)
        return { state, version }
      })
    }

    if (op === 'meeting.create') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const resolved = await resolveProjectLead(sessionId)
        const type = String(payload?.type ?? '')
        if (!MEETING_TYPES.includes(type)) throw Object.assign(new Error('未知的会议类型'), { code: 'VALIDATION' })
        const version = findVersion(state, payload?.versionId)
        if (version === undefined) throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
        assertVersionWritable(version, '创建会议')
        const stageOk =
          type === 'requirement_clarification'
            ? version.status === 'draft' && version.stage === 'requirement'
            : type === 'architecture_review'
              ? version.status === 'draft' && (version.stage === 'requirement' || version.stage === 'architecture')
              : type === 'test_review'
                ? version.status === 'active' || version.status === 'draft'
                : true
        if (!stageOk) {
          throw Object.assign(new Error(`会议类型「${type}」不适用于当前版本状态（${version.status}/${version.stage}）`), {
            code: 'MEETING_STATE',
          })
        }
        const title = String(payload?.title ?? '').trim()
        if (title === '') throw Object.assign(new Error('会议标题不能为空'), { code: 'VALIDATION' })
        const participants = [...new Set((Array.isArray(payload?.participants) ? payload.participants : []).map(String))]
        // A requirement clarification started by the team lead has no member
        // assignees yet; the lead is the host, so an empty participant list is valid.
        if (participants.length === 0 && payload?.leadOnly !== true) {
          throw Object.assign(new Error('请选择参会成员'), { code: 'VALIDATION' })
        }
        for (const name of participants) {
          const config = memberConfig(state, name)
          if (config === undefined || config.removed === true || config.blocked === true) {
            throw Object.assign(new Error(`成员「${name}」不可参会（未配置/已移出/已屏蔽）`), { code: 'VALIDATION' })
          }
        }
        // Members are created lazily; a meeting is a first-use moment and may
        // activate the selected participants now.
        for (const name of participants) {
          const config = memberConfig(state, name)
          if (config.creation?.status !== 'active') {
            const activated = await activateMember(resolved, state, config)
            if (activated !== true) throw Object.assign(new Error(`成员「${name}」激活失败：${config.creation?.error ?? 'unknown'}`), { code: 'OFFICIAL_ERROR' })
          }
        }
        const officialNames = new Set(listMembers(resolved.lead).map((member) => member.name))
        for (const name of participants) {
          if (!officialNames.has(name)) throw Object.assign(new Error(`成员「${name}」不可参会（官方不存在）`), { code: 'VALIDATION' })
        }
        const typeRole = { requirement_clarification: 'product', architecture_review: 'architect', test_review: 'test' }[type]
        const roleHost = typeRole === undefined ? undefined : participants.find((name) => memberConfig(state, name)?.roleId === typeRole)
        const hostMemberName = String(payload?.hostMemberName || roleHost || participants[0])
        if (!participants.includes(hostMemberName)) throw Object.assign(new Error('主持人必须是参会成员'), { code: 'VALIDATION' })
        const meeting = {
          id: `meet-${randomUUID()}`,
          leadSessionId: resolved.leadSessionId,
          versionId: version.id,
          type,
          title,
          goal: String(payload?.goal ?? ''),
          status: 'draft',
          hostMemberName,
          participants,
          createdAt: nowIso(),
          startedAt: null,
          closedAt: null,
          inviteSentAt: {},
          transcript: [],
          pendingSpeeches: [],
          notes: '',
          requirementDraft: null,
          savedRequirementIds: [],
          artifactIds: [],
          lastSeq: {},
          sessionIds: {},
        }
        state.meetings.push(meeting)
        appendActivity(state, 'meeting.create', `${title}（${type}）`)
        return { state, meeting }
      })
    }

    if (op === 'meeting.start') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const resolved = await resolveProjectLead(sessionId)
        const meeting = state.meetings.find((candidate) => candidate.id === payload?.meetingId)
        if (meeting === undefined) throw Object.assign(new Error('会议不存在'), { code: 'VALIDATION' })
        if (meeting.status !== 'draft') throw Object.assign(new Error('只有草稿会议可以开始'), { code: 'MEETING_STATE' })
        trackMeetingSessions(resolved.lead, meeting)
        const invited = []
        for (const name of meeting.participants) {
          if (name === meeting.hostMemberName) continue
          try {
            await agentTeams().sendMessage(resolved.lead, {
              target: name,
              content: [
                {
                  type: 'text',
                  text: `【会议邀请】${meeting.title}\n会议目标：${meeting.goal}\n\n${MEETING_RULES}\n主持人与主要讨论在主持人会话进行；当被点名时请结合项目上下文作答，不需要主动刷屏。\n产出物模板见后续请求。`,
                },
              ],
              signal: new AbortController().signal,
            })
            meeting.inviteSentAt[name] = nowIso()
            invited.push(name)
          } catch {
            // invitation best effort; surfaced in result
          }
        }
        meeting.status = 'active'
        meeting.startedAt = nowIso()
        appendActivity(state, 'meeting.start', `${meeting.title}（邀请 ${invited.length} 人）`)
        return { state, meeting, invited }
      })
    }

    if (op === 'meeting.invite') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const resolved = await resolveProjectLead(sessionId)
        const meeting = state.meetings.find((candidate) => candidate.id === payload?.meetingId)
        if (meeting === undefined) throw Object.assign(new Error('会议不存在'), { code: 'VALIDATION' })
        if (meeting.status !== 'active' && meeting.status !== 'draft') {
          throw Object.assign(new Error('会议已结束'), { code: 'MEETING_STATE' })
        }
        const names = [...new Set((Array.isArray(payload?.participants) ? payload.participants : []).map(String))]
        const invited = []
        for (const name of names) {
          const config = memberConfig(state, name)
          if (config === undefined || config.removed === true || config.blocked === true) {
            throw Object.assign(new Error(`成员「${name}」不可参会`), { code: 'VALIDATION' })
          }
          if (config.creation?.status !== 'active') {
            const activated = await activateMember(resolved, state, config)
            if (activated !== true) throw Object.assign(new Error(`成员「${name}」激活失败`), { code: 'OFFICIAL_ERROR' })
          }
          const officialNames = new Set(listMembers(resolved.lead).map((member) => member.name))
          if (!officialNames.has(name)) throw Object.assign(new Error(`成员「${name}」不可参会`), { code: 'VALIDATION' })
          if (!meeting.participants.includes(name)) meeting.participants.push(name)
          if (meeting.inviteSentAt?.[name] !== undefined) continue
          try {
            await agentTeams().sendMessage(resolved.lead, {
              target: name,
              content: [{ type: 'text', text: `【会议邀请】${meeting.title}\n会议目标：${meeting.goal}\n${MEETING_RULES}` }],
              signal: new AbortController().signal,
            })
            meeting.inviteSentAt[name] = nowIso()
            invited.push(name)
          } catch {
            // best effort
          }
        }
        trackMeetingSessions(resolved.lead, meeting)
        appendActivity(state, 'meeting.invite', `${meeting.title}: ${invited.join(',') || '(无新增)'}`)
        return { state, meeting, invited }
      })
    }

    if (op === 'meeting.speak') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const resolved = await resolveProjectLead(sessionId)
        const meeting = state.meetings.find((candidate) => candidate.id === payload?.meetingId)
        if (meeting === undefined) throw Object.assign(new Error('会议不存在'), { code: 'VALIDATION' })
        if (meeting.status !== 'active') throw Object.assign(new Error('会议未在进行中'), { code: 'MEETING_STATE' })
        const memberName = String(payload?.memberName ?? '')
        if (!meeting.participants.includes(memberName)) throw Object.assign(new Error('该成员不是参会成员'), { code: 'VALIDATION' })
        if (meeting.pendingSpeeches.some((speech) => speech.memberName === memberName && speech.status === 'pending')) {
          throw Object.assign(new Error('该成员已有未完成发言请求'), { code: 'MEETING_SPEAK_BUSY' })
        }
        const question = String(payload?.question ?? '').trim()
        if (question === '') throw Object.assign(new Error('发言问题不能为空'), { code: 'VALIDATION' })
        trackMeetingSessions(resolved.lead, meeting)
        meeting.pendingSpeeches.push({ memberName, question, requestedAt: nowIso(), status: 'pending' })
        let result
        try {
          result = await askMember(resolved.lead, memberName, `【会议发言请求】${meeting.title}\n会议目标：${meeting.goal}\n\n${MEETING_RULES}\n请回答：${question}\n（直接给结论与依据，控制在 500 字内）`, config.meetingReplyTimeoutMs ?? 120000)
        } catch (error) {
          const speech = meeting.pendingSpeeches.find((entry) => entry.memberName === memberName && entry.status === 'pending')
          if (speech) speech.status = 'failed'
          throw error
        }
        const speech = meeting.pendingSpeeches.find((entry) => entry.memberName === memberName && entry.status === 'pending')
        if (speech) speech.status = result.turnEnded ? 'answered' : 'timeout'
        appendActivity(state, 'meeting.speak', `${meeting.title} -> ${memberName}`)
        return { state, meeting, reply: result.reply, turnEnded: result.turnEnded }
      })
    }

    if (op === 'meeting.generateOutput') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const resolved = await resolveProjectLead(sessionId)
        const meeting = state.meetings.find((candidate) => candidate.id === payload?.meetingId)
        if (meeting === undefined) throw Object.assign(new Error('会议不存在'), { code: 'VALIDATION' })
        if (meeting.status !== 'active') throw Object.assign(new Error('会议未在进行中'), { code: 'MEETING_STATE' })
        trackMeetingSessions(resolved.lead, meeting)
        const result = await askMember(resolved.lead, meeting.hostMemberName, meetingOutputPrompt(meeting), config.meetingReplyTimeoutMs ?? 120000)
        const extracted = extractMarked(result.reply, 'output')
        if (extracted === null) {
          throw Object.assign(new Error('主持人未按标记块输出文档，请重试或让主持人重新输出'), {
            code: 'ARTIFACT_PARSE_FAILED',
            details: { reply: result.reply.slice(0, 2000) },
          })
        }
        if (meeting.type === 'requirement_clarification') {
          meeting.requirementDraft = extracted
          const artifact = createArtifactRecord(state, {
            versionId: meeting.versionId,
            type: 'requirement_doc',
            title: `需求文档：${meeting.title}`,
            content: extracted,
            source: { kind: 'meeting', meetingId: meeting.id },
          })
          meeting.artifactIds.push(artifact.id)
          appendActivity(state, 'meeting.requirementDraft', meeting.title)
          return { state, meeting, output: extracted, artifact }
        }
        const artifact = createArtifactRecord(state, {
          versionId: meeting.versionId,
          type: MEETING_ARTIFACT_TYPE[meeting.type] ?? 'custom',
          title: `${meeting.title} 产出物`,
          content: extracted,
          source: { kind: 'meeting', meetingId: meeting.id },
        })
        meeting.artifactIds.push(artifact.id)
        appendActivity(state, 'meeting.artifact', `${meeting.title} -> ${artifact.type}`)
        return { state, meeting, output: extracted, artifact }
      })
    }

    if (op === 'meeting.saveRequirement') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const meeting = state.meetings.find((candidate) => candidate.id === payload?.meetingId)
        if (meeting === undefined) throw Object.assign(new Error('会议不存在'), { code: 'VALIDATION' })
        if (meeting.status !== 'active') throw Object.assign(new Error('会议未在进行中'), { code: 'MEETING_STATE' })
        const version = findVersion(state, meeting.versionId)
        if (version === undefined) throw Object.assign(new Error('会议关联版本不存在'), { code: 'VALIDATION' })
        if (version.status !== 'draft') throw Object.assign(new Error('只能保存到草稿版本'), { code: 'VERSION_STATE' })
        const title = String(payload?.title ?? '').trim()
        if (title === '') throw Object.assign(new Error('需求标题不能为空'), { code: 'VALIDATION' })
        const description = String(payload?.description ?? meeting.requirementDraft ?? '')
        const participantAssignees = (meeting.participants ?? []).filter((name) => {
          const config = memberConfig(state, name)
          return config !== undefined && config.removed !== true && config.blocked !== true && config.roleId
        })
        const roleTags = Array.isArray(payload?.roleTags)
          ? payload.roleTags.filter((id) => state.roles.some((role) => role.id === id))
          : [...new Set(participantAssignees.map((name) => memberConfig(state, name)?.roleId).filter(Boolean))]
        const requirement = {
          id: `req-${randomUUID()}`,
          title,
          description,
          status: 'planned',
          versionId: version.id,
          roleTags,
          assignees: participantAssignees,
          taskSpecs: [],
          attachments: [],
          requirementArtifactId: null,
          source: { kind: 'meeting', meetingId: meeting.id },
          createdAt: nowIso(),
          updatedAt: nowIso(),
        }
        state.requirements.push(requirement)
        requirement.taskSpecs = autoTaskSpecs(state, requirement)
        if (!version.requirementIds.includes(requirement.id)) version.requirementIds.push(requirement.id)
        version.updatedAt = nowIso()
        const existing = state.artifacts
          .filter((candidate) => candidate.type === 'requirement_doc' && candidate.requirementId === null && candidate.source?.kind === 'meeting' && candidate.source?.meetingId === meeting.id)
          .sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))[0]
        const artifact = existing === undefined
          ? createArtifactRecord(state, {
              versionId: version.id,
              requirementId: requirement.id,
              type: 'requirement_doc',
              title: `需求文档：${title}`,
              content: description,
              source: { kind: 'meeting', meetingId: meeting.id },
            })
          : existing
        if (existing !== undefined) {
          existing.requirementId = requirement.id
          existing.versionId = version.id
          existing.title = `需求文档：${title}`
          existing.content = description
          existing.updatedAt = nowIso()
        }
        requirement.requirementArtifactId = artifact.id
        // PRD §7.2: one meeting may produce several requirements; closing is explicit.
        meeting.savedRequirementIds.push(requirement.id)
        appendActivity(state, 'meeting.saveRequirement', `${meeting.title} -> ${title}`)
        return { state, meeting, requirement, artifact }
      })
    }

    if (op === 'meeting.updateNotes' || op === 'meeting.close' || op === 'meeting.cancel') {
      return await mutateState(sessionId, expectedRevision, (state) => {
        const meeting = state.meetings.find((candidate) => candidate.id === payload?.meetingId)
        if (meeting === undefined) throw Object.assign(new Error('会议不存在'), { code: 'VALIDATION' })
        if (op === 'meeting.updateNotes') {
          meeting.notes = String(payload?.notes ?? '')
        } else if (op === 'meeting.close') {
          meeting.status = 'closed'
          meeting.closedAt = nowIso()
        } else {
          if (meeting.status === 'closed') throw Object.assign(new Error('已关闭的会议不能取消'), { code: 'MEETING_STATE' })
          meeting.status = 'cancelled'
          meeting.closedAt = nowIso()
        }
        appendActivity(state, op, meeting.title)
        return { state, meeting }
      })
    }

    if (op === 'meeting.finish') {
      // Generate minutes + type-specific result, close the meeting, and let the UI guide the user out.
      return await mutateState(sessionId, expectedRevision, (state) => {
        const meeting = state.meetings.find((candidate) => candidate.id === payload?.meetingId)
        if (meeting === undefined) throw Object.assign(new Error('会议不存在'), { code: 'VALIDATION' })
        if (meeting.status !== 'active') throw Object.assign(new Error('只有进行中的会议可以结束'), { code: 'MEETING_STATE' })
        const version = findVersion(state, meeting.versionId)
        const transcript = Array.isArray(meeting.transcript) ? meeting.transcript : []
        const lines = transcript.map(
          (entry) =>
            `- **${entry.kind === 'user' ? '用户' : entry.kind === 'plugin' ? '系统' : entry.memberName}**（${entry.at}）：${String(entry.text ?? '').replace(/\n/g, ' ').slice(0, 500)}`,
        )
        const minutes = `# 会议纪要：${meeting.title}\n\n- 类型：${meeting.type}\n- 版本：${version?.name ?? meeting.versionId}\n- 主持人：${meeting.hostMemberName}\n- 参会人：${meeting.participants.join('、')}\n- 目标：${meeting.goal || '（未填写）'}\n- 时间：${meeting.startedAt ?? ''} → ${nowIso()}\n\n## 讨论纪要\n\n${lines.length === 0 ? '（无发言记录）' : lines.join('\n')}\n\n## 会议结论\n\n${meeting.notes ? `${meeting.notes}\n\n` : ''}${meeting.requirementDraft ? `### 需求草稿\n\n${meeting.requirementDraft}\n\n` : ''}`
        const minutesArtifact = createArtifactRecord(state, {
          versionId: meeting.versionId,
          type: 'meeting_minutes',
          title: `会议纪要：${meeting.title}`,
          content: minutes,
          source: { kind: 'meeting', meetingId: meeting.id },
        })
        meeting.artifactIds = Array.isArray(meeting.artifactIds) ? meeting.artifactIds : []
        meeting.artifactIds.push(minutesArtifact.id)
        meeting.status = 'closed'
        meeting.closedAt = nowIso()
        appendActivity(state, 'meeting.finish', `${meeting.title}（生成会议纪要）`)
        return { state, meeting, minutesArtifact }
      })
    }

    if (op === 'artifact.capture') {
      return await mutateState(sessionId, expectedRevision, async (state) => {
        const resolved = await resolveProjectLead(sessionId)
        if (state.settings?.highEfficiencyMode === true && !inDiscountWindow()) {
          throw Object.assign(new Error('高能效模式：当前不在 DeepSeek 优惠时段，任务已挂起'), { code: 'DISCOUNT_WINDOW_CLOSED' })
        }
        const version = findVersion(state, payload?.versionId)
        if (version === undefined) throw Object.assign(new Error('版本不存在'), { code: 'VALIDATION' })
        assertVersionWritable(version, '采集产出物')
        const objectType = String(payload?.type ?? '')
        const allowed = ['requirement_doc', 'architecture_doc', 'review_report', 'test_report', 'test_plan', 'meeting_minutes', 'custom']
        if (!allowed.includes(objectType)) throw Object.assign(new Error('未知的产出物类型'), { code: 'VALIDATION' })
        const memberName = String(payload?.memberName ?? '')
        const title = String(payload?.title ?? `采集产出物：${version.name}`).trim()
        const instruction =
          payload?.prompt ??
          `【产出物采集】${version.name}｜${objectType}\n请基于当前工作的真实结果输出文档，必须严格用以下标记包裹：\n<!--atplanner:artifact:begin-->\n（Markdown 正文）\n<!--atplanner:artifact:end-->`
        const result = await askMember(resolved.lead, memberName, instruction, config.artifactReplyTimeoutMs ?? 180000)
        if (!result.turnEnded) {
          throw Object.assign(new Error('采集超时：成员未在限定时间内结束回合'), {
            code: 'ARTIFACT_TIMEOUT',
            details: { memberName, turnEnded: false },
          })
        }
        const extracted = extractMarked(result.reply, 'artifact')
        if (extracted === null) {
          throw Object.assign(new Error('成员回复缺少 artifact 标记块'), {
            code: 'ARTIFACT_PARSE_FAILED',
            details: { reply: String(result.reply ?? '').slice(0, 2000) },
          })
        }
        const content = extracted.length > 256 * 1024 ? `${extracted.slice(0, 256 * 1024)}\n\n…（截断，超过 256KB）` : extracted
        const artifact = createArtifactRecord(state, {
          versionId: version.id,
          requirementId: typeof payload?.requirementId === 'string' ? payload.requirementId : null,
          type: objectType,
          title,
          content,
          source: { kind: 'agent', agentName: memberName },
        })
        appendActivity(state, 'artifact.capture', `${objectType} <- ${memberName}`)
        if (objectType === 'review_report' || objectType === 'test_report') {
          try {
            await pumpVersion(state, resolved)
          } catch {
            // manual advance remains available
          }
        }
        return { state, artifact, turnEnded: result.turnEnded }
      })
    }

    throw Object.assign(new Error(`unsupported op: ${op}`), { code: 'NOT_IMPLEMENTED' })
  }

  function normalizeRoute(input) {
    if (input === null || input === undefined) return null
    if (!isPlainObject(input)) throw Object.assign(new Error('route must be an object or null'), { code: 'VALIDATION' })
    const provider = String(input.provider ?? '')
    const model = String(input.model ?? '')
    if (provider === '' || model === '') return null
    return {
      provider,
      model,
      ...(typeof input.reasoningEffort === 'string' && input.reasoningEffort !== ''
        ? { reasoningEffort: input.reasoningEffort }
        : {}),
    }
  }

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    })

  const connection = ctx.get('connection')
  if (connection !== undefined) {
    ctx.effect(() => {
      const disposeState = connection.fetch.register({
        path: STATE_ROUTE,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: stateHandler,
      })
      const disposeCommand = connection.fetch.register({
        path: COMMAND_ROUTE,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: commandHandler,
      })
      const disposeAttachment = connection.fetch.register({
        path: ATTACHMENT_ROUTE,
        methods: ['GET'],
        requestBody: 'buffered',
        fetch: attachmentHandler,
      })
      return () => {
        Promise.resolve(disposeState()).catch(() => {})
        Promise.resolve(disposeCommand()).catch(() => {})
        Promise.resolve(disposeAttachment()).catch(() => {})
      }
    }, 'agent-team-planner: routes')
  } else {
    ctx.logger?.warn?.('agent-team-planner: connection service missing; HTTP routes not registered')
  }

  /* ------------------------------------------------------------ listeners */

  ctx.effect(
    () =>
      ctx.on('agent/created', (payload) => {
        try {
          const agent = payload?.agent
          if (agent === undefined) return
          const identity = identify(agent)
          if (identity === undefined) return
          if (identity.role === 'lead') {
            // Warm the prompt cache so the next lead turn can render the roster.
            void (async () => {
              try {
                const state = (await readState(agent.id)) ?? emptyState(agent.id)
                reconcileMembers(state, agent)
                st.promptCache = { leadSessionId: identity.leadSessionId, state }
              } catch {
                // ignore
              }
            })()
            return
          }
          const route = st.routeByMember.get(identity.name)
          if (route === undefined) return
          installRoute(agent, identity.name, route)
          ctx.logger?.info?.(`agent-team-planner: installed route for ${identity.name}`)
        } catch (error) {
          ctx.logger?.warn?.('agent-team-planner: route install failed %o', error)
        }
      }),
    'agent-team-planner: agent created',
  )

  ctx.effect(
    () =>
      ctx.on('agent/disposed', (payload) => {
        const agent = payload?.agent
        if (agent === undefined) return
        const entry = st.selections.get(agent.id)
        if (entry !== undefined) {
          try {
            entry.dispose?.()
          } catch {
            // ignore
          }
          st.selections.delete(agent.id)
        }
      }),
    'agent-team-planner: agent disposed',
  )

  // Team events: keep the prompt cache warm and drive the workflow pump.
  ctx.effect(
    () =>
      ctx.on('session/event', (session, event) => {
        if (event.type === 'team/member') {
          void (async () => {
            try {
              const resolved = await resolveLead(session.id)
              const state = (await readState(session.id)) ?? emptyState(session.id)
              reconcileMembers(state, resolved.lead)
              st.promptCache = { leadSessionId: resolved.leadSessionId, state }
            } catch {
              // ignore; next state read refreshes
            }
          })()
          return
        }
        if (event.type !== 'team/task') return
        const task = event.data?.task
        if (task === undefined || typeof task.id !== 'string') return
        // NOTE: mutateState owns st.queue; wrapping it in another queue task self-deadlocks.
        void mutateState(session.id, undefined, async (state) => {
          if (state.team?.leadSessionId !== session.id) return { state }
          const binding = state.bindings.find((candidate) => candidate.taskId === task.id)
          if (binding === undefined) return { state }
          binding.lastKnownStatus = task.status
          binding.updatedAt = nowIso()
          if (typeof task.ownerId === 'string') binding.memberName = binding.memberName ?? null
          const resolved = await resolveLead(session.id)
          await pumpVersion(state, resolved)
          return { state }
        }).catch((error) => ctx.logger?.warn?.('agent-team-planner: workflow event failed %o', error))
      }),
    'agent-team-planner: team events',
  )

  // Meeting capture: record user/assistant text for tracked meeting sessions and
  // materialise it into the persisted transcript (deduplicated by event seq).
  ctx.effect(
    () =>
      ctx.on('session/event', (session, event) => {
        const record = slimEvent(event)
        if (record !== undefined) appendCaptured(session.id, record)
        if (event.type !== 'user/message' && event.type !== 'assistant/message') return
        const tracked = meetingSessions.get(session.id)
        if (tracked === undefined) return
        const text = textOfMessage(event.type === 'user/message' ? event.data : event.data?.message)
        if (text === '') return
        const sourceKind = event.type === 'user/message' ? event.data?.source?.kind : 'assistant'
        const entry = {
          memberName: tracked.memberName,
          kind: event.type === 'user/message' ? (sourceKind === 'user' ? 'user' : 'plugin') : 'member',
          text: text.length > 8192 ? `${text.slice(0, 8192)}\n…（截断）` : text,
          sessionId: session.id,
          seq: event.seq,
        }
        void mutateState(tracked.leadSessionId, undefined, (state) => {
          const meeting = state.meetings.find((candidate) => candidate.id === tracked.meetingId)
          if (meeting !== undefined) appendTranscript(meeting, session.id, entry)
          return { state }
        }).catch((error) => ctx.logger?.warn?.('agent-team-planner: meeting capture failed %o', error))
      }),
    'agent-team-planner: meeting capture',
  )

  ctx.logger?.info?.('agent-team-planner: host loaded')
}
