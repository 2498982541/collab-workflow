# INSTALL (Windows) — instructions for the AI setting this up

This is the install for Windows; INSTALL-wsl.md is for WSL, and INSTALL-shared.md holds the sections both use. Goal: make `/collab` fully work on this Windows 11 machine in one pass. Go through every section in order, and check each item before changing anything; install or fix only what's missing. At the end, report to the user in Chinese.

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
| Pi 1.4.0, logged in to OpenCode Go | does large, patterned batch work on DeepSeek V4.1 Flash, when a plan has some |
| PowerShell 7 **from the MSI installer, not the Microsoft Store** | Codex runs its commands in `pwsh`. Store/MSIX `pwsh` escapes the job object that `codex-run.ps1` uses to clean up leftover processes, such as dev servers. |
| git with a commit identity, Node.js ≥ 22.19, Microsoft Edge | commits, the helper scripts, and Playwright screenshots |
| Playwright MCP | Claude screenshots the UI |
| GitHub CLI, logged in | syncing this repo between machines |
| a status line | shows both quotas and context use, and records quota for the final report and for deciding when to park a run until Claude's quota resets |
| the `collab` plugin (in `skills/collab`) | asks Haiku what Codex is doing, for the progress row of the status line; loads from the skills folder once function hooks are enabled (section 4) |

## 1. Repo location

Skills are linked into place with junctions, not copied, so `git pull` in this repo updates them. If this clone sits in a temporary or download folder, ask the user for a permanent location (for example `%USERPROFILE%\collab-workflow`) and move it there first. Below, `<repo>` is the Windows path of the clone.

## 2. Tools

| Need | Check | If missing |
|---|---|---|
| Claude Code ≥ 2.1.293 | `claude --version` | `npm i -g @anthropic-ai/claude-code@latest` (the user wants the latest). From 2.1.293, `haiku` is Claude Haiku 5.5. Upgrading the running session's own binary works: npm leaves the old one in a `node_modules/@anthropic-ai/.claude-code-*` folder, which can be deleted once that session has exited. |
| git + identity | `git --version`, `git config --global user.name`, `git config --global user.email` | `winget install --id Git.Git`; ask the user for name and email, then set them |
| Node.js ≥ 22.19 (Pi needs it) | `node --version` | `winget install --id OpenJS.NodeJS.LTS`; if an older version is installed, `winget upgrade --id OpenJS.NodeJS.LTS` |
| Microsoft Edge | ships with Windows 11 | `winget install --id Microsoft.Edge` |
| GitHub CLI, logged in | `gh --version`, `gh auth status` | `winget install --id GitHub.cli`, then ask the user to run `gh auth login` in a new terminal. Browser login can't be automated. If they use a proxy, they should set `$env:HTTPS_PROXY` first. |
| Codex CLI, latest | `codex --version`, `codex login status` | Always run `npm i -g @openai/codex@latest`, even if it's installed: an old CLI can reject a newer model. If not logged in, ask the user to run `codex login` (ChatGPT account). |
| Pi 1.4.0, pinned | `pi --version` | `npm i -g @earendil-works/pi-coding-agent@1.4.0`, never `@latest` (see "Pi configuration" in INSTALL-shared.md). The key is set up in section 3. |

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

## 3. Codex and Pi configuration

Do "Codex configuration" and "Pi configuration" in INSTALL-shared.md. Codex's file is `%USERPROFILE%\.codex\config.toml`, and Pi's is `%USERPROFILE%\.pi\agent\settings.json`.

## 4. Claude Code settings

Do "Claude Code settings" in INSTALL-shared.md. The file is `%USERPROFILE%\.claude\settings.json`, and the status line path looks like `C:/Users/<user>/.claude/skills/collab/scripts/codex-status.mjs`.

## 5. Skills

Do "Skills" in INSTALL-shared.md. To link a skill, use a junction, and keep the single quotes so Git Bash doesn't expand `$env`:

```bash
powershell -NoProfile -Command 'New-Item -ItemType Junction -Path "$env:USERPROFILE\.claude\skills\<name>" -Target "<repo>\skills\<name>"'
```

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
3. **Status line and plugin:** do "Status line and plugin check" in INSTALL-shared.md.
4. **A real Codex run through the workflow's launcher.** Do this in a scratch git repo:
   ```bash
   D="$TEMP/collab-install-test"; rm -rf "$D"; mkdir -p "$D/.collab/runs" && cd "$D" && git init -q && git commit -q --allow-empty -m init
   echo "Reply with exactly: OK" > .collab/runs/t.prompt.md
   powershell -NoProfile -ExecutionPolicy Bypass -File "$S/codex-run.ps1" -Name t -Effort medium; cat .collab/runs/t.last.md
   ```
   It must print `codex run 't' finished (exit 0)` and then `OK`.
5. **Leftover-process cleanup.** This needs the MSI `pwsh` visible to Codex. If you just installed it, do this after the restart in section 8, and first check that the first line of `cmd //c "where pwsh"` is `C:\Program Files\PowerShell\7\pwsh.exe`. In the same scratch repo:
   - Write `.collab/runs/c.prompt.md` asking Codex to start `node -e "require('http').createServer((q,r)=>r.end('hi')).listen(3111)"` in the background with `Start-Process`, check it answers, leave it running, and reply `DONE`.
   - Run it with `-Name c` the same way.
   - Afterwards, `netstat -ano | grep LISTENING | grep ":3111 "` must print nothing, meaning the leftover server was killed.
6. **A real Pi run through the workflow's launcher**, once the key is set up (section 3). In the same scratch repo:
   ```bash
   echo "Reply with exactly: OK" > .collab/runs/p.prompt.md
   powershell -NoProfile -ExecutionPolicy Bypass -File "$S/pi-run.ps1" -Name p -Effort medium; cat .collab/runs/p.last.md
   ```
   It must print `pi run 'p' finished (exit 0)` and then `OK`. On exit 1, `.collab/runs/p.last.md` says why.

## 8. Report

Tell the user in Chinese what you installed or changed, and that **Claude Code must be restarted from a new terminal window** so the new PATH (MSI `pwsh`), skills, MCP server, settings and status line take effect. Restarting claude inside the same terminal tab keeps the old PATH; if they run Claude Code inside VS Code, they should restart VS Code. If you deferred the cleanup test (7.5), ask them to have you run it after the restart.

Then show them how to use it:
- Open Claude Code in a project directory and run `/collab`; after an interruption, run `/collab continue`.
- Keep the terminal window open during a run: closing it ends Claude Code, and the run with it.
- On a laptop, keep the lid open (or set lid-close to "do nothing" while plugged in) during a run. Closing the lid sleeps the machine regardless of keep-awake.
