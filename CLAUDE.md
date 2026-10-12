# collab-workflow

The same workflow comes in two versions, on two branches:
- `main`: Windows. Claude Code runs on Windows; the scripts are PowerShell; skills are linked with junctions. The default branch.
- `wsl`: WSL. It is `main` plus the scripts' `.sh` twins (`codex-run.sh` cleans up through a systemd user scope; notifications and keep-awake reach Windows through WSL interop), `free-port.mjs`, `keep-awake-wsl.ps1`, a Linux/WSL section in SKILL.md, and its own INSTALL.md.

Everything else is shared: the workflow in SKILL.md, `codex-status.mjs` (status line, sentinel, parking), the plugin, `codex-task.md`, `codex-review.md`, `grilling`, README.md, and the shared settings in INSTALL.md. When changing a shared part:
1. Commit it on `main`, written for Windows.
2. Merge `main` into `wsl` (`git switch wsl && git merge main`). Where a conflict is in platform-specific lines, keep the WSL wording.
3. If a `.ps1` script changed, make the same change to its `.sh` twin on `wsl`. If shared INSTALL.md settings changed, carry them into `wsl`'s INSTALL.md.

WSL-only changes go straight to `wsl`. Push both branches. The installed skills are links into this clone, so whichever branch is checked out is what runs: keep `wsl` checked out on a WSL machine.
