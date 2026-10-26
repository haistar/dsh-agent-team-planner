# Changelog

## 0.8.5

- First public-release preparation: new bilingual README (English + 简体中文), GitHub repository/author metadata, MIT copyright holder, README-aware installer, CI runs the full test suite, and internal verification documents excluded from the repository.

## 0.8.4

- Repository hygiene for the first public release: normalized package description and English cordis patch comments (removed double-encoded text).

## 0.8.3

- High-efficiency mode: remove the question-mark tooltip and show the schedule description as muted text after the title, with the switch on the right.

## 0.8.2

- High-efficiency mode uses a real switch control (role=switch/aria-checked); the full schedule description moved into the question-mark tooltip.

## 0.8.1

- High-efficiency mode now uses DeepSeek peak windows: Mon–Fri 09:00–12:00 and 14:00–18:00 Beijing time are peak; weekends, 2026 Chinese statutory holidays, and all other hours are idle. Includes the official 2026 holiday dates.

## 0.8.0

- Settings switch “High-efficiency mode” (default off) with a help tooltip.
- When enabled, new member task dispatch and artifact capture are gated to the DeepSeek discount window (Beijing 00:30–08:30); running tasks continue unaffected.
- Pending work is suspended outside the window and automatically pumped when the discount window opens (state polling). Board shows waiting/active notice.

## 0.7.10

- Member display names are used in active-task rows, task details, meeting speaker options and timeline summaries.

## 0.7.9

- Remove the timeline “newest first, 5 per page” description text from the section header.

## 0.7.8

- Distinct status colours: in progress green, pending yellow, blocked red, completed neutral.
- Removed the duplicate “pending manual handling” section; manual confirmations own this area.
- Artifact page size adapts to window height (3–12 rows); timeline height increased so its pager is fully visible.
- Review/test reports are auto-captured by the pump when the review/test task completes; manual capture remains as fallback with busy feedback.

## 0.7.7

- Task status localized (in progress/pending/blocked/completed/deleted); task title opens a details modal with progress, elapsed time and token-availability note.
- Artifact capture buttons show “Capturing…” and an aria-live progress line.
- Timeline is newest-first, 5 rows per page with paging.
- Critical workflow fix: approving a review/test report now advances the stage even if the official review/test task binding is not marked completed; `version.advance` also honors approved reports.

## 0.7.6

- Manual development confirmation lists each task and related artifact; add reject flow with a required reason that is persisted and sent to the developer.
- Confirming development uses a dedicated `version.confirmDevelopment` operation that marks development bindings complete and enters review directly, fixing the case where `version.advance` closed the dialog without changing the stage.

## 0.7.5

- Active tasks sort by status priority, then durable creation time descending (binding createdAt for official tasks without createdAt).
- Every board artifact now has View details opening rendered Markdown; drafts additionally keep Edit.

## 0.7.4

- Board tasks sort by status priority (in progress/pending first) then newest creation.
- Manual confirmation section under artifacts: development-complete confirmation and draft report approvals with detail modal and action.
- Task rows/page size adapt up to 20 per page; meeting dock reads the workspace-scoped state and ignores closed meetings; meeting context requires closedAt=null.

## 0.7.3

- Task splitting now chooses the implementation role from explicit developer assignees, then the architecture document / requirement text (e.g. html page → frontend), not from product/test participants.
- Commands issued from a teammate (subagent) conversation resolve the durable parent/root agent when the session-controller reports session/agent-busy; the UI also prefers root sessions for plugin operations.

## 0.7.2

- "Ask team lead to split" no longer sends a prompt to the lead agent (which failed with session/agent-busy while the lead was busy). It performs a local, deterministic split from the requirement assignees/role tags and returns the specs.

## 0.7.1

- Infer roles for official teammates created outside the plugin (pm/arch/fe/be/qa/ops) and backfill null roles.
- Requirement clarification meetings now auto-fill requirement assignees from participants and generate baseline task specs, clearing the role-availability gate.

## 0.7.0

