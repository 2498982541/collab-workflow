# collab-workflow

One branch, `main`, serves both platforms:
- Windows: Claude Code runs on Windows; the helper scripts are PowerShell (`.ps1`); skills are linked with junctions.
- WSL: Claude Code runs inside WSL; each script has a `.sh` twin with the same name and arguments (`codex-run.sh` cleans up through a systemd user scope; notifications and keep-awake reach Windows through WSL interop, with `keep-awake-wsl.ps1` on the Windows side).

When changing:
1. A `.ps1` script: make the same change to its `.sh` twin, and the other way round.
2. SKILL.md: platform differences go only in its Platform table; everything else is written once for both.
3. Install steps: what both platforms do the same way goes in INSTALL-shared.md; INSTALL-windows.md and INSTALL-wsl.md hold only what differs.

Push `main`. The installed skills are links into this clone, so what's checked out is what runs.
