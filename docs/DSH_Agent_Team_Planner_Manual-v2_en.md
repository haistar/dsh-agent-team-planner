# DSH Agent Team Planner — Complete User Manual

> **Applies to:** plugin `v0.9.1` (`DSH 0.2.1-rc.2`)  
> **Authors:** Alex, DeepSeek, Gemini, haistar  
> **Build date:** 12.11.2026  
> **Translator's note:** UI labels, status names, and example prompt strings are rendered in English; code, commands, file names, model names, and identifiers are kept exactly as in the original Russian manual. Where the original embeds a Russian instruction string, the English rendering is given with the Russian original noted.

---

## Table of Contents

- **Part 1: Basics and Workflow**
  - [Chapter 1. Core Philosophy: Why Doesn't the Team Lead Work Alone?](#ch1)
  - [Chapter 2. Version Lifecycle (The Pipeline)](#ch2)
  - [Chapter 3. User Interface (Where to Click)](#ch3)
  - [Chapter 4. Walkthrough Example (Mini-Project "To-Do List")](#ch4)
  - [Chapter 5. Theoretical Scenarios (What Happens If...)](#ch5)
  - [Chapter 6. Maintenance and Backups](#ch6)
- **Part 2: Installation, Architecture, and Updates**
  - [Chapter 7. Version Compatibility (What You Need to Know)](#ch7)
  - [Chapter 8. How to Install the Plugin from Scratch](#ch8)
  - [Chapter 9. How to Properly Restart DSH After Code Edits](#ch9)
  - [Chapter 10. How to Update from GitHub Without Losing Custom Edits](#ch10)
  - [Chapter 11. Troubleshooting: What to Do If the Plugin Fails to Load](#ch11)
- **Part 3: Advanced Role Configuration and Task Adaptation**
  - [Chapter 12. How Prompts Work and How to Make Agents Write in Russian](#ch12)
  - [Chapter 13. Adapting for Non-IT Tasks (CAD Drawings, Design, Copywriting)](#ch13)
  - [Chapter 14. Model Allocation (Smart Budget Management)](#ch14)
  - [Chapter 15. Token Limits and Fallback Models](#ch15)
  - [Chapter 16. How to Stop Agents from Writing Code (For Design & Content Projects)](#ch16)
- **Part 4: Permissions, Sandboxing, and Parallel Execution**
  - [Chapter 17. DSH Security Architecture: Why It's Not Just a "Sandbox"](#ch17)
  - [Chapter 18. Sandbox Modes](#ch18)
  - [Chapter 19. Approval Policies](#ch19)
  - [Chapter 20. File Isolation: Preventing Agents from Overwriting Each Other](#ch20)
  - [Chapter 21. Best Practices: Configuring Role Permissions](#ch21)
- **Part 5: Advanced Scenarios and Disaster Recovery**
  - [Chapter 22. Network Disconnection or API Provider Outage](#ch22)
  - [Chapter 23. Depleted API Balance or Token Rate Limits](#ch23)
  - [Chapter 24. Manual Rollback: Editing state.json (Time Machine)](#ch24)
  - [Chapter 25. Full Reset (The Nuclear Option)](#ch25)
- **Appendix**
  - [Appendix. Glossary of Companion Plugins](#appendix)

---

# Part 1: Basics and Workflow

<a id="ch1"></a>
## Chapter 1. Core Philosophy: Why Doesn't the Team Lead Work Alone?

The plugin is a dispatcher. It doesn't force the neural networks to chat — it creates the conditions for them to do so.

* **Team Lead (Lead)** — an ordinary agent that sits in the chat. If you simply write "build a project", it will do the whole thing itself, working solo.
* **Plugin** — an add-on that forcibly enables roles (Product, Architect, QA, etc.) and makes them communicate through **Meetings** and execute work through the **Task Board**.
* **You (Human)** — the director. You set goals, create meetings, review documents, and click **"Confirm"**.

---

<a id="ch2"></a>
## Chapter 2. Version Lifecycle (The Pipeline)

A project always moves along this chain:

`Requirements` ➡️ `Architecture` ➡️ `Development` ➡️ `Review` ➡️ `Testing` ➡️ `Done`

Each stage has a **Gate**. Until you satisfy the condition of that stage, the button for moving on to the next step stays disabled (greyed out).

1. **Requirements:** You need to create a meeting and confirm the requirements document.
2. **Architecture:** The Architect must hold a meeting and write the architecture document (you confirm it).
3. **Development:** The plugin creates tasks for the developers (for example, Zoe and Owen). You wait for them to be completed.
4. **Review & Tests:** The agents write reports. You review them and confirm.

---

<a id="ch3"></a>
## Chapter 3. User Interface (Where to Click)

* **Version Board:** The main screen. It shows the stages, active tasks, team workload (who is handling how many tasks), and **Artifacts** (documents). In the bottom right is the "Manual confirmations" block, where the buttons for confirming reports appear.
* **Requirements:** A list of ideas. From here you create new requirements and launch the first clarification meetings.
* **Meetings:** The negotiation room. Here you select participants, ask questions, and tell the facilitator to generate the final document.
* **Settings:** Here you bind the team, configure roles (prompts) and models, and delete versions (in the "Version settings" window).

---

<a id="ch4"></a>
## Chapter 4. Walkthrough Example (Mini-Project "To-Do List")

A step-by-step scenario for building a test project (To-Do List) to reinforce the workflow:

1. Create a **New version** `v0.2.0-todo`.
2. Go to the **Requirements** tab ➡️ click **+ New requirement**.
   - **Title:** `To-Do List`.
   - **Description:** `A web app for adding, deleting, and marking tasks as done. Design: minimalistic, an input field and an "Add" button.`
   - **Assignees:** Check a developer (for example, `Zoe`).
3. Click **"Create clarification meeting"**.
4. Go to the **Meetings** tab ➡️ click **"Start meeting"**.
5. Ask the assignee: *"What component structure do you propose?"* (wait for the answer).
6. Click **"Ask the facilitator to prepare the document"** ➡️ save the requirement.
7. Click **"Finish and create minutes"**.
8. Go to the **Version Board** ➡️ confirm the artifact (the requirements document).
9. Click **"Move to architecture"** ➡️ hold a meeting with the architect (for example, `Kael`) ➡️ finish it ➡️ confirm the architecture document.
10. Click **"Start development"** ➡️ wait for the developer to complete the task.
11. In the bottom right, click **"Confirm and move to review"**.
12. Wait for the reviewer's report (or enter it manually) ➡️ confirm it.
13. Wait for the QA testing reports (for example, `Mia`) ➡️ confirm them ➡️ **Version complete!**

---

<a id="ch5"></a>
## Chapter 5. Theoretical Scenarios (What Happens If...)

### 1. What if you click "Finish and create minutes" on an empty meeting?
**Result:** The meeting closes and the minutes are created, but they are empty. You will still have to create or edit the requirements document manually in order to pass the gate.

### 2. What if an agent returns the error `ARTIFACT_PARSE_FAILED`?
**Result:** The model forgot to insert the hidden markup markers. Click the generate button again. If that doesn't help, edit the artifact manually — the plugin only cares about the text inside.

### 3. What if a task has been "In progress" for 20 minutes?
**Result:** The agent is stuck or has gone into a loop. Check the left panel: if a yellow "Waiting for reply" dot is lit there, open the chat and answer the agent's question. If there is no dot, open its chat and write: *"Finish the task and report back"*. Alternatively, force it through by clicking "Confirm development".

### 4. How do you delete a version?
**Result:** Only versions with the `draft` status can be deleted. Go to **Version settings** (the button next to the name) ➡️ click **"Delete"** in the bottom-left corner of the window. Versions with the `active` or `completed` status cannot be deleted — they can only be archived.

### 5. What if you unlink a requirement from a version?
**Result:** The requirement returns to the general list and the "Delete" button becomes available again. However, all documents that were created for it within that version remain in the version's artifacts.

### 6. What does "High Efficiency Mode" do?
**Result:** If the option is enabled in the settings, agents execute tasks only outside working hours (Beijing time `UTC+8`: at night and on weekends). During the day, tasks stay in the "Waiting" status.

> **Note on time zones:** High Efficiency Mode is tuned for the Chinese market and the load pattern of DeepSeek servers. If you are in a different time zone, you will have to recalculate the trigger window (for example, for Moscow `UTC+3`, Beijing's off-hours fall in the evening, night, and early morning). In future plugin versions this logic can be adjusted in the `index.js` file if needed.

---

<a id="ch6"></a>
## Chapter 6. Maintenance and Backups

* The hidden `.dsh_teams` folder is located in the project root directory. Inside it lies the file `planner/state.json`.
* Never delete this folder if you want to keep the history of versions, meetings, and artifacts.
* To protect against data loss, regularly copy the `.dsh_teams` folder to backup storage.
* When updating the plugin from GitHub, local code modifications (for example, custom buttons in `lib/client.js`) may be overwritten. Always keep changed files separately or use Git branches.

---

# Part 2: Installation, Architecture, and Updates

<a id="ch7"></a>
## Chapter 7. Version Compatibility (What You Need to Know)

The plugin does not work as a standalone program — it is an add-on over the DeepSeek Harness (DSH) core.

* **DSH version:** Plugin `v0.9.1` targets DSH core `0.2.1-rc.2` and above (up to `0.3.0`). When DSH is updated to the global `0.3.0` release, the plugin may lose compatibility until a matching patch is released.
* **Environment:** **Node.js 20+** must be installed.
* **Profile:** The experimental **Agent Teams** profile must be enabled in the DSH settings — without it the plugin will not see the list of team members.

---

<a id="ch8"></a>
## Chapter 8. How to Install the Plugin from Scratch

The plugin is not loaded automatically from an external registry — it must be placed locally on disk and linked to DSH.

### Option A: Automatic (the bundled script)
The `scripts` folder in the plugin repository root contains the `install-manual.ps1` script. When run, it performs all steps automatically:
1. Creates a backup of the DSH profile configuration (usually the `web` folder).
2. Adds the plugin as a dependency via `link:`.
3. Registers it in the DSH build system.

### Option B: Manual (via `cordis.patch.yml`)
DSH uses a plugin configuration file (a manifest). The plugin adds the following block from `cordis.patch.yml` to it:

```yaml
- insert:
    - id: agent-team-planner
      name: dsh-agent-team-planner
```

This entry tells the DSH core to load `dsh-agent-team-planner` at startup. If you rename the plugin folder, you must update the name in the manifest, otherwise DSH will not be able to find it.

---

<a id="ch9"></a>
## Chapter 9. How to Properly Restart DSH After Code Edits

The plugin is split into two independent parts:
* **Backend (`lib/index.js`):** Runs on the Node.js server side.
* **Frontend (`lib/client.js`):** Executes in the browser window.

**Rules for applying changes:**
1. **If `lib/client.js` (the interface) was changed:** There is no need to restart the DSH server. A hard page reload in the browser with `Ctrl + F5` is enough to clear the cache of `.js` files.
2. **If `lib/index.js` (server logic) was changed:** You must fully stop the DSH process in the terminal and start it again so that Node.js re-reads the files.

---

<a id="ch10"></a>
## Chapter 10. How to Update from GitHub Without Losing Custom Edits

If you have made local edits to the plugin code, the `git pull` command can cause a conflict or overwrite your changes.

### Method 1: Manual transfer
1. Copy the modified `lib/client.js` into a separate backup folder.
2. In the terminal, run:
   ```bash
   git pull origin main
   ```
3. Open the saved file and manually port your tweaks into the updated code.

### Method 2: Working through a separate Git branch (recommended)
Create your own branch for local tweaks:

```bash
git checkout -b my-custom-features
```

Commit your changes in this branch. When you need to pull updates from the main repository, run:

```bash
git checkout main
git pull
git checkout my-custom-features
git rebase main
```

---

<a id="ch11"></a>
## Chapter 11. Troubleshooting: What to Do If the Plugin Fails to Load

If, after restarting DSH, the plugin icon has disappeared from the left panel:

1. **Check the DSH terminal logs.** Red messages mentioning `agent-team-planner` indicate an initialization error (for example, a syntax error after manual edits).
2. **Check the `client.js` syntax.** Make sure no closing brackets or commas are missing.
3. **Check the plugin status in the UI.** Open the DSH profile settings (plugins menu) and make sure the `dsh-agent-team-planner` toggle is set to **"Enabled"**.
4. **Check the core version.** Make sure the DSH version meets the compatibility requirements from Chapter 7.

---

# Part 3: Advanced Role Configuration and Task Adaptation

<a id="ch12"></a>
## Chapter 12. How Prompts Work and How to Make Agents Write in Russian

The plugin uses a three-level prompt system (from general rules to specific ones):

1. **Role:** The base specialization (for example, "Product" contains instructions for gathering requirements and acceptance criteria).
2. **Member Prompt:** Individual instructions for a specific agent (for example, you can tell one product agent "answer concisely" and another "go into detail").
3. **Custom Prompt:** Additional rules for the project or team.

> **Localization tip:** To make agents always converse and format documents in Russian, open **Settings** ➡️ **Roles & Prompts**, select the desired role, and append the following line to the end of the base prompt:  
> *"IMPORTANT: Communicate, think, and write all documents strictly in Russian."*  
> (Original Russian string to paste into a Russian-language prompt: *«ВАЖНО: Общайся, думай и пиши все документы строго на русском языке»*.)  
> After that, click **"Apply prompt to members"**.

---

<a id="ch13"></a>
## Chapter 13. Adapting for Non-IT Tasks (CAD Drawings, Design, Copywriting)

The plugin's architecture is universal: the "Architecture" and "Development" stages work for any structured task.

### Example: configuring a team for engineering drawings (CAD / 3D):
1. Go to **Settings** ➡️ **Roles & Prompts** ➡️ click **+ New role**.
2. Create specialized roles:
   - **Chief Engineer:** *"You design technical systems. Your job is to calculate loads, select materials, and compile a bill of materials."*
   - **Draftsman:** *"You create drawings in SVG format or generate Python code for the CadQuery / FreeCAD libraries."*
   - **Inspector:** *"You check drawings and specifications for compliance with GOST standards and safety requirements."*
3. Since language models do not generate binary `.dwg` files directly, phrase requirements through text formats: *"Create a part drawing as an SVG file"* or *"Write a Python script to generate a 3D model"*.
4. Create members in the **Settings** ➡️ **Members** tab and assign the new roles to them.

---

<a id="ch14"></a>
## Chapter 14. Model Allocation (Smart Budget Management)

Assigning different language models to specific roles lets you optimize both budget and speed:

* **Architect / Chief Engineer:** Requires deep analysis and risk assessment. Reasoning models are optimal (for example, `DeepSeek-R1` or higher `Pro` tiers).
* **Frontend / Backend / Draftsman:** Standard general-purpose models (`DeepSeek-V4` / `DeepSeek-Chat`) are a good fit, balancing cost and code-generation quality.
* **QA / Tester / Reviewer:** Faster and more economical models (for example, `Flash` or `Lite` versions) suit checklist-based verification.

**How to assign a model:**
1. Open **Settings** ➡️ **Members** and click **"Edit"** next to the agent you want.
2. In the **"Model route"** block, select the provider and the specific model.
3. Click **"Save"**. The new model takes effect the next time the agent is launched.

---

<a id="ch15"></a>
## Chapter 15. Token Limits and Fallback Models

The `Agent Team Planner` plugin acts only as a task dispatcher — it passes the DSH core a command to launch a particular agent with the selected model, but does not manage token limits directly.

* **Token limits:** Configured globally at the DSH core level (in the provider configuration or through `.env` environment variables). There you can set the maximum response length (`max_tokens`) so that agents don't waste extra budget.
* **Fallback models:** Switching between providers when an API fails is configured in DSH's own routing. Inside the plugin you can reduce the risk of downtime simply by assigning models from different providers to different team members.

---

<a id="ch16"></a>
## Chapter 16. How to Stop Agents from Writing Code (For Design & Content Projects)

When working on texts, documentation, or design concepts, agents may by default try to create project files or install packages. To avoid this:

1. Open **Settings** ➡️ **Roles & Prompts** ➡️ **Team Lead**.
2. In the base prompt, replace the block about development with a hard restriction:  
   *"WRITING PROGRAM CODE AND RUNNING CONSOLE COMMANDS IS FORBIDDEN. Your job is to coordinate the preparation of text and design materials. Phrase tasks in the format: 'Write chapter 1', 'Prepare the layout structure'."*
3. In the text of the requirements themselves, explicitly state the expected output format (for example: *"Do not write code. The final artifact is a Markdown document."*).

---

# Part 4: Permissions, Sandboxing, and Parallel Execution

<a id="ch17"></a>
## Chapter 17. DSH Security Architecture: Why It's Not Just a "Sandbox"

Security of operation execution in DSH rests on three independent levels:

1. **Sandbox Mode:** Defines the boundaries of an agent's access to the file system.
2. **Approval Policy:** Governs the cases in which an agent must request the user's permission before executing a command.
3. **Workspace isolation:** Defines the rules for shared access by several agents to the same directories.

---

<a id="ch18"></a>
## Chapter 18. Sandbox Modes

DSH supports three main file-system modes:

* **`read-only`:** Forbids any modification of files. Suitable for analysts, reviewers, and testers who only need to study code or documentation.
* **`workspace-write`:** Allows creating and modifying files strictly inside the current project directory. Going outside the workspace folder is blocked. The recommended default mode for developers and architects.
* **`danger-full-access`:** Fully disables sandbox restrictions. The agent gains access to the entire file system and to system commands. Use only in a trusted environment when installing global dependencies is required.

> **Note for Windows:** In a Windows environment, the OS-level `read-only` mode has technical limitations and does not always guarantee a complete write block when child processes are launched. Do not rely on it as the sole protection for critical system files.

---

<a id="ch19"></a>
## Chapter 19. Approval Policies

Approval policies define how autonomous agents are when performing potentially dangerous actions (for example, running scripts in the terminal):

* **`ask`:** Before executing a command, the agent pauses its work and waits for manual confirmation from the user in the DSH interface.
* **`never`:** The agent does not request confirmation from the user. Depending on the DSH configuration, this either allows automatic execution of actions within the sandbox or automatically rejects operations that require elevated privileges.

In practice, the combination of `workspace-write` + `ask` provides the optimal balance between speed of work and security control.

---

<a id="ch20"></a>
## Chapter 20. File Isolation: Preventing Agents from Overwriting Each Other

When two developers (for example, `Zoe` and `Owen`) edit files in the same project folder in parallel, a race condition and mutual overwriting of changes can occur.

### Built-in DSH mechanism
The standard *Agent Teams* framework uses a shared working directory for all members. To separate them, **write scopes** are used — textual recommendations in prompts about which files each agent is responsible for. Since these are soft constraints, conflicts are still possible when shared modules are edited simultaneously.

### Ways to solve the problem
1. **Manual splitting of tasks and directories (the basic method):** At the task-assignment stage, explicitly assign each agent isolated files or subfolders (for example, one is responsible only for `src/components/`, the second for `src/utils/`).
2. **Using lock or branching plugins:** In the DSH ecosystem, specialized extensions for file-level locking (`dsh-file-claim`) or isolation via `git worktree` (`dsh-plugin-worktrees`) are used for this task, allowing agents' work to be spread across different working copies with subsequent branch merging *(see the Appendix)*.

---

<a id="ch21"></a>
## Chapter 21. Best Practices: Configuring Role Permissions

Recommended access-permission matrix for a typical team:

| Agent role | Sandbox mode | Approval policy | Rationale |
| :--- | :--- | :--- | :--- |
| **Tester (QA)** | `read-only` | `ask` | Reads code and checks logic; no need to write to project files. |
| **Reviewer (Code Review)** | `read-only` | `ask` | Analyzes changes without the right to edit them directly. |
| **Architect** | `workspace-write` | `ask` | Creates and updates project documentation in the workspace folder. |
| **Developer** | `workspace-write` | `ask` | Writes code strictly within the project directory under user control. |
| **DevOps / Engineer** | `danger-full-access` | `ask` | May need access to system utilities, but `ask` is mandatory for controlling commands. |

Permissions can be configured in the DSH profile settings or via the `/permission` command in the interface. Avoid assigning `danger-full-access` to all members by default.

---

# Part 5: Advanced Scenarios and Disaster Recovery

<a id="ch22"></a>
## Chapter 22. Network Disconnection or API Provider Outage

If the internet connection drops or the API servers are temporarily unavailable, tasks in the interface may hang in the `in_progress` status and network errors will appear in the logs.

**Procedure:**
1. **Stay calm:** The planner saves all states and artifacts locally on disk — the data will not be lost.
2. Wait for the connection to be restored or for the API to stabilize.
3. Refresh the plugin page (`F5`).
4. If the agent has not resumed work automatically, open its personal chat and send the message: *"Continue the current task"*.
5. If the task is completely stuck but most of the work is already done, you can force-close the stage with the **"Confirm"** button in the manual confirmations block.

---

<a id="ch23"></a>
## Chapter 23. Depleted API Balance or Token Rate Limits

When the funds in the provider balance are exhausted or the request limit is reached, the DSH logs will show `429 Too Many Requests` or `Insufficient Balance` errors.

**Procedure:**
1. Top up the balance in the provider's personal account (or wait for the request limit to reset).
2. Restarting the DSH server is not required — return to the **Version Board**.
3. Open the chat of the stopped agent and write: *"Balance topped up, continue working"*.
4. If the task remains blocked, close the stage manually via the confirmation button and move the pipeline on to the next step.
5. **Check the operating mode:** If tasks are not starting but there are no API errors in the logs, make sure "High Efficiency Mode" is not enabled, which holds tasks until nighttime Beijing time (see Chapter 5).

---

<a id="ch24"></a>
## Chapter 24. Manual Rollback: Editing state.json (Time Machine)

The plugin automatically creates state snapshots after every significant action. If you need to undo a mistaken action (for example, an accidentally confirmed empty artifact), you can perform a rollback manually.

**File locations:**
* Current state: `[Project_Folder]/.dsh_teams/planner/state.json`
* Backups: `[Project_Folder]/.dsh_teams/planner/backups/` (the last 10 snapshots of the form `state-17123456789.json` are stored).

**Step-by-step rollback instructions:**
1. **Fully close DSH** so that the server does not overwrite the file while you are editing.
2. Make a backup copy of the current `state.json` file in a separate folder.
3. In the `backups` folder, find the file with a timestamp from before the error occurred.
4. Copy the selected file into the `planner/` directory and rename it to `state.json` (replacing the existing one).
5. Open the new `state.json` in a text editor, find the `"revision": X` parameter at the very beginning, and **increase this number by 1** (for example, replace `"revision": 12` with `"revision": 13`). This is necessary so that the frontend recognizes the data update.
6. Start DSH.

> ⚠️ **JSON syntax warning:** Be extremely careful when editing the file. The JSON format does not forgive syntax errors (extra or missing commas, quotes, brackets). If after startup the plugin reports a state read error (`STATE_CORRUPT`), the file structure has been broken — close DSH and restore the original `state.json` from your backup copy.

---

<a id="ch25"></a>
## Chapter 25. Full Reset (The Nuclear Option)

If the project has accumulated too many duplicate requirements or stuck states and it is easier to start planning from a clean slate:

1. Fully close DSH.
2. Delete the `.dsh_teams` folder in the project root (or rename it to `.dsh_teams_backup` for archiving).
3. Start DSH again. The plugin will automatically initialize a clean version board.

*(Note: all source code written by agents in the project's working directories remains untouched — only the planner's own history of tasks, meetings, and artifacts is deleted.)*

---

<a id="appendix"></a>
# Appendix

## Appendix. Glossary of Companion Plugins

Below are the tools and extensions of the **DeepSeek Harness (DSH)** ecosystem that complement the work of `dsh-agent-team-planner`:

* **`dsh-agent-teams`** — the base framework for team work in DSH. It provides creation of agent profiles, role assignment, and message exchange between them. It is a required foundation for the planner to work.
* **`dsh-agent-team-gui`** — a visual interface for managing agent teams. Lets you clearly track member statuses and interact with them through a graphical panel.
* **`dsh-file-claim`** — an extension for coordinating file access when several agents work in parallel. It introduces a pre-locking mechanism (a "claim" on a file), preventing code from being overwritten when two developers work simultaneously.
* **`dsh-plugin-worktrees`** — a workspace isolation tool based on `git worktree`. It allocates a separate physical directory and Git branch to each parallel task, eliminating file conflicts until the stage where changes are merged.

> **Note:** The plugins `dsh-file-claim` and `dsh-plugin-worktrees` are given as conceptual architectural solutions of the ecosystem. Before installing, check their availability and current names in the official DSH plugin manager or on GitHub. If suitable packages are absent from the registry, use the manual method of splitting files and directories between agents (see Chapter 20).
