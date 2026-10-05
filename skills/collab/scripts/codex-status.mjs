// Status helpers for /collab Codex runs (Node >= 18, no dependencies).
//   node codex-status.mjs watch <root> <run> <minutes>  sentinel: prints DONE when the run ends, or SILENT once
//                                                        neither Codex nor any of its sub-agents has done anything for <minutes>
//   node codex-status.mjs inspect <root> <run>           diagnosis bundle for a quiet run (events, sub-agents, processes)
//   node codex-status.mjs quota <root>                   quota change per step, from .collab/runs/quota.log
//   node codex-status.mjs line                           Claude Code status line (session JSON on stdin)
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
    if (pid && !alive(pid)) { console.log(`DONE ${run} (codex-run.ps1 is gone without an exit code)`); break }
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
    const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(HERE, 'codex-proc.ps1'), 'list', run, '5'], { cwd: root, encoding: 'utf8' })
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
}

// Codex quota from the most recent rate-limit record in its rollout files, cached for 30 s.
function codexQuota() {
  if (cache.quota?.h5 != null && Date.now() - cache.quota.at < 30000) return cache.quota
  const recent = dayDirs(Date.now() - 86400000).flatMap(listDir)
    .map(f => ({ f, born: stat(f)?.birthtimeMs ?? 0 })).sort((a, b) => b.born - a.born).slice(0, 12)
  let best = null
  for (const { f } of recent) {
    const e = lines(f, true).reverse().find(x => x.payload?.rate_limits?.primary)
    const at = Date.parse(e?.timestamp ?? '') || 0
    if (e && (!best || at > best.at)) best = { at, rl: e.payload.rate_limits }
  }
  if (!best) return {}
  const now = Date.now() / 1000
  const used = w => (w ? (w.resets_at > now ? w.used_percent : 0) : null)
  return (cache.quota = { at: Date.now(), h5: used(best.rl.primary), wk: used(best.rl.secondary) })
}

function statusLine(session) {
  const cq = codexQuota()
  const c5 = session.rate_limits?.five_hour?.used_percentage
  const quota = [cq.h5 != null && `Codex 5h余${Math.round(100 - cq.h5)}%`, c5 != null && `Claude 5h余${Math.round(100 - c5)}%`].filter(Boolean).join(' · ')

  let root = session.workspace?.current_dir ?? session.cwd ?? process.cwd()
  while (!fs.existsSync(path.join(root, '.collab', 'progress.md')) && path.dirname(root) !== root) root = path.dirname(root)
  const progress = readSlice(path.join(root, '.collab', 'progress.md'), false)
  const status = (progress.match(/Status:\s*(.+)/i)?.[1] ?? '').trim()
  if (!progress || /^done/i.test(status)) return quota
  if (/^escalated/i.test(status)) return `⚠ collab 等你决定 │ ${quota}`

  const now = (progress.match(/Now:\s*(.+)/i)?.[1] ?? '').trim()
  const done = (progress.match(/^\s*- \[x\]/gim) ?? []).length
  const total = done + (progress.match(/^\s*- \[ \]/gim) ?? []).length
  const steps = total + 2  // phases + review + acceptance
  let doneSteps = /^review/i.test(status) ? total : /^accept/i.test(status) ? total + 1 : done
  const bits = [`⚙ ${/^phase/i.test(status) ? `阶段${Math.min(done + 1, total)}/${total}` : 'collab'}${now ? ' ' + now : ''}`]

  const run = currentRun(root)
  if (run) {
    const r = runInfo(root, run)
    const todo = lines(r.log, true).reverse().find(e => e.item?.type === 'todo_list')?.item.items
    if (todo?.length && /^phase/i.test(status)) doneSteps += todo.filter(t => t.completed).length / todo.length
    const agents = r.files.filter(f => f.agent && f.type !== 'task_complete' && Date.now() - f.at < 1800000).length
    if (agents) bits.push(`${agents}子代理`)
    const quiet = Math.floor((Date.now() - r.last) / 60000)
    if (quiet >= 10) bits.push(`⏸${quiet}分钟无动静`)
  }
  bits.splice(1, 0, `约${Math.round((100 * doneSteps) / steps)}%`)

  // Record quota for the report: on every step change, and at most every 5 minutes otherwise.
  const log = path.join(runs(root), 'quota.log')
  const lastRow = readSlice(log, true, 512).trim().split('\n').at(-1)?.split('\t') ?? []
  if (lastRow[1] !== status || Date.now() - (stat(log)?.mtimeMs ?? 0) > 300000) {
    const row = [new Date().toISOString(), status, c5 ?? '', session.rate_limits?.seven_day?.used_percentage ?? '', cq.h5 ?? '', cq.wk ?? '']
    try { fs.mkdirSync(runs(root), { recursive: true }); fs.appendFileSync(log, row.join('\t') + '\n') } catch {}
  }
  return `${bits.join(' · ')} │ ${quota}`
}

const [cmd, ...args] = process.argv.slice(2)
if (cmd === 'watch') await watch(args[0], args[1], Number(args[2] ?? 10))
else if (cmd === 'inspect') inspect(args[0], args[1])
else if (cmd === 'quota') quotaTable(args[0])
else if (cmd === 'line') {
  let input = ''
  for await (const chunk of process.stdin) input += chunk
  let session = {}
  try { session = JSON.parse(input) } catch {}
  try { process.stdout.write(statusLine(session)) } catch { process.stdout.write('') }
  saveCache()
} else console.log('usage: codex-status.mjs watch|inspect|quota|line ...')
