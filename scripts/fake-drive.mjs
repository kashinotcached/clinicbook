// A stand-in for the Google Drive app folder, for testing sync on a developer machine.
// node scripts/fake-drive.mjs  ->  http://127.0.0.1:4599
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'

const files = new Map() // id -> { id, name, modifiedTime, data }
const body = (req) => new Promise((ok) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => ok(Buffer.concat(c))) })

createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', '*')
  if (req.method === 'OPTIONS') return res.end()
  const url = new URL(req.url, 'http://x')
  const id = url.pathname.split('/')[2]
  if (req.method === 'GET' && !id) {
    res.setHeader('Content-Type', 'application/json')
    return res.end(JSON.stringify([...files.values()].map(({ data, ...f }) => ({ ...f, size: String(data.length) }))))
  }
  if (req.method === 'GET') { const f = files.get(id); if (!f) { res.statusCode = 404; return res.end() } return res.end(f.data) }
  if (req.method === 'POST') {
    const f = { id: randomUUID(), name: url.searchParams.get('name'), modifiedTime: new Date().toISOString(), data: await body(req) }
    files.set(f.id, f)
    res.setHeader('Content-Type', 'application/json')
    return res.end(JSON.stringify({ id: f.id }))
  }
  if (req.method === 'PUT') { const f = files.get(id); if (f) { f.data = await body(req); f.modifiedTime = new Date().toISOString() } return res.end() }
  if (req.method === 'DELETE') { files.delete(id); return res.end() }
  res.statusCode = 405; res.end()
}).listen(4599, '127.0.0.1', () => console.log('fake drive on http://127.0.0.1:4599'))
