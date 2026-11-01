# Upgrading DSH Agent Team Planner

This project is distributed from GitHub only. There is **no npm package and no built-in auto-updater**: the installer links/copies the plugin into a DSH Web profile, so upgrading means updating the checkout, re-running the installer, and restarting DSH Web.

## Before you upgrade

1. Stop long-running meetings/tasks or let them finish.
2. Back up the workspace planner state if it matters:
   - Windows: `%USERPROFILE%\.dsh\...` is not the state location for a normal workspace.
   - The planner state lives in the **workspace** at `.dsh_teams/planner/state.json`, with backups in `.dsh_teams/planner/backups/`.
3. If you edited the plugin locally, commit or stash those changes first. `git pull --ff-only` will refuse to overwrite conflicting local changes.

## Standard upgrade

```powershell
# 1. enter the existing checkout
cd <path-to>\dsh-agent-team-planner

# 2. update source
git fetch --tags
git pull --ff-only

# 3. reinstall into the default DSH web profile
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-manual.ps1

# 4. restart DSH Web
```

Then hard-refresh the browser tab (Ctrl+F5 / Cmd+Shift+R) so the client bundle is reloaded.

The installer:

- backs up the profile manifest to `package.json.atplanner-backup`;
- updates the `link:` dependency and the bundle list;
- replaces the plugin files under the profile's `node_modules`;
- leaves the workspace planner state untouched.

## Custom profile path

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-manual.ps1 `
  -ProfileDir "C:\Users\<you>\.dsh\profiles\<profile>"
```

## Upgrade behavior and data

- Planner state is forward-migrated on read (`schemaVersion` remains 1; missing fields get defaults).
- Existing versions, requirements, artifacts, meetings and attachments are preserved because they live in the workspace, not in the plugin directory.
- State writes remain atomic and revision-checked. A data-bearing backup is kept in `.dsh_teams/planner/backups/`.
- If you upgrade from a build older than 0.6.0, state may previously have been written relative to a different session path. Keep the old `.dsh_teams/planner` directory and open the workspace once; the plugin uses the workspace path for new reads/writes.
- Russian UI and document-language support are client/Host code changes; no manual state migration is required.

## Rollback

```powershell
git checkout v0.8.5
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-manual.ps1
# restart DSH Web
```

Rollback restores code only. Keep the state backup if you need to inspect data written by a newer build.

## Why there is no auto-update

The plugin is loaded by DSH Web from a local profile. Automatically replacing files while DSH is running could mix Host and client versions, so the supported path is explicit: update checkout → reinstall → restart. A future release may add a version-check indicator, but it will not silently update.

## Verify an upgrade

1. Restart DSH Web and reopen the workbench.
2. Check Settings → about/version (or the plugin's GitHub release tag) matches the checkout.
3. Open a version with existing requirements/artifacts and confirm data is present.
4. Switch DSH language between 中文 / English / Русский and confirm the workbench title and UI follow.
5. Run the repository tests locally if you need a smoke check:

```powershell
npm run check
npm test
```
