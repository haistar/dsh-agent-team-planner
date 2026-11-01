/**
 * Agent Team Planner — Client half (0.2 workbench).
 *
 * Registration model:
 *   sidebar.panellist (id=devteam)  -> left rail entry (only entry)
 *   main              (key=devteam) -> full main-area workbench
 *   conversation.input.dock         -> meeting banner above the base chat composer
 *
 * All writes go through the Host routes /api/atplanner.state and
 * /api/atplanner.command. No model tools, no direct session-log access.
 */
window.__ModuleLoader__.load({
  id: 'dsh-agent-team-planner',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement

    const NS = 'devteam'
    const PANEL_ID = 'devteam'

const normalizeLanguage = (value) => {
  const code = String(value ?? '').toLowerCase()
  if (code.startsWith('zh')) return 'zh'
  if (code.startsWith('ru')) return 'ru'
  return 'en'
}

const activeLanguage = () => {
  try { return normalizeLanguage(ctxRef.locale.getLocale().active) } catch { return 'en' }
}
    const STATE_URL = '/api/atplanner.state'
    const COMMAND_URL = '/api/atplanner.command'
    const LONG_OPS = new Set(['meeting.speak', 'meeting.generateOutput', 'artifact.capture', 'workflow.requestLeadSplit'])
    const MEETING_TYPE_KEY = {
      requirement_clarification: 'meeting.type.requirement',
      architecture_review: 'meeting.type.architecture',
      test_review: 'meeting.type.test',
      custom: 'meeting.type.custom',
    }
    const meetingTypeLabel = (t, type) => t(MEETING_TYPE_KEY[type] ?? 'meeting.type.custom')
    const taskStatusLabel = (t, status) => t(`task.status.${status}`)
    const taskStatusTone = (status) => status === 'in_progress' ? 'ok' : status === 'completed' ? undefined : status === 'blocked' ? 'danger' : status === 'pending' ? 'warn' : undefined
    const CN_HOLIDAYS = new Set([
      '2026-01-01', '2026-01-02', '2026-01-03',
      '2026-02-15', '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-21', '2026-02-22', '2026-02-23',
      '2026-04-04', '2026-04-05', '2026-04-06',
      '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05',
      '2026-06-19', '2026-06-20', '2026-06-21',
      '2026-09-25', '2026-09-26', '2026-09-27',
      '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07',
    ])
    const inDiscountWindowClient = () => {
      const now = new Date()
      const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000)
      const day = beijing.getUTCDay()
      const date = beijing.toISOString().slice(0, 10)
      const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes()
      const weekday = day >= 1 && day <= 5 && !CN_HOLIDAYS.has(date)
      const peak = weekday && ((minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60))
      return !peak
    }

    const formatDuration = (startedAt) => {
      const start = Date.parse(startedAt ?? '')
      if (Number.isNaN(start)) return '—'
      const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000))
      if (seconds < 60) return `${seconds}s`
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return `${minutes}m ${seconds % 60}s`
      return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    }
    const meetingStatusLabel = (t, status) => t(`meeting.status.${status}`)
    const meetingStatusTone = (status) => status === 'active' ? 'ok' : status === 'draft' ? 'warn' : status === 'cancelled' ? 'danger' : undefined
    const memberLabel = (state, name) => {
      const member = (state?.members ?? []).find((candidate) => candidate.name === name)
      return member?.displayName ?? name
    }

    const memberStatusLabel = (t, member) => {
      if (member.removed === true) return t('member.statusRemoved')
      if (member.blocked === true) return t('member.blocked')
      const status = member.creation?.status
      if (status === 'active') return t('member.statusActive')
      if (status === 'pending') return t('member.statusPending')
      return t('member.statusMissing')
    }

    const roleNameOf = (stateOrRoles, roleId) => {
      const roles = Array.isArray(stateOrRoles) ? stateOrRoles : (stateOrRoles?.roles ?? [])
      return roles.find((role) => role.id === roleId)?.name ?? roleId ?? '-'
    }
    const slugId = (value) => String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

    /* ------------------------------------------------------------------ i18n */

    const ZH = {
      'panel.label': 'DSH 研发团队',
      'nav.board': '版本看板',
      'nav.meetings': '会议',
      'nav.settings': '配置',
      'highEfficiency.active': '高能效模式：当前处于优惠时段，待执行任务会自动调度。',
      'highEfficiency.waiting': '高能效模式：当前非优惠时段，待执行任务已挂起；进入优惠时段后自动继续。',
      'settings.highEfficiencyTip': '开启后成员任务仅在deepseek优惠时间段执行',
      'settings.highEfficiencyHint': '所有成员任务仅在空闲时段执行：周一至周五 9:00–12:00、14:00–18:00 以外，以及周末、中国法定节假日全天。',
      'settings.highEfficiency': '高能效模式',
      'ws.project': '当前项目',
      'ws.switch': '切换工作区',
      'ws.follow': '跟随最近工作区',
      'ws.noSession': '该工作区还没有会话',
      'ws.createSession': '创建一个会话',
      'ws.noWorkspace': '没有可用的工作区',
      'ws.noWorkspaceHint': '请先在左侧栏创建或打开一个工作区',
      'ws.noState': '该项目还没有规划数据：先绑定团队并创建版本',
      'common.refresh': '刷新',
      'common.close': '关闭',
      'common.cancel': '取消',
      'common.save': '保存',
      'common.create': '创建',
      'common.delete': '删除',
      'common.edit': '编辑',
      'common.view': '查看',
      'common.confirm': '确认',
      'common.back': '返回',
      'common.backToChat': '返回对话',
      'common.next': '下一页',
      'common.prev': '上一页',
      'requirement.createAndMeet': '加入需求澄清会',
      'requirement.meetTitle': '需求澄清：{title}',
      'requirement.taskAuto': '任务规格由 Agent 自动生成，可在编辑需求时调整',
      'requirement.readOnly': '版本已完成/归档，只读',
      'requirement.noAttachments': '暂无附件',
      'requirement.attachmentHint': '支持 txt/doc/docx/xls/xlsx/png/jpg/jpeg，自动绑定并归档',
      'requirement.upload': '上传附件',
      'requirement.attachments': '附件',
      'requirement.detach': '删除',
      'requirement.leadFixed': '团队长（默认）',
      'requirement.assigneesHint': '团队长默认参与；不选成员则由团队长判断需要哪些成员',
      'requirement.assignees': '指定成员',
      'ws.openFailed': '无法打开目录，请确认基座支持本地打开',
      'ws.openDirectory': '打开目录',
      'nav.requirements': '需求',
      'nav.requirementsBadge': '还没有需求，点击创建第一个需求',
      'common.retry': '重试',
      'common.none': '暂无',
      'common.loading': '加载中…',
      'common.actions': '操作',
      'common.details': '详情',
      'common.bind': '绑定',
      'common.unbind': '解绑',
      'common.expand': '展开',
      'common.collapse': '收起',
      'common.language': '语言',
      'team.title': '项目团队',
      'team.bound': '已绑定',
      'team.unbound': '未绑定',
      'team.lost': '会话不可用',
      'team.bind': '绑定当前会话',
      'team.rebind': '重新绑定',
      'team.recreate': '重建缺失成员',
      'team.name': '团队名',
      'version.new': '新建版本',
      'version.select': '选择版本',
      'version.current': '当前版本',
      'version.name': '版本名',
      'version.desc': '描述',
      'version.planDate': '计划日期',
      'version.owner': '负责人',
      'version.notes': '备注',
      'version.settings': '版本设置',
      'version.delete': '删除版本',
      'version.archive': '归档版本',
      'version.forceComplete': '强制完成',
      'version.reopen': '回退为草稿',
      'version.confirmDelete': '确定删除该草稿版本？绑定需求会被解绑，关联会议/产出物会一并删除。',
      'version.forceReasonPrompt': '强制完成需要填写原因（用于审计）：',
      'version.readOnly': '只有草稿版本可以编辑名称/描述；其他状态可在此查看或执行归档、强制完成。',
      'version.stage': '阶段',
      'version.progress': '绑定需求',
      'stage.requirement': '需求澄清',
      'stage.architecture': '架构设计',
      'stage.development': '开发',
      'stage.review': 'Code Review',
      'stage.testing': '测试',
      'stage.done': '完成',
      'stage.enterArchitecture': '进入架构设计',
      'stage.startDevelopment': '开始开发',
      'stage.advance': '推进阶段',
      'stage.checkGate': '检查门禁',
      'stage.short.requirement': '需求',
      'stage.short.architecture': '架构',
      'stage.short.development': '开发',
      'stage.short.review': '评审',
      'stage.short.testing': '测试',
      'stage.gate': '门禁',
      'stage.gateOk': '门禁已满足',
      'stage.gateMissing': '缺失',
      'role.leadSpecial': '特殊',
      'meeting.finishHint': '将生成会议纪要产出物并关闭会议；会议不可继续，纪要与已保存需求保留；失败时会议保持进行中。',
      'stage.stateTodo': '未开始',
      'stage.stateCurrent': '当前',
      'stage.stateDone': '已通过',
      'stage.needRequirements': '未绑定需求',
      'stage.needRequirementDoc': '需求文档未确认',
      'stage.needArchitectureDoc': '架构方案未确认',
      'stage.needReviewReport': '评审报告未确认',
      'stage.needTestReport': '测试报告未确认',
      'stage.needSpecs': '缺少任务规格',
      'stage.needRoles': '任务规格角色无可用成员',
      'task.role': '角色',
      'task.member': '成员',
      'task.dependency': '依赖',
      'task.ready': '就绪',
      'task.blocked': '阻塞',
      'requirement.docApproved': '文档已确认',
      'requirement.docDraft': '文档待确认',
      'meeting.rounds': '发言轮次',
      'meeting.system': '系统消息',
      'meeting.expand': '展开',
      'meeting.collapse': '收起',
      'settings.leadModel': '团队长模型',
      'settings.group.active': '活跃',
      'settings.group.blocked': '已屏蔽',
      'settings.group.removed': '已移出',
      'settings.group.missing': '缺失',
      'settings.group.unconfigured': '未配置角色',
      'settings.stages': '可参与阶段',
      'settings.refs': '引用数',
      'confirm.what': '会发生什么',
      'confirm.why': '为什么',
      'confirm.recoverable': '可恢复吗',
      'confirm.confirm': '确认',
      'confirm.cancel': '取消',
      'board.tasks': '进行中任务',
      'timeline.latest': '按时间倒序，每页 5 条',
      'artifact.captureProgress': '正在向成员采集产出物，请稍候…',
      'artifact.capturing': '采集中…',
      'task.tokensUnknown': '基座任务视图未提供 Token 统计',
      'task.tokens': 'Token 使用量',
      'task.elapsed': '执行时长',
      'task.progress': '处理进度',
      'task.detail': '任务详情',
      'task.status.deleted': '已删除',
      'task.status.completed': '已完成',
      'task.status.blocked': '阻塞',
      'task.status.pending': '待执行',
      'task.status.in_progress': '执行中',
      'board.timeline': '时间线',
      'board.artifacts': '产出物',
      'confirm.reportTitle': '报告待确认：{name}',
      'confirm.enterReview': '确认并进入评审',
      'confirm.devDoneText': '开发任务已全部完成。请确认浏览器访问/产物结果后进入评审。',
      'confirm.devDoneTitle': '开发任务已完成，等待确认',
      'confirm.empty': '暂无待确认事项',
      'confirm.title': '人工确认事项',
      'confirm.lastReject': '上次不通过原因：{reason}',
      'confirm.submitReject': '提交不通过',
      'confirm.rejectReason': '不通过原因（会发送给开发成员）',
      'confirm.reject': '确认不通过',
      'confirm.artifacts': '相关产物',
      'confirm.tasks': '开发任务',
      'board.loadCount': '任务数',
      'board.teamLoad': '团队负载',
      'board.meetings': '会议',
      'requirement.title': '需求',
      'requirement.new': '新建需求',
      'requirement.edit': '编辑需求',
      'requirement.name': '需求标题',
      'requirement.desc': '需求描述',
      'requirement.tags': '角色标签（逗号分隔）',
      'requirement.specs': '任务规格（JSON）',
      'requirement.autoSpecs': '自动生成任务规格',
      'requirement.leadSpecs': '拆分任务规格',
      'requirement.bindVersion': '绑定到当前版本',
      'requirement.doc': '需求文档',
      'requirement.specInvalid': '任务规格 JSON 无效：{message}',
      'task.title': '进行中任务',
      'task.owner': '负责人',
      'task.phase': '阶段',
      'task.status': '状态',
      'artifact.title': '产出物',
      'artifact.new': '新建产出物',
      'artifact.type': '类型',
      'artifact.content': '内容（Markdown）',
      'artifact.approve': '确认',
      'artifact.archive': '归档',
      'artifact.captureReview': '采集评审报告',
      'artifact.captureTest': '采集测试报告',
      'member.title': '成员',
      'member.new': '新建成员',
      'member.name': '成员名（英文标识）',
      'member.display': '显示名',
      'member.role': '角色',
      'member.route': '模型路由',
      'member.routeInherit': '继承默认',
      'member.block': '屏蔽',
      'member.removeHint': '仅在本项目（工作区）移出：不再参与派发、领取任务或参会；官方成员名单仍保留，运行时由基座处置。',
      'member.removeRecoverable': '可恢复：在“已移出”分组点“恢复”，或用同名重建。',
      'member.unblock': '取消屏蔽',
      'member.remove': '移出团队',
      'member.restore': '恢复',
      'member.recreate': '重建',
      'member.removed': '已移出',
      'member.blocked': '已屏蔽',
      'member.statusActive': '活跃',
      'member.statusPending': '待派发',
      'member.statusMissing': '缺失',
      'member.statusRemoved': '已移出',
      'member.status': '状态',
      'role.title': '角色与提示词',
      'role.new': '新建角色',
      'role.prompt': '默认提示词',
      'role.promptSync': '应用提示词到成员',
      'role.reset': '恢复默认提示词',
      'role.delete': '删除角色',
      'role.deleteHint': '角色被删除后不可恢复；仅当没有成员、需求标签、任务规格或阶段默认引用该角色时才允许删除。',
      'role.deleteRecoverable': '不可恢复：内置角色可用“恢复默认角色”重建同名默认提示词，自定义角色需重新创建。',
      'role.idHint': '角色标识需为小写英文/数字/连字符，且以字母开头（2–32 位）。',
      'meeting.title': '会议',
      'meeting.new': '新建会议',
      'meeting.type': '类型',
      'meeting.type.requirement': '需求澄清会',
      'meeting.type.architecture': '架构评审会',
      'meeting.type.test': '测试细节会',
      'meeting.type.custom': '自定义会议',
      'meeting.host': '主持人',
      'meeting.participants': '参会成员（逗号分隔成员名）',
      'meeting.goal': '会议目标',
      'meeting.start': '开始会议',
      'meeting.openHost': '进入讨论',
      'meeting.speak': '请成员发言',
      'meeting.question': '发言问题',
      'meeting.generate': '请主持人产出文档',
      'meeting.saveRequirement': '保存需求到版本',
      'meeting.finish': '结束会议并生成纪要',
      'meeting.close': '关闭会议',
      'meeting.cancel': '取消会议',
      'meeting.transcript': '会议纪要',
      'meeting.draft': '需求草稿',
      'meeting.archTitle': '架构评审：{name}',
      'meeting.archGoal': '确认架构细节并产出架构设计文档',
      'meeting.activeBanner': '会议进行中',
      'common.viewDetails': '查看详情',
      'meeting.documents': '会议产出的文档',
      'meeting.progressFinish': '正在结束会议并生成纪要，请稍候…',
      'meeting.progressGenerate': '主持人正在生成文档，请稍候…',
      'meeting.progressSpeak': '{name} 正在发言，请稍候…',
      'meeting.finishing': '结束中…',
      'meeting.generating': '生成中…',
      'meeting.speaking': '发言中…',
      'meeting.status.cancelled': '已取消',
      'meeting.status.closed': '已结束',
      'meeting.status.active': '进行中',
      'meeting.status.draft': '草稿',
      'meeting.bannerExit': '结束会议',
      'meeting.bannerBoard': '返回看板',
      'meeting.finished': '会议已结束，会议纪要已生成。',
      'meeting.minutes': '会议纪要',
      'meeting.noMinutes': '尚未生成会议纪要',
      'meeting.openBoard': '返回看板',
      'pending.title': '待人工处置',
      'pending.reportDraft': '报告待确认：{name}',
      'pending.noSpecs': '需求「{name}」缺少任务规格',
      'pending.gate': '阶段门禁未通过',
      'timeline.title': '时间线',
      'timeline.empty': '暂无活动',
      'teamLoad.title': '团队负载',
      'load.inProgress': '{n} 进行中',
      'empty.noVersion': '还没有版本',
      'empty.noVersionHint': '先创建一个版本，再绑定需求并进入架构设计。',
      'empty.noData': '暂无数据',
      'error.code': '{code}: {message}',
      'error.network': '网络错误：{message}',
    }

    const EN = {
      'panel.label': 'Agent Team Planner',
      'nav.board': 'Version Board',
      'nav.meetings': 'Meetings',
      'nav.settings': 'Settings',
      'highEfficiency.active': 'High-efficiency mode: inside the discount window; pending tasks are scheduled automatically.',
      'highEfficiency.waiting': 'High-efficiency mode: outside the discount window; pending tasks are suspended and resume automatically when the window opens.',
      'settings.highEfficiencyTip': 'When enabled, member tasks run only during the DeepSeek discount window',
      'settings.highEfficiencyHint': 'Member tasks run only in idle time: outside Mon–Fri 09:00–12:00 / 14:00–18:00, plus weekends and Chinese public holidays.',
      'settings.highEfficiency': 'High-efficiency mode',
      'ws.project': 'Project',
      'ws.switch': 'Switch workspace',
      'ws.follow': 'Follow recent workspace',
      'ws.noSession': 'This workspace has no session yet',
      'ws.createSession': 'Create a session',
      'ws.noWorkspace': 'No workspace available',
      'ws.noWorkspaceHint': 'Create or open a workspace in the left sidebar first',
      'ws.noState': 'No planning data yet: bind the team and create a version',
      'common.refresh': 'Refresh',
      'common.close': 'Close',
      'common.cancel': 'Cancel',
      'common.save': 'Save',
      'common.create': 'Create',
      'common.delete': 'Delete',
      'common.edit': 'Edit',
      'common.view': 'View',
      'common.confirm': 'Confirm',
      'common.back': 'Back',
      'common.backToChat': 'Back to chat',
      'common.next': 'Next',
      'common.prev': 'Prev',
      'requirement.createAndMeet': 'Create clarification meeting',
      'requirement.meetTitle': 'Requirement clarification: {title}',
      'requirement.taskAuto': 'Task specs are generated by the agent; edit them when editing the requirement',
      'requirement.readOnly': 'Completed/archived version: read-only',
      'requirement.noAttachments': 'No attachments',
      'requirement.attachmentHint': 'txt/doc/docx/xls/xlsx/png/jpg/jpeg; stored with and archived under this requirement',
      'requirement.upload': 'Upload files',
      'requirement.attachments': 'Attachments',
      'requirement.detach': 'Remove',
      'requirement.leadFixed': 'Lead (default)',
      'requirement.assigneesHint': 'The lead always participates; leave empty to let the lead decide',
      'requirement.assignees': 'Assignees',
      'ws.openFailed': 'Cannot open the folder; the base desktop opener is unavailable',
      'ws.openDirectory': 'Open folder',
      'nav.requirements': 'Requirements',
      'nav.requirementsBadge': 'No requirements yet; create the first one',
      'common.retry': 'Retry',
      'common.none': 'None',
      'common.loading': 'Loading…',
      'common.actions': 'Actions',
      'common.details': 'Details',
      'common.bind': 'Bind',
      'common.unbind': 'Unbind',
      'common.expand': 'Expand',
      'common.collapse': 'Collapse',
      'common.language': 'Language',
      'team.title': 'Project team',
      'team.bound': 'Bound',
      'team.unbound': 'Not bound',
      'team.lost': 'Session unavailable',
      'team.bind': 'Bind current session',
      'team.rebind': 'Re-bind',
      'team.recreate': 'Rebuild missing members',
      'team.name': 'Team name',
      'version.new': 'New version',
      'version.select': 'Select version',
      'version.current': 'Current version',
      'version.name': 'Version',
      'version.desc': 'Description',
      'version.planDate': 'Planned date',
      'version.owner': 'Owner',
      'version.notes': 'Notes',
      'version.settings': 'Version settings',
      'version.delete': 'Delete version',
      'version.archive': 'Archive version',
      'version.forceComplete': 'Force complete',
      'version.reopen': 'Revert to draft',
      'version.confirmDelete': 'Delete this draft version? Bound requirements are unbound and related meetings/artifacts are removed.',
      'version.forceReasonPrompt': 'A reason is required for force-complete (audit):',
      'version.readOnly': 'Only draft versions can be edited. Non-draft versions can be archived or force-completed here.',
      'version.stage': 'Stage',
      'version.progress': 'Requirements',
      'stage.requirement': 'Requirement',
      'stage.architecture': 'Architecture',
      'stage.development': 'Development',
      'stage.review': 'Code Review',
      'stage.testing': 'Testing',
      'stage.done': 'Done',
      'stage.enterArchitecture': 'Enter architecture',
      'stage.startDevelopment': 'Start development',
      'stage.advance': 'Advance stage',
      'stage.checkGate': 'Check gates',
      'stage.short.requirement': 'Req',
      'stage.short.architecture': 'Arch',
      'stage.short.development': 'Dev',
      'stage.short.review': 'Review',
      'stage.short.testing': 'Test',
      'stage.gate': 'Gate',
      'stage.gateOk': 'Gate satisfied',
      'stage.gateMissing': 'Missing',
      'role.leadSpecial': 'Special',
      'meeting.finishHint': 'Generates the meeting-minutes artifact and closes the meeting; it cannot continue, but minutes and saved requirements remain. On failure the meeting stays active.',
      'stage.stateTodo': 'Not started',
      'stage.stateCurrent': 'Current',
      'stage.stateDone': 'Passed',
      'stage.needRequirements': 'No requirements bound',
      'stage.needRequirementDoc': 'Requirement doc not confirmed',
      'stage.needArchitectureDoc': 'Architecture doc not confirmed',
      'stage.needReviewReport': 'Review report not confirmed',
      'stage.needTestReport': 'Test report not confirmed',
      'stage.needSpecs': 'Task specs missing',
      'stage.needRoles': 'No available member for spec role',
      'task.role': 'Role',
      'task.member': 'Member',
      'task.dependency': 'Dependency',
      'task.ready': 'Ready',
      'task.blocked': 'Blocked',
      'requirement.docApproved': 'Doc confirmed',
      'requirement.docDraft': 'Doc unconfirmed',
      'meeting.rounds': 'Speaking rounds',
      'meeting.system': 'System',
      'meeting.expand': 'Expand',
      'meeting.collapse': 'Collapse',
      'settings.leadModel': 'Lead model',
      'settings.group.active': 'Active',
      'settings.group.blocked': 'Blocked',
      'settings.group.removed': 'Removed',
      'settings.group.missing': 'Missing',
      'settings.group.unconfigured': 'Unconfigured',
      'settings.stages': 'Stages',
      'settings.refs': 'Refs',
      'confirm.what': 'What happens',
      'confirm.why': 'Why',
      'confirm.recoverable': 'Recoverable',
      'confirm.confirm': 'Confirm',
      'confirm.cancel': 'Cancel',
      'board.tasks': 'Active tasks',
      'timeline.latest': 'Newest first, 5 per page',
      'artifact.captureProgress': 'Capturing the artifact from the member, please wait…',
      'artifact.capturing': 'Capturing…',
      'task.tokensUnknown': 'Token usage is not exposed by the base task view',
      'task.tokens': 'Token usage',
      'task.elapsed': 'Elapsed',
      'task.progress': 'Progress',
      'task.detail': 'Task details',
      'task.status.deleted': 'Deleted',
      'task.status.completed': 'Completed',
      'task.status.blocked': 'Blocked',
      'task.status.pending': 'Pending',
      'task.status.in_progress': 'In progress',
      'board.timeline': 'Timeline',
      'board.artifacts': 'Artifacts',
      'confirm.reportTitle': 'Report awaiting confirmation: {name}',
      'confirm.enterReview': 'Confirm and enter review',
      'confirm.devDoneText': 'All development tasks are complete. Confirm the browser/artifact result, then enter review.',
      'confirm.devDoneTitle': 'Development tasks completed; awaiting confirmation',
      'confirm.empty': 'Nothing to confirm',
      'confirm.title': 'Manual confirmations',
      'confirm.lastReject': 'Previous rejection: {reason}',
      'confirm.submitReject': 'Submit rejection',
      'confirm.rejectReason': 'Rejection reason (sent to the developer)',
      'confirm.reject': 'Reject',
      'confirm.artifacts': 'Related artifacts',
      'confirm.tasks': 'Development tasks',
      'board.loadCount': 'Tasks',
      'board.teamLoad': 'Team load',
      'board.meetings': 'Meetings',
      'requirement.title': 'Requirements',
      'requirement.new': 'New requirement',
      'requirement.edit': 'Edit requirement',
      'requirement.name': 'Title',
      'requirement.desc': 'Description',
      'requirement.tags': 'Role tags (comma separated)',
      'requirement.specs': 'Task specs (JSON)',
      'requirement.autoSpecs': 'Auto-generate specs',
      'requirement.leadSpecs': 'Ask Lead to split',
      'requirement.bindVersion': 'Bind to current version',
      'requirement.doc': 'Requirement doc',
      'requirement.specInvalid': 'Invalid task specs JSON: {message}',
      'task.title': 'Active tasks',
      'task.owner': 'Owner',
      'task.phase': 'Phase',
      'task.status': 'Status',
      'artifact.title': 'Artifacts',
      'artifact.new': 'New artifact',
      'artifact.type': 'Type',
      'artifact.content': 'Content (Markdown)',
      'artifact.approve': 'Confirm',
      'artifact.archive': 'Archive',
      'artifact.captureReview': 'Capture review report',
      'artifact.captureTest': 'Capture test report',
      'member.title': 'Members',
      'member.new': 'New member',
      'member.name': 'Member name (identifier)',
      'member.display': 'Display name',
      'member.role': 'Role',
      'member.route': 'Model route',
      'member.routeInherit': 'Inherit default',
      'member.block': 'Block',
      'member.removeHint': 'Project-scoped removal only: no dispatch, task claiming or meetings in this workspace. The official member roster keeps the record; its runtime is owned by the base product.',
      'member.removeRecoverable': 'Recoverable: restore from the Removed group, or recreate with the same name.',
      'member.unblock': 'Unblock',
      'member.remove': 'Remove',
      'member.restore': 'Restore',
      'member.recreate': 'Rebuild',
      'member.removed': 'Removed',
      'member.blocked': 'Blocked',
      'member.statusActive': 'Active',
      'member.statusPending': 'Pending activation',
      'member.statusMissing': 'Missing',
      'member.statusRemoved': 'Removed',
      'member.status': 'Status',
      'role.title': 'Roles & prompts',
      'role.new': 'New role',
      'role.prompt': 'Default prompt',
      'role.promptSync': 'Apply prompt to members',
      'role.reset': 'Reset default prompt',
      'role.delete': 'Delete role',
      'role.deleteHint': 'Deleting a role is permanent; it is allowed only when no member, requirement tag, task spec or stage default references it.',
      'role.deleteRecoverable': 'Not recoverable: built-in roles can be recreated via restore-defaults; custom roles must be recreated manually.',
      'role.idHint': 'Role id must be 2–32 lowercase letters/digits/hyphens and start with a letter.',
      'meeting.title': 'Meetings',
      'meeting.new': 'New meeting',
      'meeting.type': 'Type',
      'meeting.type.requirement': 'Requirement clarification',
      'meeting.type.architecture': 'Architecture review',
      'meeting.type.test': 'Test details',
      'meeting.type.custom': 'Custom',
      'meeting.host': 'Host',
      'meeting.participants': 'Participants (comma separated names)',
      'meeting.goal': 'Goal',
      'meeting.start': 'Start meeting',
      'meeting.openHost': 'Enter discussion',
      'meeting.speak': 'Ask member to speak',
      'meeting.question': 'Question',
      'meeting.generate': 'Ask host to produce document',
      'meeting.saveRequirement': 'Save requirement to version',
      'meeting.finish': 'Finish & generate minutes',
      'meeting.close': 'Close meeting',
      'meeting.cancel': 'Cancel meeting',
      'meeting.transcript': 'Minutes',
      'meeting.draft': 'Requirement draft',
      'meeting.archTitle': 'Architecture review: {name}',
      'meeting.archGoal': 'Confirm architecture details and produce the architecture design document',
      'meeting.activeBanner': 'Meeting in progress',
      'common.viewDetails': 'View details',
      'meeting.documents': 'Meeting documents',
      'meeting.progressFinish': 'Finishing the meeting and minutes, please wait…',
      'meeting.progressGenerate': 'The host is generating the document, please wait…',
      'meeting.progressSpeak': '{name} is speaking, please wait…',
      'meeting.finishing': 'Finishing…',
      'meeting.generating': 'Generating…',
      'meeting.speaking': 'Speaking…',
      'meeting.status.cancelled': 'Cancelled',
      'meeting.status.closed': 'Closed',
      'meeting.status.active': 'In progress',
      'meeting.status.draft': 'Draft',
      'meeting.bannerExit': 'Finish meeting',
      'meeting.bannerBoard': 'Back to board',
      'meeting.finished': 'Meeting finished. Minutes have been generated.',
      'meeting.minutes': 'Meeting minutes',
      'meeting.noMinutes': 'No minutes generated yet',
      'meeting.openBoard': 'Back to board',
      'pending.title': 'Needs attention',
      'pending.reportDraft': 'Report to confirm: {name}',
      'pending.noSpecs': 'Requirement "{name}" has no task specs',
      'pending.gate': 'Stage gate blocked',
      'timeline.title': 'Timeline',
      'timeline.empty': 'No activity yet',
      'teamLoad.title': 'Team load',
      'load.inProgress': '{n} in progress',
      'empty.noVersion': 'No versions yet',
      'empty.noVersionHint': 'Create a version first, then bind requirements and enter architecture design.',
      'empty.noData': 'No data',
      'error.code': '{code}: {message}',
      'error.network': 'Network error: {message}',
    }

    const RU = {
  'panel.label': 'DSH Agent Team Planner — планировщик команды',
  'nav.board': 'Доска версий',
  'nav.meetings': 'Встречи',
  'nav.settings': 'Настройки',
  'highEfficiency.active': 'Режим энергоэффективности: сейчас действует скидочный период, ожидающие задачи запускаются автоматически.',
  'highEfficiency.waiting': 'Режим энергоэффективности: скидочный период не действует, ожидающие задачи приостановлены и продолжатся автоматически, когда он начнётся.',
  'settings.highEfficiencyTip': 'После включения задачи участников выполняются только в скидочный период DeepSeek',
  'settings.highEfficiencyHint': 'Задачи участников выполняются только в непиковые часы: вне интервалов пн–пт 9:00–12:00 и 14:00–18:00, а также весь день в выходные и официальные праздники Китая.',
  'settings.highEfficiency': 'Режим энергоэффективности',
  'ws.project': 'Текущий проект',
  'ws.switch': 'Сменить рабочую область',
  'ws.follow': 'Следовать последней рабочей области',
  'ws.noSession': 'В этой рабочей области ещё нет сеанса',
  'ws.createSession': 'Создать сеанс',
  'ws.noWorkspace': 'Нет доступных рабочих областей',
  'ws.noWorkspaceHint': 'Сначала создайте или откройте рабочую область на левой панели',
  'ws.noState': 'В этом проекте пока нет данных планирования: привяжите команду и создайте версию',
  'common.refresh': 'Обновить',
  'common.close': 'Закрыть',
  'common.cancel': 'Отмена',
  'common.save': 'Сохранить',
  'common.create': 'Создать',
  'common.delete': 'Удалить',
  'common.edit': 'Изменить',
  'common.view': 'Просмотр',
  'common.confirm': 'Подтвердить',
  'common.back': 'Назад',
  'common.backToChat': 'Вернуться к чату',
  'common.next': 'Далее',
  'common.prev': 'Назад',
  'requirement.createAndMeet': 'Присоединиться к встрече по уточнению требований',
  'requirement.meetTitle': 'Уточнение требований: {title}',
  'requirement.taskAuto': 'Спецификации задач создаются агентом автоматически; их можно изменить при редактировании требования',
  'requirement.readOnly': 'Версия завершена или заархивирована — только чтение',
  'requirement.noAttachments': 'Нет вложений',
  'requirement.attachmentHint': 'Поддерживаются txt/doc/docx/xls/xlsx/png/jpg/jpeg; привязываются и архивируются автоматически',
  'requirement.upload': 'Загрузить вложения',
  'requirement.attachments': 'Вложения',
  'requirement.detach': 'Удалить',
  'requirement.leadFixed': 'Руководитель команды (по умолчанию)',
  'requirement.assigneesHint': 'Руководитель участвует по умолчанию; если участники не выбраны, он сам определяет, кто нужен',
  'requirement.assignees': 'Участники',
  'ws.openFailed': 'Не удалось открыть папку: проверьте, что платформа поддерживает локальное открытие',
  'ws.openDirectory': 'Открыть папку',
  'nav.requirements': 'Требования',
  'nav.requirementsBadge': 'Требований пока нет — нажмите, чтобы создать первое',
  'common.retry': 'Повторить',
  'common.none': 'Нет',
  'common.loading': 'Загрузка…',
  'common.actions': 'Действия',
  'common.details': 'Подробности',
  'common.bind': 'Привязать',
  'common.unbind': 'Отвязать',
  'common.expand': 'Развернуть',
  'common.collapse': 'Свернуть',
  'common.language': 'Язык',
  'team.title': 'Команда проекта',
  'team.bound': 'Привязано',
  'team.unbound': 'Не привязано',
  'team.lost': 'Сеанс недоступен',
  'team.bind': 'Привязать текущий сеанс',
  'team.rebind': 'Привязать заново',
  'team.recreate': 'Пересоздать отсутствующих участников',
  'team.name': 'Название команды',
  'version.new': 'Новая версия',
  'version.select': 'Выбрать версию',
  'version.current': 'Текущая версия',
  'version.name': 'Название версии',
  'version.desc': 'Описание',
  'version.planDate': 'Плановая дата',
  'version.owner': 'Ответственный',
  'version.notes': 'Заметки',
  'version.settings': 'Настройки версии',
  'version.delete': 'Удалить версию',
  'version.archive': 'Архивировать версию',
  'version.forceComplete': 'Принудительно завершить',
  'version.reopen': 'Вернуть в черновик',
  'version.confirmDelete': 'Удалить эту версию-черновик? Привязанные требования будут отвязаны, а связанные встречи и артефакты удалены.',
  'version.forceReasonPrompt': 'Для принудительного завершения нужна причина (для аудита):',
  'version.readOnly': 'Название и описание можно менять только у черновика; для версий в другом статусе здесь доступны архивирование и принудительное завершение.',
  'version.stage': 'Этап',
  'version.progress': 'Привязанные требования',
  'stage.requirement': 'Уточнение требований',
  'stage.architecture': 'Проектирование архитектуры',
  'stage.development': 'Разработка',
  'stage.review': 'Code Review',
  'stage.testing': 'Тестирование',
  'stage.done': 'Завершено',
  'stage.enterArchitecture': 'Перейти к архитектуре',
  'stage.startDevelopment': 'Начать разработку',
  'stage.advance': 'Следующий этап',
  'stage.checkGate': 'Проверить гейты',
  'stage.short.requirement': 'Треб.',
  'stage.short.architecture': 'Арх.',
  'stage.short.development': 'Разр.',
  'stage.short.review': 'Ревью',
  'stage.short.testing': 'Тест',
  'stage.gate': 'Гейт',
  'stage.gateOk': 'Гейт пройден',
  'stage.gateMissing': 'Отсутствует',
  'role.leadSpecial': 'Особый',
  'meeting.finishHint': 'Будут созданы протокол встречи и артефакт, встреча закроется; продолжить её нельзя, протокол и сохранённые требования останутся. При ошибке встреча останется активной.',
  'stage.stateTodo': 'Не начат',
  'stage.stateCurrent': 'Текущий',
  'stage.stateDone': 'Пройден',
  'stage.needRequirements': 'Нет привязанных требований',
  'stage.needRequirementDoc': 'Документ требований не подтверждён',
  'stage.needArchitectureDoc': 'Архитектурное решение не подтверждено',
  'stage.needReviewReport': 'Отчёт ревью не подтверждён',
  'stage.needTestReport': 'Отчёт о тестировании не подтверждён',
  'stage.needSpecs': 'Не заданы спецификации задач',
  'stage.needRoles': 'Для роли из спецификации нет доступных участников',
  'task.role': 'Роль',
  'task.member': 'Участник',
  'task.dependency': 'Зависимость',
  'task.ready': 'Готова',
  'task.blocked': 'Заблокирована',
  'requirement.docApproved': 'Документ подтверждён',
  'requirement.docDraft': 'Документ не подтверждён',
  'meeting.rounds': 'Раунды выступлений',
  'meeting.system': 'Системное сообщение',
  'meeting.expand': 'Развернуть',
  'meeting.collapse': 'Свернуть',
  'settings.leadModel': 'Модель руководителя',
  'settings.group.active': 'Активные',
  'settings.group.blocked': 'Заблокированные',
  'settings.group.removed': 'Удалённые',
  'settings.group.missing': 'Отсутствующие',
  'settings.group.unconfigured': 'Без роли',
  'settings.stages': 'Этапы участия',
  'settings.refs': 'Ссылок',
  'confirm.what': 'Что произойдёт',
  'confirm.why': 'Почему',
  'confirm.recoverable': 'Можно ли отменить',
  'confirm.confirm': 'Подтвердить',
  'confirm.cancel': 'Отмена',
  'board.tasks': 'Задачи в работе',
  'timeline.latest': 'В обратном порядке времени, по 5 записей на страницу',
  'artifact.captureProgress': 'Собираем артефакты у участников, подождите…',
  'artifact.capturing': 'Сбор…',
  'task.tokensUnknown': 'Представление задач не отдаёт статистику Token',
  'task.tokens': 'Расход Token',
  'task.elapsed': 'Длительность',
  'task.progress': 'Прогресс',
  'task.detail': 'Детали задачи',
  'task.status.deleted': 'Удалена',
  'task.status.completed': 'Завершена',
  'task.status.blocked': 'Заблокирована',
  'task.status.pending': 'Ожидает',
  'task.status.in_progress': 'Выполняется',
  'board.timeline': 'Хронология',
  'board.artifacts': 'Артефакты',
  'confirm.reportTitle': 'Отчёт ждёт подтверждения: {name}',
  'confirm.enterReview': 'Подтвердить и перейти к ревью',
  'confirm.devDoneText': 'Все задачи разработки завершены. Проверьте результат в браузере и артефакты, затем перейдите к ревью.',
  'confirm.devDoneTitle': 'Разработка завершена, ждём подтверждения',
  'confirm.empty': 'Нет пунктов на подтверждение',
  'confirm.title': 'Ручные подтверждения',
  'confirm.lastReject': 'Причина прошлого отклонения: {reason}',
  'confirm.submitReject': 'Отправить отклонение',
  'confirm.rejectReason': 'Причина отклонения (будет отправлена разработчику)',
  'confirm.reject': 'Отклонить',
  'confirm.artifacts': 'Связанные артефакты',
  'confirm.tasks': 'Задачи разработки',
  'board.loadCount': 'Задач',
  'board.teamLoad': 'Загрузка команды',
  'board.meetings': 'Встречи',
  'requirement.title': 'Требования',
  'requirement.new': 'Новое требование',
  'requirement.edit': 'Редактировать требование',
  'requirement.name': 'Заголовок требования',
  'requirement.desc': 'Описание требования',
  'requirement.tags': 'Теги ролей (через запятую)',
  'requirement.specs': 'Спецификации задач (JSON)',
  'requirement.autoSpecs': 'Создать спецификации автоматически',
  'requirement.leadSpecs': 'Разбить на спецификации задач',
  'requirement.bindVersion': 'Привязать к текущей версии',
  'requirement.doc': 'Документ требования',
  'requirement.specInvalid': 'Некорректный JSON спецификаций: {message}',
  'task.title': 'Задачи в работе',
  'task.owner': 'Ответственный',
  'task.phase': 'Этап',
  'task.status': 'Статус',
  'artifact.title': 'Артефакты',
  'artifact.new': 'Новый артефакт',
  'artifact.type': 'Тип',
  'artifact.content': 'Содержимое (Markdown)',
  'artifact.approve': 'Подтвердить',
  'artifact.archive': 'Архивировать',
  'artifact.captureReview': 'Собрать отчёт ревью',
  'artifact.captureTest': 'Собрать отчёт о тестировании',
  'member.title': 'Участники',
  'member.new': 'Новый участник',
  'member.name': 'Имя участника (латинский идентификатор)',
  'member.display': 'Отображаемое имя',
  'member.role': 'Роль',
  'member.route': 'Маршрут модели',
  'member.routeInherit': 'Наследовать по умолчанию',
  'member.block': 'Заблокировать',
  'member.removeHint': 'Удаление только в этом проекте (рабочей области): участник больше не получает задачи и не участвует во встречах; в официальном составе он остаётся, решение принимает платформа.',
  'member.removeRecoverable': 'Можно восстановить: нажмите «Восстановить» в группе «Удалённые» или пересоздайте с тем же именем.',
  'member.unblock': 'Разблокировать',
  'member.remove': 'Убрать из команды',
  'member.restore': 'Восстановить',
  'member.recreate': 'Пересоздать',
  'member.removed': 'Удалён',
  'member.blocked': 'Заблокирован',
  'member.statusActive': 'Активен',
  'member.statusPending': 'Ждёт назначения',
  'member.statusMissing': 'Отсутствует',
  'member.statusRemoved': 'Удалён',
  'member.status': 'Статус',
  'role.title': 'Роли и промпты',
  'role.new': 'Новая роль',
  'role.prompt': 'Промпт по умолчанию',
  'role.promptSync': 'Применить промпт к участникам',
  'role.reset': 'Восстановить промпт по умолчанию',
  'role.delete': 'Удалить роль',
  'role.deleteHint': 'Удаление роли необратимо; оно доступно, только если роль не используется участниками, тегами требований, спецификациями задач и этапами по умолчанию.',
  'role.deleteRecoverable': 'Необратимо: встроенную роль можно воссоздать кнопкой «Восстановить роли по умолчанию» с тем же промптом, пользовательскую придётся создать заново.',
  'role.idHint': 'Идентификатор роли — строчные латинские буквы, цифры и дефисы, начинается с буквы (2–32 символа).',
  'meeting.title': 'Встречи',
  'meeting.new': 'Новая встреча',
  'meeting.type': 'Тип',
  'meeting.type.requirement': 'Встреча по уточнению требований',
  'meeting.type.architecture': 'Ревью архитектуры',
  'meeting.type.test': 'Встреча по деталям тестирования',
  'meeting.type.custom': 'Своя встреча',
  'meeting.host': 'Ведущий',
  'meeting.participants': 'Участники (имена через запятую)',
  'meeting.goal': 'Цель встречи',
  'meeting.start': 'Начать встречу',
  'meeting.openHost': 'Перейти к обсуждению',
  'meeting.speak': 'Дать слово участнику',
  'meeting.question': 'Вопрос для выступления',
  'meeting.generate': 'Попросить ведущего подготовить документ',
  'meeting.saveRequirement': 'Сохранить требование в версию',
  'meeting.finish': 'Завершить встречу и создать протокол',
  'meeting.close': 'Закрыть встречу',
  'meeting.cancel': 'Отменить встречу',
  'meeting.transcript': 'Протокол встречи',
  'meeting.draft': 'Черновик требования',
  'meeting.archTitle': 'Ревью архитектуры: {name}',
  'meeting.archGoal': 'Уточнить детали архитектуры и подготовить документ архитектуры',
  'meeting.activeBanner': 'Встреча идёт',
  'common.viewDetails': 'Подробнее',
  'meeting.documents': 'Документы встречи',
  'meeting.progressFinish': 'Завершаем встречу и создаём протокол, подождите…',
  'meeting.progressGenerate': 'Ведущий готовит документ, подождите…',
  'meeting.progressSpeak': '{name} выступает, подождите…',
  'meeting.finishing': 'Завершение…',
  'meeting.generating': 'Создание…',
  'meeting.speaking': 'Выступление…',
  'meeting.status.cancelled': 'Отменена',
  'meeting.status.closed': 'Завершена',
  'meeting.status.active': 'Идёт',
  'meeting.status.draft': 'Черновик',
  'meeting.bannerExit': 'Завершить встречу',
  'meeting.bannerBoard': 'Вернуться на доску',
  'meeting.finished': 'Встреча завершена, протокол создан.',
  'meeting.minutes': 'Протокол встречи',
  'meeting.noMinutes': 'Протокол ещё не создан',
  'meeting.openBoard': 'Вернуться на доску',
  'pending.title': 'Требует решения',
  'pending.reportDraft': 'Отчёт ждёт подтверждения: {name}',
  'pending.noSpecs': 'У требования «{name}» нет спецификаций задач',
  'pending.gate': 'Гейт этапа не пройден',
  'timeline.title': 'Хронология',
  'timeline.empty': 'Событий нет',
  'teamLoad.title': 'Загрузка команды',
  'load.inProgress': '{n} в работе',
  'empty.noVersion': 'Версий пока нет',
  'empty.noVersionHint': 'Создайте версию, затем привяжите требования и перейдите к проектированию архитектуры.',
  'empty.noData': 'Нет данных',
  'error.code': '{code}: {message}',
  'error.network': 'Сетевая ошибка: {message}',
}

    /* ---------------------------------------------------------------- styles */

    /* ------------------------------------------------------- design system */

    const TOKEN_STYLE_ID = 'devteam-design-tokens'
    const TOKEN_CSS = `
:where(.dt-root){
  --dt-canvas:#0F172A; --dt-surface:#1B2336; --dt-surface-raised:#272F42; --dt-surface-sunken:#0F172A;
  --dt-text-primary:#F8FAFC; --dt-text-secondary:#94A3B8; --dt-text-tertiary:#94A3B8;
  --dt-accent:#22C55E; --dt-accent-hover:#22C55E; --dt-accent-muted:#272F42;
  --dt-accent-foreground:#0F172A;
  --dt-border-subtle:#272F42; --dt-border-strong:#334155; --dt-border-control:#475569;
  --dt-success:#22C55E; --dt-success-bg:color-mix(in srgb, var(--dt-success) 12%, transparent);
  /* WARNING_TOKEN_PENDING: #FBBF24 is not in design.tokens.json; retained from the dsh-fuse dark theme until a warning token is supplied. */
  --dt-warning:#FBBF24; --dt-warning-bg:color-mix(in srgb, var(--dt-warning) 12%, transparent);
  --dt-danger:#EF4444; --dt-danger-bg:color-mix(in srgb, var(--dt-danger) 12%, transparent);
  --dt-focus-ring:#22C55E;
  --dt-font:"Inter","SF Pro Text","Segoe UI","PingFang SC","Microsoft YaHei","Noto Sans SC",sans-serif;
  --dt-mono:"JetBrains Mono","Cascadia Code","SF Mono",Consolas,"Liberation Mono",monospace;
  color-scheme:dark;
}
.dt-root{font-family:var(--dt-font);color:var(--dt-text-primary);background:var(--dt-canvas);}
.dt-root :is(button,input,select,textarea,[tabindex]):focus-visible{outline:2px solid var(--dt-focus-ring);outline-offset:2px;}
.dt-root [data-dt-scroll]{scrollbar-width:thin;scrollbar-color:var(--dt-border-strong) transparent;}
.dt-root,.dt-root *{box-sizing:border-box;}
.dt-root button{transition:opacity 100ms ease,border-color 100ms ease,color 100ms ease;}
.dt-root button:active:not(:disabled){opacity:.85;}
.dt-root button:disabled,.dt-root input:disabled,.dt-root select:disabled,.dt-root textarea:disabled{opacity:1;cursor:not-allowed;color:var(--dt-text-secondary);border-color:var(--dt-border-subtle);background:var(--dt-surface-raised);}
.dt-stage:hover:not(:disabled),.dt-stage:focus-visible:not(:disabled){border-color:var(--dt-accent);color:var(--dt-accent);}
.dt-open-dir:hover{border-color:var(--dt-border-subtle);color:var(--dt-text-primary);}
.dt-mono{font-family:var(--dt-mono);font-variant-numeric:tabular-nums;}
@media (prefers-reduced-motion:reduce){.dt-root *,.dt-root *::before,.dt-root *::after{animation:none!important;transition:none!important;}}
`

    const injectDesignTokens = () => {
      if (typeof document === 'undefined' || document.head === undefined) return
      if (document.getElementById(TOKEN_STYLE_ID) !== null) return
      const style = document.createElement('style')
      style.id = TOKEN_STYLE_ID
      style.textContent = TOKEN_CSS
      document.head.appendChild(style)
    }

    const S = {
      root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, maxHeight: '100%', overflow: 'hidden', boxSizing: 'border-box', paddingTop: 8, background: 'var(--dt-canvas)', color: 'var(--dt-text-primary)', fontSize: 13, fontFamily: 'var(--dt-font)' },
      // P1-A: single row, <=48px, no wrap
      topbar: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid var(--dt-border-subtle)', flexWrap: 'nowrap', flex: 'none', background: 'var(--dt-surface)', height: 56, minHeight: 56, maxHeight: 56, overflow: 'hidden' },
      project: { display: 'flex', flexDirection: 'column', minWidth: 0, flex: '1 1 auto', overflow: 'hidden', gap: 2 },
      projectLine: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
      versionLine: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
      projectName: { fontWeight: 600, fontSize: 14, lineHeight: '20px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      path: { color: 'var(--dt-text-secondary)', fontSize: 12, lineHeight: '16px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'var(--dt-mono)' },
      muted: { color: 'var(--dt-text-secondary)', fontSize: 12, lineHeight: 1.6 },
      mono: { fontFamily: 'var(--dt-mono)', fontVariantNumeric: 'tabular-nums', fontSize: 11 },
      dot: (ok) => ({ width: 6, height: 6, borderRadius: '50%', background: ok ? 'var(--dt-success)' : 'var(--dt-warning)', flex: 'none' }),
      spacer: { flex: 1 },
      iconBtn: { width: 24, height: 24, minHeight: 24, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: '1px solid transparent', borderRadius: 4, background: 'transparent', color: 'var(--dt-text-secondary)', cursor: 'pointer', flex: 'none' },
      btn: { fontSize: 12, lineHeight: '18px', padding: '4px 8px', minHeight: 28, borderRadius: 4, border: '1px solid var(--dt-border-subtle)', background: 'var(--dt-surface-raised)', color: 'var(--dt-text-primary)', cursor: 'pointer', whiteSpace: 'nowrap' },
      // neutral primary: accent is reserved for stage actions
      btnPrimary: { fontSize: 12, lineHeight: '18px', padding: '4px 8px', minHeight: 28, borderRadius: 4, border: '1px solid var(--dt-border-strong)', background: 'var(--dt-surface-raised)', color: 'var(--dt-text-primary)', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' },
      // accent allocation: stage advance only (border + text)
      btnStage: { fontSize: 12, lineHeight: '18px', padding: '4px 8px', minHeight: 28, borderRadius: 4, border: '1px solid var(--dt-border-strong)', background: 'transparent', color: 'var(--dt-text-primary)', fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' },
      btnGhost: { fontSize: 12, lineHeight: '18px', padding: '4px', minHeight: 24, borderRadius: 4, border: 'none', background: 'transparent', color: 'var(--dt-text-secondary)', cursor: 'pointer' },
      input: { width: '100%', boxSizing: 'border-box', marginBottom: 8, padding: '6px 8px', fontSize: 13, lineHeight: '20px', borderRadius: 4, border: '1px solid var(--dt-border-control)', background: 'var(--dt-surface-raised)', color: 'var(--dt-text-primary)' },
      textarea: { width: '100%', boxSizing: 'border-box', marginBottom: 8, padding: '6px 8px', fontSize: 13, lineHeight: 1.6, borderRadius: 4, border: '1px solid var(--dt-border-control)', background: 'var(--dt-surface-raised)', color: 'var(--dt-text-primary)' },
      select: { width: '100%', boxSizing: 'border-box', marginBottom: 8, padding: '6px 8px', fontSize: 13, lineHeight: '20px', borderRadius: 4, border: '1px solid var(--dt-border-control)', background: 'var(--dt-surface-raised)', color: 'var(--dt-text-primary)' },
      selectSm: { width: 'auto', maxWidth: 160, marginBottom: 0, padding: '4px 8px', fontSize: 12, lineHeight: '20px', height: 28, borderRadius: 4, border: '1px solid var(--dt-border-subtle)', background: 'var(--dt-surface-raised)', color: 'var(--dt-text-primary)' },
      // P1-A: compact segmented tabs, <=36px
      tabs: { display: 'flex', alignItems: 'center', gap: 4, marginTop: 8, padding: '4px 8px', borderBottom: '1px solid var(--dt-border-subtle)', background: 'var(--dt-surface)', flex: 'none', height: 44, minHeight: 44, maxHeight: 44, overflow: 'hidden' },
      tab: (active) => ({ position: 'relative', fontSize: 14, lineHeight: '24px', fontWeight: active ? 600 : 400, padding: '4px 12px', height: 32, borderRadius: 4, cursor: 'pointer', color: active ? 'var(--dt-text-primary)' : 'var(--dt-text-secondary)', border: active ? '1px solid var(--dt-border-strong)' : '1px solid transparent', background: active ? 'var(--dt-surface-raised)' : 'transparent' }),
      tabDot: { position: 'absolute', top: 3, right: 3, width: 6, height: 6, borderRadius: 999, background: 'var(--dt-danger)' },
      // P1-B/C: main + side columns; page never scrolls
      body: { flex: 1, minHeight: 0, display: 'flex', gap: 0, padding: 8, overflow: 'hidden', alignItems: 'stretch' },
      mainCol: { flex: '1 1 60%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', paddingRight: 8, boxSizing: 'border-box' },
      sideCol: { flex: '0 0 40%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto', borderLeft: '1px solid var(--dt-border-subtle)', paddingLeft: 8, boxSizing: 'border-box' },
      col: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto' },
      section: { border: '1px solid var(--dt-border-subtle)', borderRadius: 4, padding: '4px 8px', background: 'var(--dt-surface)' },
      card: { border: '1px solid var(--dt-border-subtle)', borderRadius: 4, padding: '4px 8px', background: 'var(--dt-surface)' },
      sectionTitle: { fontWeight: 600, fontSize: 12, lineHeight: 1.35, color: 'var(--dt-text-primary)', whiteSpace: 'nowrap' },
      sectionHead: { display: 'flex', alignItems: 'center', gap: 4, height: 28, marginBottom: 2 },
      count: { marginLeft: 8, fontSize: 11, color: 'var(--dt-text-secondary)', flex: 'none' },
      row: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
      rowLine: { display: 'flex', alignItems: 'center', gap: 4, minHeight: 32, borderTop: '1px solid var(--dt-border-subtle)' },
      trunc: { flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      gap: { height: 6 },
      tag: (tone) => ({
        display: 'inline-block',
        padding: '0 4px',
        borderRadius: 4,
        fontSize: 11,
        lineHeight: '18px',
        border: tone === 'ok' ? '1px solid var(--dt-success)' : tone === 'warn' ? '1px solid var(--dt-warning)' : tone === 'danger' ? '1px solid var(--dt-danger)' : '1px solid var(--dt-border-subtle)',
        background: 'transparent',
        color: tone === 'ok' ? 'var(--dt-success)' : tone === 'warn' ? 'var(--dt-warning)' : tone === 'danger' ? 'var(--dt-text-primary)' : 'var(--dt-text-secondary)',
        whiteSpace: 'nowrap',
      }),
      tagMono: (tone) => ({ ...S.tag(tone), fontFamily: 'var(--dt-mono)', fontSize: 11 }),
      pre: { margin: '4px 0 0', fontSize: 12, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 180, overflow: 'auto', background: 'var(--dt-surface-sunken)', border: '1px solid var(--dt-border-subtle)', borderRadius: 4, padding: 8, fontFamily: 'var(--dt-mono)' },
      error: { color: 'var(--dt-text-primary)', background: 'var(--dt-danger-bg)', border: '1px solid var(--dt-danger)', borderRadius: 4, fontSize: 13, lineHeight: 1.6, padding: '4px 8px', margin: '4px 8px' },
      modalBackdrop: { position: 'fixed', inset: 0, background: 'color-mix(in srgb, var(--dt-canvas) 70%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
      modal: { width: 'min(640px, 92vw)', maxHeight: '86vh', overflow: 'auto', background: 'var(--dt-surface)', border: '1px solid var(--dt-border-strong)', borderRadius: 8, padding: 16, boxShadow: 'none' },
      modalTitle: { fontWeight: 600, fontSize: 16, lineHeight: 1.3, marginBottom: 8 },
      timeline: { borderTop: '1px solid var(--dt-border-subtle)', padding: '4px 8px', fontSize: 12, color: 'var(--dt-text-secondary)', maxHeight: 120, overflow: 'auto' },
      banner: { display: 'flex', alignItems: 'center', gap: 4, margin: '0 8px 4px', padding: '4px 8px', height: 40, maxHeight: 40, borderRadius: 4, border: '1px solid var(--dt-border-subtle)', background: 'var(--dt-surface)', transition: 'opacity 120ms ease' },
      pipeline: { display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap', marginTop: 2, height: 32, maxHeight: 32, overflow: 'hidden' },
      stageNode: (state) => ({
        display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 8px', borderRadius: 4, fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
        border: state === 'current' ? '1px solid var(--dt-accent)' : '1px solid var(--dt-border-subtle)',
        background: 'transparent',
        color: state === 'current' ? 'var(--dt-accent)' : 'var(--dt-text-secondary)',
        opacity: state === 'todo' ? 0.75 : 1,
      }),
      stageIcon: { width: 16, fontSize: 11, textAlign: 'center' },
      gateBox: { marginTop: 4, borderTop: '1px solid var(--dt-border-subtle)', paddingTop: 4, display: 'flex', flexDirection: 'column', gap: 2 },
      versionHead: { display: 'flex', alignItems: 'center', gap: 4, height: 36, maxHeight: 40, overflow: 'hidden' },
      versionName: { fontWeight: 600, fontSize: 14, lineHeight: '18px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 },
      tableHead: { display: 'flex', alignItems: 'center', gap: 4, height: 28, color: 'var(--dt-text-secondary)', fontSize: 11, borderTop: '1px solid var(--dt-border-subtle)' },
      tableRow: { display: 'flex', alignItems: 'center', gap: 4, height: 36, maxHeight: 40, borderTop: '1px solid var(--dt-border-subtle)', fontSize: 12 },
      taskRow: { display: 'flex', alignItems: 'center', gap: 4, height: 36, maxHeight: 40, borderTop: '1px solid var(--dt-border-subtle)', fontSize: 12 },
      artifactRow: { display: 'flex', alignItems: 'center', gap: 4, height: 36, maxHeight: 40, borderTop: '1px solid var(--dt-border-subtle)', fontSize: 12 },
      loadRow: { display: 'flex', alignItems: 'center', gap: 4, height: 32, maxHeight: 36, borderTop: '1px solid var(--dt-border-subtle)', fontSize: 12 },
      meetingRow: { display: 'flex', alignItems: 'center', gap: 4, height: 32, maxHeight: 36, borderTop: '1px solid var(--dt-border-subtle)', fontSize: 12 },
      // pending: accent vertical bar + <=40px row
      pendingRow: { display: 'flex', alignItems: 'center', gap: 4, minHeight: 36, maxHeight: 40, borderTop: '1px solid var(--dt-border-subtle)', paddingLeft: 4, borderLeft: '2px solid var(--dt-accent)', fontSize: 12 },
      transcriptRound: { borderTop: '1px solid var(--dt-border-subtle)', borderLeft: '2px solid var(--dt-border-strong)', padding: '4px 8px', marginTop: 4 },
      transcriptSystem: { color: 'var(--dt-text-secondary)', fontSize: 11, lineHeight: '18px', borderTop: '1px solid var(--dt-border-subtle)', padding: '2px 0' },
    }

    /* --------------------------------------------------------------- helpers */

    const fmtDate = (value) => {
      if (typeof value !== 'string' || value === '') return ''
      const d = new Date(value)
      return Number.isNaN(d.getTime()) ? value : d.toLocaleString()
    }

    const requestJson = async (url, init) => {
      const res = await fetch(url, init)
      const text = await res.text()
      try {
        return JSON.parse(text)
      } catch {
        return { ok: false, error: { code: 'BAD_RESPONSE', message: `HTTP ${res.status}: ${text.slice(0, 200)}` } }
      }
    }

    function useTicker(ms) {
      const [tick, setTick] = React.useState(0)
      React.useEffect(() => {
        const id = setInterval(() => setTick((v) => v + 1), ms)
        return () => clearInterval(id)
      }, [ms])
      return tick
    }

    function useViewportHeight() {
      const read = () => (typeof window === 'undefined' ? 900 : window.innerHeight || 900)
      const [height, setHeight] = React.useState(read)
      React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        const onResize = () => setHeight(window.innerHeight || 900)
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])
      return height
    }

    function useViewportWidth() {
      const read = () => (typeof window === 'undefined' ? 1440 : window.innerWidth || 1440)
      const [width, setWidth] = React.useState(read)
      React.useEffect(() => {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
        const onResize = () => setWidth(window.innerWidth || 1440)
        window.addEventListener('resize', onResize)
        return () => window.removeEventListener('resize', onResize)
      }, [])
      return width
    }

    const isApprovedArtifact = (artifact) =>
      artifact !== undefined && (artifact.status === 'approved' || artifact.status === 'archived')

    /** Derive stage gate gaps from the loaded state only; no RPC is added. */
    function gateMissing({ version, requirements, artifacts, members, settings, t }) {
      if (!version) return []
      const bound = requirements.filter((requirement) => requirement.versionId === version.id)
      const missing = []
      const roleHasMember = (roleId) => roleId === undefined || members.some(
        (member) => member.roleId === roleId && !member.blocked && !member.removed && member.creation?.status === 'active',
      )
      if (version.stage === 'requirement') {
        if (bound.length === 0) missing.push(t('stage.needRequirements'))
        for (const requirement of bound) {
          const doc = artifacts.find(
            (artifact) => artifact.type === 'requirement_doc' && artifact.requirementId === requirement.id && isApprovedArtifact(artifact),
          )
          if (doc === undefined) missing.push(`${requirement.title} · ${t('stage.needRequirementDoc')}`)
        }
      } else if (version.stage === 'architecture') {
        const architecture = artifacts.find(
          (artifact) => artifact.versionId === version.id && artifact.type === 'architecture_doc' && isApprovedArtifact(artifact),
        )
        if (architecture === undefined) missing.push(t('stage.needArchitectureDoc'))
        for (const requirement of bound) {
          const specs = (requirement.taskSpecs ?? []).filter((spec) => spec.stage !== 'testing')
          if (specs.length === 0) missing.push(`${requirement.title} · ${t('stage.needSpecs')}`)
          for (const spec of specs) {
            const hasMember = members.some(
              (member) => member.roleId === spec.role && !member.blocked && !member.removed && member.creation?.status === 'active',
            )
            if (!hasMember) missing.push(`${requirement.title} · ${spec.role} · ${t('stage.needRoles')}`)
          }
        }
        if (!roleHasMember(settings?.defaultRoleByStage?.review)) missing.push(`${t('stage.needRoles')} · ${settings?.defaultRoleByStage?.review ?? 'review'}`)
        if (!roleHasMember(settings?.defaultRoleByStage?.testing)) missing.push(`${t('stage.needRoles')} · ${settings?.defaultRoleByStage?.testing ?? 'test'}`)
      } else if (version.stage === 'review') {
        const report = artifacts.find(
          (artifact) => artifact.versionId === version.id && artifact.type === 'review_report' && isApprovedArtifact(artifact),
        )
        if (report === undefined) missing.push(t('stage.needReviewReport'))
      } else if (version.stage === 'testing') {
        const report = artifacts.find(
          (artifact) => artifact.versionId === version.id && artifact.type === 'test_report' && isApprovedArtifact(artifact),
        )
        if (report === undefined) missing.push(t('stage.needTestReport'))
      }
      return missing
    }

    /* ------------------------------------------------------------------ modal */

    function Modal({ title, onClose, children, footer }) {
      const ref = typeof React.useRef === 'function' ? React.useRef(null) : { current: null }
      const closeRef = typeof React.useRef === 'function' ? React.useRef(onClose) : { current: onClose }
      closeRef.current = onClose
      // Mount-only: the panel polls every 3s; re-running this effect would call focus()
      // again and yank the caret out of the focused input.
      React.useEffect(() => {
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
        const onKey = (event) => { if (event.key === 'Escape') closeRef.current() }
        document.addEventListener('keydown', onKey)
        try {
          const focusable = ref.current?.querySelector?.('input:not([disabled]),textarea:not([disabled]),select:not([disabled]),button:not([disabled])')
          ;(focusable ?? ref.current)?.focus?.()
        } catch {}
        return () => document.removeEventListener('keydown', onKey)
      }, [])
      return h(
        'div',
        { style: S.modalBackdrop, onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
        h(
          'div',
          { style: S.modal, role: 'dialog', 'aria-modal': 'true', 'aria-label': title, tabIndex: -1, ref },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            h('div', { style: S.modalTitle }, title),
            // U+2715 is a typographic close glyph, not an emoji icon.
            h('button', { style: S.btnGhost, onClick: onClose, 'aria-label': 'close' }, '✕'),
          ),
          children,
          footer ? h('div', { style: { ...S.row, marginTop: 8, justifyContent: 'flex-end' } }, footer) : null,
        ),
      )
    }

    const field = (label, node) => h('div', null, h('div', { style: { ...S.muted, marginBottom: 4 } }, label), node)

    /* ------------------------------------------------------------- data hooks */

    function usePlannerData(sessionId, workspacePath) {
      const t = ctxRef.locale.bind(NS)
      const [snapshot, setSnapshot] = React.useState(null)
      const [catalog, setCatalog] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [last, setLast] = React.useState(null)
      const sessionKey = typeof sessionId === 'string' ? sessionId : ''
      const workspaceKey = typeof workspacePath === 'string' ? workspacePath : ''
      const languageKey = activeLanguage()
      const sessionRef = React.useRef(sessionKey)
      sessionRef.current = sessionKey

      React.useEffect(() => {
        setSnapshot(null)
        setError(null)
      }, [sessionKey])

      const refresh = React.useCallback(() => {
        if (sessionKey === '') return Promise.resolve(null)
        const requestedFor = sessionKey
        const workspaceQuery = workspaceKey === '' ? '' : `&workspace=${encodeURIComponent(workspaceKey)}`
        return requestJson(`${STATE_URL}?session=${encodeURIComponent(sessionKey)}${workspaceQuery}&language=${encodeURIComponent(languageKey)}`)
          .then((body) => {
            if (sessionRef.current !== requestedFor) return body
            if (body.ok) {
              setSnapshot((previous) => {
                const previousRevision = previous?.state?.revision
                const nextRevision = body.value?.state?.revision
                // A slow poll must never overwrite a newer command result.
                if (typeof previousRevision === 'number' && typeof nextRevision === 'number' && nextRevision < previousRevision) {
                  return previous
                }
                return body.value
              })
              setError((previous) => (previous?.source === 'command' ? previous : null))
            } else setError(body.error ?? { code: 'STATE_FAILED', message: 'state request failed' })
            return body
          })
          .catch((failure) => {
            if (sessionRef.current !== requestedFor) return { ok: false, error: { code: 'STALE', message: 'session changed' } }
            const err = { code: 'NETWORK', message: String(failure) }
            setError(err)
            return { ok: false, error: err }
          })
      }, [sessionKey, workspaceKey, languageKey])

      React.useEffect(() => {
        void refresh()
        if (sessionKey === '') return () => {}
        const id = setInterval(refresh, 3000)
        return () => clearInterval(id)
      }, [refresh, sessionKey])

      React.useEffect(() => {
        if (sessionKey === '') return
        requestJson(COMMAND_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ session: sessionKey, op: 'catalog.get', payload: {} }),
        })
          .then((body) => { if (body.ok) setCatalog(body.value.catalog) })
          .catch(() => {})
      }, [sessionKey])

      const run = React.useCallback(
        (op, payload, options) => {
          if (sessionKey === '') return Promise.resolve(null)
          // Serial callers (e.g. requirement.create -> requirement.setTaskSpecs)
          // must pass the revision returned by the first command: the snapshot
          // captured in this closure is still one render old.
          const expectedRevision = typeof options?.revision === 'number' ? options.revision : snapshot?.state?.revision
          setBusy(op)
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), LONG_OPS.has(op) ? 240000 : 60000)
          return requestJson(COMMAND_URL, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ session: sessionKey, workspace: workspaceKey || undefined, language: languageKey, op, expectedRevision, payload: payload || {} }),
            signal: controller.signal,
          })
            .then((body) => {
              if (sessionRef.current !== sessionKey) return body
              if (body.ok === true) {
                if (body.value?.state !== undefined) {
                  setSnapshot((previous) => ({ ...(previous || {}), state: body.value.state }))
                }
                setError(null)
              } else setError({ ...(body.error ?? { code: 'COMMAND_FAILED', message: 'command failed' }), source: 'command' })
              setLast({ at: new Date().toLocaleTimeString(), op, body })
              void refresh()
              return body
            })
            .catch((failure) => {
              const aborted = failure !== null && typeof failure === 'object' && failure.name === 'AbortError'
              const err = { code: aborted ? 'TIMEOUT' : 'NETWORK', message: aborted ? `${op} timeout` : String(failure) }
              setError(err)
              return { ok: false, error: err }
            })
            .finally(() => {
              clearTimeout(timer)
              setBusy(null)
            })
        },
        [sessionKey, snapshot, refresh, languageKey],
      )

      return { snapshot, state: snapshot?.state, catalog, error, busy, last, refresh, run, t, language: languageKey, clearError: () => setError(null) }
    }

    function useWorkspaceContext() {
      const tick = useTicker(2500)
      const workspacesSvc = ctxRef.get('workspaces')
      const sessionsSvc = ctxRef.get('sessions')
      const wsSnap = workspacesSvc?.list?.getSnapshot?.() ?? { items: [] }
      const sessionSnap = sessionsSvc?.list?.getSnapshot?.() ?? { ids: [], byId: {} }
      const items = Array.isArray(wsSnap.items) ? wsSnap.items : []
      const sessionIds = Array.isArray(sessionSnap.ids) ? sessionSnap.ids : []
      const sessionRows = sessionSnap.byId ?? {}
      const [picked, setPicked] = React.useState(() => {
        try { return localStorage.getItem('devteam.lastWorkspace') } catch { return null }
      })
      const sessionLock = React.useRef({ workspaceKey: null, sessionId: null })
      // WorkspaceView exposes `workspaceId` (not `id`); SessionSummary exposes
      // `cwd` (not `workspaceId`). Keep both fallbacks so older fixtures work.
      const workspace = items.find((item) => item.workspaceId === picked || item.id === picked) ?? items[0] ?? null
      const workspaceKey = workspace === null ? '' : String(workspace.workspaceId ?? workspace.id ?? workspace.path ?? '')
      if (sessionLock.current.workspaceKey !== workspaceKey) {
        sessionLock.current = { workspaceKey, sessionId: null }
      }
      let sessionId = null
      if (workspace !== null) {
        const accounted = (Array.isArray(workspace.sessionIds) ? workspace.sessionIds : [])
          .filter((id) => sessionRows[id] !== undefined)
        const samePath = sessionIds.filter((id) => {
          const row = sessionRows[id]
          if (row === undefined) return false
          const cwd = typeof row.cwd === 'string' ? row.cwd : ''
          const path = typeof workspace.path === 'string' ? workspace.path : ''
          return cwd !== '' && path !== '' && (cwd === path || cwd.startsWith(`${path}\\`) || cwd.startsWith(`${path}/`))
        })
        // Prefer sessions whose cwd is exactly inside this workspace; this avoids
        // loading another workspace's state when a stale session id is accounted.
        const allCandidates = [...new Set([...samePath, ...accounted])]
        // Subagent sessions are owned by their durable parent address; commands sent
        // from them fail with session/agent-busy. Prefer root/lead sessions.
        const rootCandidates = allCandidates.filter((id) => sessionRows[id]?.origin !== 'subagent' && sessionRows[id]?.parentId === undefined)
        const candidates = rootCandidates.length > 0 ? rootCandidates : allCandidates
        const ranked = [...candidates].sort((a, b) => (sessionRows[b]?.updatedAt ?? 0) - (sessionRows[a]?.updatedAt ?? 0))
        const nonBlank = ranked.filter((id) => sessionRows[id]?.blank !== true)
        const resolved = nonBlank.find((id) => typeof sessionRows[id]?.title === 'string' && sessionRows[id].title !== '')
          ?? nonBlank[0]
          ?? ranked[0]
          ?? null
        const locked = sessionLock.current.sessionId
        const lockedRow = locked === null ? undefined : sessionRows[locked]
        const lockedStillListed = locked !== null && candidates.includes(locked)
        if (lockedRow === undefined || !lockedStillListed) sessionLock.current.sessionId = resolved
        sessionId = sessionLock.current.sessionId ?? resolved
      }
      const selectWorkspace = (id) => {
        if (typeof id !== 'string' || id === '') return
        setPicked(id)
        try { localStorage.setItem('devteam.lastWorkspace', id) } catch {}
      }
      const createSession = () => {
        if (workspace === null) return
        const workspaceId = workspace.workspaceId ?? workspace.id
        if (typeof workspaceId !== 'string' || workspaceId === '') return
        const uiWorkspace = ctxRef.get('uiWorkspace')
        try {
          if (typeof uiWorkspace?.startSession === 'function') uiWorkspace.startSession(workspaceId)
          else if (typeof uiWorkspace?.openWorkspace === 'function') void uiWorkspace.openWorkspace(workspaceId)
        } catch {}
      }
      return {
        workspaces: items,
        workspace,
        sessionId,
        selectWorkspace,
        createSession,
        tick,
        hasWorkspacesService: workspacesSvc !== undefined,
        workspacesPending: wsSnap.phase === 'pending',
        sessionsPending: sessionSnap.phase === 'pending',
      }
    }

    /* ------------------------------------------------------------- components */

    function WorkspaceBar({
      wctx, t, language, setLanguage,
      versions, version, onSelectVersion,
      onSettings,
    }) {
      const ws = wctx.workspace
      const path = ws?.path ?? ws?.rootPath ?? ''
      const workspaceId = ws?.workspaceId ?? ws?.id ?? ''
      const separator = language === 'zh' ? '：' : ': '
      const viewport = useViewportWidth()
      const narrow = viewport < 1280
      const layout = ctxRef.get('layout')
      const canLeave = typeof layout?.selectPanel === 'function'
      const backToChat = () => {
        try { layout.selectPanel(null) } catch {}
      }
      const openDirectory = () => {
        const clickBaseOpener = () => {
          try {
            if (typeof document === 'undefined') return false
            const target = Array.from(document.querySelectorAll('button, [role="button"]')).find((node) => {
              const label = node.getAttribute('title') ?? node.getAttribute('aria-label') ?? ''
              return /文件资源管理器|File Explorer|Open in File Explorer/i.test(label)
            })
            if (target === undefined) return false
            target.click()
            return true
          } catch {
            return false
          }
        }
        const openViaBaseApp = async () => {
          const appsResponse = await fetch('open-in-app/apps', { headers: { accept: 'application/json' } })
          if (!appsResponse.ok) throw new Error('apps route unavailable')
          const payload = await appsResponse.json()
          const apps = Array.isArray(payload.apps) ? payload.apps.filter((id) => typeof id === 'string') : []
          if (apps.length === 0) throw new Error('no native opener')
          let remembered = ''
          try { remembered = localStorage.getItem('dsh.open-in-app.choice') ?? '' } catch {}
          const app = apps.includes(remembered)
            ? remembered
            : apps.find((id) => /explorer|finder|file|folder|文件|资源管理器/i.test(id)) ?? apps[0]
          const launch = await fetch('open-in-app/open', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ app, path }),
          })
          if (!launch.ok) throw new Error('open failed: HTTP ' + String(launch.status))
        }
        const finishFailure = () => {
          if (!clickBaseOpener() && typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(t('ws.openFailed'))
        }
        openViaBaseApp().catch(() => {
          try {
            const remote = ctxRef.current?.remote ?? ctxRef.get('remote')
            const call = remote?.session?.openWorkspacePath
            if (typeof call !== 'function' || path === '') throw new Error('desktop opener unavailable')
            return Promise.resolve(call.call(remote.session, { path, action: 'reveal' })).then((result) => {
              if (result !== undefined && result !== null && result.ok === false) throw new Error(JSON.stringify(result.error ?? result))
            })
          } catch {
            throw new Error('desktop opener unavailable')
          }
        }).catch(finishFailure)
      }
      // Keep the base shortcut discoverable from the icon's tooltip.
      React.useEffect(() => {
        if (typeof document === 'undefined' || typeof document.addEventListener !== 'function') return undefined
        const onKey = (event) => {
          if (event.ctrlKey === true && event.shiftKey === true && String(event.key).toLowerCase() === 'o') {
            event.preventDefault()
            openDirectory()
          }
        }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [path])
      return h(
        'div',
        { style: S.topbar },
        h('div', { style: S.project },
          h('div', { style: S.projectLine },
            h('span', { style: { ...S.projectName, flex: 'none' } }, `${t('ws.project')}${separator}${ws?.title ?? ws?.name ?? path ?? '—'}`),
            h('select', {
              style: { ...S.selectSm, maxWidth: 160 },
              value: workspaceId,
              disabled: wctx.workspaces.length === 0,
              onChange: (e) => wctx.selectWorkspace(e.target.value),
              title: t('ws.switch'),
            },
            wctx.workspaces.length === 0
              ? h('option', { value: '' }, t('ws.noWorkspace'))
              : wctx.workspaces.map((item) => {
                const id = item.workspaceId ?? item.id ?? ''
                return h('option', { key: id, value: id }, item.title ?? item.path ?? id)
              }),
            ),
          ),
          h('div', { style: S.versionLine },
            h('span', { style: { ...S.muted, flex: 'none' } }, `${t('version.current')}${separator}${version?.name ?? '—'}`),
            h('select', {
              style: { ...S.selectSm, maxWidth: 160 },
              value: version?.id ?? '',
              disabled: versions.length === 0,
              onChange: (e) => onSelectVersion(e.target.value),
              title: t('version.select'),
            },
              versions.length === 0
                ? h('option', { value: '' }, t('common.none'))
                : versions.map((candidate) => h('option', { key: candidate.id, value: candidate.id }, `${candidate.name} · ${candidate.status}`)),
            ),
            h('span', { style: { ...S.path, flex: '0 1 auto', minWidth: 0, maxWidth: '52%' }, title: path || undefined }, path || '—'),
            h('button', {
              style: S.iconBtn,
              className: 'dt-open-dir',
              onClick: openDirectory,
              title: `${t('ws.openDirectory')} (Ctrl+Shift+O)`,
              'aria-label': t('ws.openDirectory'),
            }, h('svg', {
              width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
              'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
            },
              h('path', { d: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z' }),
            )),
          ),
        ),
        h('div', { style: S.spacer }),
        h('select', {
          style: { ...S.selectSm, maxWidth: 110 },
          value: language,
          onChange: (e) => setLanguage(e.target.value),
          title: t('common.language'),
        },
          h('option', { value: 'zh' }, '中文'),
          h('option', { value: 'en' }, 'English'),
          h('option', { value: 'ru' }, 'Русский'),
        ),
        h('button', { style: S.btn, onClick: onSettings }, t('nav.settings')),
        canLeave && !narrow ? h('button', { style: S.btnGhost, onClick: backToChat, title: t('common.backToChat') }, t('common.backToChat')) : null,
      )
    }

    /**
     * P1-B: five compact stage nodes. Clicking a node opens an inline gate
     * detail panel; no navigation and no RPC is introduced.
     */
    function StagePipeline({ t, version, requirements, artifacts, members, settings, onOpenRequirement }) {
      const stages = ['requirement', 'architecture', 'development', 'review', 'testing']
      const currentIndex = stages.indexOf(version?.stage ?? 'requirement')
      const [expanded, setExpanded] = React.useState(null)
      const stageData = expanded === null || !version
        ? []
        : gateMissing({
            version: { ...version, stage: expanded },
            requirements,
            artifacts,
            members,
            settings,
            t,
          })
      return h('div', null,
        h('div', { style: S.pipeline },
          stages.map((stage, index) => {
            const state = index < currentIndex || version?.stage === 'done' ? 'done' : index === currentIndex ? 'current' : 'todo'
            // Status glyphs are typographic symbols (not emoji), paired with text labels for color-independence.
            const icon = state === 'done' ? '✓' : state === 'current' ? '●' : '○'
            const stateLabel = state === 'done' ? t('stage.stateDone') : state === 'current' ? t('stage.stateCurrent') : t('stage.stateTodo')
            return h('button', {
              key: stage,
              type: 'button',
              style: S.stageNode(state),
              title: `${t(`stage.short.${stage}`)} · ${stateLabel}`,
              'aria-label': `${t(`stage.short.${stage}`)} · ${stateLabel}`,
              'aria-expanded': expanded === stage,
              onClick: () => setExpanded(expanded === stage ? null : stage),
            },
              h('span', { style: S.stageIcon }, icon),
              h('span', null, t(`stage.short.${stage}`)),
            )
          }),
        ),
        expanded !== null
          ? h('div', { style: S.gateBox },
              h('div', { style: { ...S.row, color: 'var(--dt-text-secondary)', fontSize: 10 } },
                h('span', null, t('stage.gate')),
                h('span', null, stageData.length === 0 ? t('stage.gateOk') : `${t('stage.gateMissing')} ${stageData.length}`),
              ),
              stageData.length === 0
                ? null
                : stageData.slice(0, 5).map((item, index) => h('div', { key: index, style: { ...S.muted, fontSize: 10 } }, `· ${item}`)),
            )
          : null,
      )
    }

    function VersionDialog({ t, initial, onClose, onSubmit, onDelete, onForceComplete, onArchive, busy }) {
      const [form, setForm] = React.useState({
        name: initial?.name ?? '',
        description: initial?.description ?? '',
        planDate: initial?.planDate ?? '',
        owner: initial?.owner ?? '',
        notes: initial?.notes ?? '',
      })
      const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }))
      const readOnly = initial !== undefined && initial.status !== 'draft'
      const confirmDelete = () => {
        const ask = typeof window !== 'undefined' && typeof window.confirm === 'function'
        if (ask && !window.confirm(t('version.confirmDelete'))) return
        onDelete?.()
      }
      const actions = []
      if (initial?.status === 'draft' && onDelete) {
        actions.push(h('button', { key: 'delete', style: { ...S.btn, color: 'var(--dt-text-primary)', borderColor: 'var(--dt-danger)' }, disabled: !!busy, onClick: confirmDelete }, t('version.delete')))
      }
      if (initial?.status === 'active' && onForceComplete) {
        actions.push(h('button', { key: 'force', style: S.btn, disabled: !!busy, onClick: onForceComplete }, t('version.forceComplete')))
      }
      if (initial?.status === 'completed' && onArchive) {
        actions.push(h('button', { key: 'archive', style: S.btn, disabled: !!busy, onClick: onArchive }, t('version.archive')))
      }
      return h(Modal, {
        title: initial ? t('version.settings') : t('version.new'),
        onClose,
        footer: [
          ...actions,
          h('div', { key: 'spacer', style: { flex: 1 } }),
          h('button', { key: 'c', style: S.btn, onClick: onClose }, readOnly ? t('common.close') : t('common.cancel')),
          readOnly ? null : h('button', {
            key: 's',
            style: S.btnPrimary,
            disabled: !!busy || form.name.trim() === '',
            onClick: () => onSubmit({
              id: initial?.id,
              name: form.name.trim(),
              description: form.description,
              planDate: form.planDate,
              owner: form.owner,
              notes: form.notes,
            }),
          }, t('common.save')),
        ],
      },
        initial ? h('div', { style: { ...S.row, marginBottom: 8 } },
          h('span', { style: S.tag(initial.status === 'completed' ? 'ok' : initial.status === 'active' ? 'warn' : undefined) }, `${initial.status}/${initial.stage}`),
        ) : null,
        field(t('version.name'), h('input', { style: S.input, value: form.name, disabled: readOnly, onChange: (e) => set('name', e.target.value) })),
        field(t('version.desc'), h('textarea', { style: S.textarea, rows: 2, value: form.description, disabled: readOnly, onChange: (e) => set('description', e.target.value) })),
        field(t('version.planDate'), h('input', { style: S.input, type: 'date', value: form.planDate, disabled: readOnly, onChange: (e) => set('planDate', e.target.value) })),
        field(t('version.owner'), h('input', { style: S.input, value: form.owner, disabled: readOnly, onChange: (e) => set('owner', e.target.value) })),
        field(t('version.notes'), h('textarea', { style: S.textarea, rows: 2, value: form.notes, disabled: readOnly, onChange: (e) => set('notes', e.target.value) })),
        readOnly ? h('div', { style: S.muted }, t('version.readOnly')) : null,
      )
    }

    function RequirementDialog({ t, initial, roles, members, readOnly, onClose, onSubmit, busy, extra }) {
      const isEdit = initial !== undefined
      const memberRows = (members ?? []).filter(
        (member) => member.removed !== true && member.blocked !== true && member.roleId !== 'lead',
      )
      const [form, setForm] = React.useState({
        title: initial?.title ?? '',
        description: initial?.description ?? '',
        assignees: initial?.assignees ?? [],
        specs: JSON.stringify(initial?.taskSpecs ?? [], null, 2),
        files: [],
      })
      const [error, setError] = React.useState(null)
      const set = (key, value) => setForm((previous) => ({ ...previous, [key]: value }))
      const toggleAssignee = (name) => setForm((previous) => ({
        ...previous,
        assignees: previous.assignees.includes(name)
          ? previous.assignees.filter((candidate) => candidate !== name)
          : [...previous.assignees, name],
      }))
      const readFiles = async (fileList) => {
        const files = Array.from(fileList ?? [])
        const allowed = ['.txt', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg']
        const next = []
        for (const file of files) {
          const lower = String(file.name ?? '').toLowerCase()
          if (!allowed.some((extension) => lower.endsWith(extension))) {
            setError(t('requirement.attachmentHint'))
            continue
          }
          if (file.size > 10 * 1024 * 1024) {
            setError(t('requirement.attachmentHint'))
            continue
          }
          const dataBase64 = await new Promise((resolve, reject) => {
            if (typeof FileReader === 'undefined') { reject(new Error('FileReader unavailable')); return }
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result ?? '').split(',')[1] ?? '')
            reader.onerror = () => reject(reader.error ?? new Error('read failed'))
            reader.readAsDataURL(file)
          }).catch(() => '')
          if (dataBase64 !== '') next.push({ name: file.name, mime: file.type || 'application/octet-stream', dataBase64 })
        }
        if (next.length > 0) setForm((previous) => ({ ...previous, files: [...previous.files, ...next] }))
      }
      const submit = (meet = false) => {
        if (readOnly) return
        let specs
        if (isEdit) {
          try {
            specs = JSON.parse(form.specs)
            if (!Array.isArray(specs)) throw new Error('array required')
          } catch (failure) {
            setError(t('requirement.specInvalid').replace('{message}', String(failure?.message ?? failure)))
            return
          }
        }
        setError(null)
        onSubmit({
          requirementId: initial?.id,
          title: form.title.trim(),
          description: form.description,
          assignees: form.assignees,
          specs,
          files: form.files,
          meet,
        })
      }
      const openAttachment = (attachment) => extra?.openAttachment?.(initial, attachment)
      return h(Modal, {
        title: initial ? t('requirement.edit') : t('requirement.new'),
        onClose,
        footer: readOnly
          ? [h('button', { key: 'c', style: S.btn, onClick: onClose }, t('common.close'))]
          : [
              h('button', { key: 'c', style: S.btn, onClick: onClose }, t('common.cancel')),
              h('button', {
                key: 's',
                style: S.btnPrimary,
                disabled: !!busy || form.title.trim() === '' || (!isEdit && form.description.trim() === ''),
                onClick: () => submit(false),
              }, t('common.save')),
              !isEdit ? h('button', {
                key: 'm',
                style: S.btn,
                disabled: !!busy || form.title.trim() === '' || form.description.trim() === '',
                onClick: () => submit(true),
              }, t('requirement.createAndMeet')) : null,
            ],
      },
        field(t('requirement.name'), h('input', { style: S.input, value: form.title, disabled: readOnly, onChange: (e) => set('title', e.target.value) })),
        field(t('requirement.desc'), h('textarea', { style: S.textarea, rows: 4, value: form.description, disabled: readOnly, onChange: (e) => set('description', e.target.value) })),
        field(t('requirement.assignees'), h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
          h('span', { style: S.tag() }, t('requirement.leadFixed')),
          memberRows.length === 0
            ? h('span', { style: S.muted }, t('empty.noData'))
            : memberRows.map((member) => h('label', { key: member.name, style: { ...S.row, gap: 8, minHeight: 28, cursor: 'pointer' } },
                h('input', {
                  type: 'checkbox',
                  checked: form.assignees.includes(member.name),
                  disabled: readOnly,
                  onChange: () => toggleAssignee(member.name),
                }),
                h('span', null, member.displayName ?? member.name),
                h('span', { style: S.tagMono() }, roleNameOf(roles, member.roleId)),
              )),
        )),
        h('div', { style: { ...S.muted, fontSize: 11, marginTop: -4, marginBottom: 8 } }, t('requirement.assigneesHint')),
        isEdit
          ? field(t('requirement.specs'), h('textarea', { style: S.textarea, rows: 8, value: form.specs, disabled: readOnly, onChange: (e) => { set('specs', e.target.value); setError(null) } }))
          : h('div', { style: { ...S.muted, fontSize: 11, marginBottom: 8 } }, t('requirement.taskAuto')),
        isEdit ? h('div', { style: S.row },
          extra?.autoSpecs ? h('button', { style: S.btn, disabled: !!busy || readOnly, onClick: () => extra.autoSpecs().then((body) => {
            if (body?.ok && Array.isArray(body.value?.specs)) set('specs', JSON.stringify(body.value.specs, null, 2))
            else if (body?.error) setError(String(body.error.message ?? body.error.code))
          }) }, t('requirement.autoSpecs')) : null,
          extra?.leadSpecs ? h('button', { style: S.btn, disabled: !!busy || readOnly, onClick: () => extra.leadSpecs().then((body) => {
            if (body?.ok && Array.isArray(body.value?.specs)) set('specs', JSON.stringify(body.value.specs, null, 2))
            else if (body?.error) setError(String(body.error.message ?? body.error.code))
          }) }, t('requirement.leadSpecs')) : null,
        ) : null,
        field(t('requirement.attachments'), h('div', null,
          (initial?.attachments ?? []).length === 0
            ? h('div', { style: S.muted }, t('requirement.noAttachments'))
            : (initial?.attachments ?? []).map((attachment) => h('div', { key: attachment.id, style: { ...S.row, minHeight: 32, borderTop: '1px solid var(--dt-border-subtle)' } },
                h('span', { style: { ...S.trunc } }, attachment.name),
                h('span', { style: { ...S.mono, flex: 'none' } }, `${Math.max(1, Math.round(attachment.size / 1024))} KB`),
                h('button', { style: S.btnGhost, onClick: () => openAttachment(attachment) }, t('common.view')),
                readOnly ? null : h('button', { style: S.btnGhost, onClick: () => extra?.removeAttachment?.(attachment.id) }, t('requirement.detach')),
              )),
          readOnly ? null : h('label', { style: { ...S.btn, display: 'inline-block', marginTop: 4, cursor: 'pointer' } },
            t('requirement.upload'),
            h('input', {
              type: 'file',
              multiple: true,
              accept: '.txt,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg',
              style: { display: 'none' },
              onChange: (e) => { void readFiles(e.target.files); e.target.value = '' },
            }),
          ),
          h('div', { style: { ...S.muted, fontSize: 11, marginTop: 4 } }, t('requirement.attachmentHint')),
          form.files.length > 0 ? h('div', { style: { ...S.muted, fontSize: 11, marginTop: 4 } }, form.files.map((file) => file.name).join(', ')) : null,
        )),
        error ? h('div', { style: S.error }, error) : null,
      )
    }

    const markdownInline = (text) => String(text ?? '')
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')

    function MarkdownView({ text }) {
      const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n')
      const blocks = []
      let codeLines = null
      let paragraph = []
      const flushParagraph = () => {
        if (paragraph.length === 0) return
        blocks.push(h('p', { key: "p" + blocks.length, style: { margin: '0 0 8px', lineHeight: 1.7 } }, markdownInline(paragraph.join(' '))))
        paragraph = []
      }
      for (const line of lines) {
        if (/^```/.test(line.trim())) {
          if (codeLines === null) {
            flushParagraph()
            codeLines = []
          } else {
            blocks.push(h('pre', { key: "c" + blocks.length, style: S.pre }, codeLines.join('\n')))
            codeLines = null
          }
          continue
        }
        if (codeLines !== null) { codeLines.push(line); continue }
        const heading = /^(#{1,4})\s+(.*)$/.exec(line)
        if (heading) {
          flushParagraph()
          const level = heading[1].length
          blocks.push(h('div', { key: "h" + blocks.length, style: { fontSize: [20, 17, 15, 14][level - 1], fontWeight: 700, lineHeight: 1.3, margin: level <= 2 ? '12px 0 8px' : '8px 0 4px' } }, markdownInline(heading[2])))
          continue
        }
        const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
        if (bullet) {
          flushParagraph()
          blocks.push(h('div', { key: "l" + blocks.length, style: { paddingLeft: 12, lineHeight: 1.7 } }, "• " + markdownInline(bullet[1])))
          continue
        }
        const ordered = /^\s*(\d+)\.\s+(.*)$/.exec(line)
        if (ordered) {
          flushParagraph()
          blocks.push(h('div', { key: "n" + blocks.length, style: { paddingLeft: 12, lineHeight: 1.7 } }, ordered[1] + ". " + markdownInline(ordered[2])))
          continue
        }
        if (line.trim() === '') { flushParagraph(); continue }
        paragraph.push(line.trim())
      }
      flushParagraph()
      if (codeLines !== null) blocks.push(h('pre', { key: "c" + blocks.length, style: S.pre }, codeLines.join('\n')))
      return h('div', { style: { fontSize: 13, color: 'var(--dt-text-primary)' } }, blocks)
    }

    function DocumentModal({ t, title, text, onClose }) {
      return h(Modal, {
        title,
        onClose,
        footer: [h('button', { key: 'c', style: S.btn, onClick: onClose }, t('common.close'))],
      }, h('div', { style: { maxHeight: '68vh', overflow: 'auto', paddingRight: 4 } }, h(MarkdownView, { text })))
    }

    function ArtifactDialog({ t, initial, versionId, onClose, onSubmit, busy, readOnly: readOnlyVersion }) {
      const [form, setForm] = React.useState({
        type: initial?.type ?? 'custom',
        title: initial?.title ?? '',
        content: initial?.content ?? '',
      })
      const readOnly = readOnlyVersion === true || (initial !== undefined && initial.status !== 'draft')
      return h(Modal, {
        title: initial ? t('common.edit') : t('artifact.new'),
        onClose,
        footer: [
          h('button', { key: 'c', style: S.btn, onClick: onClose }, readOnly ? t('common.close') : t('common.cancel')),
          readOnly ? null : h('button', {
            key: 's',
            style: S.btnPrimary,
            disabled: !!busy || form.title.trim() === '',
            onClick: () => onSubmit({ id: initial?.id, versionId, type: form.type, title: form.title.trim(), content: form.content }),
          }, t('common.save')),
        ],
      },
        field(t('artifact.type'), h('select', { style: S.select, value: form.type, disabled: readOnly, onChange: (e) => setForm({ ...form, type: e.target.value }) },
          ['requirement_doc', 'architecture_doc', 'review_report', 'test_report', 'test_plan', 'meeting_minutes', 'custom'].map((type) => h('option', { key: type, value: type }, type)),
        )),
        field(t('requirement.name'), h('input', { style: S.input, value: form.title, disabled: readOnly, onChange: (e) => setForm({ ...form, title: e.target.value }) })),
        field(t('artifact.content'), h('textarea', { style: S.textarea, rows: 10, value: form.content, disabled: readOnly, onChange: (e) => setForm({ ...form, content: e.target.value }) })),
      )
    }

    function MemberDialog({ t, initial, roles, catalog, onClose, onSubmit, busy }) {
      const assignableRoles = roles.filter((role) => role.id !== 'lead')
      const [form, setForm] = React.useState({
        name: initial?.name ?? '',
        displayName: initial?.displayName ?? '',
        roleId: initial?.roleId ?? assignableRoles[0]?.id ?? '',
        provider: initial?.route?.provider ?? '',
        model: initial?.route?.model ?? '',
        effort: initial?.route?.reasoningEffort ?? '',
      })
      const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }))
      // Host catalog.get returns { default, routableProviders, groups, failures };
      // groups[].id is the provider and groups[].models[] carries the model ids.
      const groups = Array.isArray(catalog?.groups) ? catalog.groups : []
      const providers = groups.length > 0
        ? groups.map((group) => ({
            provider: group.id,
            name: group.name ?? group.id,
            models: Array.isArray(group.models) ? group.models : [],
          }))
        : Array.isArray(catalog?.providers)
          ? catalog.providers
          : (Array.isArray(catalog?.routableProviders) ? catalog.routableProviders : []).map((provider) => ({
              provider: provider.id ?? provider.provider,
              name: provider.name ?? provider.id ?? provider.provider,
              models: [],
            }))
      const models = providers.find((p) => p.provider === form.provider)?.models ?? []
      const selectedModel = models.find((model) => (model.id ?? model.model) === form.model)
      const efforts = selectedModel?.reasoningEfforts ?? selectedModel?.efforts ?? []
      return h(Modal, {
        title: initial ? t('member.title') : t('member.new'),
        onClose,
        footer: [
          h('button', { key: 'c', style: S.btn, onClick: onClose }, t('common.cancel')),
          h('button', {
            key: 's',
            style: S.btnPrimary,
            disabled: !!busy || form.name.trim() === '' || form.roleId === '',
            onClick: () => onSubmit({
              name: form.name.trim(),
              displayName: form.displayName.trim() || form.name.trim(),
              roleId: form.roleId,
              route: form.provider && form.model ? { provider: form.provider, model: form.model, ...(form.effort ? { reasoningEffort: form.effort } : {}) } : null,
            }),
          }, t('common.save')),
        ],
      },
        field(t('member.name'), h('input', { style: S.input, value: form.name, disabled: initial !== undefined, onChange: (e) => set('name', e.target.value) })),
        field(t('member.display'), h('input', { style: S.input, value: form.displayName, onChange: (e) => set('displayName', e.target.value) })),
        field(t('member.role'), h('select', { style: S.select, value: form.roleId, onChange: (e) => set('roleId', e.target.value) },
          (assignableRoles.length > 0 ? assignableRoles : roles).map((role) => h('option', { key: role.id, value: role.id }, role.name)),
        )),
        field(t('member.route'), h('div', null,
          h('div', { style: { ...S.row, marginBottom: 4, flexWrap: 'nowrap' } },
            h('select', { style: { ...S.selectSm, flex: 1, maxWidth: 'none' }, value: form.provider, onChange: (e) => setForm({ ...form, provider: e.target.value, model: '', effort: '' }) },
              h('option', { value: '' }, t('member.routeInherit')),
              providers.map((p) => h('option', { key: p.provider, value: p.provider }, p.provider)),
            ),
            h('select', { style: { ...S.selectSm, flex: 1, maxWidth: 'none' }, value: form.model, onChange: (e) => setForm({ ...form, model: e.target.value, effort: '' }), disabled: !form.provider },
              h('option', { value: '' }, '—'),
              models.map((m) => h('option', { key: m.id ?? m.model, value: m.id ?? m.model }, m.name ?? m.id ?? m.model)),
            ),
            h('select', { style: { ...S.selectSm, flex: 1, maxWidth: 'none' }, value: form.effort, onChange: (e) => set('effort', e.target.value), disabled: !form.model || efforts.length === 0 },
              h('option', { value: '' }, '—'),
              efforts.map((effort) => {
                const id = typeof effort === 'string' ? effort : (effort.id ?? effort.name ?? '')
                const label = typeof effort === 'string' ? effort : (effort.name ?? effort.id ?? '')
                return h('option', { key: id, value: id }, label)
              }),
            ),
          ),
        )),
      )
    }

    function RoleDialog({ t, initial, onClose, onSubmit, busy }) {
      const [form, setForm] = React.useState({ name: initial?.name ?? '', description: initial?.description ?? '', basePrompt: initial?.basePrompt ?? '' })
      const idPreview = slugId(form.name)
      const validNewId = initial !== undefined || /^[a-z][a-z0-9-]{1,31}$/.test(idPreview)
      return h(Modal, {
        title: initial ? t('role.title') : t('role.new'),
        onClose,
        footer: [
          h('button', { key: 'c', style: S.btn, onClick: onClose }, t('common.cancel')),
          h('button', { key: 's', style: S.btnPrimary, disabled: !!busy || form.basePrompt.trim() === '' || !validNewId, onClick: () => onSubmit({ id: initial?.id, ...form }) }, t('common.save')),
        ],
      },
        field(t('member.name'), h('input', { style: S.input, value: form.name, disabled: initial !== undefined, placeholder: 'role-id', onChange: (e) => setForm({ ...form, name: e.target.value }) })),
        field(t('version.desc'), h('input', { style: S.input, value: form.description, onChange: (e) => setForm({ ...form, description: e.target.value }) })),
        field(t('role.prompt'), h('textarea', { style: S.textarea, rows: 10, value: form.basePrompt, onChange: (e) => setForm({ ...form, basePrompt: e.target.value }) })),
        !validNewId ? h('div', { style: S.muted }, t('role.idHint')) : null,
      )
    }

    function MeetingDialog({ t, versions, members, roles, onClose, onSubmit, busy }) {
      const editableVersions = versions.filter((version) => version.status !== 'completed' && version.status !== 'archived')
      const availableMembers = members.filter((member) => member.removed !== true && member.blocked !== true)
      const [form, setForm] = React.useState({ versionId: editableVersions.find((v) => v.status === 'draft')?.id ?? editableVersions[0]?.id ?? '', type: 'requirement_clarification', title: '', goal: '', participants: [], host: '' })
      const set = (k, v) => setForm((prev) => ({ ...prev, [k]: v }))
      const toggleParticipant = (name) => setForm((previous) => ({
        ...previous,
        participants: previous.participants.includes(name)
          ? previous.participants.filter((candidate) => candidate !== name)
          : [...previous.participants, name],
        host: previous.host === name && previous.participants.includes(name) ? '' : previous.host,
      }))
      return h(Modal, {
        title: t('meeting.new'),
        onClose,
        footer: [
          h('button', { key: 'c', style: S.btn, onClick: onClose }, t('common.cancel')),
          h('button', {
            key: 's',
            style: S.btnPrimary,
            disabled: !!busy || !form.versionId || form.title.trim() === '' || form.participants.length === 0,
            onClick: () => onSubmit({
              versionId: form.versionId,
              type: form.type,
              title: form.title.trim(),
              goal: form.goal,
              participants: form.participants,
              hostMemberName: form.host.trim() || undefined,
            }),
          }, t('common.create')),
        ],
      },
        field(t('version.select'), h('select', { style: S.select, value: form.versionId, onChange: (e) => set('versionId', e.target.value) },
          editableVersions.map((v) => h('option', { key: v.id, value: v.id }, `${v.name} (${v.status}/${v.stage})`)),
        )),
        field(t('meeting.type'), h('select', { style: S.select, value: form.type, onChange: (e) => set('type', e.target.value) },
          ['requirement_clarification', 'architecture_review', 'test_review', 'custom'].map((type) => h('option', { key: type, value: type }, meetingTypeLabel(t, type))),
        )),
        field(t('requirement.name'), h('input', { style: S.input, value: form.title, onChange: (e) => set('title', e.target.value) })),
        field(t('meeting.goal'), h('textarea', { style: S.textarea, rows: 2, value: form.goal, onChange: (e) => set('goal', e.target.value) })),
        field(t('meeting.participants'), h('div', { style: { display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 190, overflowY: 'auto' } },
          availableMembers.length === 0
            ? h('div', { style: S.muted }, t('empty.noData'))
            : availableMembers.map((member) => h('label', { key: member.name, style: { ...S.row, gap: 8, minHeight: 30, cursor: 'pointer' } },
                h('input', {
                  type: 'checkbox',
                  checked: form.participants.includes(member.name),
                  onChange: () => toggleParticipant(member.name),
                }),
                h('span', { style: { flex: 1 } }, member.displayName ?? member.name),
                h('span', { style: S.tagMono() }, roleNameOf(roles, member.roleId)),
              )),
        )),
        field(t('meeting.host'), h('select', {
          style: S.select,
          value: form.host,
          onChange: (e) => set('host', e.target.value),
        },
          h('option', { value: '' }, t('common.none')),
          form.participants.map((name) => h('option', { key: name, value: name }, memberLabel({ members }, name))),
        )),
      )
    }

    /* ------------------------------------------------------------------ board */

    function PendingList({ t, version, requirements, artifacts, onConfirm, onEditRequirement, readOnly }) {
      const items = []
      for (const artifact of artifacts) {
        if (artifact.status === 'draft' && (artifact.type === 'review_report' || artifact.type === 'test_report')) {
          items.push({ key: artifact.id, text: t('pending.reportDraft').replace('{name}', artifact.title), action: () => onConfirm(artifact), actionLabel: t('artifact.approve') })
        }
      }
      const bound = requirements.filter((requirement) => requirement.versionId === version?.id)
      for (const requirement of bound) {
        if ((requirement.taskSpecs ?? []).length === 0 && version?.status === 'draft' && version?.stage === 'architecture') {
          items.push({ key: `spec-${requirement.id}`, text: t('pending.noSpecs').replace('{name}', requirement.title), action: () => onEditRequirement(requirement), actionLabel: t('common.edit') })
        }
      }
      if (items.length === 0) return null
      return h('div', { style: S.section },
        h('div', { style: S.sectionHead },
          h('span', { style: S.sectionTitle }, t('pending.title')),
          h('span', { style: S.count }, `[${items.length}]`),
        ),
        items.slice(0, 5).map((item) => h('div', { key: item.key, style: S.pendingRow },
          h('span', { style: { ...S.trunc } }, item.text),
          readOnly ? null : h('button', { style: S.btnGhost, onClick: item.action }, item.actionLabel),
        )),
      )
    }

    function BoardView({ data, version, onNewVersion, onVersionSettings, onOpenRequirements, stageAction }) {
      const { state, busy, run, t } = data
      const [dialog, setDialog] = React.useState(null)
      const [taskPage, setTaskPage] = React.useState(0)
      const [artifactPage, setArtifactPage] = React.useState(0)
      const [memberPage, setMemberPage] = React.useState(0)
      const [docModal, setDocModal] = React.useState(null)
      const [manualModal, setManualModal] = React.useState(null)
      const [taskModal, setTaskModal] = React.useState(null)
      const [timelinePage, setTimelinePage] = React.useState(0)
      const viewport = useViewportWidth()
      const viewportHeight = useViewportHeight()
      const taskPageSize = Math.max(5, Math.min(20, Math.floor((viewportHeight - 300) / 36)))
      const artifactPageSize = Math.max(3, Math.min(12, Math.floor((viewportHeight - 420) / 36)))
      const narrow = viewport < 1280
      const requirements = state?.requirements ?? []
      const artifacts = state?.artifacts ?? []
      const bindings = state?.bindings ?? []
      const members = state?.members ?? []
      const tasks = data.snapshot?.official?.tasks ?? []
      const settings = state?.settings ?? {}
      const bound = requirements.filter((requirement) => requirement.versionId === version?.id)
      const versionArtifacts = artifacts
        .filter((artifact) => artifact.versionId === version?.id || bound.some((requirement) => requirement.id === artifact.requirementId))
        .sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))
      const inProgress = bindings.filter(
        (binding) => binding.versionId === version?.id && binding.lastKnownStatus === 'in_progress' && !binding.abandonedAt,
      )
      const stage = version?.stage ?? 'requirement'
      const gapHint = gateMissing({ version, requirements, artifacts, members, settings, t })
      const separator = data.language === 'zh' ? '：' : ': '
      const readOnly = version?.status === 'completed' || version?.status === 'archived'
      const close = () => setDialog(null)
      const fallbackTasks = bindings
        .filter((binding) => binding.versionId === version?.id && binding.abandonedAt === undefined)
        .map((binding) => ({
          id: binding.taskId,
          subject: binding.subject ?? binding.taskKey ?? binding.taskId,
          ownerName: binding.memberName,
          status: binding.lastKnownStatus,
          ready: true,
          createdAt: binding.createdAt,
        }))
      const taskRank = (status) => status === 'in_progress' ? 0 : status === 'pending' ? 1 : status === 'blocked' ? 2 : status === 'completed' ? 3 : 4
      const bindingCreatedAt = new Map(bindings.map((binding) => [binding.taskId, binding.createdAt]))
      const taskTime = (task) => task.createdAt ?? bindingCreatedAt.get(task.id) ?? task.updatedAt ?? ''
      const taskSeq = (task) => {
        const match = String(task.id).match(/(\d+)$/)
        return match === null ? 0 : Number(match[1])
      }
      const sortedTasks = (tasks.length > 0 ? [...tasks] : fallbackTasks).sort((left, right) =>
        taskRank(left.status) - taskRank(right.status) ||
        String(taskTime(right)).localeCompare(String(taskTime(left))) ||
        taskSeq(right) - taskSeq(left) ||
        String(right.id).localeCompare(String(left.id)))
      const captureMember = (roleId) => members.find((member) => member.roleId === roleId && !member.blocked && !member.removed && member.creation?.status === 'active')
      const activeMembers = members
        .filter((member) => !member.removed)
        .sort((left, right) => String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))
      const pageOf = (items, page, size) => items.slice(page * size, (page + 1) * size)
      const pager = (page, setPage, total, size) => total <= size ? null : h('div', { style: { ...S.row, marginTop: 4 } },
        h('button', { style: S.btnGhost, disabled: page <= 0, onClick: () => setPage(Math.max(0, page - 1)) }, t('common.prev')),
        h('span', { style: { ...S.muted, flex: 'none' } }, `${page + 1}/${Math.ceil(total / size)}`),
        h('button', { style: S.btnGhost, disabled: page + 1 >= Math.ceil(total / size), onClick: () => setPage(page + 1) }, t('common.next')),
      )
      const bodyStyle = narrow
        ? { ...S.body, flexDirection: 'column', overflow: 'auto' }
        : S.body
      const sideStyle = narrow
        ? { ...S.sideCol, borderLeft: 'none', borderTop: '1px solid var(--dt-border-subtle)', paddingLeft: 0, paddingTop: 8, flex: '0 0 auto', overflow: 'visible' }
        : S.sideCol
      const persistedActivity = state?.activity ?? []
      const devBindings = bindings.filter((binding) => binding.versionId === version?.id && binding.abandonedAt === undefined)
      const allDevelopmentDone = sortedTasks.length > 0 && sortedTasks.every((task) => task.status === 'completed' || task.status === 'deleted')
      const manualItems = []
      if (version?.stage === 'development' && allDevelopmentDone) {
        const taskLines = sortedTasks.map((task) => `- ${task.subject} · ${task.ownerName ?? '—'} · ${task.status}`).join('\n')
        const artifactLines = versionArtifacts.map((artifact) => `- ${artifact.title} · ${artifact.status}`).join('\n')
        const rejectLine = version.lastRejectReason ? `\n\n${t('confirm.lastReject').replace('{reason}', version.lastRejectReason)}` : ''
        manualItems.push({
          key: 'dev-done',
          title: t('confirm.devDoneTitle'),
          text: `${t('confirm.devDoneText')}\n\n## ${t('confirm.tasks')}\n${taskLines || '—'}\n\n## ${t('confirm.artifacts')}\n${artifactLines || '—'}${rejectLine}`,
          actionLabel: t('confirm.enterReview'),
          execute: () => run('version.confirmDevelopment', { versionId: version.id }),
          canReject: true,
        })
      }
      for (const artifact of versionArtifacts.filter((item) => item.status === 'draft' && (item.type === 'review_report' || item.type === 'test_report'))) {
        manualItems.push({
          key: artifact.id,
          title: t('confirm.reportTitle').replace('{name}', artifact.title),
          text: artifact.content ?? '',
          actionLabel: t('artifact.approve'),
          execute: () => run('artifact.approve', { id: artifact.id }),
        })
      }
      const displaySummary = (summary) => {
        let text = String(summary ?? '')
        for (const member of [...(state?.members ?? [])].sort((a, b) => b.name.length - a.name.length)) {
          if (member.name && member.displayName && text.includes(member.name)) text = text.split(member.name).join(member.displayName)
        }
        return text
      }
      const activity = persistedActivity.length > 0
        ? persistedActivity
        : bindings
            .filter((binding) => binding.versionId === version?.id)
            .map((binding) => ({
              id: binding.taskId,
              at: binding.updatedAt ?? binding.createdAt,
              summary: binding.subject ?? binding.taskKey ?? binding.taskId,
            }))
      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' } },
        h('div', { style: bodyStyle },
          version === null || version === undefined
            ? h('div', { style: { flex: '1 1 100%', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: 320, textAlign: 'center', gap: 8, padding: 24 } },
                h('div', { style: { fontSize: 20, fontWeight: 600, lineHeight: 1.25 } }, t('empty.noVersion')),
                h('div', { style: { ...S.muted, maxWidth: 420 } }, t('empty.noVersionHint')),
                h('button', { style: { ...S.btnPrimary, marginTop: 8 }, onClick: onNewVersion }, `+ ${t('version.new')}`),
              )
            : h('div', { style: { ...S.mainCol } },
                h('div', { style: { ...S.section, flex: 'none' } },
                  h('div', { style: S.versionHead },
                    h('strong', { style: S.versionName, title: version.name }, version.name),
                    h('span', { style: S.tag(version.status === 'active' ? 'ok' : version.status === 'interrupted' ? 'warn' : undefined) }, version.status),
                    readOnly ? h('span', { style: S.tag() }, t('requirement.readOnly')) : null,
                    version.planDate ? h('span', { style: { ...S.muted, flex: 'none' } }, `${t('version.planDate')} ${version.planDate}`) : null,
                    version.owner ? h('span', { style: { ...S.muted, flex: 'none' } }, `${t('version.owner')} ${version.owner}`) : null,
                    version.notes ? h('span', { style: { ...S.trunc, color: 'var(--dt-text-secondary)', fontSize: 10 }, title: version.notes }, version.notes) : null,
                    h('div', { style: S.spacer }),
                    stageAction !== null && stageAction !== undefined
                      ? h('button', {
                          style: stageAction.disabled ? S.btn : S.btnStage,
                          className: 'dt-stage',
                          disabled: stageAction.disabled,
                          title: stageAction.title || undefined,
                          onClick: stageAction.onClick,
                        }, stageAction.label)
                      : null,
                    h('button', { style: S.btnGhost, onClick: onNewVersion }, `+ ${t('version.new')}`),
                    h('button', { style: S.btnGhost, onClick: onVersionSettings }, t('version.settings')),
                    h('span', { style: S.mono }, `${bound.length} req · ${versionArtifacts.length} art · ${inProgress.length} active`),
                  ),
                  h(StagePipeline, { t, version, requirements, artifacts, members, settings, onOpenRequirement: () => onOpenRequirements() }),
                  settings.highEfficiencyMode === true ? h('div', { style: { ...S.rowLine, borderLeft: '2px solid var(--dt-accent)', paddingLeft: 4, minHeight: 28 } },
                    h('span', { style: { ...S.muted, fontSize: 11 } }, inDiscountWindowClient() ? t('highEfficiency.active') : t('highEfficiency.waiting')),
                  ) : null,
                  gapHint.length > 0 ? h('div', {
                    style: { ...S.rowLine, borderLeft: '2px solid var(--dt-accent)', paddingLeft: 4, minHeight: 28, maxHeight: 32, flexWrap: 'nowrap' },
                  },
                    h('span', { style: { ...S.muted, flex: 'none', fontSize: 10 } }, `${t('stage.gateMissing')}:`),
                    h('span', { style: { ...S.trunc, fontSize: 10 }, title: gapHint.join('；') }, gapHint.join(' · ')),
                  ) : null,
                ),
                h('div', { style: { ...S.section, flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' } },
                  h('div', { style: S.sectionHead },
                    h('span', { style: S.sectionTitle }, t('board.tasks')),
                    h('span', { style: S.count }, `[${sortedTasks.length}]`),
                  ),
                  sortedTasks.length === 0 ? h('div', { style: S.muted }, t('empty.noData')) : h('div', { style: { flex: 1, minHeight: 0, overflow: 'auto' } },
                    h('div', { style: S.tableHead },
                      h('span', { style: { flex: '2 1 40%' } }, t('requirement.name')),
                      h('span', { style: { flex: '0 0 15%' } }, t('task.role')),
                      h('span', { style: { flex: '0 0 15%' } }, t('task.member')),
                      h('span', { style: { flex: '0 0 15%' } }, t('task.status')),
                      h('span', { style: { flex: '0 0 12%' } }, t('task.dependency')),
                    ),
                    pageOf(sortedTasks, taskPage, taskPageSize).map((task) => {
                      const binding = bindings.find((candidate) => candidate.taskId === task.id)
                      return h('div', { key: task.id, style: S.taskRow },
                        h('span', { style: { ...S.trunc, flex: '2 1 40%', cursor: 'pointer' }, title: task.subject, onClick: () => setTaskModal(task) }, task.subject),
                        h('span', { style: { ...S.trunc, flex: '0 0 15%' }, title: binding?.role ?? '' }, roleNameOf(state, binding?.role)),
                        h('span', { style: { ...S.trunc, flex: '0 0 15%' }, title: task.ownerName ?? binding?.memberName ?? '' }, memberLabel(state, task.ownerName ?? binding?.memberName ?? '') || '-'),
                        h('span', { style: { flex: '0 0 15%' } }, h('span', { style: S.tag(taskStatusTone(task.status)) }, taskStatusLabel(t, task.status))),
                        h('span', { style: { flex: '0 0 12%', color: 'var(--dt-text-secondary)', fontSize: 10 } }, task.ready ? t('task.ready') : t('task.blocked')),
                      )
                    }),
                  ),
                  pager(taskPage, setTaskPage, sortedTasks.length, taskPageSize),
                ),
                h('div', { style: { ...S.section, flex: 'none', height: 230, minHeight: 0, display: 'flex', flexDirection: 'column' } },
                  h('div', { style: S.sectionHead },
                    h('span', { style: S.sectionTitle }, t('board.timeline')),
                    h('span', { style: S.count }, `[${activity.length}]`),
                  ),
                  activity.length === 0
                    ? h('div', { style: S.muted }, t('timeline.empty'))
                    : h('div', { style: { flex: 1, minHeight: 0, overflow: 'auto' } },
                        [...activity].sort((left, right) => String(right.at ?? '').localeCompare(String(left.at ?? ''))).slice(timelinePage * 5, timelinePage * 5 + 5).map((entry) => h('div', { key: entry.id, style: { ...S.muted, fontSize: 10, lineHeight: '18px', borderTop: '1px solid var(--dt-border-subtle)' } },
                          `${fmtDate(entry.at)}${separator}${displaySummary(entry.summary)}`,
                        )),
                        activity.length > 5 ? h('div', { style: { ...S.row, marginTop: 2 } },
                          h('button', { style: S.btnGhost, disabled: timelinePage <= 0, onClick: () => setTimelinePage(Math.max(0, timelinePage - 1)) }, t('common.prev')),
                          h('span', { style: { ...S.muted, fontSize: 10 } }, `${timelinePage + 1}/${Math.ceil(activity.length / 5)}`),
                          h('button', { style: S.btnGhost, disabled: timelinePage + 1 >= Math.ceil(activity.length / 5), onClick: () => setTimelinePage(timelinePage + 1) }, t('common.next')),
                        ) : null,
                      ),
                ),
              ),
          version === null || version === undefined
            ? null
            : h('div', { style: sideStyle },
                h('div', { style: { ...S.section, flex: '0 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column' } },
                  h('div', { style: S.sectionHead }, h('span', { style: S.sectionTitle }, t('board.teamLoad')),
                    h('span', { style: S.count }, `[${activeMembers.length}]`)),
                  h('div', { style: { ...S.tableHead, gap: 8, padding: '0 8px' } },
                    h('span', { style: { flex: '1 1 30%' } }, t('task.member')),
                    h('span', { style: { flex: '0 0 24%' } }, t('task.role')),
                    h('span', { style: { flex: '0 0 14%', textAlign: 'right' } }, t('board.loadCount')),
                    h('span', { style: { flex: '0 0 22%' } }, t('task.status')),
                  ),
                  activeMembers.length === 0 ? h('div', { style: S.muted }, t('empty.noData')) : h('div', { style: { overflow: 'auto', minHeight: 0 } },
                    pageOf(activeMembers, memberPage, 8).map((member) => {
                      const load = inProgress.filter((binding) => binding.memberName === member.name).length
                      const blocked = member.blocked === true
                      const status = memberStatusLabel(t, member)
                      return h('div', { key: member.name, style: { ...S.loadRow, gap: 8, padding: '0 8px', opacity: blocked ? 0.6 : 1 } },
                        h('span', { style: { ...S.trunc, flex: '1 1 30%', fontWeight: 500 }, title: member.displayName ?? member.name }, member.displayName ?? member.name),
                        h('span', { style: { flex: '0 0 24%' } }, h('span', { style: S.tagMono() }, roleNameOf(state, member.roleId))),
                        h('span', { style: { flex: '0 0 14%', textAlign: 'right', ...S.mono } }, `${load}`),
                        h('span', { style: { flex: '0 0 22%' } }, h('span', { style: S.tag(blocked ? 'warn' : member.creation?.status === 'active' ? 'ok' : 'warn') }, status)),
                      )
                    }),
                  ),
                  pager(memberPage, setMemberPage, activeMembers.length, 8),
                ),
                h('div', { style: { ...S.section, flex: '1 1 0', minHeight: 0, display: 'flex', flexDirection: 'column' } },
                  h('div', { style: S.sectionHead },
                    h('span', { style: S.sectionTitle }, t('board.artifacts')),
                    h('span', { style: S.count }, `[${versionArtifacts.length}]`),
                    h('div', { style: S.spacer }),
                    h('button', { style: S.btnGhost, disabled: readOnly, onClick: () => setDialog({ kind: 'artifact' }) }, `+`),
                  ),
                  versionArtifacts.length === 0 ? h('div', { style: S.muted }, t('empty.noData')) : h('div', { style: { flex: 1, minHeight: 0, overflow: 'auto' } },
                    pageOf(versionArtifacts, artifactPage, artifactPageSize).map((artifact) =>
                      h('div', { key: artifact.id, style: S.artifactRow },
                        h('span', { style: S.tag() }, artifact.type.replace(/_/g, ' ').slice(0, 10)),
                        h('span', { style: { ...S.trunc, color: artifact.status === 'draft' ? 'var(--dt-text-secondary)' : 'var(--dt-text-primary)' }, title: artifact.title }, artifact.title),
                        h('span', { style: S.tag(artifact.status === 'approved' ? 'ok' : artifact.status === 'draft' ? 'warn' : undefined) }, artifact.status),
                        h('button', { style: S.btnGhost, onClick: () => setDocModal({ title: artifact.title, text: artifact.content ?? '' }) }, t('common.viewDetails')),
                        artifact.status === 'draft' && !readOnly ? h('button', { style: S.btnGhost, onClick: () => setDialog({ kind: 'artifact', artifact }) }, t('common.edit')) : null,
                        artifact.status === 'draft' && !readOnly ? h('button', { style: S.btnGhost, onClick: () => run('artifact.approve', { id: artifact.id }) }, t('artifact.approve')) : null,
                      ),
                    ),
                  ),
                  pager(artifactPage, setArtifactPage, versionArtifacts.length, artifactPageSize),
                  busy === 'artifact.capture' ? h('div', { style: { fontSize: 11, color: 'var(--dt-accent)', paddingTop: 4 }, 'aria-live': 'polite' }, t('artifact.captureProgress')) : null,
                  !readOnly && stage === 'review' && !versionArtifacts.some((artifact) => artifact.type === 'review_report' && artifact.status === 'approved')
                    ? h('button', { style: { ...S.btn, marginTop: 4, width: '100%' }, disabled: !!busy, onClick: () => {
                        const member = captureMember(settings.defaultRoleByStage?.review)
                        if (member) run('artifact.capture', { versionId: version.id, type: 'review_report', title: `${version.name} review report`, memberName: member.name })
                      } }, busy === 'artifact.capture' ? t('artifact.capturing') : t('artifact.captureReview'))
                    : null,
                  !readOnly && stage === 'testing' && !versionArtifacts.some((artifact) => artifact.type === 'test_report' && artifact.status === 'approved')
                    ? h('button', { style: { ...S.btn, marginTop: 4, width: '100%' }, disabled: !!busy, onClick: () => {
                        const member = captureMember(settings.defaultRoleByStage?.testing)
                        if (member) run('artifact.capture', { versionId: version.id, type: 'test_report', title: `${version.name} test report`, memberName: member.name })
                      } }, busy === 'artifact.capture' ? t('artifact.capturing') : t('artifact.captureTest'))
                    : null,
                ),
                h('div', { style: { ...S.section, flex: 'none' } },
                  h('div', { style: S.sectionHead },
                    h('span', { style: S.sectionTitle }, t('confirm.title')),
                    h('span', { style: S.count }, `[${manualItems.length}]`),
                  ),
                  manualItems.length === 0
                    ? h('div', { style: S.muted }, t('confirm.empty'))
                    : h('div', { style: { maxHeight: 150, overflow: 'auto' } },
                        manualItems.map((item) => h('div', { key: item.key, style: { ...S.rowLine, minHeight: 32, flexWrap: 'nowrap' } },
                          h('span', { style: { ...S.trunc, flex: 1, fontWeight: 500 }, title: item.title }, item.title),
                          h('button', { style: S.btnGhost, onClick: () => setManualModal(item) }, t('common.details')),
                        )),
                      ),
                ),
              ),
        ),
        dialog?.kind === 'artifact' ? h(ArtifactDialog, { t, initial: dialog.artifact, versionId: version?.id, busy, readOnly, onClose: close, onSubmit: (form) => run(form.id ? 'artifact.update' : 'artifact.create', form.id ? { id: form.id, title: form.title, content: form.content } : { versionId: form.versionId, type: form.type, title: form.title, content: form.content }).then((body) => { if (body?.ok) close(); return body }) }) : null,
        docModal ? h(DocumentModal, { t, title: docModal.title, text: docModal.text, onClose: () => setDocModal(null) }) : null,
        taskModal ? h(Modal, {
          title: t('task.detail'),
          onClose: () => setTaskModal(null),
          footer: [h('button', { key: 'c', style: S.btn, onClick: () => setTaskModal(null) }, t('common.close'))],
        },
          h('div', { style: { ...S.muted, fontSize: 13, lineHeight: 1.8 } },
            h('div', null, `${t('requirement.name')}：${taskModal.subject ?? '—'}`),
            h('div', null, `${t('task.status')}：${taskStatusLabel(t, taskModal.status)}`),
            h('div', null, `${t('task.member')}：${memberLabel(state, taskModal.ownerName ?? (bindings.find((b) => b.taskId === taskModal.id) ?? {}).memberName ?? '') || '—'}`),
            h('div', null, `${t('task.progress')}：${taskModal.status === 'completed' ? '100%' : taskModal.status === 'in_progress' ? '执行中' : '等待'}`),
            h('div', null, `${t('task.elapsed')}：${formatDuration((bindings.find((b) => b.taskId === taskModal.id) ?? {}).createdAt)}`),
            h('div', null, `${t('task.tokens')}：${t('task.tokensUnknown')}`),
          ),
        ) : null,
        manualModal ? h(Modal, {
          title: manualModal.title,
          onClose: () => setManualModal(null),
          footer: manualModal.rejecting
            ? [
                h('button', { key: 'c', style: S.btn, onClick: () => setManualModal(null) }, t('common.cancel')),
                h('button', {
                  key: 'r',
                  style: S.btnPrimary,
                  disabled: !!busy || String(manualModal.reason ?? '').trim() === '',
                  onClick: () => run('version.rejectDevelopment', { versionId: version.id, reason: manualModal.reason }).then((body) => {
                    if (body?.ok) setManualModal(null)
                    return body
                  }),
                }, t('confirm.submitReject')),
              ]
            : [
                h('button', { key: 'c', style: S.btn, onClick: () => setManualModal(null) }, t('common.cancel')),
                manualModal.canReject ? h('button', { key: 'r', style: S.btn, onClick: () => setManualModal({ ...manualModal, rejecting: true, reason: '' }) }, t('confirm.reject')) : null,
                h('button', { key: 'o', style: S.btnPrimary, disabled: !!busy, onClick: () => manualModal.execute().then((body) => { if (body?.ok) setManualModal(null); return body }) }, manualModal.actionLabel),
              ],
        },
          h('div', { style: { maxHeight: '55vh', overflow: 'auto' } }, h(MarkdownView, { text: manualModal.text })),
          manualModal.rejecting ? h('div', { style: { marginTop: 8 } },
            h('div', { style: { ...S.muted, marginBottom: 4 } }, t('confirm.rejectReason')),
            h('textarea', { style: S.textarea, rows: 4, value: manualModal.reason ?? '', onChange: (e) => setManualModal({ ...manualModal, reason: e.target.value }) }),
          ) : null,
        ) : null,
      )
    }

    function RequirementsView({ data, version, sessionId, onNewVersion, onOpenMeeting }) {
      const { state, busy, run, t } = data
      const [dialog, setDialog] = React.useState(null)
      const [page, setPage] = React.useState(0)
      const requirements = [...(state?.requirements ?? [])].sort((left, right) =>
        String(right.createdAt ?? '').localeCompare(String(left.createdAt ?? '')))
      const versions = state?.versions ?? []
      const artifacts = state?.artifacts ?? []
      const members = state?.members ?? []
      const roles = state?.roles ?? []
      const pageSize = 10
      const pageItems = requirements.slice(page * pageSize, (page + 1) * pageSize)
      const versionOf = (requirement) => versions.find((candidate) => candidate.id === requirement.versionId)
      const readOnlyFor = (requirement) => {
        const boundVersion = versionOf(requirement)
        return boundVersion !== undefined && (boundVersion.status === 'completed' || boundVersion.status === 'archived')
      }
      const openAttachment = (requirement, attachment) => {
        if (typeof window === 'undefined' || typeof window.open !== 'function') return
        const url = `/api/atplanner.attachment?session=${encodeURIComponent(sessionId ?? '')}&requirementId=${encodeURIComponent(requirement.id)}&attachmentId=${encodeURIComponent(attachment.id)}`
        window.open(url, '_blank', 'noopener')
      }
      const submit = async (form) => {
        const first = form.requirementId
          ? await run('requirement.update', { id: form.requirementId, title: form.title, description: form.description, assignees: form.assignees })
          : await run('requirement.create', { title: form.title, description: form.description, assignees: form.assignees })
        if (!first?.ok) return first
        const requirementId = form.requirementId ?? first.value?.requirement?.id
        let revision = first.value?.state?.revision
        if (Array.isArray(form.specs) && typeof requirementId === 'string') {
          const specsBody = await run('requirement.setTaskSpecs', { id: requirementId, specs: form.specs }, typeof revision === 'number' ? { revision } : undefined)
          if (!specsBody?.ok) return specsBody
          revision = specsBody.value?.state?.revision
        }
        for (const file of form.files ?? []) {
          const attached = await run('requirement.attach', {
            requirementId,
            name: file.name,
            mime: file.mime,
            dataBase64: file.dataBase64,
          }, typeof revision === 'number' ? { revision } : undefined)
          if (!attached?.ok) return attached
          revision = attached.value?.state?.revision
        }
        if (form.meet === true) {
          let targetVersion = version
          if (targetVersion === null || targetVersion === undefined) {
            const createdVersion = await run('version.create', { name: 'v0.1.0', description: '首个版本' }, typeof revision === 'number' ? { revision } : undefined)
            if (!createdVersion?.ok) return createdVersion
            revision = createdVersion.value?.state?.revision
            targetVersion = createdVersion.value?.version
          }
          if (targetVersion?.status === 'draft' && typeof requirementId === 'string') {
            const bound = await run('version.bind', { versionId: targetVersion.id, requirementIds: [requirementId] }, typeof revision === 'number' ? { revision } : undefined)
            if (!bound?.ok) return bound
            revision = bound.value?.state?.revision
          }
          const fallbackParticipants = members.filter((member) => member.removed !== true && member.blocked !== true && member.creation?.status === 'active').map((member) => member.name)
          const participants = (form.assignees ?? []).length > 0 ? form.assignees : fallbackParticipants
          const meeting = await run('meeting.create', {
            versionId: targetVersion.id,
            type: targetVersion.status === 'draft' && targetVersion.stage === 'requirement' ? 'requirement_clarification' : 'custom',
            title: t('requirement.meetTitle').replace('{title}', form.title),
            goal: form.description,
            participants,
          }, typeof revision === 'number' ? { revision } : undefined)
          if (!meeting?.ok) return meeting
          onOpenMeeting?.(meeting.value?.meeting?.id)
        }
        setDialog(null)
        return first
      }
      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' } },
        h('div', { style: S.section },
          h('div', { style: S.sectionHead },
            h('span', { style: S.sectionTitle }, t('requirement.title')),
            h('span', { style: S.muted }, `${requirements.length}`),
            h('div', { style: S.spacer }),
            h('button', { style: S.btnPrimary, onClick: () => setDialog({ kind: 'requirement' }) }, `+ ${t('requirement.new')}`),
          ),
          requirements.length === 0 ? h('div', { style: S.muted }, t('empty.noData')) : pageItems.map((requirement) => {
            const boundVersion = versionOf(requirement)
            const doc = artifacts.find((artifact) => artifact.type === 'requirement_doc' && artifact.requirementId === requirement.id)
            const docOk = doc !== undefined && (doc.status === 'approved' || doc.status === 'archived')
            const readOnly = readOnlyFor(requirement)
            return h('div', { key: requirement.id, style: { ...S.rowLine, height: 40, maxHeight: 44, flexWrap: 'nowrap' } },
              h('span', { style: { ...S.trunc, fontWeight: 500 }, title: requirement.title }, requirement.title),
              h('span', { style: S.tag() }, requirement.status),
              h('span', { style: { ...S.trunc, flex: '0 1 18%', color: 'var(--dt-text-secondary)' }, title: (requirement.assignees ?? []).join(', ') },
                (requirement.assignees ?? []).length === 0 ? t('requirement.assigneesHint') : requirement.assignees.map((name) => memberLabel(state, name)).join(', ')),
              h('span', { style: S.tag(docOk ? 'ok' : 'warn'), title: doc?.title ?? '' }, docOk ? t('requirement.docApproved') : t('requirement.docDraft')),
              h('span', { style: S.tagMono(), title: t('requirement.attachments') }, `${(requirement.attachments ?? []).length}`),
              boundVersion ? h('span', { style: S.tag() }, boundVersion.name) : null,
              readOnly ? h('span', { style: S.tag() }, t('requirement.readOnly')) : null,
              h('div', { style: { flex: 'none', display: 'flex', gap: 2 } },
                h('button', { style: S.btnGhost, disabled: readOnly, onClick: () => setDialog({ kind: 'requirement', requirement }) }, t('common.edit')),
                requirement.versionId === null && version?.status === 'draft'
                  ? h('button', { style: S.btnGhost, onClick: () => run('version.bind', { versionId: version.id, requirementIds: [requirement.id] }) }, t('common.bind'))
                  : null,
                requirement.versionId !== null && boundVersion?.status === 'draft'
                  ? h('button', { style: S.btnGhost, onClick: () => run('version.unbind', { versionId: boundVersion.id, requirementId: requirement.id }) }, t('common.unbind'))
                  : null,
                requirement.versionId === null && requirement.status === 'draft'
                  ? h('button', { style: S.btnGhost, onClick: () => run('requirement.delete', { id: requirement.id }) }, t('common.delete')) : null,
              ),
            )
          }),
          requirements.length > pageSize ? h('div', { style: { ...S.row, marginTop: 4 } },
            h('button', { style: S.btnGhost, disabled: page <= 0, onClick: () => setPage(Math.max(0, page - 1)) }, t('common.prev')),
            h('span', { style: { ...S.muted, flex: 'none' } }, `${page + 1}/${Math.ceil(requirements.length / pageSize)}`),
            h('button', { style: S.btnGhost, disabled: page + 1 >= Math.ceil(requirements.length / pageSize), onClick: () => setPage(page + 1) }, t('common.next')),
          ) : null,
        ),
        dialog?.kind === 'requirement' ? h(RequirementDialog, {
          t,
          initial: dialog.requirement,
          roles,
          members,
          readOnly: dialog.requirement ? readOnlyFor(dialog.requirement) : false,
          busy,
          onClose: () => setDialog(null),
          onSubmit: submit,
          extra: {
            autoSpecs: dialog.requirement ? () => run('workflow.autoTaskSpecs', { requirementId: dialog.requirement.id, overwrite: true }) : null,
            leadSpecs: dialog.requirement ? () => run('workflow.requestLeadSplit', { requirementId: dialog.requirement.id, apply: true }) : null,
            openAttachment,
            removeAttachment: async (attachmentId) => {
              const body = await run('requirement.detach', { requirementId: dialog.requirement.id, attachmentId })
              if (body?.ok) setDialog(null)
              return body
            },
          },
        }) : null,
      )
    }

    /* ---------------------------------------------------------------- meeting */

    function MeetingsView({ data, wctx, onOpenHost, onOpenBoard, initialMeetingId }) {
      const { state, busy, run, t } = data
      const meetings = state?.meetings ?? []
      const versions = state?.versions ?? []
      const roles = state?.roles ?? []
      const artifacts = state?.artifacts ?? []
      const members = (state?.members ?? []).filter((member) => !member.removed && !member.blocked)
      const [selected, setSelected] = React.useState(initialMeetingId ?? null)
      const [dialog, setDialog] = React.useState(null)
      const [expandedRound, setExpandedRound] = React.useState(null)
      const [speak, setSpeak] = React.useState({ memberName: '', question: '' })
      const [saveReq, setSaveReq] = React.useState({ title: '', description: '', roleTags: '' })
      const [docModal, setDocModal] = React.useState(null)
      const [roundPage, setRoundPage] = React.useState(0)
      const sortedMeetings = [...meetings].sort((left, right) =>
        String(right.startedAt ?? right.createdAt ?? '').localeCompare(String(left.startedAt ?? left.createdAt ?? '')))
      const meeting = sortedMeetings.find((candidate) => candidate.id === selected) ?? sortedMeetings[0] ?? null
      const separator = data.language === 'zh' ? '：' : ': '
      const inlineSeparator = data.language === 'zh' ? '｜' : ' | '
      const minutes = meeting
        ? artifacts.filter((artifact) => artifact.type === 'meeting_minutes' && (artifact.source?.meetingId === meeting.id || (meeting.artifactIds ?? []).includes(artifact.id)))
        : []
      const meetingDocs = meeting
        ? artifacts.filter((artifact) => (meeting.artifactIds ?? []).includes(artifact.id) || artifact.source?.meetingId === meeting.id)
        : []
      const roleOf = (memberName) => roleNameOf(state, (state?.members ?? []).find((member) => member.name === memberName)?.roleId)
      React.useEffect(() => {
        setSaveReq({ title: '', description: '', roleTags: '' })
        setSpeak({ memberName: '', question: '' })
        setExpandedRound(null)
        setRoundPage(0)
      }, [meeting?.id])
      React.useEffect(() => {
        if (!meeting?.requirementDraft) return
        setSaveReq((previous) => {
          if (previous.description !== '') return previous
          const first = meeting.requirementDraft.split('\n').find((line) => line.trim().startsWith('#')) ?? ''
          return { title: first.replace(/^#+\s*/, '').trim(), description: meeting.requirementDraft, roleTags: '' }
        })
      }, [meeting?.id, meeting?.requirementDraft])
      const openHost = () => {
        if (!meeting) return
        const hostId = meeting.sessionIds?.[meeting.hostMemberName] ?? meeting.leadSessionId
        if (typeof hostId === 'string' && hostId !== '') onOpenHost(hostId)
      }
      const finish = () => run('meeting.finish', { meetingId: meeting.id }).then((body) => {
        if (body?.ok) {
          setSelected(meeting.id)
          onOpenBoard?.()
        }
        return body
      })
      // Group consecutive member entries into speaking rounds; system entries stay separate and quieter.
      const transcript = Array.isArray(meeting?.transcript) ? meeting.transcript : []
      const rounds = []
      const systemEntries = []
      for (const entry of transcript) {
        if (entry.kind === 'member') {
          const last = rounds[rounds.length - 1]
          if (last !== undefined && last.memberName === entry.memberName) {
            last.texts.push(String(entry.text ?? ''))
            last.at = last.at || entry.at
          } else {
            rounds.push({ key: entry.id, memberName: entry.memberName, at: entry.at, texts: [String(entry.text ?? '')] })
          }
        } else {
          systemEntries.push(entry)
        }
      }
      const progressText = meeting === null
        ? null
        : data.busy === 'meeting.speak'
          ? t('meeting.progressSpeak').replace('{name}', memberLabel(state, speak.memberName))
          : data.busy === 'meeting.generateOutput'
            ? t('meeting.progressGenerate')
            : data.busy === 'meeting.finish'
              ? t('meeting.progressFinish')
              : (meeting.pendingSpeeches ?? []).some((speech) => speech.status === 'pending')
                ? t('meeting.progressSpeak').replace('{name}', memberLabel(state, (meeting.pendingSpeeches ?? []).find((speech) => speech.status === 'pending')?.memberName))
                : null
      const actionButtons = meeting === null
        ? []
        : [
            meeting.status === 'draft' ? h('button', { key: 'start', style: S.btn, disabled: !!busy, onClick: () => run('meeting.start', { meetingId: meeting.id }) }, t('meeting.start')) : null,
            meeting.status === 'active' ? h('button', { key: 'host', style: S.btn, onClick: openHost }, t('meeting.openHost')) : null,
            meeting.status === 'active' ? h('button', { key: 'gen', style: S.btn, disabled: !!busy, onClick: () => run('meeting.generateOutput', { meetingId: meeting.id }) }, data.busy === 'meeting.generateOutput' ? t('meeting.generating') : t('meeting.generate')) : null,
            meeting.status === 'active' ? h('button', { key: 'finish', style: S.btn, disabled: !!busy, title: t('meeting.finishHint'), onClick: finish }, data.busy === 'meeting.finish' ? t('meeting.finishing') : t('meeting.finish')) : null,
            meeting.status !== 'closed' && meeting.status !== 'cancelled' ? h('button', { key: 'cancel', style: S.btnGhost, onClick: () => run('meeting.cancel', { meetingId: meeting.id }) }, t('meeting.cancel')) : null,
          ].filter(Boolean)

      return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' } },
        h('div', { style: { ...S.body, gap: 8 } },
          h('div', { style: { flex: '0 0 30%', minWidth: 180, display: 'flex', flexDirection: 'column', gap: 4, overflow: 'auto', borderRight: '1px solid var(--dt-border-subtle)', paddingRight: 8 } },
            h('div', { style: { ...S.sectionHead, flex: 'none' } },
              h('span', { style: S.sectionTitle, flex: 1 }, t('meeting.title')),
              h('button', { style: S.btnGhost, onClick: () => setDialog({ kind: 'meeting' }) }, `+`),
            ),
            sortedMeetings.length === 0 ? h('div', { style: S.muted }, t('empty.noData')) : sortedMeetings.map((candidate) =>
              h('div', {
                key: candidate.id,
                style: {
                  ...S.rowLine, height: 36, maxHeight: 36, flexWrap: 'nowrap', cursor: 'pointer',
                  borderLeft: candidate.id === meeting?.id ? '2px solid var(--dt-border-strong)' : '2px solid transparent',
                  paddingLeft: 4,
                  background: candidate.id === meeting?.id ? 'var(--dt-surface-raised)' : 'transparent',
                },
                onClick: () => setSelected(candidate.id),
              },
                h('span', { style: S.tag() }, meetingTypeLabel(t, candidate.type).slice(0, 8)),
                h('span', { style: { ...S.trunc, fontWeight: candidate.id === meeting?.id ? 600 : 400 }, title: candidate.title }, candidate.title),
                h('span', { style: S.tag(meetingStatusTone(candidate.status)) }, meetingStatusLabel(t, candidate.status)),
                h('span', { style: { ...S.mono, flex: 'none' } }, `${candidate.participants.length}`),
              ),
            ),
          ),
          meeting === null
            ? h('div', { style: { ...S.section, margin: 8, alignSelf: 'flex-start', maxWidth: '100%' } }, t('empty.noData'))
            : h('div', { style: { flex: '1 1 70%', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8, overflow: 'auto' } },
                h('div', { style: { ...S.section, flex: 'none' } },
                  h('div', { style: { ...S.row, height: 40, maxHeight: 48, flexWrap: 'nowrap' } },
                    h('strong', { style: { ...S.trunc, fontSize: 13 }, title: meeting.title }, meeting.title),
                    h('span', { style: S.tag() }, meetingTypeLabel(t, meeting.type)),
                    h('span', { style: S.tag(meetingStatusTone(meeting.status)) }, meetingStatusLabel(t, meeting.status)),
                    h('span', { style: { ...S.muted, flex: 'none' } }, `${t('meeting.host')} ${memberLabel(state, meeting.hostMemberName)}`),
                    h('div', { style: S.spacer }),
                    ...actionButtons,
                  ),
                  h('div', { style: { ...S.muted, fontSize: 10, ...S.trunc } }, `${t('meeting.goal')}${separator}${meeting.goal || '—'}`),
                  meeting.status === 'active' ? h('div', { style: { ...S.muted, fontSize: 10, ...S.trunc }, title: t('meeting.finishHint') }, t('meeting.finishHint')) : null,
                  progressText ? h('div', { style: { fontSize: 11, color: 'var(--dt-accent)', paddingTop: 4 }, 'aria-live': 'polite' }, progressText) : null,
                ),
                h('div', { style: { ...S.section, flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
                  h('div', { style: S.sectionHead },
                    h('span', { style: S.sectionTitle }, t('meeting.transcript')),
                    h('span', { style: S.muted }, `${t('meeting.rounds')} ${rounds.length}`),
                    h('div', { style: S.spacer }),
                    minutes.length > 0 ? h('span', { style: S.tag('ok') }, `${t('meeting.minutes')} ${minutes.length}`) : null,
                  ),
                  rounds.length === 0 && systemEntries.length === 0
                    ? h('div', { style: S.muted }, t('empty.noData'))
                    : h('div', { style: { overflow: 'auto', flex: 1, minHeight: 0 } },
                        rounds.slice(roundPage * 10, roundPage * 10 + 10).map((round) => {
                          const full = round.texts.join('\n')
                          const summary = markdownInline(full).replace(/\s+/g, ' ').slice(0, 220)
                          return h('div', { key: round.key, style: S.transcriptRound },
                            h('div', { style: { ...S.row, height: 24, flexWrap: 'nowrap' } },
                              h('span', { style: { fontWeight: 600 } }, memberLabel(state, round.memberName)),
                              h('span', { style: S.tagMono() }, roleOf(round.memberName)),
                              h('span', { style: { ...S.muted, fontSize: 10 } }, fmtDate(round.at)),
                              h('div', { style: S.spacer }),
                              h('button', { style: S.btnGhost, onClick: () => setDocModal({ title: `${memberLabel(state, round.memberName)} · ${fmtDate(round.at)}`, text: full }) }, t('common.viewDetails')),
                            ),
                            h('div', { style: { fontSize: 12, lineHeight: 1.6, color: 'var(--dt-text-primary)' } }, summary),
                          )
                        }),
                        rounds.length > 10 ? h('div', { style: { ...S.row, marginTop: 4 } },
                          h('button', { style: S.btnGhost, disabled: roundPage <= 0, onClick: () => setRoundPage(Math.max(0, roundPage - 1)) }, t('common.prev')),
                          h('span', { style: { ...S.muted, flex: 'none' } }, `${roundPage + 1}/${Math.ceil(rounds.length / 10)}`),
                          h('button', { style: S.btnGhost, disabled: roundPage + 1 >= Math.ceil(rounds.length / 10), onClick: () => setRoundPage(roundPage + 1) }, t('common.next')),
                        ) : null,
                        systemEntries.slice(-8).map((entry) => h('div', { key: entry.id, style: S.transcriptSystem },
                          h('div', { style: { ...S.row, gap: 4 } },
                            h('span', { style: { ...S.muted, flex: 1 }, title: String(entry.text ?? '') }, `${t('meeting.system')} · ${fmtDate(entry.at)} · ${markdownInline(entry.text).replace(/\s+/g, ' ').slice(0, 120)}`),
                            h('button', { style: S.btnGhost, onClick: () => setDocModal({ title: t('meeting.system'), text: String(entry.text ?? '') }) }, t('common.viewDetails')),
                          ),
                        )),
                      ),
                ),
                meetingDocs.length > 0 ? h('div', { style: { ...S.section, flex: 'none' } },
                  h('div', { style: S.sectionHead },
                    h('span', { style: S.sectionTitle }, t('meeting.documents')),
                    h('span', { style: S.count }, `[${meetingDocs.length}]`),
                  ),
                  meetingDocs.map((artifact) => h('div', { key: artifact.id, style: { ...S.rowLine, minHeight: 32, flexWrap: 'nowrap' } },
                    h('span', { style: S.tag() }, artifact.type.replace(/_/g, ' ').slice(0, 14)),
                    h('span', { style: { ...S.trunc, fontWeight: 500 }, title: artifact.title }, artifact.title),
                    h('span', { style: S.tag(artifact.status === 'approved' || artifact.status === 'archived' ? 'ok' : 'warn') }, artifact.status),
                    h('div', { style: S.spacer }),
                    h('button', { style: S.btnGhost, onClick: () => setDocModal({ title: artifact.title, text: artifact.content ?? '' }) }, t('common.viewDetails')),
                  )),
                ) : null,
                h('div', { style: { ...S.section, flex: 'none' } },
                  h('div', { style: S.sectionHead }, h('span', { style: S.sectionTitle }, t('meeting.speak'))),
                  h('div', { style: { ...S.row, flexWrap: 'nowrap' } },
                    h('select', { style: { ...S.selectSm, maxWidth: 140 }, value: speak.memberName, onChange: (e) => setSpeak({ ...speak, memberName: e.target.value }) },
                      h('option', { value: '' }, '—'), meeting.participants.map((name) => h('option', { key: name, value: name }, memberLabel(state, name))),
                    ),
                    h('input', { style: { ...S.input, marginBottom: 0, flex: 1 }, value: speak.question, placeholder: t('meeting.question'), onChange: (e) => setSpeak({ ...speak, question: e.target.value }) }),
                    h('button', {
                      style: S.btn,
                      disabled: !!busy || !speak.memberName || !speak.question.trim(),
                      onClick: () => run('meeting.speak', { meetingId: meeting.id, memberName: speak.memberName, question: speak.question })
                        .then((body) => { if (body?.ok) setSpeak((previous) => ({ ...previous, question: '' })) }),
                    }, data.busy === 'meeting.speak' ? t('meeting.speaking') : t('meeting.speak')),
                  ),
                ),
                meeting.requirementDraft ? h('div', { style: { ...S.section, flex: 'none' } },
                  h('div', { style: S.sectionHead }, h('span', { style: S.sectionTitle }, t('meeting.draft'))),
                  h('input', { style: S.input, value: saveReq.title, onChange: (e) => setSaveReq({ ...saveReq, title: e.target.value }) }),
                  h('textarea', { style: S.textarea, rows: 3, value: saveReq.description, onChange: (e) => setSaveReq({ ...saveReq, description: e.target.value }) }),
                  h('div', { style: { ...S.row, flexWrap: 'nowrap' } },
                    h('input', { style: { ...S.input, marginBottom: 0, flex: 1 }, value: saveReq.roleTags, placeholder: t('requirement.tags'), onChange: (e) => setSaveReq({ ...saveReq, roleTags: e.target.value }) }),
                    h('button', { style: S.btnPrimary, disabled: !!busy || saveReq.title.trim() === '', onClick: () => run('meeting.saveRequirement', { meetingId: meeting.id, title: saveReq.title.trim(), description: saveReq.description, roleTags: saveReq.roleTags.split(',').map((v) => v.trim()).filter(Boolean) }) }, t('meeting.saveRequirement')),
                  ),
                ) : null,
              ),
        ),
        dialog?.kind === 'meeting' ? h(MeetingDialog, {
          t,
          versions,
          members,
          roles,
          busy,
          onClose: () => setDialog(null),
          onSubmit: (form) => run('meeting.create', form).then((body) => {
            if (body?.ok) {
              if (typeof body.value?.meeting?.id === 'string') setSelected(body.value.meeting.id)
              setDialog(null)
            }
            return body
          }),
        }) : null,
        docModal ? h(DocumentModal, { t, title: docModal.title, text: docModal.text, onClose: () => setDocModal(null) }) : null,
      )
    }

    /* --------------------------------------------------------------- settings */

    function SettingsView({ data, wctx }) {
      const { state, catalog, busy, run, t } = data
      const settingsKey = wctx?.sessionId ?? 'default'
      const [open, setOpen] = React.useState(() => settingsOpenCache.get(settingsKey) ?? { team: false, roles: false, members: false, leadModel: false })
      const [dialog, setDialog] = React.useState(null)
      const [confirm, setConfirm] = React.useState(null)
      const [leadRoute, setLeadRoute] = React.useState({
        provider: state?.team?.leadRoute?.provider ?? '',
        model: state?.team?.leadRoute?.model ?? '',
        effort: state?.team?.leadRoute?.reasoningEffort ?? '',
      })
      const roles = state?.roles ?? []
      const members = state?.members ?? []
      const settings = state?.settings ?? {}
      const catalogGroups = Array.isArray(catalog?.groups) ? catalog.groups : []
      const providers = catalogGroups.length > 0
        ? catalogGroups.map((group) => ({ provider: group.id, name: group.name ?? group.id, models: Array.isArray(group.models) ? group.models : [] }))
        : Array.isArray(catalog?.providers)
          ? catalog.providers
          : (Array.isArray(catalog?.routableProviders) ? catalog.routableProviders : []).map((provider) => ({
              provider: provider.id ?? provider.provider,
              name: provider.name ?? provider.id ?? provider.provider,
              models: [],
            }))
      const leadModels = providers.find((provider) => provider.provider === leadRoute.provider)?.models ?? []
      const toggle = (key) => setOpen((previous) => {
        const next = { ...previous, [key]: !previous[key] }
        settingsOpenCache.set(settingsKey, next)
        return next
      })
      const roleRefs = (roleId) => members.filter((member) => member.roleId === roleId && !member.removed).length
        + (state?.requirements ?? []).filter((requirement) =>
          (requirement.roleTags ?? []).includes(roleId) || (requirement.taskSpecs ?? []).some((spec) => spec.role === roleId)).length
        + Object.values(settings.defaultRoleByStage ?? {}).filter((value) => value === roleId).length
      const groups = [
        { key: 'active', label: t('settings.group.active'), rows: members.filter((member) => !member.removed && !member.blocked && member.roleId && member.creation?.status === 'active') },
        { key: 'blocked', label: t('settings.group.blocked'), rows: members.filter((member) => !member.removed && member.blocked) },
        { key: 'missing', label: t('settings.group.missing'), rows: members.filter((member) => !member.removed && member.creation?.status !== 'active' && member.roleId) },
        { key: 'removed', label: t('settings.group.removed'), rows: members.filter((member) => member.removed) },
        { key: 'unconfigured', label: t('settings.group.unconfigured'), rows: members.filter((member) => !member.removed && !member.roleId) },
      ]
      const submitMember = (form) => {
        const promise = form.name && members.some((member) => member.name === form.name)
          ? run('member.update', { name: form.name, displayName: form.displayName, roleId: form.roleId, route: form.route })
          : run('member.create', { name: form.name, displayName: form.displayName, roleId: form.roleId, route: form.route })
        promise.then((body) => { if (body?.ok) setDialog(null); return body })
      }
      const askRemoveMember = (member) => setConfirm({
        kind: 'remove',
        title: t('member.remove'),
        what: `${member.displayName} (${member.name})`,
        why: t('member.removeHint'),
        recoverable: t('member.removeRecoverable'),
        op: 'member.remove',
        target: member.name,
      })
      const askDeleteRole = (role) => setConfirm({
        kind: 'role',
        title: t('role.delete'),
        what: role.name,
        why: t('role.deleteHint'),
        recoverable: t('role.deleteRecoverable'),
        op: 'role.delete',
        target: role.id,
      })
      const saveLeadRoute = () => {
        const route = leadRoute.provider && leadRoute.model
          ? { provider: leadRoute.provider, model: leadRoute.model, ...(leadRoute.effort ? { reasoningEffort: leadRoute.effort } : {}) }
          : null
        run('team.setLeadRoute', { route })
      }
      return h('div', { style: { ...S.body, flexDirection: 'column', overflow: 'auto', alignItems: 'stretch', gap: 8 } },
        h('div', { style: S.section },
          h('div', { style: { ...S.row, minHeight: 36, flexWrap: 'nowrap' } },
            h('span', { style: { ...S.sectionTitle, flex: 'none' } }, t('settings.highEfficiency')),
            h('span', { style: { ...S.muted, fontSize: 11, flex: 1, minWidth: 0, lineHeight: 1.6 }, title: t('settings.highEfficiencyHint') }, t('settings.highEfficiencyHint')),
            h('button', {
              type: 'button',
              role: 'switch',
              'aria-checked': state?.settings?.highEfficiencyMode === true,
              'aria-label': t('settings.highEfficiency'),
              title: t('settings.highEfficiencyTip'),
              onClick: () => run('settings.update', { highEfficiencyMode: state?.settings?.highEfficiencyMode !== true }),
              style: {
                width: 40,
                height: 22,
                minHeight: 22,
                padding: 0,
                position: 'relative',
                borderRadius: 999,
                border: '1px solid var(--dt-border-strong)',
                background: state?.settings?.highEfficiencyMode === true ? 'var(--dt-accent)' : 'var(--dt-surface-raised)',
                cursor: 'pointer',
                flex: 'none',
              },
            },
              h('span', {
                style: {
                  position: 'absolute',
                  top: 2,
                  left: state?.settings?.highEfficiencyMode === true ? 20 : 2,
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: state?.settings?.highEfficiencyMode === true ? 'var(--dt-accent-foreground)' : 'var(--dt-text-secondary)',
                  transition: 'left 120ms ease',
                },
              }),
            ),
          ),
        ),
        h('div', { style: S.section },
          h('div', { style: { ...S.sectionHead, cursor: 'pointer' }, onClick: () => toggle('team') },
            h('span', { style: { ...S.sectionTitle, flex: 1 } }, t('team.title')),
            h('span', { style: S.tag(state?.team?.leadSessionId ? 'ok' : 'warn') }, state?.team?.leadSessionId ? t('team.bound') : t('team.unbound')),
            h('span', { style: S.muted }, open.team ? '▾' : '▸'),
          ),
          open.team ? h('div', null,
            h('div', { style: { ...S.rowLine, height: 28, flexWrap: 'nowrap' } },
              h('span', { style: S.muted }, `${t('team.name')}${data.language === 'zh' ? '：' : ': '}${state?.team?.name ?? '—'}`),
              h('span', { style: { ...S.mono, ...S.trunc }, title: state?.team?.leadSessionId ?? '' }, state?.team?.leadSessionId ?? '—'),
              h('div', { style: S.spacer }),
              h('button', { style: S.btn, disabled: !!busy, onClick: () => run('team.bind', { name: state?.team?.name }) }, t('team.bind')),
              h('button', { style: S.btn, disabled: !!busy, onClick: () => run('team.recreateMissing', {}) }, t('team.recreate')),
            ),
          ) : null,
        ),
        h('div', { style: S.section },
          h('div', { style: { ...S.sectionHead, cursor: 'pointer' }, onClick: () => toggle('leadModel') },
            h('span', { style: { ...S.sectionTitle, flex: 1 } }, t('settings.leadModel')),
            h('span', { style: S.muted }, state?.team?.leadRoute ? `${state.team.leadRoute.provider}/${state.team.leadRoute.model}` : t('member.routeInherit')),
            h('span', { style: S.muted }, open.leadModel ? '▾' : '▸'),
          ),
          open.leadModel ? h('div', null,
            h('div', { style: { ...S.row, flexWrap: 'nowrap', marginTop: 4 } },
              h('select', { style: { ...S.selectSm, maxWidth: 160 }, value: leadRoute.provider, onChange: (e) => setLeadRoute({ provider: e.target.value, model: '', effort: '' }) },
                h('option', { value: '' }, t('member.routeInherit')),
                providers.map((provider) => h('option', { key: provider.provider, value: provider.provider }, provider.provider)),
              ),
              h('select', { style: { ...S.selectSm, maxWidth: 180 }, value: leadRoute.model, disabled: !leadRoute.provider, onChange: (e) => setLeadRoute({ ...leadRoute, model: e.target.value }) },
                h('option', { value: '' }, '—'),
                leadModels.map((model) => h('option', { key: model.id ?? model.model, value: model.id ?? model.model }, model.name ?? model.id ?? model.model)),
              ),
              h('button', { style: S.btn, disabled: !!busy, onClick: saveLeadRoute }, t('common.save')),
            ),
          ) : null,
        ),
        h('div', { style: S.section },
          h('div', { style: { ...S.sectionHead, cursor: 'pointer' }, onClick: () => toggle('roles') },
            h('span', { style: { ...S.sectionTitle, flex: 1 } }, t('role.title')),
            h('span', { style: S.muted }, `${roles.length}`),
            h('span', { style: S.muted }, open.roles ? '▾' : '▸'),
          ),
          open.roles ? h('div', null,
            h('div', { style: S.sectionHead },
              h('button', { style: S.btnGhost, onClick: () => setDialog({ kind: 'role' }) }, `+ ${t('role.new')}`),
            ),
            h('div', { style: { ...S.tableHead, flexWrap: 'nowrap' } },
              h('span', { style: { flex: '1 1 25%' } }, t('role.title')),
              h('span', { style: { flex: '0 0 25%' } }, t('settings.stages')),
              h('span', { style: { flex: '0 0 10%' } }, t('settings.refs')),
              h('span', { style: { flex: '0 0 30%' } }, t('common.actions')),
            ),
            roles.map((role) => h('div', {
              key: role.id,
              style: { ...S.tableRow, flexWrap: 'nowrap', borderLeft: role.id === 'lead' ? '2px solid var(--dt-border-strong)' : '2px solid transparent', paddingLeft: 4 },
            },
              h('span', { style: { ...S.trunc, flex: '1 1 25%', fontWeight: 500 } }, role.name),
              role.id === 'lead' ? h('span', { style: S.tag(), flex: 'none' }, t('role.leadSpecial')) : null,
              h('span', { style: { ...S.trunc, flex: '0 0 25%', color: 'var(--dt-text-secondary)', fontSize: 10 } }, (role.stageHints ?? []).join(',') || '—'),
              h('span', { style: { ...S.mono, flex: '0 0 10%' } }, `${roleRefs(role.id)}`),
              h('div', { style: { flex: '0 0 30%', display: 'flex', gap: 2 } },
                h('button', { style: S.btnGhost, onClick: () => setDialog({ kind: 'role', role }) }, t('common.edit')),
                role.builtin ? h('button', { style: S.btnGhost, onClick: () => run('role.reset', { id: role.id }) }, t('role.reset')) : h('button', { style: S.btnGhost, onClick: () => askDeleteRole(role) }, t('role.delete')),
                h('button', { style: S.btnGhost, onClick: () => run('role.syncMembers', { id: role.id }) }, t('role.promptSync')),
              ),
            )),
          ) : null,
        ),
        h('div', { style: S.section },
          h('div', { style: { ...S.sectionHead, cursor: 'pointer' }, onClick: () => toggle('members') },
            h('span', { style: { ...S.sectionTitle, flex: 1 } }, t('member.title')),
            h('span', { style: S.muted }, `${members.filter((member) => !member.removed).length}`),
            h('span', { style: S.muted }, open.members ? '▾' : '▸'),
          ),
          open.members ? h('div', null,
            h('div', { style: S.sectionHead },
              h('button', { style: S.btnGhost, onClick: () => setDialog({ kind: 'member' }) }, `+ ${t('member.new')}`),
            ),
            groups.map((group) => group.rows.length === 0 ? null : h('div', { key: group.key },
              h('div', { style: { ...S.muted, marginTop: 4, fontSize: 10 } }, `${group.label} (${group.rows.length})`),
              group.rows.slice(0, 20).map((member) => h('div', { key: member.name, style: { ...S.loadRow, height: 36, maxHeight: 40, flexWrap: 'nowrap', opacity: member.removed ? 0.6 : 1 } },
                h('span', { style: { ...S.trunc, flex: '1 1 20%', fontWeight: 500 }, title: member.name }, member.displayName),
                h('span', { style: { flex: '0 0 12%' } }, h('span', { style: S.tagMono(), title: member.roleId ?? '' }, roleNameOf(state, member.roleId))),
                h('span', { style: { flex: '0 0 10%' } }, h('span', { style: S.tag(member.blocked ? 'warn' : member.creation?.status === 'active' ? 'ok' : 'warn') }, memberStatusLabel(t, member))),
                h('span', { style: { ...S.mono, flex: '1 1 25%', ...S.trunc }, title: member.route ? `${member.route.provider}/${member.route.model}` : '' }, member.route ? `${member.route.provider}/${member.route.model}` : t('member.routeInherit')),
                h('div', { style: { flex: '0 0 27%', display: 'flex', gap: 2 } },
                  member.removed
                    ? h('button', { style: S.btnGhost, onClick: () => run('member.restore', { name: member.name }) }, t('member.restore'))
                    : h('button', { style: S.btnGhost, onClick: () => setDialog({ kind: 'member', member }) }, t('common.edit')),
                  member.removed ? null : (member.blocked
                    ? h('button', { style: S.btnGhost, onClick: () => run('member.unblock', { name: member.name }) }, t('member.unblock'))
                    : h('button', { style: S.btnGhost, onClick: () => run('member.block', { name: member.name }) }, t('member.block'))),
                  member.removed ? null : h('button', { style: S.btnGhost, onClick: () => askRemoveMember(member) }, t('member.remove')),
                  member.creation?.status !== 'active' ? h('button', { style: S.btnGhost, onClick: () => run('member.recreate', { name: member.name }) }, t('member.recreate')) : null,
                ),
              )),
            )),
          ) : null,
        ),
        dialog?.kind === 'member' ? h(MemberDialog, { t, initial: dialog.member, roles, catalog, busy, onClose: () => setDialog(null), onSubmit: submitMember }) : null,
        dialog?.kind === 'role' ? h(RoleDialog, {
          t,
          initial: dialog.role,
          busy,
          onClose: () => setDialog(null),
          onSubmit: (form) => {
            const promise = form.id
              ? run('role.update', { id: form.id, name: form.name, description: form.description, basePrompt: form.basePrompt })
              : run('role.create', { id: slugId(form.name), name: form.name || form.basePrompt.slice(0, 20), description: form.description, basePrompt: form.basePrompt })
            promise.then((body) => { if (body?.ok) setDialog(null); return body })
          },
        }) : null,
        confirm !== null ? h(Modal, {
          title: confirm.title,
          onClose: () => setConfirm(null),
          footer: [
            h('button', { key: 'cancel', style: S.btn, onClick: () => setConfirm(null) }, t('confirm.cancel')),
            h('button', {
              key: 'confirm',
              style: { ...S.btn, color: 'var(--dt-text-primary)', borderColor: 'var(--dt-danger)' },
              disabled: !!busy,
              onClick: () => run(confirm.op, confirm.op === 'member.remove' ? { name: confirm.target } : { id: confirm.target }).then((body) => {
                if (body?.ok) setConfirm(null)
                return body
              }),
            }, t('confirm.confirm')),
          ],
        },
          h('div', { style: S.muted }, `${t('confirm.what')}${data.language === 'zh' ? '：' : ': '}${confirm.what}`),
          h('div', { style: { ...S.muted, marginTop: 4 } }, `${t('confirm.why')}${data.language === 'zh' ? '：' : ': '}${confirm.why}`),
          h('div', { style: { ...S.muted, marginTop: 4 } }, `${t('confirm.recoverable')}${data.language === 'zh' ? '：' : ': '}${confirm.recoverable}`),
        ) : null,
      )
    }

    /* ---------------------------------------------------------------- meeting banner */

    function MeetingDock({ sessionId, session }) {
      // Session-scoped slots receive the live SessionSnapshot; the injected
      // sessionId is the portable fallback used by the registration below.
      const currentSessionId = typeof sessionId === 'string' && sessionId !== ''
        ? sessionId
        : (typeof session?.sessionId === 'string' ? session.sessionId : '')
      const workspacePath = typeof session?.cwd === 'string' ? session.cwd : (typeof session?.header?.cwd === 'string' ? session.header.cwd : '')
      const data = usePlannerData(currentSessionId, workspacePath)
      const t = data.t
      const meetings = data.state?.meetings ?? []
      const meeting = currentSessionId === ''
        ? null
        : meetings
          .filter((candidate) => candidate.status === 'active' && candidate.closedAt === null)
          .sort((a, b) => Date.parse(b.startedAt ?? '') - Date.parse(a.startedAt ?? ''))
          .find((candidate) => candidate.leadSessionId === currentSessionId || Object.values(candidate.sessionIds ?? {}).includes(currentSessionId))
      if (meeting === undefined || meeting === null) return null
      const separator = data.language === 'zh' ? '：' : ': '
      const inlineSeparator = data.language === 'zh' ? '｜' : ' | '
      const openBoard = () => {
        try { ctxRef.get('layout')?.selectPanel?.(PANEL_ID) } catch {}
      }
      const finish = () => data.run('meeting.finish', { meetingId: meeting.id }).then((body) => {
        if (body?.ok) openBoard()
        return body
      })
      const bannerStyle = { ...S.banner, height: 'auto', minHeight: 64, maxHeight: 112, flexDirection: 'column', alignItems: 'stretch', gap: 4, padding: '8px 12px' }
      return h('div', { style: bannerStyle },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          h('span', { style: { fontSize: 13, fontWeight: 700, color: 'var(--dt-success)', flex: 'none' } }, t('meeting.activeBanner')),
          h('div', { style: S.spacer }),
          h('button', { type: 'button', style: S.btn, onClick: openBoard }, t('meeting.bannerBoard')),
          h('button', { type: 'button', style: S.btn, disabled: !!data.busy, onClick: finish }, data.busy === 'meeting.finish' ? '…' : t('meeting.bannerExit')),
        ),
        h('div', { style: { ...S.trunc, fontSize: 14, fontWeight: 600 }, title: meeting.title }, meeting.title),
        h('div', { style: { ...S.muted, fontSize: 13, ...S.trunc } },
          `${t('meeting.host')}：${memberLabel(data.state, meeting.hostMemberName)}`),
        h('div', { style: { ...S.muted, fontSize: 12, ...S.trunc }, title: meeting.goal || undefined },
          `${meetingTypeLabel(t, meeting.type)} · ${meeting.goal || '—'}`),
      )
    }

    /* ------------------------------------------------------------------- icon */

    function DevTeamIcon({ size = 24 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-label': 'dsh-agent-team-planner' },
        h('ellipse', { cx: 12, cy: 12, rx: 9, ry: 4.4, transform: 'rotate(-30 12 12)' }),
        h('ellipse', { cx: 12, cy: 12, rx: 9, ry: 4.4, transform: 'rotate(30 12 12)' }),
        h('circle', { cx: 12, cy: 12, r: 1.9, fill: 'currentColor', stroke: 'none' }),
        h('path', { d: 'M17.6 15.2l2.2 2.2a1.4 1.4 0 0 1-2 2l-2.2-2.2' }),
        h('path', { d: 'M18.7 14.6l1.9 1.9' }),
      )
    }

    /* ------------------------------------------------------------------- shell */

    // `current` is the live client Context. The convenience accessors keep the
    // React bodies readable and tolerate ctx.get() being unavailable in tests.
    const settingsOpenCache = new Map()

    const ctxRef = {
      current: null,
      get(name) {
        try { return this.current?.get?.(name) } catch { return undefined }
      },
      get locale() { return this.current?.locale },
      get layout() { return this.current?.layout },
    }
    let boundT = null

    function Shell() {
      const wctx = useWorkspaceContext()
      const [tab, setTab] = React.useState('board')
      const [openMeetingId, setOpenMeetingId] = React.useState(null)
      const [selectedVersionId, setSelectedVersionId] = React.useState(null)
      const [versionDialog, setVersionDialog] = React.useState(null)
      const [language, setLanguageState] = React.useState(() => activeLanguage())
      React.useEffect(() => {
        try {
          const off = ctxRef.locale.subscribe(() => {
            setLanguageState(activeLanguage())
          })
          return off
        } catch { return undefined }
      }, [])
      const setLanguage = (next) => {
        const normalized = normalizeLanguage(next)
        try { ctxRef.locale.setLocale(normalized) } catch {}
        setLanguageState(normalized)
      }
      const data = usePlannerData(wctx.sessionId, wctx.workspace?.path)
      const t = data.t
      const state = data.state
      const versions = state?.versions ?? []
      const autoMembersRef = React.useRef(false)
      React.useEffect(() => {
        if (autoMembersRef.current || data.snapshot === null) return
        if ((state?.members ?? []).length > 0) return
        autoMembersRef.current = true
        const defaults = [
          { name: 'luna', displayName: 'Luna', roleId: 'product' },
          { name: 'kael', displayName: 'Kael', roleId: 'architect' },
          { name: 'zoe', displayName: 'Zoe', roleId: 'frontend' },
          { name: 'owen', displayName: 'Owen', roleId: 'backend' },
          { name: 'mia', displayName: 'Mia', roleId: 'test' },
          { name: 'jasper', displayName: 'Jasper', roleId: 'ops' },
        ]
        let revision = state.revision
        const createNext = async (index) => {
          if (index >= defaults.length) return
          const body = await data.run('member.create', defaults[index], { revision })
          if (body?.ok !== true) { autoMembersRef.current = false; return }
          revision = body.value?.state?.revision
          await createNext(index + 1)
        }
        void createNext(0)
      }, [data.snapshot, state?.members?.length, data.run])
      const requirements = state?.requirements ?? []
      const artifacts = state?.artifacts ?? []
      const members = state?.members ?? []
      const version = versions.find((candidate) => candidate.id === selectedVersionId)
        ?? versions.find((candidate) => candidate.status === 'active')
        ?? versions[0]
        ?? null
      const openHost = (targetSessionId) => {
        if (typeof targetSessionId !== 'string' || targetSessionId === '') return
        try {
          // SessionTarget is the displayed SessionId (or a SubagentAddress),
          // not a { parentSessionId, childSessionId } object.
          ctxRef.get('uiWorkspace')?.openSession?.(targetSessionId)
        } catch {}
      }
      const goMeetings = (meetingId) => {
        setOpenMeetingId(meetingId ?? null)
        setTab('meetings')
      }
      const closeVersionDialog = () => setVersionDialog(null)
      const submitVersion = (form) => {
        const body = { name: form.name, description: form.description, planDate: form.planDate, owner: form.owner, notes: form.notes }
        const promise = form.id ? data.run('version.update', { id: form.id, ...body }) : data.run('version.create', body)
        return promise.then((result) => {
          if (result?.ok) {
            const createdId = result.value?.version?.id
            if (typeof createdId === 'string') setSelectedVersionId(createdId)
            closeVersionDialog()
          }
          return result
        })
      }
      const runVersionAction = (op, versionId) => data.run(op, op === 'version.delete' ? { id: versionId } : { versionId }).then((body) => {
        if (body?.ok) {
          if (op === 'version.delete') setSelectedVersionId(null)
          closeVersionDialog()
        }
        return body
      })
      const forceComplete = (versionId) => {
        const ask = typeof window !== 'undefined' && typeof window.prompt === 'function'
        const answer = ask ? window.prompt(t('version.forceReasonPrompt'), '') : 'UI force complete'
        if (answer === null || answer.trim() === '') return Promise.resolve(null)
        return data.run('version.forceComplete', { versionId, reason: answer.trim() }).then((body) => {
          if (body?.ok) closeVersionDialog()
          return body
        })
      }
      const gaps = gateMissing({ version, requirements, artifacts, members, settings: state?.settings, t })
      const enterArchitectureAndMeet = async () => {
        const entered = await data.run('version.enterArchitecture', { versionId: version.id })
        if (entered?.ok !== true) return entered
        let revision = entered.value?.state?.revision
        const target = entered.value?.version ?? version
        const participants = members
          .filter((member) => member.removed !== true && member.blocked !== true && ['product', 'architect'].includes(member.roleId))
          .map((member) => member.name)
        const goalTitles = requirements
          .filter((requirement) => (target.requirementIds ?? []).includes(requirement.id))
          .map((requirement) => requirement.title)
          .join('；')
        const created = await data.run('meeting.create', {
          versionId: target.id,
          type: 'architecture_review',
          title: t('meeting.archTitle').replace('{name}', target.name),
          goal: goalTitles || t('meeting.archGoal'),
          participants,
        }, typeof revision === 'number' ? { revision } : undefined)
        if (created?.ok === true) {
          revision = created.value?.state?.revision
          const meetingId = created.value?.meeting?.id
          if (meetingId !== undefined) {
            await data.run('meeting.start', { meetingId }, typeof revision === 'number' ? { revision } : undefined)
            goMeetings(meetingId)
          }
        }
        return created
      }
      const stageAction = (() => {
        if (!version) return null
        const missingTitle = gaps.length === 0 ? t('stage.gateOk') : `${t('stage.gateMissing')}${language === 'zh' ? '：' : ': '}${gaps.join('；')}`
        if (version.status === 'draft' && version.stage === 'requirement') {
          return { label: t('stage.enterArchitecture'), disabled: gaps.length > 0 || !!data.busy, title: missingTitle, onClick: enterArchitectureAndMeet }
        }
        if (version.status === 'draft' && version.stage === 'architecture') {
          return { label: t('stage.startDevelopment'), disabled: gaps.length > 0 || !!data.busy, title: missingTitle, onClick: () => data.run('version.startDevelopment', { versionId: version.id }) }
        }
        if (version.status === 'active') {
          return { label: t('stage.advance'), disabled: gaps.length > 0 || !!data.busy, title: missingTitle, onClick: () => data.run('version.advance', { versionId: version.id }) }
        }
        if (version.status === 'completed') {
          return { label: t('version.archive'), disabled: !!data.busy, title: t('version.archive'), onClick: () => data.run('version.archive', { versionId: version.id }) }
        }
        if (version.status === 'interrupted') {
          return { label: t('version.reopen'), disabled: !!data.busy, title: t('version.reopen'), onClick: () => data.run('version.reopenInterrupted', { versionId: version.id }) }
        }
        return null
      })()
      const hasWorkspace = wctx.workspace !== null
      const errorCode = data.error?.code ?? 'ERROR'
      const errorMessage = data.error?.message ?? String(data.error ?? '')
      return h(
        'div',
        { style: S.root, className: 'dt-root' },
        h(WorkspaceBar, {
          wctx, t, language, setLanguage,
          versions, version,
          onSelectVersion: setSelectedVersionId,
          onSettings: () => setTab('settings'),
        }),
        h('div', { style: S.tabs },
          ['board', 'requirements', 'meetings'].map((id) =>
            h('div', { key: id, style: S.tab(tab === id), onClick: () => setTab(id) }, t(`nav.${id}`),
              id === 'requirements' && requirements.length === 0
                ? h('span', { style: S.tabDot, title: t('nav.requirementsBadge'), 'aria-label': t('nav.requirementsBadge') })
                : null,
            ),
          ),
        ),
        data.error ? h('div', { style: S.error },
          h('div', { style: { display: 'flex', alignItems: 'flex-start', gap: 8 } },
            h('div', { style: { flex: 1 } }, t('error.code').replace('{code}', errorCode).replace('{message}', errorMessage)),
            h('button', { style: S.btnGhost, onClick: () => data.clearError?.() }, '✕'),
          ),
          Array.isArray(data.error?.details?.missing)
            ? h('div', { style: { marginTop: 4, fontSize: 10 } }, data.error.details.missing.map((item, index) => h('div', { key: index }, `· ${item}`)))
            : null,
        ) : null,
        !hasWorkspace
          ? wctx.workspacesPending
            ? h('div', { style: { ...S.section, margin: 8 } }, h('div', { style: S.sectionTitle }, t('common.loading')))
            : h('div', { style: { ...S.section, margin: 8 } },
                h('div', { style: S.sectionTitle }, t('ws.noWorkspace')),
                h('div', { style: S.muted }, t('ws.noWorkspaceHint')),
              )
          : wctx.sessionId === null
            ? wctx.sessionsPending
              ? h('div', { style: { ...S.section, margin: 8 } }, h('div', { style: S.sectionTitle }, t('common.loading')))
              : h('div', { style: { ...S.section, margin: 8 } },
                  h('div', { style: S.sectionTitle }, t('ws.noSession')),
                  h('button', { style: S.btnPrimary, onClick: wctx.createSession }, t('ws.createSession')),
                )
            : data.snapshot === null
              ? h('div', { style: { ...S.section, margin: 8 } },
                  h('div', { style: S.sectionTitle }, data.error === null ? t('common.loading') : t('common.retry')),
                  data.error === null ? null : h('button', { style: S.btn, onClick: () => data.refresh() }, t('common.retry')),
                )
              : h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
                  tab === 'board' ? h(BoardView, {
                    data, version, stageAction,
                    onNewVersion: () => setVersionDialog({ kind: 'version' }),
                    onVersionSettings: () => setVersionDialog({ kind: 'version', version }),
                    onOpenRequirements: () => setTab('requirements'),
                  })
                    : tab === 'requirements' ? h(RequirementsView, {
                      data, version, sessionId: wctx.sessionId,
                      onNewVersion: () => setVersionDialog({ kind: 'version' }),
                      onOpenMeeting: goMeetings,
                    })
                      : tab === 'meetings' ? h(MeetingsView, { data, wctx, onOpenHost: openHost, onOpenBoard: () => setTab('board'), initialMeetingId: openMeetingId })
                        : h(SettingsView, { data, wctx }),
                ),
        versionDialog?.kind === 'version' ? h(VersionDialog, {
          t,
          initial: versionDialog.version,
          busy: !!data.busy,
          onClose: closeVersionDialog,
          onSubmit: submitVersion,
          onDelete: version ? () => runVersionAction('version.delete', version.id) : undefined,
          onForceComplete: version ? () => forceComplete(version.id) : undefined,
          onArchive: version ? () => runVersionAction('version.archive', version.id) : undefined,
        }) : null,
      )
    }

    /* ------------------------------------------------------------------- apply */

    function apply(ctx) {
      ctxRef.current = ctx
      injectDesignTokens()
      ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'devteam: zh dictionary')
      ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'devteam: en dictionary')
      ctx.effect(() => ctx.locale.register(NS, 'ru', RU), 'devteam: ru dictionary')
      boundT = ctx.locale.bind(NS)
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: () => boundT('panel.label'), locale: NS }, DevTeamIcon),
      )
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS, inject: () => ({}) }, Shell),
      )
      ctx.slots.inject('conversation.input.dock', () =>
        ctx.slots.register({ name: 'conversation.input.dock', id: 'devteam-meeting', order: 5, locale: NS, inject: (sessionId) => ({ sessionId }) }, MeetingDock),
      )
    }

    exports.apply = apply
    exports.inject = ['slots', 'locale', 'layout', 'remote']
    return module.exports
  },
})
