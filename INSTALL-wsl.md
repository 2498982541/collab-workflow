# INSTALL (WSL) — instructions for the AI setting this up

This is the install for WSL; INSTALL-windows.md is for Windows, and INSTALL-shared.md holds the sections both use. Goal: make `/collab` fully work in this WSL distro (Ubuntu) in one pass. Go through every section in order, and check each item before changing anything; install or fix only what's missing. At the end, report to the user in Chinese.

- Commands are written for Claude Code's Bash tool inside WSL.
- Where a command needs the user (a browser login, a `sudo` password, `wsl --shutdown` on Windows), say so in Chinese and wait. You can't type a `sudo` password: ask the user to run such a command themselves by typing `! <command>`.
- Prefer user-level installs under `~/.local`, which need no `sudo`. `~/.local/bin` must be on PATH (Ubuntu's `~/.profile` adds it once the folder exists; for zsh, check `~/.zshrc`).
- Never print tokens or other secrets you come across.
- A tool installed during this session may not be on this session's PATH. After installing one, `export PATH="$HOME/.local/bin:$PATH"` for the rest of the install.

## 0. What /collab needs

| Piece | Why |
|---|---|
| Claude Code (the conductor), inside WSL | runs the `collab` skill |
| Codex CLI, inside WSL, logged in with ChatGPT | writes the code, using its own parallel sub-agents |
| Pi 1.4.0, logged in to OpenCode Go | does large, patterned batch work on DeepSeek V4.1 Flash, when a plan has some |
| systemd in WSL | `codex-run.sh` runs each Codex run in a systemd user scope, so everything the run started, dev servers included, is killed when it ends |
| WSL interop | notifications and keep-awake run on the Windows side, through Windows PowerShell |
| git with a commit identity, Node.js ≥ 22.19 | commits and the helper scripts |
| Playwright MCP with its own Chromium, on an invisible display that reaches the GPU | Claude screenshots the UI, WebGL included |
| GitHub CLI, logged in | syncing this repo between machines |
| a status line | shows both quotas and context use, and records quota for the final report and for deciding when to park a run until Claude's quota resets |
| the `collab` plugin (in `skills/collab`) | asks Haiku what Codex is doing, for the progress row of the status line; loads from the skills folder once function hooks are enabled (section 4) |

## 1. Repo location

Skills are linked into place with symlinks, not copied, so `git pull` in this repo updates them. The clone should be in the Linux file system (for example `~/collab-workflow`, not under `/mnt/c`), on the `main` branch: `git -C <repo> branch --show-current` prints `main`. If it's still on the old `wsl` branch, run `git -C <repo> fetch && git -C <repo> switch main`. If it sits in a temporary or download folder, ask the user for a permanent location and move it there first. Below, `<repo>` is the clone's path.

## 2. WSL and tools

### WSL itself

- **systemd:** `systemctl --user is-system-running` must print `running` or `degraded`. If it errors (for example "System has not been booted with systemd"), ask the user to put this in `/etc/wsl.conf` (with `! sudo nano /etc/wsl.conf`):
  ```
  [boot]
  systemd=true
  ```
  Then they run `wsl --shutdown` in a Windows terminal, open WSL again, start Claude Code, and ask you to continue the install from here.
- **Interop:** `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe -NoProfile -Command '$PSVersionTable.PSVersion.Major'` must print a number. If it fails, interop is off: ask the user to add `[interop]` with `enabled=true` to `/etc/wsl.conf` and restart WSL as above. The scripts call PowerShell by its full path, so `appendWindowsPath=false` is fine.
- **Networking:** either mode works, so change nothing. Under mirrored networking (`networkingMode=mirrored` in the Windows `%USERPROFILE%\.wslconfig`), ports held by Windows programs are taken in WSL too but don't show in `ss`. That's why the workflow picks ports with `free-port.mjs`.

### Tools

| Need | Check | If missing |
|---|---|---|
| Claude Code ≥ 2.1.293 | `claude --version` | `curl -fsSL https://claude.ai/install.sh \| bash` (installs into `~/.local`). From 2.1.293, `haiku` is Claude Haiku 5.5. To upgrade an existing install: `claude update`. |
| git + identity | `git --version`, `git config --global user.name`, `git config --global user.email` | ask the user to run `! sudo apt-get install -y git`; ask them for name and email, then set them |
| Node.js ≥ 22.19 (Pi needs it) | `node --version` | without `sudo`: download the current LTS's `linux-x64.tar.xz` from nodejs.org, unpack it into `~/.local/opt/node`, and link its `bin/node`, `bin/npm` and `bin/npx` into `~/.local/bin`. Then `npm config set prefix ~/.local`, so `npm i -g` installs into `~/.local` without `sudo`. |
| GitHub CLI, logged in | `gh --version`, `gh auth status` | without `sudo`: download the `linux_amd64.tar.gz` of the latest release from github.com/cli/cli, and put its `bin/gh` into `~/.local/bin`. Then ask the user to run `! gh auth login`. If they use a proxy, they should set `HTTPS_PROXY` first. |
| Codex CLI, latest | `codex --version`, `codex login status` | If it's installed, always run `codex update`: an old CLI can reject a newer model. If it's missing, `npm i -g @openai/codex@latest`. If not logged in, ask the user to run `! codex login --device-auth` (a code to enter in the Windows browser). |
| Pi 1.4.0, pinned | `pi --version` | `npm i -g @earendil-works/pi-coding-agent@1.4.0`, never `@latest` (see "Pi configuration" in INSTALL-shared.md). The key is set up in section 3. |

## 3. Codex and Pi configuration

Do "Codex configuration" and "Pi configuration" in INSTALL-shared.md. Codex's file is `~/.codex/config.toml`, and Pi's is `~/.pi/agent/settings.json`.

## 4. Claude Code settings

Do "Claude Code settings" in INSTALL-shared.md. The file is `~/.claude/settings.json`, and the status line path looks like `/home/<user>/.claude/skills/collab/scripts/codex-status.mjs`.

## 5. Skills

Do "Skills" in INSTALL-shared.md. To link a skill, use a symlink:

```bash
mkdir -p ~/.claude/skills && ln -s "<repo>/skills/<name>" ~/.claude/skills/<name>
```

## 6. Playwright MCP (user scope)

Headless Chromium can't use the GPU in WSL: there is no `/dev/dri` render node, so the surfaceless EGL it needs finds no configs, and WebGL falls back to SwiftShader (maps, charts and 3D then render wrongly or not at all). So the MCP runs Chromium headed on an invisible X display, where Mesa's d3d12 driver reaches the Windows GPU.

1. **Xvfb:** `command -v Xvfb` must print a path. If not, ask the user to run `! sudo apt-get install -y xvfb`.
2. **The display:** `systemctl --user is-active xvfb-gpu` must print `active`. If not, write `~/.config/systemd/user/xvfb-gpu.service`:
   ```ini
   [Unit]
   Description=Invisible X display :99 for GPU-rendered browser automation (used by pw-gpu)

   [Service]
   ExecStart=/usr/bin/Xvfb :99 -screen 0 1920x1080x24 -nolisten tcp
   Restart=on-failure

   [Install]
   WantedBy=default.target
   ```
   Then run `systemctl --user daemon-reload && systemctl --user enable --now xvfb-gpu`.
3. **The wrapper:** `command -v pw-gpu` must print `~/.local/bin/pw-gpu`. If not, write this file there and `chmod 755` it:
   ```sh
   #!/bin/sh
   # pw-gpu <command>: run a command whose browsers render WebGL on the GPU without showing a window.
   # Browsers it starts go to the invisible X display :99 (user service xvfb-gpu), where Mesa's d3d12
   # driver reaches the Windows GPU. Launch them headed (Playwright: headless: false).
   # Real headless can't use the GPU in WSL: there is no /dev/dri render node, so the surfaceless EGL
   # that headless Chromium needs finds no configs and falls back to SwiftShader.
   systemctl --user is-active --quiet xvfb-gpu || systemctl --user start xvfb-gpu
   unset WAYLAND_DISPLAY
   export DISPLAY=:99 GALLIUM_DRIVER=d3d12 PW_GPU=1
   exec "$@"
   ```
   Scripts that need the GPU run as `pw-gpu node <script>` and launch the browser with `headless: false`.
4. **The MCP entry:** `claude mcp get playwright` must show the command `pw-gpu` with the args `npx -y @playwright/mcp@latest --browser chromium --isolated --allow-unrestricted-file-access` (no `--headless`: the browser draws on the invisible display, so no window appears). The last flag lets it save screenshots anywhere in the project and open `file://` pages.

   If the entry is missing or wrong, remove it (`claude mcp remove -s user playwright`) and add it again:

   ```bash
   claude mcp add -s user playwright -- pw-gpu npx -y @playwright/mcp@latest --browser chromium --isolated --allow-unrestricted-file-access
   ```
5. **Check the GPU** in the next Claude Code session, once the MCP has restarted: navigate the MCP to `about:blank` and evaluate `() => { const gl = document.createElement('canvas').getContext('webgl'); return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL) }`. It should name D3D12 and the GPU. SwiftShader or llvmpipe means WSL has no GPU access (check `ls /dev/dxg` and the Windows GPU driver); the MCP still works, without the GPU.

It needs Playwright's own Chromium: `ls ~/.cache/ms-playwright` should list a `chromium-*` folder. If not, run `npx -y playwright install chromium` (no `sudo` needed). If Chromium then can't start because system libraries are missing, ask the user to run `! sudo npx -y playwright install-deps chromium`.

Then `claude mcp list` should show it as connected.

## 7. Smoke tests

Let `S=<repo>/skills/collab/scripts`.

1. **Notification:**
   ```bash
   bash "$S/notify.sh" -Title "collab" -Message "安装测试"
   ```
   Ask the user whether a popup or notification appeared on the Windows desktop.
2. **Keep-awake:**
   ```bash
   bash "$S/keep-awake.sh" start
   ```
   Then run the same with `stop`. Both must succeed with no error output.
3. **Status line and plugin:** do "Status line and plugin check" in INSTALL-shared.md.
4. **A real Codex run through the workflow's launcher.** Do this in a scratch git repo:
   ```bash
   D=/tmp/collab-install-test; rm -rf "$D"; mkdir -p "$D/.collab/runs" && cd "$D" && git init -q && git commit -q --allow-empty -m init
   echo "Reply with exactly: OK" > .collab/runs/t.prompt.md
   bash "$S/codex-run.sh" -Name t -Effort medium; cat .collab/runs/t.last.md
   ```
   It must print `codex run 't' finished (exit 0)` and then `OK`.
5. **Leftover-process cleanup.** In the same scratch repo:
   - Write `.collab/runs/c.prompt.md` asking Codex to start `node -e "require('http').createServer((q,r)=>r.end('hi')).listen(3111)"` in the background with `setsid nohup ... > /dev/null 2>&1 &`, check it answers, leave it running, and reply `DONE`.
   - Run it with `-Name c` the same way.
   - Afterwards, `node "$S/free-port.mjs" 3111` must print `3111`, meaning the leftover server was killed with the run's systemd scope.
6. **A real Pi run through the workflow's launcher**, once the key is set up (section 3). In the same scratch repo:
   ```bash
   echo 'Run `git stash` with your bash tool. If it was blocked, reply with exactly: OK. If it ran, reply with exactly: RAN' > .collab/runs/p.prompt.md
   bash "$S/pi-run.sh" -Name p -Effort medium; cat .collab/runs/p.last.md
   ```
   It must print `pi run 'p' finished (exit 0)` and then `OK`, which also shows the run's git guard works. On exit 1, `.collab/runs/p.last.md` says why.

## 8. Report

Tell the user in Chinese what you installed or changed, and that **Claude Code must be restarted** (exit it and run `claude` again) so the skills, MCP server, settings and status line take effect. If you changed `/etc/wsl.conf`, WSL itself must have been restarted with `wsl --shutdown` first.

Then show them how to use it:
- Open Claude Code in WSL, in a project directory, and run `/collab`; after an interruption, run `/collab continue`.
- Keep the WSL terminal open during a run: closing it ends Claude Code, and the run with it.
- On a laptop, keep the lid open (or set lid-close to "do nothing" while plugged in) during a run. Closing the lid sleeps the machine regardless of keep-awake.
