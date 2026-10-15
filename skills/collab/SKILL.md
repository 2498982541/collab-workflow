---
name: collab
description: Large-project workflow - Claude aligns requirements, plans, and builds the visual skeleton; Codex CLI implements phase by phase (with its own parallel sub-agents); Claude accepts against the requirements. Manual trigger only.
disable-model-invocation: true
argument-hint: "[continue]"
---

# collab

You are the conductor. Codex CLI is your implementation subagent. You own requirements, architecture, the frontend look, and final acceptance; Codex owns writing the code and its code quality. Don't do Codex's job, and don't re-implement what Claude Code and Codex already do well — just route work between them.

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

`codex-run` ends a run by killing everything the run started: through a Windows job object, or in WSL through a systemd user scope. In WSL, `notify` and `keep-awake` reach Windows through WSL interop.

## Saving tokens

- During execution, read Codex's final message, not its diffs or source files. When a check fails, give Codex the symptom and evidence (command output, a screenshot path) and let it diagnose.
- After launching background work, end your turn with one status line. Don't poll and don't sleep — Claude Code wakes you when a background command exits.

## Files (project root)

```
.collab/spec.md        requirements + numbered acceptance criteria
.collab/plan.md        architecture, contracts, commands, phases
.collab/report.md      final report (Chinese)
.collab/progress.md    run state - the source of truth for continuing (not committed)
.collab/.gitignore     contains: runs/  screenshots/  progress.md
.collab/runs/          Codex prompts, logs, final messages; quota.log and transcript.txt (written by the status line: quota over time, and where this session's transcript is); status.json and haiku.log (the status bar's view of the live run, and what Haiku's summaries of it cost)
.collab/screenshots/   acceptance evidence
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

## Decisions made without asking
- ...
```

- `Status:` is one of `planning`, `phase N`, `review`, `acceptance`, `done`, `escalated: <reason>`. `Now:` is 2–4 Chinese words on what's happening (`写前端`, `截图检查`). The status bar shows both, so keep them current.
- The phases are the file's only checkboxes: the status bar counts them, and weights its bar by the `(~Nm)` estimates.
- `Fix rounds:` counts the current phase's rounds; in acceptance, each failing criterion's (`AC3: 1, AC5: 2`).
- While parked, the `Parked until:` line that the park command prints goes at the start of a line.

## Step 0 - Preflight

If the argument is `continue`, skip this step and go to "Continue".

