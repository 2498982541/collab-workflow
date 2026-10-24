# INSTALL, shared part: what both platforms set up the same way

INSTALL-windows.md and INSTALL-wsl.md send you here for these sections. Do each one where your platform file says. Paths are written with `~`; on Windows, `~` is `%USERPROFILE%`.

## Codex configuration (`~/.codex/config.toml`)

Edit only the keys below and keep everything else the user has.

- **Default model:** a top-level `model = "gpt-6.1-sol"`, the user's choice as of 2026-10. The workflow never passes `-m`, so this is the model for every run and every sub-agent.
  - If the Codex smoke test says the model isn't supported, first make sure Codex is the latest version.
  - Then list the models this account can use from `~/.codex/models_cache.json` (the `slug` fields) and ask the user which one to use.
- **Settings the workflow passes on every call:** `sandbox_mode`, `approval_policy`, `model_reasoning_effort` and `agents.max_threads`. Whatever the config says for these doesn't matter.
- **Sub-agents:**
  - They're built in. Check that `codex features list` shows `multi_agent ... true`; if it doesn't, add `multi_agent = true` under `[features]`.
  - With this model, Codex uses its v2 sub-agent tools automatically. `multi_agent_v2` may show `false` in that list; that's expected, so leave it. No agent roles or `~/.codex/agents` files are needed.
  - Codex only spawns sub-agents when the prompt asks it to. The workflow's `codex-task.md` does that for phases that plan.md marks `parallel: N`.
  - `codex-run -Parallel N` passes `-c agents.max_threads=N`.
  - Sub-agents share the parent's prompt-cache key, so after the first one they mostly hit the cache.
  - They work in the same folder, so plan.md gives each one its own files.

## Pi configuration

Pi is a small coding agent. `/collab` gives it large, patterned batch work, on DeepSeek V4.1 Flash from the user's OpenCode Go subscription. Codex does everything else, and a run without such work never starts Pi.

