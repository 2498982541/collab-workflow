// Prints the first port from <preferred> up that can really be bound right now:  node free-port.mjs 3000
// Binding is the only reliable test: under WSL mirrored networking, ports held on the Windows side don't show in ss/netstat.
import net from 'node:net'

const canBind = port => new Promise(resolve => {
  const s = net.createServer()
  s.once('error', () => resolve(false))
  s.listen(port, () => s.close(() => resolve(true)))
})

const start = Number(process.argv[2] ?? 3000)
for (let port = start; port < start + 200; port++) {
  if (await canBind(port)) { console.log(port); process.exit(0) }
}
console.error(`no free port in ${start}-${start + 199}`)
process.exit(1)
