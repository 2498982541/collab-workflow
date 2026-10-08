# INSTALL — instructions for the AI setting this up

Goal: make `/collab` fully work on this Windows 11 machine in one pass. Go through every section in order, and check each item before changing anything; install or fix only what's missing. At the end, report to the user in Chinese.

- Commands are written for Claude Code's Bash tool (Git Bash).
- Where a command needs the user (a browser login, a UAC prompt), say so in Chinese and wait.
- Never print tokens or other secrets you come across.
- Always pass `-e --accept-source-agreements --accept-package-agreements` to `winget install`. Otherwise the first winget call on a new machine waits for a Y/N answer that can't be given here.
- A tool installed during this session isn't on this session's PATH. After installing one, prepend its folder for the rest of the install (child processes inherit it), e.g. `export PATH="/c/Program Files/nodejs:$(cygpath "$APPDATA")/npm:/c/Program Files/GitHub CLI:/c/Program Files/Git/cmd:$PATH"`.

## 0. What /collab needs

| Piece | Why |
|---|---|
| Claude Code (the conductor) | runs the `collab` skill |
| Codex CLI, logged in with ChatGPT | writes the code, using its own parallel sub-agents |
| PowerShell 7 **from the MSI installer, not the Microsoft Store** | Codex runs its commands in `pwsh`. Store/MSIX `pwsh` escapes the job object that `codex-run.ps1` uses to clean up leftover processes, such as dev servers. |
| git with a commit identity, Node.js ≥ 18, Microsoft Edge | commits, the helper scripts, and Playwright screenshots |
| Playwright MCP | Claude screenshots the UI |
| GitHub CLI, logged in | syncing this repo between machines |
| a status line | shows both quotas and context use, and records quota for the final report |
| the `collab` plugin (in `skills/collab`) | draws /collab progress at the right end of the row under the prompt; loads from the skills folder once function hooks are enabled (section 4) |

## 1. Repo location

Skills are linked into place with junctions, not copied, so `git pull` in this repo updates them. If this clone sits in a temporary or download folder, ask the user for a permanent location (for example `%USERPROFILE%\collab-workflow`) and move it there first. Below, `<repo>` is the Windows path of the clone.

## 2. Tools

| Need | Check | If missing |
|---|---|---|
| Claude Code ≥ 2.1.234 | `claude --version` | Don't update it: the user keeps their installed version. If it's older than 2.1.234, tell them auto-continue after usage limits won't work and leave the upgrade to them. |
| git + identity | `git --version`, `git config --global user.name`, `git config --global user.email` | `winget install --id Git.Git`; ask the user for name and email, then set them |
| Node.js ≥ 18 | `node --version` | `winget install --id OpenJS.NodeJS.LTS` |
| Microsoft Edge | ships with Windows 11 | `winget install --id Microsoft.Edge` |
| GitHub CLI, logged in | `gh --version`, `gh auth status` | `winget install --id GitHub.cli`, then ask the user to run `gh auth login` in a new terminal. Browser login can't be automated. If they use a proxy, they should set `$env:HTTPS_PROXY` first. |
| Codex CLI, latest | `codex --version`, `codex login status` | Always run `npm i -g @openai/codex@latest`, even if it's installed: an old CLI can reject a newer model. If not logged in, ask the user to run `codex login` (ChatGPT account). |

### PowerShell 7 (MSI)

Check:

```bash
ls "/c/Program Files/PowerShell/7/pwsh.exe" && powershell -NoProfile -Command '[Environment]::GetEnvironmentVariable("Path","Machine") -split ";" | ? { $_ -like "*PowerShell\7*" }'
```

If it's missing, install the MSI from the GitHub release. Don't use winget: its `Microsoft.PowerShell` package is MSIX (Store-style), and when a Store `pwsh` is already present it only tries to "upgrade" that. The install needs admin rights, so tell the user a UAC prompt will appear and they must click 是/Yes:

```bash
TAG=$(gh api repos/PowerShell/PowerShell/releases/latest --jq .tag_name); V=${TAG#v}
gh release download "$TAG" -R PowerShell/PowerShell -p "PowerShell-$V-win-x64.msi" --clobber -D "$TEMP"
MSI=$(cygpath -w "$TEMP/PowerShell-$V-win-x64.msi")
powershell -NoProfile -Command "\$p = Start-Process msiexec.exe -ArgumentList '/i','\"$MSI\"','/passive','ADD_PATH=1','USE_MU=1','ENABLE_MU=1' -Verb RunAs -Wait -PassThru; 'msiexec exit: ' + \$p.ExitCode"
```

