# Contributing

Thanks for considering a contribution.

## Ground rules

- **Do not fork or patch the official Agent Teams implementation.** This plugin is a planning layer that consumes Host services (`ctx.agentTeams`, `ctx.agents`, `ctx.systemPrompt`, `ctx.connection`, `ctx.sessionController`) and the official client slot/sidebar APIs.
- **No model tools.** All state changes go through the two Host routes (`/api/atplanner.state`, `/api/atplanner.command`); the browser must not write files or fabricate session/team events.
- Keep the Host half dependency-free at runtime: `@deepseek-ai/*` modules are resolved from the Host installation.

## Development

```powershell
node --check lib/index.js
node --check lib/client.js
npm test
```

`test/smoke.mjs` is a browser-free harness: it loads the Host half with a fake cordis ctx and an in-memory official Agent Teams service, then exercises the main flow (team → members → requirements/versions → activation → pump → meetings → artifacts). Extend it when you add a workflow op.

## Pull requests

- Describe the user-visible change and the PRD section it implements.
- Add or update a smoke scenario for behavioral changes.
- Keep changes small and scoped; avoid reformatting unrelated code.
- Update `CHANGELOG.md` and, when behavior changes, `README.md` / `docs/`.

## Reporting issues

Please include: DSH version, OS, the plugin version, the failing `op`, and the JSON returned by the sidebar's “最近命令” panel.
