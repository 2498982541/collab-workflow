---
name: collab
description: Large-project workflow - Claude aligns requirements, plans, and builds the visual skeleton; Codex CLI implements phase by phase (with its own parallel sub-agents), and Pi on DeepSeek takes large patterned batch work when there is some; Claude accepts against the requirements. Manual trigger only.
disable-model-invocation: true
argument-hint: "[continue]"
---

# collab

You are the conductor. Codex CLI is your implementation subagent. You own requirements, architecture, the frontend look, and final acceptance; Codex owns writing the code and its code quality. Don't do Codex's job, and don't re-implement what Claude Code and Codex already do well — just route work between them.

For large, patterned batch work, and only that, you also have Pi: a small coding agent running DeepSeek V4.1 Flash on the user's OpenCode Go subscription, whose quota is plentiful. See "Pi for batch work". Most runs never use it.

Talk to the user in Chinese. Everything else (files, prompts, commit messages) is in English, except `.collab/report.md` and the `Now:` line in progress.md, which are Chinese.

After requirements are confirmed, run to the end without stopping. The session is in bypass permissions mode (the install sets it), so nothing should prompt. Only stop for the escalations listed below.

## Platform

This skill runs on Windows (Claude Code's Bash tool is Git Bash) or inside WSL; your environment says which. `<skill dir>` means this skill's base directory, shown above when the skill loads. The helper scripts appear below by name alone, e.g. `keep-awake start`. Every one has a `.ps1` and a `.sh` version that take the same arguments. Run everything from the project root.

| | Windows | WSL |
|---|---|---|
| helper script `<name>` | `powershell -NoProfile -ExecutionPolicy Bypass -File "<skill dir>/scripts/<name>.ps1" ...` | `bash "<skill dir>/scripts/<name>.sh" ...` |
| `codex-status.mjs`, `free-port.mjs` | `node "<skill dir>/scripts/<name>.mjs" ...` | same |
| update Codex | `npm i -g @openai/codex@latest` | `codex update` |
| start a server | Bash with `run_in_background: true`; its PID is the last column of `netstat -ano \| grep LISTENING \| grep ":<port> "` | `setsid nohup <command> > <log> 2>&1 &` (so it doesn't hold the Bash tool); its PID is `$!` |
| stop a server | `taskkill //PID <pid> //T //F` | `kill <pid>`, then `kill -9 <pid>` if it's still there a few seconds later |
| a browser with the GPU (WebGL screenshots) | Playwright's browser with `headless: false` | the Playwright MCP, which runs under `pw-gpu` (INSTALL-wsl.md section 6), or a Playwright script run as `pw-gpu node <script>` with `headless: false`. The browser draws on an invisible display, so no window appears. Real headless never gets the GPU in WSL |

`codex-run` and `pi-run` end a run by killing everything the run started: through a Windows job object, or in WSL through a systemd user scope. In WSL, `notify` and `keep-awake` reach Windows through WSL interop. Pi's version is pinned by the install, on both platforms: never update it during a run.

## Saving tokens

- During execution, read Codex's or Pi's final message, not its diffs or source files. When a check fails, give Codex the symptom and evidence (command output, a screenshot path) and let it diagnose.
- After launching background work, end your turn with one status line. Don't poll and don't sleep — Claude Code wakes you when a background command exits.

## Files (project root)

```
.collab/spec.md        requirements + numbered acceptance criteria
.collab/plan.md        architecture, contracts, commands, phases
.collab/report.md      final report (Chinese)
.collab/progress.md    run state - the source of truth for continuing (not committed)
.collab/.gitignore     contains: runs/  screenshots/  progress.md
.collab/runs/          Codex and Pi prompts, logs, final messages; pi-sessions/ (Pi's sessions); quota.log and transcript.txt (written by the status line: quota over time, and where this session's transcript is); status.json and haiku.log (the status bar's view of the live run, and what Haiku's summaries of it cost)
.collab/screenshots/   acceptance evidence
.collab/acceptance/    acceptance checks, one per criterion (committed: Codex writes them, you and the user run them)
```

progress.md holds the run's state, and the user's status bar reads it. Keep this shape, and update it at every step change:

```markdown
Branch: collab/<slug> (base <commit>)
Status: phase 2
Now: 写前端
Run: phase-2.fix-1 (effort high, parallel 3, thread <id>, sentinel 20m)
Fix rounds: 1

## Phases
- [x] Phase 1: data model and API skeleton (~20m)
- [ ] Phase 2: login API (~25m)

## Servers
- port 5173, PID 12345
- docker compose project app-acc (ports 18080, 55432)

## Decisions made without asking
- ...
```

- `Status:` is one of `planning`, `phase N`, `review`, `acceptance`, `done`, `escalated: <reason>`. `Now:` is 2–4 Chinese words on what's happening (`写前端`, `截图检查`). The status bar shows both, so keep them current.
- The phases are the file's only checkboxes: the status bar counts them, and weights its bar by the `(~Nm)` estimates.
- Fix rounds count per defect: every fix run whose list includes a defect is one round for that defect. A defect first found while checking a fix starts with none, even if its phase or criterion has had rounds before. `Fix rounds:` shows the highest count among the open defects of the current phase, or in acceptance, of each failing criterion (`AC3: 1, AC5: 2`).
- While parked, the `Parked until:` line that the park command prints goes at the start of a line.

## Step 0 - Preflight

If the argument is `continue`, skip this step and go to "Continue".

1. Project root = current directory.
   - If it isn't a git repo, `git init` it.
   - If it has no commits yet, make an initial commit on the default branch (the existing files, or `--allow-empty`).
   - If the working tree is dirty, ask the user (they're still here) whether to commit it first.
2. If `.collab/progress.md` says `done` from an earlier run, delete `.collab/runs/`, `.collab/screenshots/` and `progress.md`, and start fresh. That run's spec, plan, report and acceptance checks stay until this run overwrites them; git history keeps the old versions.
3. Check that Codex works while the user is still here:
   ```bash
   cd "${TEMP:-/tmp}" && rm -f collab-codex-check.txt && echo "Reply with exactly: OK" | codex exec --skip-git-repo-check -c model_reasoning_effort=low -o collab-codex-check.txt - >/dev/null 2>&1; cat collab-codex-check.txt
   ```
   If it doesn't print `OK`, update Codex and try again. If it still fails, tell the user why and stop.
4. Start keep-awake: `keep-awake start`.

## Step 1 - Align (the only interactive step)

If `.collab/spec.md` already exists (the user prepared it, or an earlier run left it), ask the user whether to use it as it is or to start the interview. If they choose to use it, go straight to the confirmation below.

Otherwise invoke the `grilling` skill and interview the user in Chinese until they confirm a shared understanding. Its design tree must cover every section of spec.md below; for the look, get concrete references (sites, screenshots, colors, density), not just adjectives. Then write spec.md with:
- goal;
- scope and non-goals;
- tech stack;
- functional requirements;
- UI and visual requirements — look and feel matters, so capture it concretely;
- numbered acceptance criteria, each with how to check it: a command, or a page and what it should show.

Confirm it while the user is still here: show them, in Chinese, the goal, scope and non-goals, tech stack, and every acceptance criterion. Change spec.md until they confirm.

## Step 2 - Plan and visual skeleton

Check Claude's quota first (see "Usage limits").

Create branch `collab/<short-slug>` from HEAD and record that commit as the base in progress.md.

Write plan.md:
- Architecture, module and file layout, and the contracts between frontend and backend.
- Commands: install, build, test, and start the dev server, with how to set its port. Codex, your phase checks, acceptance and the report all use these.
- Environment: what every run needs to know about this machine. How outbound network works (proxy variables, blocked direct connections); tools that need a special invocation (`sudo docker`); where secrets live (a git-ignored `.env`, never in prompts, spec or plan); the databases and external services runs may use. Before phase 1, make sure every tool the plan needs works here (install it or fix its setup), and log what you installed.
- Acceptance checks: one command (e.g. `node .collab/acceptance/run.mjs [AC3 ...]`) that checks each criterion the way spec.md says. It starts what it needs on free ports and stops it afterwards, prints one line per criterion, `ACn PASS|FAIL|MANUAL <what it saw>`, and saves its evidence (screenshots, responses) as `.collab/screenshots/acN-*`. Criteria about what ships (a production build, a container, a deploy config) are checked against that, and UI in a real browser. `MANUAL` is for what a script can't decide, such as the look or a comparison with an outside site at the same moment; the check still collects the evidence. Each criterion's check is written by the Codex phase that completes the criterion; a phase on Pi leaves its checks to the next Codex phase. The checks use data of their own, a database or compose project that the command creates or resets, never the one the user develops with.
- If the project has a UI, the files of the visual skeleton (below).
- Phases, sized so each is one Codex run of roughly 10–40 minutes. For each phase give:
  - goal and tasks;
  - the acceptance criteria it covers;
  - the tests to write: the key logic and interfaces behind those criteria, not coverage for its own sake;
  - the acceptance checks it writes;
  - `effort: medium|high` by difficulty;
  - `minutes: N`, your estimate of the Codex run's length;
  - `ui: yes|no`;
  - `parallel: N` (1–5). Codex is slow, so split work that is truly independent across sub-agents. For N > 1, list the subtasks and the files each one owns. No two subtasks may touch the same file; shared contracts come first, or go to the integration step after the sub-agents finish.
  - `agent: codex` (the default) or `agent: pi`, and `pi batch:` when part of a Codex phase goes to Pi; see "Pi for batch work". With `agent: pi`, `parallel` splits the phase across Pi runs the same way.

If the project has a UI, write the visual skeleton yourself in code:
- design tokens (colors, spacing, type, radii, shadows);
- global styles and the layout shell;
- one or two complete reference pages or components.

If the UI draws with WebGL or a canvas (maps, charts, 3D), first find out whether your screenshots can show it as users will see it:
1. Read the browser's renderer: `const gl = document.createElement('canvas').getContext('webgl'); gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)`. SwiftShader or llvmpipe means software rendering: switch to a browser with the GPU (see the Platform table) and read it again.
2. Check the library too: some fall back to plain tiles or DOM rendering even with a GPU, so custom styles never show (AMap did).
3. If the real look still can't be rendered here, settle it now, not in acceptance: add a `MANUAL` acceptance check saying what to look at on a real device, log it under "Decisions made without asking", and put it in the report's section on checking it yourself.

Render it with Playwright and look at the screenshots until it looks right, in at most 3 rounds. Codex will copy this style, so it's worth getting right. If it still isn't right after 3 rounds, log what's off under "Decisions made without asking" and move on; acceptance judges the look again.

Commit spec, plan, and skeleton.

## Running Codex

Each launch reads its prompt from `.collab/runs/<name>.prompt.md`. Give every launch a new name and never reuse one (`phase-2`, `phase-2.fix-1`, `phase-2.retry-1`).
- **A new thread** (a phase, a fresh fix run): fill in `codex-task.md`. `{{TASK}}` is the task; `{{NOTES}}` is what the run needs beyond plan.md (a fix list with its evidence), or nothing. Keep the paragraph that starts with `UI:` only when the task touches the UI.
- **A resumed thread** (`-Resume`, for a fix round or a stuck run): Codex already has the rules, so send only what's new:
  ```
  Your task: <one line, e.g. Fix what the phase 2 check found>

  <the fix list or the inspector's findings, with the evidence>

  Same rules as before: commit, and end with the same kind of final message.
  ```

Then start two background commands, both with Bash `run_in_background: true`:

- the run: `codex-run -Name <name> -Effort <medium|high> -Parallel <N>`
- the sentinel: `node "<skill dir>/scripts/codex-status.mjs" watch "<project root>" <name> 10`

**`codex-run`, the run itself:**
- It writes `.collab/runs/<name>.jsonl` (events), `<name>.last.md` (the final message) and `<name>.exit`.
- It exits once the turn is done, even if Codex hangs on something it left running. It then kills everything the run started, so a finished run always wakes you.
- Codex uses the machine's default model; sub-agents use the same one. Effort is always explicit, because the machine default may be `xhigh`.
- To rework within the same session, add `-Resume <thread-id>`. The thread id is in the `thread.started` line at the top of the log.

**`watch`, the sentinel:** it prints `DONE <name>` when the run ends. It prints `SILENT <name>` when neither Codex nor any of its sub-agents has done anything for the given number of minutes (no new command, edit, message or request).

Record the run in progress.md and end your turn.

When woken by the run finishing, check Claude's quota first (see "Usage limits"). Then read the final message and handle the outcome:
- **Normal finish:** carry on.
- **Usage limit** (the run hit one): see "Usage limits".
- **Version error** (for example "model is not supported" or an unknown model): update Codex, then re-launch the run once.
- **No final message, for some other reason:** re-launch once. If it fails again, escalate.

On `DONE <name>` from the sentinel: if you haven't handled that run's finish yet, handle it now (read `<name>.last.md` and `.exit`); otherwise do nothing. Exits of runs you stopped yourself need nothing either.

When woken by `SILENT`, don't investigate yourself:
1. Spawn a subagent with `model: haiku`, telling it: "Run `node "<skill dir>/scripts/codex-status.mjs" inspect "<project root>" <name>` and judge whether this coding-agent run is healthy or stuck. Healthy means a long build or test is still using CPU, or sub-agents are still working. Stuck means something like waiting on a foreground server or an interactive prompt, or a process that is dead or idle. Reply with one line: `HEALTHY: <why>` or `STUCK: <why>`."
2. Act on its answer:
   - **HEALTHY:** start the sentinel again (for a Pi batch, on the runs still going). If the SILENT line's "last at" time is later than when you started that sentinel, the run did something in between, so use 10 minutes. Otherwise double the previous minutes (10 → 20 → 40). After 3 HEALTHY verdicts in a row with no activity in between, treat it as STUCK.
   - **STUCK:** run `codex-proc stop <name>`. A Codex run: resume the thread under a new name, with a note on what the inspector found; this counts as one of the phase's fix runs. A Pi run: its work goes to Codex (see "Pi for batch work").

Servers you start yourself (skeleton renders, UI checks, acceptance) outlive TaskStop and the user closing this window, so keep track of them:
- Pick the port with `free-port.mjs <preferred port>`. It prints the first port from there that can really be bound. Start the app on that port (`PORT=...` or the framework's port flag).
- Start and stop servers as the Platform table shows. Record each one in progress.md while it runs (its port and PID; for containers, the compose project and its ports; for a database you create, its name), and remove it once stopped. Codex and Pi leave everything listed there alone.
- Never kill a process that isn't listed in progress.md, even if it holds a port you want. It may be one of the user's programs; under WSL mirrored networking it may even be a Windows program that `ss` can't see.

## Pi for batch work

Pi takes large, patterned batch work and nothing else; Codex does all the rest.

**What counts.** You decide while writing plan.md. Batch work is many pieces of the same shape that follow one template, don't depend on each other, and are easy to check: many similar endpoints, pages or components; a migration or rename across many files; bulk tests or fixtures; i18n strings. Architecture, tricky logic, state, the first instance of a pattern, and anything that needs judgment stay with Codex. Most runs have no such work and never start Pi. Log what you gave Pi, and why, under "Decisions made without asking".

**Two shapes in plan.md:**
- **A batch inside a Codex phase** (`pi batch:` on the phase: the template Codex writes first, then up to 5 subtasks, each with the files it owns). The phase runs in three steps:
  1. Codex, `phase-N`: the template, the contracts and the phase's other work, committed. Its `{{NOTES}}` name the files it must leave to the batch.
  2. The batch: one Pi run per subtask, `phase-N.pi-1` … `phase-N.pi-K`, all at once.
  3. Codex again, resuming the phase's thread as `phase-N.join`, with "Your task: Integrate the batch for phase N", the batch's files, and the subtasks that didn't finish (with their `.last.md`). It finishes those itself, then builds, tests and commits.
- **A whole phase on Pi** (`agent: pi`), only when the entire phase is batch work. With `parallel: 1`, one run, `phase-N.pi`, does all of it and commits. With `parallel: K`, the subtasks run as `phase-N.pi-1` … `phase-N.pi-K`, then one more Pi run, `phase-N.pi-join`, integrates, builds, tests and commits.

**Running Pi.** Fill `pi-task.md` into `.collab/runs/<name>.prompt.md`. Keep the paragraph that starts with `Batch:` for a subtask (its task names the template and lists the files it owns), or the one that starts with `Whole task:` for a run that does a whole phase or the integration, and delete the other. Keep the `UI:` paragraph only when the task touches the UI. Then start, each with Bash `run_in_background: true`:
- one `pi-run -Name <name> -Effort <medium|high>` per run, with the phase's effort, plus `-Commit` for a run with the `Whole task:` paragraph. `pi-run` loads a guard that lets Pi only read with git, so parallel runs can't wipe each other's work; `-Commit` also allows add, rm, mv and commit, but not amending;
- one sentinel for all of them: `node "<skill dir>/scripts/codex-status.mjs" watch "<project root>" <name>[,<name>...] 10`.

At most 5 Pi runs at once. Record them in progress.md (`Run: phase-2.pi-1..4 (Pi, effort medium, sentinel 10m)`) and end your turn. Each run's end wakes you; until the last one is done, end your turn with one status line. The sentinel prints `DONE <names>` once all have ended.

`pi-run` writes the same files as `codex-run`. `<name>.exit` is `0` if Pi's final message ended normally and `1` if not, and `<name>.last.md` then says why (an error from OpenCode Go, or the end of the log). Pi runs are never resumed.

**When Pi fails, Codex takes over at once.** Pi gets no second try:
- A Pi run that exits `1` or is stuck. In a Codex phase, its subtask goes to the join step. In a phase on Pi, let the other Pi runs finish, then give what's left of the phase to a fresh Codex run, `phase-N.codex`, from codex-task.md with "Finish phase N of plan.md: <title>"; its `{{NOTES}}` say what Pi did and didn't finish, with the evidence.
- A phase on Pi that fails its phase check: the fix rounds are Codex's, as a fresh thread (`phase-N.fix-1`, then resumed), and escalate as usual.
- OpenCode Go's usage limit (`.last.md` says so): the same as a failure, and give Pi nothing more in this run. Never park for it.

Codex's own limits work as before: when Codex is out, the run waits for it (see "Usage limits"), and Pi doesn't take over its work. The one exception is the review in Step 4.

## Step 3 - Phases

For each phase in plan.md:

1. Set `Now:`, then run the phase the way plan.md says. Usually that's Codex with task "Implement phase N of plan.md: <title>", that phase's effort, and `-Parallel` from the plan; a phase with `pi batch:` or `agent: pi` runs as "Pi for batch work" says.
2. When it finishes, check it:
   - read the final message and `git log --oneline` for the phase;
   - run the build and the tests with plan.md's commands, keeping only the end of the output: `<command> > .collab/runs/check.log 2>&1; echo "exit $?"; tail -20 .collab/runs/check.log`;
   - run the acceptance checks that exist so far for the criteria this phase covers, and look at their evidence yourself. The first time a check appears, skim its script to make sure it checks what spec.md says, not something weaker;
   - for `ui: yes` phases, start the app, screenshot the new screens with Playwright, compare them with the skeleton and spec, then stop the app.
3. If something is wrong, resume the phase's Codex thread with a short fix list and its evidence (the failing output or check lines, screenshot paths; say so if a check itself is wrong); after a phase on Pi, start a fresh Codex thread instead. Escalate when a defect is still there after its 2nd round, or when the phase has had 4 fix runs in all.
4. Mark the phase done in progress.md.

## Step 4 - Code review (Codex, once, review only)

1. Fill `codex-review.md` (`{{BASE}}` = the base commit) into `.collab/runs/review.prompt.md`.
2. Commit anything uncommitted, then launch it the usual way, with `-Name review -Effort high`. It runs with full access like every other run: Codex's read-only sandbox needs a Windows sandbox setup that can fail and leave Codex's own setup unfinished. The prompt tells Codex not to modify files.
   If Codex is out of quota (the review run hits its limit, or an earlier run did and it hasn't reset), don't wait: run the review on Pi instead, from the same prompt saved as `review.pi.prompt.md`, with `pi-run -Name review.pi -Effort high` and its sentinel. The fix run below is still Codex's, and waits for it as usual.
3. If `git status --porcelain` then shows changes anyway, run `git stash push -u -m "collab: edits made during review"` and log it under "Decisions made without asking".
4. If the result isn't `NO_ISSUES`, make one fresh Codex write run with task "Fix the issues listed in .collab/runs/review.last.md, P1 first" (or `review.pi.last.md`) and effort `medium`.

Don't judge the findings yourself — code quality is Codex's call.

## Step 5 - Acceptance (you)

Check Claude's quota first (see "Usage limits").

Run all the acceptance checks with plan.md's command, then judge every criterion yourself:
- Read its line and look at every screenshot it saved. A `PASS` whose evidence shows the criterion isn't met is a failure, and the check is wrong too.
- `MANUAL` lines, and anything else the checks can't reach, you check by hand the way spec.md says. Save every script you write for this into `.collab/acceptance/` as well, so it can be run again. Use the checks' own data here too: never write test records or test accounts into the database the user develops with.
- Judge the look as strictly as the function.

- **UI that works but looks poor:** fix it yourself and commit — the look is your responsibility.
- **Functional failures:** collect them into one fresh Codex write run (effort by difficulty), with the failing lines and their evidence, and which checks are wrong, if any. Then run the checks again. Escalate when a defect is still there after its 2nd round, or when a criterion has had 4 fix runs in all.

## Step 6 - Report

Write `.collab/report.md` in Chinese:
1. Each acceptance criterion with ✅/❌ and its evidence (a screenshot path or the command run).
2. Decisions made without asking.
3. How to run the project.
4. How the user checks it themselves, on this machine:
   - the commands to start it, and how to open it in a browser that can really reach it (try it: the user's usual browser may not reach a port opened inside WSL, a container or a VM);
   - what to create first, such as an admin account;
   - the acceptance-check command;
   - for each main feature, step by step, what to try and what should happen;
   - criteria that only hold at certain times (opening hours, live data).
5. Known remaining issues.
6. Branch name and a commit summary, plus a reminder that the user merges it themselves.
7. Quota used per step, as a table: run `codex-status.mjs quota "<project root>"` and translate it, including its lines on Haiku's status summaries and, if the run was parked, on each turn while parked (whether it found the context still in the cache). If Pi ran, add a Pi column with its tokens and cost per step, from the same output.

Then wrap up. The user may close this window the moment the notification appears, so everything must be finished before it, and nothing may matter only in chat:
1. Set the status to `done`, then commit everything that remains (progress.md itself is not committed).
2. Stand down with `-Title "collab 完成" -Message "<one line>"`.
3. Give a short Chinese summary in chat, pointing to `.collab/report.md`. This is a courtesy; report.md must already say everything.

Never merge or push.

## Stand down

When the run ends or stops without you (done, escalated, out of weekly quota), in this order:
1. Stop every server listed in progress.md, and check that its port is free again (`free-port.mjs <port>` prints that same port). Take compose projects listed there down with their volumes, and drop the databases listed there.
2. Delete any CronCreate job from a `Parked until:` line that hasn't fired yet.
3. `keep-awake stop`.
4. `notify -Title "<title>" -Message "<one Chinese line>"`, as the last command.

## Escalate (stop and ask) only when

- the requirements are infeasible or contradict each other;
- you would need to change the agreed tech stack or scope;
- a defect is still there after 2 fix rounds, or a phase or acceptance criterion has had 4 fix runs in all;
- a Codex run fails twice for a reason other than usage limits.

To escalate:
1. Set `Status: escalated: <reason>`.
2. Stand down with `-Title "collab 等你决定" -Message "<one line>"`.
3. Explain the problem to the user in Chinese, with options.

Everything else, decide yourself and log it under "Decisions made without asking".

## Usage limits

This session's prompt cache lives 1 hour after its last use, and reading from it costs no quota. A longer idle wait would make the next turn write the whole context again, which can cost a fifth of a 5-hour window. So a wait is parked instead: a one-line turn every 50 minutes keeps the cache warm until work can go on.

Which limit, and what to do:
- **Claude's 5-hour quota, before a step** (the steps say when): run `codex-status.mjs budget "<project root>"`. Its first word decides:
  - `GO`: carry on.
  - `PARK`: what's left of the 5-hour window, keeping 5% for the wait, won't cover the next step and won't finish the run. Park with the jobs it printed.
  - `WEEKLY`: Claude's weekly quota runs out first, so waiting for the 5-hour reset won't help. If a Codex run is still going, end your turn and wait for it to finish (it uses Codex's quota, not Claude's). Then record its result without checking it, set `Now: 等周额度`, stand down with `-Title "collab 暂停" -Message "Claude 周额度将尽，重置后运行 /collab continue"`, and end. The user runs `/collab continue` after the weekly reset.
- **A Codex limit** (the log or final message says so, including running out of credits), except for the review (Step 4): run `codex-status.mjs park "<project root>" <reset>` with the reset time Codex states, as `HH:MM`, or `+60` if it gives none. Park with the jobs it printed.
- **OpenCode Go's limit** (a Pi run): never park; Codex takes over, as "Pi for batch work" says.
- **Claude's 5-hour limit reached anyway** (a step cost more than expected): Claude Code continues automatically after the reset. Nothing to do.
- **A closed window:** the user runs `/collab continue`.

**To park:**
1. Start nothing new. A Codex run that's still going keeps going.
2. Stop every server listed in progress.md.
3. Create every CronCreate job that the command printed, all in one message, with the cron and prompt exactly as printed.
4. In progress.md, set `Now:` to what you wait for, `等 Claude 额度` or `等 Codex 额度`, and add the printed `Parked until:` line with the job ids. Note any finished Codex run you haven't checked yet.
5. Tell the user in Chinese, in two or three lines, then end your turn: what ran out (for Codex, quote its message), when work continues (the continue job's time), and that they needn't do anything: the run goes on by itself in this window, and `/collab continue` resumes it if they close the window.

**While parked** (progress.md has a `Parked until:` line), do only this:
- On a keep-alive prompt, reply with one short Chinese line, saying what the run waits for and when it continues (from the `Parked until:` line), and call no tools. That turn is what keeps the cache warm.
- When a Codex run finishes, note in progress.md that it finished and hasn't been checked, then end your turn.
- On `SILENT`, start the sentinel again with double the minutes, without the inspector.

The continue job ends the wait.

## Continue

1. Read `.collab/progress.md`. If status is `escalated`, get the user's decision first. If it has a `Parked until:` line, delete those of its jobs that haven't fired yet (CronDelete; an unknown id is fine) and remove the line. A Codex run it notes as finished but not checked is checked first, in step 5.
2. If `Now:` says `等 Codex 额度`, run the Codex check from Step 0 before anything else. If it doesn't print `OK`, Codex is still out: park again with `codex-status.mjs park "<project root>" +60` and log it under "Decisions made without asking". The first time, also `notify -Title "collab 等 Codex" -Message "Codex 额度还没恢复，一小时后再试"`: if Codex ran out of credits rather than hitting a time window, the user may need to top them up.
3. Run `keep-awake start`. Stop any server still listed in progress.md (check its port first: the PID may have been reused) and clear the list.
4. If the current run (Codex, or each run of a Pi batch) has no `.exit` file, check whether it's alive with `codex-proc list <name>` (no output means not alive).
   - **Alive:** start its sentinel again (10 minutes) and end your turn.
   - **Not alive:** write `dead` into `.collab/runs/<name>.exit`. Then, under a new name, resume its thread if the log has one; otherwise re-launch the run (a Pi run cut off this way is re-launched, not given to Codex: it didn't fail).
5. Otherwise, carry on from the recorded status.
