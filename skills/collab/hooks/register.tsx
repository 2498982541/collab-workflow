import type { Register } from 'claude-code'

// While Codex works on a /collab run, asks Haiku what it is doing, at most once a minute. The phrase shows in the
// status line's progress row. Everything else (when to ask, the question, where the answer goes) is in
// scripts/codex-status.mjs; the plugin is here because a status line command can't call a model.
type HaikuAsk = { run: string; model: string; system: string; prompt: string }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const script = `${$.plugin.root.replace(/[\\/]\.claude-plugin$/, '')}/scripts/codex-status.mjs`
    let skip = 0
    let asking = false
    $.clock.every(10000, async () => {
      if (skip > 0 || asking) return void (skip = Math.max(0, skip - 1))  // sessions that never ran /collab: once a minute
      asking = true
      try {
        const { stdout } = await $.process.run(['node', script, 'plugin', await $.session.id()], { timeoutMs: 15000 })
        const polled: { collab: boolean; ask?: HaikuAsk } = JSON.parse(stdout)
        if (!polled.collab) skip = 5
        if (!polled.ask) return
        const { run, model, system, prompt } = polled.ask
        const r = await $.model.complete({ model, system, prompt, maxTokens: 400, effort: 'low', timeoutMs: 30000 })
        if (r.isAnswered) {
          await $.process.run(['node', script, 'haiku'], { stdin: JSON.stringify({ run, text: r.text, usage: r.usage }), timeoutMs: 15000 })
        }
      } catch {
      } finally {
        asking = false
      }
    })
    return started
  })
}