- Meeting actions show busy labels and an aria-live progress line for speaking, generating documents and finishing; speak state also derives from pendingSpeeches.
- Meeting transcripts are summarized and open in a rendered markdown modal; long rounds paginate 10 per page; system messages are summarized with details.
- Meeting-produced documents (requirement doc, architecture doc, minutes, etc.) are listed with View details and rendered in a modal.
- Board artifacts that are approved/archived open in the rendered document modal; draft artifacts remain editable.
- Meeting list sorts newest-first; meeting status is localized (draft/active/closed/cancelled) with semantic tag colors.
- Role IDs removed from role/member display surfaces in favor of role names.
- Active tasks fall back to persisted bindings when the official task board is cold; timeline falls back to binding history if activity is empty.

## 0.6.4

- Meeting member list shows role names instead of role ids.
- Lazy activation adopts an already-existing official teammate with the same name (including a spawn race), preventing `teammate name "arch" was already used in this Team` when creating a meeting.

## 0.6.3

- Meeting creation now lists current-project members as checkboxes (removed/blocked members excluded); the host is chosen from the selected participants.

## 0.6.2

- Entering architecture design now creates and starts an architecture review meeting with the product manager and architect, then opens the meeting.
- Architecture reviews use an architecture-document template; confirming the generated architecture document archives it, and it remains visible in the version board artifacts.
- Requirement clarification meeting output now immediately creates a version-linked draft requirement document, visible in the board; saving the requirement reuses that document instead of creating an invisible duplicate.

## 0.6.1

- Meeting dock now shows the status, title, host and type/goal on separate lines with a larger type scale.

## 0.6.0

- State is now workspace-scoped: the client sends the workspace path with every state/command request and the Host uses it as the state directory hint. Returning to chat and re-entering the plugin no longer switches to another session's empty state file.
- Default six members are created as configuration even before the team is bound (they activate lazily on first dispatch/meeting use).
- Meeting prompts now enforce: no code generation/edits, no workflow/config/task changes; discuss only the meeting topic and produce conclusions/minutes/files.
- Non-participants receive a "meeting in progress, do not start new work" system section; task dispatch is paused for non-participants while a meeting is active.
- Meeting dock rebuilt: separate colored "meeting in progress" line, title, host/type/goal lines, and working Back to board / Finish meeting buttons.

## 0.5.7

- Member creation is now configuration-only: no `spawnTeammate`, no initial prompt, no conversation or task at create time. This removes the busy/provisioning contention when creating roles or the default six members in quick succession.
- The official teammate (and its role prompt) is created lazily on the first assignment (startDevelopment/pump) or the first meeting participation (create/invite).
- Pending members are shown as "待派发 / Pending activation" until activated.
- Smoke assertions updated for lazy activation.

## 0.5.6

- Center the first-version empty state horizontally across the full board width.

## 0.5.5

- Clarification-meeting creation falls back to active members when no assignees are chosen, keeping the team lead as the meeting host instead of submitting an invalid empty participant list.
- Finalized 0.5.4 UX batch: centered first-version state, requirements red badge, create-and-meet, default members, persistent Settings sections, persistent errors, stable session choice, larger top-bar padding, adaptive task paging with a fixed five-row timeline.

## 0.5.4

- Friendly centered first-version empty state with guidance copy.
- Requirements tab shows a red badge until the first requirement exists.
- New requirement dialog gains "Create clarification meeting" (title + description required); the Host auto-creates/binds a version when needed, attaches uploaded files, and opens the meeting.
- Newly bound projects auto-create Luna/Kael/Zoe/Owen/Mia/Jasper once.
- Settings sections stay expanded across saves; only a fresh entry starts collapsed.
- Command errors persist until dismissed or the next successful command.
- Stabilized the workspace session choice so consecutive role/member commands cannot jump to another state file and raise REVISION_CONFLICT.
- Larger top-bar padding (6/12, 56px high).
- Adaptive active-task page size and a fixed five-row latest timeline at the bottom.

## 0.5.3