The installer adds `C:\Program Files\PowerShell\7\` to the machine PATH, which comes before the user PATH (where the Store alias lives). Codex will therefore pick the MSI `pwsh`, but only once Claude Code is started from a new terminal window (see section 8). A Store `pwsh` can stay installed.

## 3. Codex configuration (`%USERPROFILE%\.codex\config.toml`)

Edit only the keys below and keep everything else the user has.

- **Default model:** a top-level `model = "gpt-6.1-sol"`, the user's choice as of 2026-10. The workflow never passes `-m`, so this is the model for every run and every sub-agent.
  - If the smoke test in section 7 says the model isn't supported, first make sure Codex is the latest version.
  - Then list the models this account can use from `~/.codex/models_cache.json` (the `slug` fields) and ask the user which one to use.
- **Settings the workflow passes on every call:** `sandbox_mode`, `approval_policy`, `model_reasoning_effort` and `agents.max_threads`. Whatever the config says for these doesn't matter.
- **Sub-agents:**
  - They're built in. Check that `codex features list` shows `multi_agent ... true`; if it doesn't, add `multi_agent = true` under `[features]`.
  - With this model, Codex uses its v2 sub-agent tools automatically. `multi_agent_v2` may show `false` in that list; that's expected, so leave it. No agent roles or `~/.codex/agents` files are needed.
  - Codex only spawns sub-agents when the prompt asks it to. The workflow's `codex-task.md` does that for phases that plan.md marks `parallel: N`.
  - `codex-run.ps1 -Parallel N` passes `-c agents.max_threads=N`.
  - Sub-agents share the parent's prompt-cache key, so after the first one they mostly hit the cache.
  - They work in the same folder, so plan.md gives each one its own files.

## 4. Claude Code settings (`%USERPROFILE%\.claude\settings.json`)

Merge these in, and don't overwrite other keys. The user chose global bypass because `/collab` must run unattended.

- `"permissions": { "defaultMode": "bypassPermissions" }`
- `"skipDangerousModePermissionPrompt": true`
- `autoContinueAtUsageLimit` must not be `false`.
- **Telemetry off** (the user's choice, for privacy). In `env`, set `"DISABLE_TELEMETRY": "1"`, `"DISABLE_ERROR_REPORTING": "1"` and `"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"`. This also stops remote feature flags, so the plugin below needs its own switch.
- **MCP tool search must work.**
  - In `env`, `ENABLE_TOOL_SEARCH` should be `"1"` (or unset), and `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` must not be set. If it is, remove it.
  - That variable silently turns tool search off, so every MCP server's full tool list (about 50k tokens with the claude.ai connectors and Playwright) is re-read on every request of a long `/collab` run.
  - After the restart in section 8, `/context` should show MCP tools as deferred or loaded on demand.
- **Status line.** If a different `statusLine` is already set, ask the user before replacing it. Use the absolute path with forward slashes:
  ```json
  "statusLine": { "type": "command", "command": "node \"C:/Users/<user>/.claude/skills/collab/scripts/codex-status.mjs\" line", "refreshInterval": 10 }
  ```
  - Every session gets one line: both 5-hour quotas with reset countdowns, plus context use, e.g. `● Claude 60% ↻ 2h13m · ● Codex 93% ↻ 4h05m · 上下文：50k  23%`. Grey means a remembered value, not a live one.
  - The session that ran `/collab` logs quota to `.collab/runs/quota.log` for the final report. Its progress, e.g. `◆ 阶段2/3 写前端 · 65% · 3子代理`, is drawn by the plugin below.
- **The `collab` plugin** needs one setting: `skills/collab` holds a plugin of function hooks (`.claude-plugin/`, `hooks/`, `types/`), and Claude Code loads it from the skills folder in every session.
  - It draws the progress at the right end of the row under the prompt. The engine lays that row out, so it follows the window width at once.
  - Plugin hooks are early access, normally switched on by a remote feature flag. With telemetry off, that flag never arrives and the plugin is listed but never loaded. So set `"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"` in `env`. It only turns the feature on locally and sends nothing.
  - To check: `claude -p "reply ok" --debug --debug-file <file>` in any folder, then the log must contain `hooks module collab@skills-dir loaded`.
  - While Codex works, the plugin asks Claude Haiku 5.5 (`claude-haiku-5-5`) at most once a minute what it is doing, from the recent log with secrets masked, and shows the phrase at the end of the row. About 1.5k input tokens a call; the final report lists the total.
- **Haiku 5.5 for `haiku`:** set `"ANTHROPIC_DEFAULT_HAIKU_MODEL": "claude-haiku-5-5"` in `env`, so the stuck-run inspector (a `model: haiku` subagent) uses Haiku 5.5. Claude Code versions released before it still map `haiku` to Haiku 4.5, which costs ten times as much.
  - Tested on Claude Code 2.1.283 and 2.1.288. If this version can't load it, nothing breaks: the status line notices and draws the progress on a second row itself.

The Claude Code `Monitor` tool is not needed: the workflow uses its own background sentinel.

## 5. Skills

For each of `collab` and `grilling` in `skills/` (`grilling` is the requirements interview that `/collab` uses):
- If `%USERPROFILE%\.claude\skills\<name>` doesn't exist, link it. Keep the single quotes so Git Bash doesn't expand `$env`:
  `powershell -NoProfile -Command 'New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\<name>" -Target "<repo>\skills\<name>"'`
- If `grilling` already exists as a plain folder (an upstream copy), replace it with the link: this repo's version is changed to ask questions in Chinese.
- If `%USERPROFILE%\.claude\skills\grill-me` exists, delete it. It's only a one-line alias for `grilling`, and the user chose to keep just `/grilling`.
- If `collab` exists as a plain folder (an older copy), ask the user before replacing it.

## 6. Playwright MCP (user scope)

`claude mcp get playwright` must show the args starting with `/c npx -y @playwright/mcp@latest`.

If the entry is missing or wrong, remove it (`claude mcp remove -s user playwright`) and add it again. `MSYS_NO_PATHCONV=1` stops Git Bash from rewriting `/c` into `C:/`:

```bash
MSYS_NO_PATHCONV=1 claude mcp add -s user playwright -- cmd /c npx -y @playwright/mcp@latest --browser msedge --headless --isolated
```

Then `claude mcp list` should show it as connected.

## 7. Smoke tests

Let `S=<repo>/skills/collab/scripts`, using forward slashes.

1. **Notification:**
   ```bash
   powershell -NoProfile -ExecutionPolicy Bypass -File "$S/notify.ps1" -Title "collab" -Message "安装测试"
   ```
   Ask the user whether a popup or notification appeared.
2. **Keep-awake:**
   ```bash
   powershell -NoProfile -ExecutionPolicy Bypass -File "$S/keep-awake.ps1" start
   ```
   Then run the same with `stop`. Both must succeed with no error output.
3. **Status line:**
   ```bash
   echo '{"rate_limits":{"five_hour":{"used_percentage":40}}}' | node "$S/codex-status.mjs" line
   ```
   It should print something like `● Claude 60% ↻ 2h13m · ● Codex 93% ↻ 4h05m` (no reset time without one in the input). The Codex part appears once Codex has run at least once.
   Then `claude plugin validate "<repo>/skills/collab"` must end with `Validation passed` (a missing-author warning is fine).
4. **A real Codex run through the workflow's launcher.** Do this in a scratch git repo:
   ```bash
   D="$TEMP/collab-install-test"; rm -rf "$D"; mkdir -p "$D/.collab/runs" && cd "$D" && git init -q && git commit -q --allow-empty -m init
   echo "Reply with exactly: OK" > .collab/runs/t.prompt.md
   powershell -NoProfile -ExecutionPolicy Bypass -File "$S/codex-run.ps1" -Name t -Effort medium; cat .collab/runs/t.last.md
   ```
   It must print `codex run 't' finished (exit 0)` and then `OK`.
5. **Leftover-process cleanup.** This needs the MSI `pwsh` visible to Codex. If you just installed it, do this after the restart in section 8, and first check that the first line of `cmd //c "where pwsh"` is `C:Program FilesPowerShellpwsh.exe`. In the same scratch repo:
   - Write `.collab/runs/c.prompt.md` asking Codex to start `node -e "require('http').createServer((q,r)=>r.end('hi')).listen(3111)"` in the background with `Start-Process`, check it answers, leave it running, and reply `DONE`.
   - Run it with `-Name c` the same way.
   - Afterwards, `netstat -ano | grep LISTENING | grep ":3111 "` must print nothing, meaning the leftover server was killed.

## 8. Report

Tell the user in Chinese what you installed or changed, and that **Claude Code must be restarted from a new terminal window** so the new PATH (MSI `pwsh`), skills, MCP server and status line take effect. Restarting claude inside the same terminal tab keeps the old PATH; if they run Claude Code inside VS Code, they should restart VS Code. If you deferred the cleanup test (7.5), ask them to have you run it after the restart.

Then show them how to use it:
- Open Claude Code in a project directory and run `/collab`; after an interruption, run `/collab continue`.
- On a laptop, keep the lid open (or set lid-close to "do nothing" while plugged in) during a run. Closing the lid sleeps the machine regardless of keep-awake.
