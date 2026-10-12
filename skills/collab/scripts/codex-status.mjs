// Status helpers for /collab Codex runs (Node >= 18, no dependencies).
//   node codex-status.mjs watch <root> <run> <minutes>  sentinel: prints DONE when the run ends, or SILENT once
//                                                        neither Codex nor any of its sub-agents has done anything for <minutes>
//   node codex-status.mjs inspect <root> <run>           diagnosis bundle for a quiet run (events, sub-agents, processes)
//   node codex-status.mjs quota <root>                   quota change per step, from .collab/runs/quota.log
//   node codex-status.mjs line                           Claude Code status line (session JSON on stdin)
//   node codex-status.mjs plugin <session id>            for the plugin (hooks/register.tsx): when due, a question for Haiku
//                                                        about what Codex is doing, as JSON
//   node codex-status.mjs haiku                          for the plugin: Haiku's answer on stdin, shown in the progress row
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SESSIONS = path.join(os.homedir(), '.codex', 'sessions')
const CACHE = path.join(os.tmpdir(), 'collab-status-cache.json')
const runs = root => path.join(root, '.collab', 'runs')
const stat = f => { try { return fs.statSync(f) } catch { return null } }
const ago = ms => `${Math.max(0, Math.round((Date.now() - ms) / 60000))}m`
const hhmm = ms => new Date(ms).toTimeString().slice(0, 5)

// Mask secrets before anything reaches Claude or Haiku.
const redact = s => String(s ?? '')
  .replace(/((?:token|api[-_]?key|key|secret|password|passwd|auth)["']?\s*[=: ]\s*["']?)[^\s"',;&]+/gi, '$1***')
  .replace(/(Bearer\s+)\S+/gi, '$1***')
  .replace(/(:\/\/[^/@\s:]+:)[^@\s]+@/g, '$1***@')
  .replace(/\b(sk-|ghp_|gho_|github_pat_|xox[abp]-)[\w-]+/g, '$1***')
const clip = (s, n) => redact(s).replace(/\s+/g, ' ').slice(0, n)

function readSlice(f, fromEnd, n = 65536) {
  try {
    const fd = fs.openSync(f, 'r')
    const size = fs.fstatSync(fd).size
    const len = Math.min(n, size)
    const buf = Buffer.alloc(len)
    fs.readSync(fd, buf, 0, len, fromEnd ? size - len : 0)
    fs.closeSync(fd)
    return buf.toString('utf8')
  } catch { return '' }
}
const lines = (f, fromEnd, n) => readSlice(f, fromEnd, n).split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)

const cache = (() => { try { return JSON.parse(fs.readFileSync(CACHE, 'utf8')) } catch { return {} } })()
cache.meta ??= {}
if (Object.keys(cache.meta).length > 3000) cache.meta = {}
const saveCache = () => { try { fs.writeFileSync(CACHE, JSON.stringify(cache)) } catch {} }

const threadId = (root, run) => lines(path.join(runs(root), `${run}.jsonl`), false).find(e => e.type === 'thread.started')?.thread_id

// Codex keeps its rollout files open, and on Windows their mtime stays at the creation time while it writes.
// So a rollout's activity time is the timestamp of its last line.
function lastEvent(f) {
  const e = lines(f, true, 16384).at(-1)
  return { at: Date.parse(e?.timestamp ?? '') || 0, type: e?.payload?.type ?? e?.type ?? '' }
}

