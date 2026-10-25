// Loaded by pi-run into every Pi run (pi -e), not installed into Pi itself, so the user's own Pi sessions don't have it.
// Several Pi runs work in one folder at once, and a single `git stash` or `git checkout .` would wipe the others'
// work, so in a Pi run git may only read. COLLAB_PI_GIT=commit (pi-run -Commit, for a run that does a whole phase
// or the integration) also allows add, rm, mv and commit, but never amending a commit.
// This catches mistakes, not someone hiding a git call on purpose. A blocked call comes back to Pi as an error
// with the reason, and Pi carries on. If this file fails to load, Pi doesn't start at all.
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'

const READ = new Set([
  'status', 'diff', 'log', 'show', 'ls-files', 'ls-tree', 'grep', 'blame', 'rev-parse', 'rev-list', 'describe',
  'cat-file', 'merge-base', 'name-rev', 'shortlog', 'show-ref', 'for-each-ref', 'check-ignore', 'diff-tree',
  'diff-index', 'diff-files', 'count-objects', 'var', 'version', 'help',
])
const COMMIT = new Set(['add', 'rm', 'mv', 'commit'])
// Options before the subcommand that take the next word as their value, as in `git -C dir stash`.
const WITH_VALUE = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace'])
// `git` as a word of its own: at the start, after a separator, a quote (`bash -c "git ..."`) or a path (`/usr/bin/git`).
const GIT = /(?:^|[\s;&|(){}`'"\/\\])git(?:\.exe)?(?=[\s;&|)`'"]|$)/g

// The subcommand and the words after it, for each git call in a shell command.
const gitCalls = (command: string) => {
  const calls: { sub: string, words: string[] }[] = []
  for (const m of command.matchAll(GIT)) {
    const rest = command.slice(m.index! + m[0].length).split(/[;&|\n)`]/)[0]
    const words = rest.split(/\s+/).map(w => w.replace(/^['"]+|['"]+$/g, '')).filter(Boolean)
    let i = 0
    while (i < words.length && words[i].startsWith('-')) i += WITH_VALUE.has(words[i]) ? 2 : 1
    if (i < words.length) calls.push({ sub: words[i], words: words.slice(i + 1) })
  }
  return calls
}

export default function (pi: ExtensionAPI) {
  const commit = process.env.COLLAB_PI_GIT === 'commit'
  pi.on('tool_call', async event => {
    if (event.toolName !== 'bash' && event.toolName !== 'powershell') return undefined
    for (const { sub, words } of gitCalls(String(event.input.command ?? ''))) {
      const amend = sub === 'commit' && words.includes('--amend')
      if (READ.has(sub) || (commit && COMMIT.has(sub) && !amend)) continue
      const allowed = commit
        ? 'This run may read with git (status, diff, log, show, ...) and add, rm, mv and commit, without amending.'
        : "Other agents are working in this folder at the same time, so this run may only read with git (status, diff, log, show, ...). Don't commit; leave that to whoever integrates."
      return {
        block: true,
        reason: `Blocked: \`git ${sub}${amend ? ' --amend' : ''}\`. ${allowed} If you think it's needed, say so in your final message. If the command doesn't run git, rewrite it so "git" isn't a word of its own.`,
      }
    }
    return undefined
  })
}