1. Project root = current directory.
   - If it isn't a git repo, `git init` it.
   - If it has no commits yet, make an initial commit on the default branch (the existing files, or `--allow-empty`).
   - If the working tree is dirty, ask the user (they're still here) whether to commit it first.
2. If `.collab/progress.md` says `done` from an earlier run, delete `.collab/runs/`, `.collab/screenshots/` and `progress.md`, and start fresh. That run's spec, plan and report stay until this run overwrites them; git history keeps the old versions.
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
- If the project has a UI, the files of the visual skeleton (below).
- Phases, sized so each is one Codex run of roughly 10–40 minutes. For each phase give:
  - goal and tasks;
  - the acceptance criteria it covers;
  - the tests to write: the key logic and interfaces behind those criteria, not coverage for its own sake;
  - `effort: medium|high` by difficulty;
  - `minutes: N`, your estimate of the Codex run's length;
  - `ui: yes|no`;
  - `parallel: N` (1–5). Codex is slow, so split work that is truly independent across sub-agents. For N > 1, list the subtasks and the files each one owns. No two subtasks may touch the same file; shared contracts come first, or go to the integration step after the sub-agents finish.

If the project has a UI, write the visual skeleton yourself in code:
- design tokens (colors, spacing, type, radii, shadows);
- global styles and the layout shell;
- one or two complete reference pages or components.

Render it with Playwright and look at the screenshots until it looks right, in at most 3 rounds. Codex will copy this style, so it's worth getting right. If it still isn't right after 3 rounds, log what's off under "Decisions made without asking" and move on; acceptance judges the look again.

Commit spec, plan, and skeleton.

## Running Codex

Every Codex write run is built from `codex-task.md`: fill in the task and notes, and save the result as `.collab/runs/<name>.prompt.md`. Give every launch a new name and never reuse one (`phase-2`, `phase-2.fix-1`, `phase-2.retry-1`). Then start two background commands, both with Bash `run_in_background: true`:

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
1. Spawn a subagent with `model: haiku`, telling it: "Run `node "<skill dir>/scripts/codex-status.mjs" inspect "<project root>" <name>` and judge whether this Codex run is healthy or stuck. Healthy means a long build or test is still using CPU, or sub-agents are still working. Stuck means something like waiting on a foreground server or an interactive prompt, or a process that is dead or idle. Reply with one line: `HEALTHY: <why>` or `STUCK: <why>`."
2. Act on its answer:
   - **HEALTHY:** start the sentinel again. If the SILENT line's "last at" time is later than when you started that sentinel, the run did something in between, so use 10 minutes. Otherwise double the previous minutes (10 → 20 → 40). After 3 HEALTHY verdicts in a row with no activity in between, treat it as STUCK.
   - **STUCK:** run `codex-proc stop <name>`, then resume the thread under a new name, with a note on what the inspector found. This counts as a fix round.

Servers you start yourself (skeleton renders, UI checks, acceptance) outlive TaskStop and the user closing this window, so keep track of them:
- Pick the port with `free-port.mjs <preferred port>`. It prints the first port from there that can really be bound. Start the app on that port (`PORT=...` or the framework's port flag).
- Start and stop servers as the Platform table shows. Record each one's port and PID in progress.md while it runs, and remove it once stopped.
- Never kill a process that isn't listed in progress.md, even if it holds a port you want. It may be one of the user's programs; under WSL mirrored networking it may even be a Windows program that `ss` can't see.

## Step 3 - Phases

For each phase in plan.md:

1. Set `Now:`, then run Codex with task "Implement phase N of plan.md: <title>", that phase's effort, and `-Parallel` from the plan.
2. When it finishes, check it:
   - read the final message and `git log --oneline` for the phase;
   - run the build and the tests with plan.md's commands, keeping only the end of the output: `<command> > .collab/runs/check.log 2>&1; echo "exit $?"; tail -20 .collab/runs/check.log`;
   - for `ui: yes` phases, start the app, screenshot the new screens with Playwright, compare them with the skeleton and spec, then stop the app.
3. If something is wrong, resume the phase's thread with a short fix list and its evidence (the failing output, screenshot paths). Each resume is one fix round. After 2 rounds, if the phase is still wrong, escalate.
4. Mark the phase done in progress.md.

## Step 4 - Code review (Codex, once, review only)

1. Fill `codex-review.md` (`{{BASE}}` = the base commit) into `.collab/runs/review.prompt.md`.
2. Commit anything uncommitted, then launch it the usual way, with `-Name review -Effort high`. It runs with full access like every other run: Codex's read-only sandbox needs a Windows sandbox setup that can fail and leave Codex's own setup unfinished. The prompt tells Codex not to modify files.
3. If `git status --porcelain` then shows changes anyway, run `git stash push -u -m "collab: edits made during review"` and log it under "Decisions made without asking".
4. If the result isn't `NO_ISSUES`, make one fresh write run with task "Fix the issues listed in .collab/runs/review.last.md" and effort `medium`.

Don't judge the findings yourself — code quality is Codex's call.

## Step 5 - Acceptance (you)

Check Claude's quota first (see "Usage limits").

Check every acceptance criterion in spec.md for real, the way it says: run the app or tests, and for UI, save screenshots into `.collab/screenshots/`. Judge the look as strictly as the function.

- **UI that works but looks poor:** fix it yourself and commit — the look is your responsibility.
- **Functional failures:** collect them into one fresh Codex write run (effort by difficulty), then check again. Count fix rounds per criterion; if one still fails after 2 rounds, escalate.

## Step 6 - Report

Write `.collab/report.md` in Chinese:
1. Each acceptance criterion with ✅/❌ and its evidence (a screenshot path or the command run).
2. Decisions made without asking.
3. How to run the project.
4. Known remaining issues.
5. Branch name and a commit summary, plus a reminder that the user merges it themselves.
6. Quota used per step, as a table: run `codex-status.mjs quota "<project root>"` and translate it, including its lines on Haiku's status summaries and, if the run was parked, on each turn while parked (whether it found the context still in the cache).

Then wrap up. The user may close this window the moment the notification appears, so everything must be finished before it, and nothing may matter only in chat:
1. Set the status to `done`, then commit everything that remains (progress.md itself is not committed).
2. Stand down with `-Title "collab 完成" -Message "<one line>"`.
3. Give a short Chinese summary in chat, pointing to `.collab/report.md`. This is a courtesy; report.md must already say everything.

Never merge or push.

## Stand down

When the run ends or stops without you (done, escalated, out of weekly quota), in this order:
1. Stop every server listed in progress.md, and check that its port is free again (`free-port.mjs <port>` prints that same port).
2. Delete any CronCreate job from a `Parked until:` line that hasn't fired yet.
3. `keep-awake stop`.
4. `notify -Title "<title>" -Message "<one Chinese line>"`, as the last command.

## Escalate (stop and ask) only when

- the requirements are infeasible or contradict each other;
- you would need to change the agreed tech stack or scope;
- a phase or acceptance criterion is still wrong after 2 fix rounds;
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
- **A Codex limit** (the log or final message says so): run `codex-status.mjs park "<project root>" <reset>` with the reset time Codex states, as `HH:MM`, or `+60` if it gives none. Park with the jobs it printed.
- **Claude's 5-hour limit reached anyway** (a step cost more than expected): Claude Code continues automatically after the reset. Nothing to do.
- **A closed window:** the user runs `/collab continue`.

**To park:**
1. Start nothing new. A Codex run that's still going keeps going.
2. Stop every server listed in progress.md.
3. Create every CronCreate job that the command printed, all in one message, with the cron and prompt exactly as printed.
4. In progress.md, set `Now: 等额度重置` and add the printed `Parked until:` line with the job ids. Note any finished Codex run you haven't checked yet.
5. End your turn with one status line.

**While parked** (progress.md has a `Parked until:` line), do only this:
- On a keep-alive prompt, reply with one character and call no tools. That turn is what keeps the cache warm.
- When a Codex run finishes, note in progress.md that it finished and hasn't been checked, then end your turn.
- On `SILENT`, start the sentinel again with double the minutes, without the inspector.

The continue job ends the wait.

## Continue

1. Read `.collab/progress.md`. If status is `escalated`, get the user's decision first. If it has a `Parked until:` line, delete those of its jobs that haven't fired yet (CronDelete; an unknown id is fine) and remove the line. A Codex run it notes as finished but not checked is checked first, in step 4.
2. Run `keep-awake start`. Stop any server still listed in progress.md (check its port first: the PID may have been reused) and clear the list.
3. If the current Codex run has no `.exit` file, check whether it's alive with `codex-proc list <name>` (no output means not alive).
   - **Alive:** start its sentinel again (10 minutes) and end your turn.
   - **Not alive:** write `dead` into `.collab/runs/<name>.exit`. Then, under a new name, resume its thread if the log has one; otherwise re-launch the run.
4. Otherwise, carry on from the recorded status.