- **Pinned version:** `@earendil-works/pi-coding-agent@1.4.0`. Pi ships changes almost daily, so the user chose to stay on one tested version. `pi --version` must print `1.4.0`; if it doesn't, run `npm i -g @earendil-works/pi-coding-agent@1.4.0`. Never install `@latest` or update Pi on your own. To upgrade, the user changes the version in this file and in the platform files' tool tables, then reruns the Pi smoke test. npm may warn that it skipped the install scripts of `@google/genai` and `protobufjs`. Pi doesn't need them, so don't allow them.
- **Key:** an OpenCode Go API key, from https://opencode.ai/auth in the workspace that has the Go subscription. Pi stores it in `~/.pi/agent/auth.json`. Never ask for the key in chat. Instead, ask the user to open `pi` in a terminal, type `/login`, choose OpenCode Go with an API key, paste the key, and quit with `/quit`. To check: `pi --list-models opencode-go` must list `deepseek-v4.1-flash`; without a key it prints "No models available".
- **Settings** (`~/.pi/agent/settings.json`; merge them in, and don't overwrite other keys): `"enableInstallTelemetry": false`. This is the user's choice. Pi only reports installs from its interactive mode anyway. `pi-run` turns the same switch back on for its own runs, because it also controls the `x-opencode-client: pi` header that tells Go which client is calling.
- Pi has no permission prompts: it runs every command it chooses, with the user's rights, like Codex with full access. On Windows its `bash` tool uses Git Bash.

## Claude Code settings (`~/.claude/settings.json`)

Merge these in, and don't overwrite other keys. The user chose global bypass because `/collab` must run unattended.

- `"permissions": { "defaultMode": "bypassPermissions" }`
- `"skipDangerousModePermissionPrompt": true`
- `autoContinueAtUsageLimit` must not be `false`.
- If the user reaches the internet through a proxy, keep their `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY` entries in `env`.
- **Telemetry off** (the user's choice, for privacy). In `env`, set `"DISABLE_TELEMETRY": "1"`, `"DISABLE_ERROR_REPORTING": "1"` and `"CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1"`. This also stops remote feature flags, so the plugin below needs its own switch.
- **MCP tool search must work.**
  - In `env`, `ENABLE_TOOL_SEARCH` should be `"1"` (or unset), and `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS` must not be set. If it is, remove it.
  - That variable silently turns tool search off, so every MCP server's full tool list (about 50k tokens with the claude.ai connectors and Playwright) is re-read on every request of a long `/collab` run.
  - After the restart at the end of the install, `/context` should show MCP tools as deferred or loaded on demand.
- **Status line.** If a different `statusLine` is already set, ask the user before replacing it. Use the absolute path of the linked skill, with forward slashes (`<home>` is `C:/Users/<user>` on Windows, `/home/<user>` in WSL):
  ```json
  "statusLine": { "type": "command", "command": "node \"<home>/.claude/skills/collab/scripts/codex-status.mjs\" line", "refreshInterval": 10 }
  ```
  - Every session gets one line: both 5-hour quotas with reset countdowns, plus context use, e.g. `● Claude 60% ↻ 2h13m · ● Codex 93% ↻ 4h05m · 上下文：50k  23%`. Grey means a remembered value, not a live one.
  - In the session that ran `/collab`, a second row shows the workflow's progress, e.g. `◆ 阶段2/3 写前端  ━━━━━━──── 58% · 3/7 正在跑单元测试 · 2子代理`: the phase, a bar weighted by each phase's estimated minutes, Codex's own step count, and what it is doing now. That session also logs quota to `.collab/runs/quota.log` for the final report.
  - `/collab` decides from the quota the status line last saw whether to park: when Claude's 5-hour window can't cover the next step, it waits for the reset with a one-line turn every 50 minutes, so the session's 1-hour prompt cache doesn't expire and the context isn't written again. Without the status line, it never parks.
- **The `collab` plugin** needs one setting: `skills/collab` holds a plugin of function hooks (`.claude-plugin/`, `hooks/`), and Claude Code loads it from the skills folder in every session. It exists because a status line command can't call a model.
  - Plugin hooks are early access, normally switched on by a remote feature flag. With telemetry off, that flag never arrives and the plugin is listed but never loaded. So set `"CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1"` in `env`. It only turns the feature on locally and sends nothing.
  - To check: `claude -p "reply ok" --debug --debug-file <file>` in any folder, then the log must contain `hooks module collab@skills-dir loaded`.
  - While Codex works, it asks `haiku` (Claude Haiku 5.5) at most once a minute what Codex is doing, from the recent log with secrets masked; the phrase shows in the progress row. About 1.5k input tokens a call; the final report lists the total. It doesn't ask while a run is parked.
  - Tested on Claude Code 2.1.293. If it can't load, nothing breaks: the progress row shows Codex's own step names instead.

The Claude Code `Monitor` tool is not needed: the workflow uses its own background sentinel.

## Skills

For each of `collab` and `grilling` in `skills/` (`grilling` is the requirements interview that `/collab` uses):
- If `~/.claude/skills/<name>` doesn't exist, link it with the command in your platform file.
- If `grilling` already exists as a plain folder (an upstream copy), replace it with the link: this repo's version asks questions in Chinese, always through the question tool (in batches of up to 4).
- If `~/.claude/skills/grill-me` exists, delete it. It's only a one-line alias for `grilling`, and the user chose to keep just `/grilling`.
- If `collab` exists as a plain folder (an older copy), ask the user before replacing it.

## Status line and plugin check

With `S=<repo>/skills/collab/scripts` (forward slashes):

```bash
echo '{"rate_limits":{"five_hour":{"used_percentage":40}}}' | node "$S/codex-status.mjs" line
```

It should print something like `● Claude 60% ↻ 2h13m · ● Codex 93% ↻ 4h05m` (no reset time without one in the input). The Codex part appears once Codex has run at least once.

Then `claude plugin validate "<repo>/skills/collab"` must end with `Validation passed` (a missing-author warning is fine).