function dayDirs(sinceMs) {
  const dirs = []
  for (let t = Date.now(); t >= sinceMs - 86400000 && dirs.length < 4; t -= 86400000) {
    const d = new Date(t)
    dirs.push(path.join(SESSIONS, String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')))
  }
  return dirs
}
const listDir = dir => { try { return fs.readdirSync(dir).filter(n => n.endsWith('.jsonl')).map(n => path.join(dir, n)) } catch { return [] } }

// The run's rollout files: the root thread's own file (it can be older, for resumed threads),
// plus each sub-agent's, whose session_id is the root thread id.
function rollouts(tid, sinceMs) {
  const out = []
  for (const f of dayDirs(sinceMs).flatMap(listDir)) {
    if (path.basename(f).includes(tid)) { out.push({ file: f }); continue }
    if ((stat(f)?.birthtimeMs ?? 0) < sinceMs - 60000) continue
    cache.meta[f] ??= (() => { const p = lines(f, false)[0]?.payload ?? {}; return { session: p.session_id ?? '', agent: p.agent_path ?? '' } })()
    if (cache.meta[f].session === tid) out.push({ file: f, agent: cache.meta[f].agent })
  }
  return out.map(r => ({ ...r, ...lastEvent(r.file) }))
}

function runInfo(root, run) {
  const log = path.join(runs(root), `${run}.jsonl`)
  const st = stat(log)
  const started = st?.birthtimeMs ?? Date.now()
  const tid = st ? threadId(root, run) : undefined
  const files = tid ? rollouts(tid, started) : []
  const last = Math.max(st?.mtimeMs ?? 0, ...files.map(f => f.at))  // the run log itself is written through cmd, so its mtime is live
  return { log, started, tid, files, last }
}

const alive = pid => { try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' } }
const wrapperPid = (root, run) => Number(readSlice(path.join(runs(root), `${run}.job`), false, 200).match(/collab-codex-(\d+)/)?.[1] ?? 0)
const finished = (root, run) => fs.existsSync(path.join(runs(root), `${run}.exit`))

// The live run: its codex-run.ps1 is still alive and it hasn't written an exit code.
function currentRun(root) {
  let names = []
  try { names = fs.readdirSync(runs(root)) } catch {}
  return names.filter(n => n.endsWith('.job')).map(n => n.slice(0, -4))
    .filter(run => !finished(root, run) && alive(wrapperPid(root, run)))
    .sort((a, b) => (stat(path.join(runs(root), `${b}.job`))?.mtimeMs ?? 0) - (stat(path.join(runs(root), `${a}.job`))?.mtimeMs ?? 0))[0]
}

async function watch(root, run, minutes) {
  const t0 = Date.now()
  for (;;) {
    if (finished(root, run)) { console.log(`DONE ${run}`); break }
    const pid = wrapperPid(root, run)
    if (pid && !alive(pid)) { console.log(`DONE ${run} (codex-run is gone without an exit code)`); break }
    const last = Math.max(runInfo(root, run).last, t0)
    if (Date.now() - last >= minutes * 60000) {
      console.log(`SILENT ${run}: no activity from Codex or its sub-agents for ${Math.round((Date.now() - last) / 60000)} minutes (last at ${hhmm(last)})`)
      break
    }
    saveCache()
    await new Promise(r => setTimeout(r, 20000))
  }
  saveCache()
}

function describe(e) {
  const it = e.item
  if (!it) return e.type === 'turn.failed' ? `turn.failed ${clip(e.error?.message, 200)}` : e.type
  if (it.type === 'command_execution') return `${e.type === 'item.started' ? 'START' : 'DONE '} cmd exit=${it.exit_code ?? '-'}: ${clip(it.command, 200)}${it.aggregated_output ? ' => ' + clip(it.aggregated_output.slice(-300), 300) : ''}`
  if (it.type === 'file_change') return `files ${it.status}: ${it.changes?.map(c => `${c.kind} ${c.path}`).join(', ')}`
  if (it.type === 'todo_list') return `todo: ${it.items?.map(t => (t.completed ? '[x] ' : '[ ] ') + clip(t.text, 50)).join(' | ')}`
  if (it.type === 'collab_tool_call') return `sub-agents: ${it.tool} ${it.status ?? ''}`
  return `${it.type}: ${clip(it.text ?? it.message ?? '', 200)}`
}

function describeRollout(e) {
  const p = e.payload ?? {}
  const text = v => clip(Array.isArray(v) ? v.map(o => o.text ?? '').join(' ') : v, 200)
  if (p.type === 'custom_tool_call' || p.type === 'function_call') return `call ${p.name}: ${text(p.input ?? p.arguments)}`
  if (p.type === 'custom_tool_call_output' || p.type === 'function_call_output') return `  -> ${text(p.output)}`
  if (p.type === 'message' && p.role === 'assistant') return `says: ${text(p.content)}`
  if (p.type === 'task_complete') return `finished: ${clip(p.last_agent_message, 120)}`
  return null
}

function inspect(root, run) {
  const r = runInfo(root, run)
  const events = lines(r.log, true)
  console.log(`run ${run} | started ${ago(r.started)} ago | last activity ${ago(r.last)} ago | thread ${r.tid ?? '?'}`)
  const open = new Map()
  for (const e of events) if (e.item?.type === 'command_execution') e.type === 'item.started' ? open.set(e.item.id, e) : open.delete(e.item.id)
  for (const e of open.values()) console.log(`STILL RUNNING: ${clip(e.item.command, 300)}`)
  console.log('\nlast root events:')
  for (const e of events.slice(-12)) console.log('  ' + describe(e))
  for (const s of r.files.filter(f => f.agent)) {
    console.log(`\nsub-agent ${s.agent} | ${s.type === 'task_complete' ? 'finished' : 'working'} | last activity ${ago(s.at)} ago`)
    for (const line of lines(s.file, true).map(describeRollout).filter(Boolean).slice(-6)) console.log('  ' + line)
  }
  console.log('\nprocesses of this run (cpu = CPU seconds used during a 5 s sample):')
  try {
    const [exe, argv] = process.platform === 'win32'
      ? ['powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'codex-proc.ps1'), 'list', run, '5']]
      : ['bash', [path.join(HERE, 'codex-proc.sh'), 'list', run, '5']]
    const out = execFileSync(exe, argv, { cwd: root, encoding: 'utf8' })
    console.log(redact(out).trim() || '  (none - the run is not alive)')
  } catch (err) { console.log('  (could not list: ' + clip(err.message, 200) + ')') }
}

function quotaTable(root) {
  const rows = readSlice(path.join(runs(root), 'quota.log'), false, 1 << 20).split('\n').filter(Boolean).map(l => l.split('\t'))
  if (!rows.length) return console.log('no quota.log')
  const steps = []
  for (const r of rows) if (!steps.length || steps.at(-1).step !== r[1]) steps.push({ step: r[1], first: r, last: r }); else steps.at(-1).last = r
  const d = (a, b, i) => (a[i] === '' || b[i] === '' ? '?' : `${Number(b[i]) - Number(a[i]) >= 0 ? '+' : ''}${Number(b[i]) - Number(a[i])}`)
  const row = (name, a, b) => console.log(`${name} | ${hhmm(Date.parse(a[0]))} - ${hhmm(Date.parse(b[0]))} | ${d(a, b, 2)} | ${d(a, b, 3)} | ${d(a, b, 4)} | ${d(a, b, 5)}`)
  console.log('step | from - to | Claude 5h | Claude week | Codex 5h | Codex week   (percentage points; a 5h window can drop when it rolls over)')
  steps.forEach((s, i) => row(s.step, s.first, steps[i + 1]?.first ?? s.last))  // a step ends where the next one starts
  row('total', rows[0], rows.at(-1))
  const haiku = readSlice(path.join(runs(root), 'haiku.log'), false, 1 << 22).split('\n').filter(Boolean).map(l => l.split('\t'))
  if (haiku.length) {
    const [input, output] = [2, 3].map(i => haiku.reduce((a, r) => a + Number(r[i] || 0), 0))
    console.log(`Haiku 5.5 status summaries: ${haiku.length} calls, ${input} input + ${output} output tokens (about $${((input * 0.1 + output * 0.5) / 1e6).toFixed(3)} at API prices; counted in Claude 5h above)`)
  }
}

// Codex quota from the most recent rate-limit record in its rollout files, cached for 30 s.
function codexQuota() {
  if (cache.codex && Date.now() - cache.codex.at < 30000) return cache.codex
  const recent = dayDirs(Date.now() - 86400000).flatMap(listDir)
    .map(f => ({ f, born: stat(f)?.birthtimeMs ?? 0 })).sort((a, b) => b.born - a.born).slice(0, 12)
  let best = null
  for (const { f } of recent) {
    const e = lines(f, true).reverse().find(x => x.payload?.rate_limits?.primary)
    const at = Date.parse(e?.timestamp ?? '') || 0
    if (e && (!best || at > best.at)) best = { at, rl: e.payload.rate_limits }
  }
  if (!best) return {}
  const win = w => w && { used: w.used_percent, resets_at: w.resets_at }
  return (cache.codex = { at: Date.now(), five_hour: win(best.rl.primary), seven_day: win(best.rl.secondary) })
}

// Claude Code passes rate_limits only after a session's first reply, and drops a window once it resets.
// So every value seen is saved, and the saved one stands in (shown grey) when the session has none.
const CLAUDE_QUOTA = path.join(os.tmpdir(), 'collab-claude-quota.json')
// The later window wins; within one window, usage only grows.
const newer = (a, b) => !b ? a : !a ? b : a.resets_at !== b.resets_at ? (a.resets_at > b.resets_at ? a : b) : (a.used >= b.used ? a : b)
function claudeQuota(session) {
  let saved = {}
  try { saved = JSON.parse(fs.readFileSync(CLAUDE_QUOTA, 'utf8')) } catch {}
  const before = JSON.stringify(saved)
  const out = {}
  for (const w of ['five_hour', 'seven_day']) {
    const l = session.rate_limits?.[w]
    const live = l?.used_percentage != null ? { used: l.used_percentage, resets_at: l.resets_at } : null
    saved[w] = newer(live, saved[w])
    out[w] = saved[w] && { ...saved[w], live: !!live }
  }
  if (JSON.stringify(saved) !== before) try { fs.writeFileSync(CLAUDE_QUOTA, JSON.stringify(saved)) } catch {}
  return out
}

// Whether this session ran /collab (scheduled continues only fire in that same session). Scans its transcript,
// only the new part each time. The marker is how a typed command is stored; quoted elsewhere, its quotes are escaped.
const COLLAB_COMMAND = '"content":"<command-message>collab</command-message>'
function ranCollab(session) {
  const f = session.transcript_path, id = session.session_id
  if (!f || !id) return false
  cache.collabSessions ??= {}
  if (Object.keys(cache.collabSessions).length > 300) cache.collabSessions = {}
  const s = (cache.collabSessions[id] ??= { offset: 0, hit: false })
  if (s.hit) return true
  const size = stat(f)?.size ?? 0
  if (size < s.offset) s.offset = 0
  try {
    const fd = fs.openSync(f, 'r')
    const buf = Buffer.alloc(1 << 22)
    for (let pos = Math.max(0, s.offset - 100); pos < size && !s.hit; pos += buf.length - 100) {
      const text = buf.toString('utf8', 0, fs.readSync(fd, buf, 0, buf.length, pos))
      s.hit = text.includes(COLLAB_COMMAND)
    }
    fs.closeSync(fd)
  } catch {}
  s.offset = size
  return s.hit
}

const C = { reset: '\x1b[0m', bold: '\x1b[1m', grey: '\x1b[90m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m' }
const SEP = ` ${C.grey}·${C.reset} `
const dur = sec => (sec >= 3600 ? `${Math.floor(sec / 3600)}h${String(Math.floor((sec % 3600) / 60)).padStart(2, '0')}m` : `${Math.max(1, Math.round(sec / 60))}m`)

// "● Claude 60% ↻ 2h13m". The dot is green above 50% left, yellow from 20%, red below. All grey = not live.
function quotaPart(name, w) {
  if (!w) return null
  const now = Date.now() / 1000
  const reset = !w.resets_at || w.resets_at <= now  // the window has rolled over since this value was seen
  const left = reset ? 100 : Math.max(0, Math.round(100 - w.used))
  const timer = reset ? '' : ` ↻ ${dur(w.resets_at - now)}`
  if (w.live === false || reset) return `${C.grey}● ${name} ${left}%${timer}${C.reset}`
  const dot = left > 50 ? C.green : left >= 20 ? C.yellow : C.red
  return `${dot}●${C.reset} ${name} ${C.bold}${left}%${C.reset}${C.grey}${timer}${C.reset}`
}

// The collab run in progress for a directory (searched upward), or null.
function activeRun(dir) {
  let root = dir
  while (!fs.existsSync(path.join(root, '.collab', 'progress.md')) && path.dirname(root) !== root) root = path.dirname(root)
  const progress = readSlice(path.join(root, '.collab', 'progress.md'), false)
  const status = (progress.match(/Status:\s*(.+)/i)?.[1] ?? '').trim()
  return progress && !/^done/i.test(status) ? { root, status, progress } : null
}

// A Codex progress line, which codex-task.md asks for at the start of each step: "▶ 3/7 检查日志".
const STEP = /^▶\s*(\d+)\s*\/\s*(\d+)\s*(.*)$/m

// One line per finished event, for Haiku. Codex's own config warnings are left out.
function brief(it) {
  if (it.type === 'error') return null
  if (it.type === 'command_execution') return `ran (exit ${it.exit_code ?? '?'}): ${clip(it.command, 150)}${it.aggregated_output ? ' => ' + clip(it.aggregated_output.slice(-150), 150) : ''}`
  if (it.type === 'file_change') return `edited: ${it.changes?.map(c => path.basename(c.path)).join(', ')}`
  if (it.type === 'agent_message') return `said: ${clip(it.text, 300)}`
  return `${it.type}: ${clip(it.text ?? it.message ?? '', 150)}`
}

// What the live run is doing, read from its log incrementally and kept in .collab/runs/status.json (the status line
// writes it, the plugin only reads it): its latest progress line, the commands still running (with when they were
// first seen), and its recent events.
const statusFile = root => path.join(runs(root), 'status.json')
const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return {} } }
const writeJson = (f, v) => { try { fs.writeFileSync(f, JSON.stringify(v)) } catch {} }
function runState(root, run) {
  let s = readJson(statusFile(root))
  if (s.run !== run) s = { run, offset: 0, open: {}, recent: [] }
  let fd
  try {
    fd = fs.openSync(path.join(runs(root), `${run}.jsonl`), 'r')
    const size = fs.fstatSync(fd).size
    if (size <= s.offset) return s
    const buf = Buffer.alloc(size - s.offset)
    fs.readSync(fd, buf, 0, buf.length, s.offset)
    const end = buf.lastIndexOf(10) + 1  // whole lines only; a partial one is read next time
    s.offset += end
    for (const l of buf.toString('utf8', 0, end).split('\n')) {
      let e
      try { e = JSON.parse(l) } catch { continue }
      const it = e.item
      if (!it) continue
      if (it.type === 'command_execution') {
        if (e.type === 'item.started') s.open[it.id] = { cmd: clip(it.command, 150), at: Date.now() }
        else delete s.open[it.id]
      }
      const m = it.type === 'agent_message' && it.text?.match(STEP)
      if (m) s.step = { k: Number(m[1]), n: Number(m[2]), text: clip(m[3], 40) }
      if (e.type === 'item.completed') s.recent.push(brief(it))
    }
    s.recent = s.recent.filter(Boolean).slice(-12)
    writeJson(statusFile(root), s)
  } catch {} finally { if (fd !== undefined) fs.closeSync(fd) }
  return s
}

// Haiku's side, in .collab/runs/haiku.json (written through the plugin only): when it was last asked about which run,
// and its answer. `haiku` is Claude Haiku 5.5 from Claude Code 2.1.293 on.
const haikuFile = root => path.join(runs(root), 'haiku.json')
const HAIKU = 'haiku'
const HAIKU_SYSTEM = 'You watch the log of a coding agent. Reply with one short phrase in Chinese, at most 16 characters, '
  + 'saying what it is doing right now (not what it already finished), like 正在跑单元测试 or 修复登录接口报错. '
  + 'Only the phrase: no quotes, no trailing punctuation.'
function haikuPrompt(root, run, s) {
  const task = readSlice(path.join(runs(root), `${run}.prompt.md`), false).match(/Your task:\s*(.+)/)?.[1] ?? run
  const open = Object.values(s.open).map(o => `still running for ${Math.round((Date.now() - o.at) / 60000)} min: ${o.cmd}`)
  return [`Task: ${clip(task, 200)}`, s.step && `Its latest progress line: ${s.step.k}/${s.step.n} ${s.step.text}`,
    'Recent events, oldest first:', ...s.recent, ...open].filter(Boolean).join('\n')
}

// The status line's second row, the workflow's progress:
//   ◆ 阶段2/3 写前端  ━━━━━━──── 58% · 3/7 正在跑单元测试 · 2子代理
// `run` is the live Codex run, `s` its runState and `h` Haiku's side, when there is a run.
const REVIEW_MIN = 10, ACCEPT_MIN = 10  // rough weights of the two steps after the phases
const BAR = 10
function collabRow({ root, status, progress }, run, s, h) {
  if (/^escalated/i.test(status)) {
    const why = clip(status.replace(/^escalated\W*/i, ''), 40)
    return `${C.yellow}⚠ collab 等你决定${C.reset}${why ? SEP + C.grey + why + C.reset : ''}`
  }
  const now = (progress.match(/Now:\s*(.+)/i)?.[1] ?? '').trim()
  // The phases from the checklist, each weighted by its estimate "(~25m)", 20 minutes without one.
  const phases = [...progress.matchAll(/^\s*- \[([ x])\](.*)$/gim)].map(m => ({ done: m[1] !== ' ', min: Number(m[2].match(/\(~(\d+)\s*m\)/)?.[1] ?? 20) }))
  const sum = list => list.reduce((a, p) => a + p.min, 0)
  const done = phases.filter(p => p.done).length
  const isPhase = /^phase/i.test(status), isReview = /^review/i.test(status), isAccept = /^accept/i.test(status)
  const stage = isPhase ? `阶段${Math.min(done + 1, phases.length)}/${phases.length}`
    : /^plan/i.test(status) ? '规划' : isReview ? '代码审查' : isAccept ? '验收' : 'collab'
  // How far into the current step: Codex's progress lines while the phase's own run works;
  // a fix run, or Claude checking after the run, counts as nearly done.
  let frac = 0
  if (isPhase) {
    const base = `phase-${done + 1}`
    frac = run === base ? (s.step ? (s.step.k - 1) / s.step.n : 0) : fs.existsSync(path.join(runs(root), `${base}.exit`)) ? 0.9 : 0
  } else if (isReview || isAccept) frac = 0.5
  const doneMin = sum(phases.filter(p => p.done)) + (isAccept ? REVIEW_MIN : 0)
  const curMin = isPhase ? (phases.find(p => !p.done)?.min ?? 0) : isReview ? REVIEW_MIN : isAccept ? ACCEPT_MIN : 0
  const pct = Math.min(99, Math.round((100 * (doneMin + curMin * frac)) / (sum(phases) + REVIEW_MIN + ACCEPT_MIN)))
  const filled = Math.round((pct / 100) * BAR)
  const bar = `${C.cyan}${'━'.repeat(filled)}${C.grey}${'─'.repeat(BAR - filled)}${C.reset}`

  const row = [`${C.cyan}◆${C.reset} ${stage}${now && now !== stage ? ' ' + now : ''}  ${bar} ${C.bold}${pct}%${C.reset}`]
  if (run) {
    const activity = h.run === run && h.text && Date.now() - h.at < 180000 ? h.text : s.step?.text
    const step = s.step ? `${C.grey}${s.step.k}/${s.step.n}${C.reset}` : ''
    if (step || activity) row.push([step, activity].filter(Boolean).join(' '))
    const r = runInfo(root, run)
    const agents = r.files.filter(f => f.agent && f.type !== 'task_complete' && Date.now() - f.at < 1800000).length
    if (agents) row.push(`${C.grey}${agents}子代理${C.reset}`)
    const busy = Math.floor(Math.max(0, ...Object.values(s.open).map(o => Date.now() - o.at)) / 60000)
    if (busy >= 2) row.push(`${busy >= 10 ? C.yellow : C.grey}命令已跑${busy}分钟${C.reset}`)
    const quiet = Math.floor((Date.now() - r.last) / 60000)
    if (quiet >= 10) row.push(`${quiet >= 30 ? C.red : C.yellow}上次运行${quiet}分钟前${C.reset}`)
  }
  return row.join(SEP)
}

function statusLine(session) {
  const cl = claudeQuota(session)
  const cx = codexQuota()
  const ctx = session.context_window?.used_percentage
  const ctxColor = ctx >= 90 ? C.red : ctx >= 70 ? C.yellow : ''
  const u = session.context_window?.current_usage  // same input-only sum that used_percentage is based on
  const ctxTokens = u ? `${Math.round(((u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)) / 1000)}k  ` : ''
  const top = [quotaPart('Claude', cl.five_hour), quotaPart('Codex', cx.five_hour),
    ctx != null && `${C.grey}上下文：${C.reset}${ctxTokens}${ctxColor}${Math.round(ctx)}%${C.reset}`].filter(Boolean).join(SEP)

  if (!ranCollab(session)) return top
  const run = activeRun(session.workspace?.current_dir ?? session.cwd ?? process.cwd())
  if (!run) return top

  // Record quota for the report: on every step change, and at most every 5 minutes otherwise.
  const log = path.join(runs(run.root), 'quota.log')
  const lastRow = readSlice(log, true, 512).trim().split('\n').at(-1)?.split('\t') ?? []
  if (lastRow[1] !== run.status || Date.now() - (stat(log)?.mtimeMs ?? 0) > 300000) {
    const used = w => (!w ? '' : w.resets_at > Date.now() / 1000 ? w.used : 0)  // a rolled-over window starts again at 0
    const row = [new Date().toISOString(), run.status, used(cl.five_hour), used(cl.seven_day), used(cx.five_hour), used(cx.seven_day)]
    try { fs.mkdirSync(runs(run.root), { recursive: true }); fs.appendFileSync(log, row.join('\t') + '\n') } catch {}
  }
  const codex = currentRun(run.root)
  const s = codex && runState(run.root, codex)
  return `${top}\n${collabRow(run, codex, s, codex ? readJson(haikuFile(run.root)) : {})}`
}

// For the plugin: whether this session ran /collab and, at most once a minute while Codex works and only when its log
// moved since the last question, a question for Haiku about what Codex is doing. Runs in the session's directory.
function pluginPoll(sid) {
  cache.collabSessions ??= {}
  let transcript = cache.collabSessions[sid]?.path
  if (!transcript) {
    const projects = path.join(os.homedir(), '.claude', 'projects')
    try { transcript = fs.readdirSync(projects).map(d => path.join(projects, d, `${sid}.jsonl`)).find(f => fs.existsSync(f)) } catch {}
  }
  const collab = !!transcript && ranCollab({ session_id: sid, transcript_path: transcript })
  if (transcript) cache.collabSessions[sid].path = transcript
  const act = collab && activeRun(process.cwd())
  const codex = act && currentRun(act.root)
  if (!codex) return { collab }
  const s = readJson(statusFile(act.root))
  const h = readJson(haikuFile(act.root))
  if (s.run !== codex || !s.recent?.length) return { collab }
  if (h.run === codex && (h.askedOffset === s.offset || Date.now() - h.askedAt < 60000)) return { collab }
  writeJson(haikuFile(act.root), { ...(h.run === codex ? h : {}), run: codex, askedAt: Date.now(), askedOffset: s.offset })
  return { collab, ask: { run: codex, model: HAIKU, system: HAIKU_SYSTEM, prompt: haikuPrompt(act.root, codex, s) } }
}

// Haiku's answer from the plugin ({ run, text, usage } on stdin): shown in the progress row, its cost logged for the report.
async function haikuNote() {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  const { run, text, usage = {} } = JSON.parse(input)
  const act = activeRun(process.cwd())
  if (!act) return
  const h = readJson(haikuFile(act.root))
  const phrase = String(text ?? '').split('\n').map(l => l.trim()).find(Boolean)?.replace(/^["'“「]+|["'”」。.!！]+$/g, '').slice(0, 24)
  if (phrase && h.run === run) writeJson(haikuFile(act.root), { ...h, text: phrase, at: Date.now() })
  const row = [new Date().toISOString(), run, usage.input_tokens ?? 0, usage.output_tokens ?? 0, usage.cache_read_input_tokens ?? 0, usage.cache_creation_input_tokens ?? 0]
  fs.appendFileSync(path.join(runs(act.root), 'haiku.log'), row.join('\t') + '\n')
}

const [cmd, ...args] = process.argv.slice(2)
if (cmd === 'watch') await watch(args[0], args[1], Number(args[2] ?? 10))
else if (cmd === 'inspect') inspect(args[0], args[1])
else if (cmd === 'quota') quotaTable(args[0])
else if (cmd === 'plugin') { console.log(JSON.stringify(pluginPoll(args[0]))); saveCache() }
else if (cmd === 'haiku') await haikuNote()
else if (cmd === 'line') {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  let session = {}
  try { session = JSON.parse(input) } catch {}
  try { process.stdout.write(statusLine(session)) } catch { process.stdout.write('') }
  saveCache()
} else console.log('usage: codex-status.mjs watch|inspect|quota|line|plugin ...')
