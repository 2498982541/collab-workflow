import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { CollabPart } from '../types'

// Draws the /collab progress at the right end of the row under the prompt. The engine lays that row out,
// so it stays right-aligned at any width, at once. What to draw comes from scripts/codex-status.mjs.
const parts = atom({ plugin: 'collab', key: 'parts' } as const, [])

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    const script = `${$.plugin.root.replace(/[\\/]\.claude-plugin$/, '')}/scripts/codex-status.mjs`
    let drawn = '[]'
    let skip = 0
    $.clock.every(5000, async () => {
      if (skip > 0) return void (skip -= 1)  // sessions that never ran /collab are checked every 30 s
      try {
        const { stdout } = await $.process.run(['node', script, 'plugin', await $.session.id()], { timeoutMs: 15000 })
        const polled: { collab: boolean; parts: CollabPart[] } = JSON.parse(stdout)
        if (!polled.collab) skip = 5
        const text = JSON.stringify(polled.parts)
        if (text !== drawn) {
          drawn = text
          await update($, parts, () => polled.parts)
        }
      } catch {}
    })
    return started
  })

  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const list = await read($, parts)
    if (list.length === 0) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        {e.props.modes.length > 0 && <Text dimColor>{e.props.modes.join(' & ') + '   '}</Text>}
        {list.map(p => (
          <Text color={p.color} bold={p.bold}>
            {p.text}
          </Text>
        ))}
      </Box>
    )
  })
}