- Version Board tabs: 8px separation from the top bar, 44px tab strip, 14px labels with active weight/background.
- Section counts are now bracketed with an 8px gap from the title, e.g. 时间线 [2] / 团队负载 [4].
- Removed the non-functional timeline expand/collapse control; timeline shows a scrollable latest-20 history.
- Team-load rows use the Settings → Members column rhythm (name/role/tasks/status), fixed widths, right-aligned task counts and status tags.

## 0.5.2

- Fix dsh-fuse theme brand mismatch: brand.fuse.darkPrimary/darkSecondary now equal the dark theme primary/accent (#1E293B / #22C55E).
- Add 8px top breathing room to the Workbench panel.
- Folder opener now uses the base open-in-app HTTP surface (apps + open) with Remote and DOM fallbacks; path and icon sit together instead of being separated by a full-width spacer.
- Team-load status uses the same localized status helper as Settings (active/pending/missing/removed/blocked).
- Active-task section no longer stretches into a large empty well; it fits content with a capped scroll area.

## 0.5.1

- Fix the workspace folder opener: use the base client's `ctx.remote` (not `ctx.get('remote')`), check the Remote result, and render the base-style folder icon immediately after the path. If the Remote surface is unavailable, fall back to clicking the base "用文件资源管理器打开" control.

## 0.5.0

- Top bar reduced to language / Settings / back; workspace folder opener added via the base desktop opener.
- Requirements moved to their own tab (Version Board / Requirements / Meetings); meetings removed from the board; team load placed above artifacts; lists paginate newest-first with proportional section heights.
- Member roles are shown by role name everywhere; team-load status mirrors Settings (active/blocked).
- Requirement create accepts member multi-select (lead always involved); Host auto-generates task specs and routes work to selected members; create hides the spec editor (editable later).
- Requirement attachments: multi-file upload (txt/doc/docx/xls/xlsx/png/jpg/jpeg, ≤10MB), stored under the requirement and opened/deleted from the requirement dialog.
- Completed/archived versions are read-only at both Host and UI level (requirements, artifacts, capture, meetings).
- Requirement/meeting updates for finished versions return VERSION_READ_ONLY.

## 0.4.0

- Fix inputs losing focus: the modal focus effect is mount-only and focuses the first field, so the 3s state poll no longer steals the caret.
- Larger typography: body 13px, secondary 12px, tags 11px, controls 12–13px; row heights raised while staying within the density caps.
- Top bar restored to a two-line project context: workspace switcher follows “当前项目”; the line below shows “当前版本” with the version switcher and path.
- Top-right actions reduced to stage action + Settings; new-version/settings moved to the board version header; bottom tabs are now only Version Board / Meetings.
- Meeting empty state hugs its text instead of stretching to the full column height.
- Persistence hardening: retry transient Windows read locks, treat only ENOENT as missing state, auto-recover from the newest data-bearing backup, never rotate empty snapshots, keep 10 backups. Expirence005's v1.0.0 was restored from backup; full later flow data was not present in any backup.

## 0.3.2

P3/P4 UX review fixes: visible gate-gap strip, stage state labels/aria, disabled-state contrast, stage accent only on hover/focus, modal Esc/dialog semantics, finish-meeting consequence hint + busy feedback, project-scoped removal copy, mono role badges, no blurred shadows, dense list caps, one-time completion accent.

## 0.3.1

- zh_design_lint cleanup: token-derived color-mix for semantic backgrounds/overlay/shadow, 4px spacing/radius normalization, body line-height 1.6.
- design.tokens.json: declared font-size scale (10/11/12/13/14/16/20px) so dense typography stays on the token scale.

## 0.3.0

P1: Workbench layout & information density.

- Shell: single-row 44px top bar (project/path truncation, workspace + version selectors, language, new version, version settings, gate-aware stage action, meetings, settings); 32px segmented tabs.
- Board: one-line version header, compact 5-stage pipeline with inline gate details, row-based requirements (<=44px), attention strips with accent left bar, compact task table, collapsible timeline (3 rows).
- Side column: compact artifacts/team-load/meeting rows, 40% width with 1px divider; stacks under 1280px.
- Meetings: compact meeting list, single-row meeting header, transcript grouped into speaking rounds with quieter system messages; 40px meeting dock with subtle border.
- Settings: four collapsible sections (team / lead model / roles / members), compact role table with lead marker and reference counts, grouped members (active/blocked/missing/removed/unconfigured), 3-level model route picker, structured destructive confirmations.
- Tokens aligned to workspace design.tokens.json (dark Developer Tool palette: accent #22C55E); 4px spacing normalization.

## 0.2.0

UI workbench release — the right-sidebar tabs are replaced by a single left-rail entry.

### Entry & main panel
- `sidebar.panellist` entry **dsh-agent-team-planner** after Automation Tasks, atom+wrench SVG icon; the only entry.
- `main` workbench keyed `devteam`: top project/workspace bar, version select, stage pipeline, one-page board (requirements/tasks/attention queue, artifacts/team load/meeting shortcut, timeline).
- Removed all right-sidebar tabs.
- Workspace switcher with last-used workspace memory (`localStorage`) and session resolution per workspace; no public “current session” getter in DSH yet.
- Version dialogs now include **planned date / owner / notes**.

### Meetings
- Dedicated meetings page: create (type/version/participants/host), start, invite, ask member to speak, host document generation, save requirement draft, finish/cancel/close.
- `meeting.finish` generates a **meeting minutes artifact** (`meeting_minutes`) and closes the meeting.
- Meeting context banner in the base chat dock (`conversation.input.dock`): shows meeting title/type/goal/host with “Back to board” and “Finish meeting” actions.
- Host conversation reuse via `uiWorkspace.openSession`; return to the panel through the banner or the left-rail entry.

### i18n
- zh/en dictionaries (141 keys each) registered through `ctx.locale`; quick language toggle in the workbench top bar; Settings → General remains the durable preference.

### Tests
- New `test/client-sim.mjs`: fake ModuleLoader + React/locale/layout/slots stubs; asserts left-rail entry, main panel, meeting dock, i18n registration and absence of right-tab registrations (18 checks).

## 0.1.0

First public, usable release of the community plugin.

### Team configuration
- Workspace-scoped project team bound to one Team Session; rebind support with `interrupted` version marking and batch member rebuild.
- Role catalog: 7 built-in roles with editable prompts, custom roles, reference-protected deletion, "restore default prompt" and prompt sync to members that never customized theirs.
- Member management: create/edit/block/unblock/logical remove/restore/recreate; per-member model route (provider/model/reasoning effort) with cold-resume installation.
- Prompt sections injected by identity (Lead vs member) with the active version/stage context.

### Requirements, versions, workflow
- Requirement CRUD with auto-generated requirement documents; lead-assisted split (`workflow.requestLeadSplit`) and rule-based task-spec generation (`workflow.autoTaskSpecs`).
- Version CRUD, requirement binding, task-spec JSON editor, requirement→architecture→development gates.
- Activation creates dependency-aware official tasks, assigns and wakes members, persists activation records.
- Event-driven pump: development → Code Review → testing → completed, with artifact archiving.
- Review/test report auto-archive from the responsible member's latest reply (marker-aware, draft for confirmation).
- Force-complete with audited reason, version archive, interrupted-version rollback.

### Meetings & artifacts
- Version meetings (requirement clarification / architecture review / test review / custom): create, start/invite, speak, transcript capture (sequence-deduplicated), host-generated documents, save requirements from a meeting.
- Artifact capture via marker blocks; inline editing and confirmation of drafts.

### Robustness
- Serialized state store, atomic writes (unique temp + fsync + rename retry), backups rotation, state forward-migration.
- Structured error codes with actionable UI hints; long-op timeouts (240 s) and short-op timeouts (60 s).
- Browser-free smoke harness (12 scenarios) and independent PRD conformance/regression reports.
