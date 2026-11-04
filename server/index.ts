import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, resolve, sep } from 'node:path'
import { ResponseEngine } from '../src/lib/network'
import { illustrativeRoute, resolveLocation } from '../src/lib/response'
import type { ResponseNetwork } from '../src/lib/types'
import { understandCall } from './understanding'
import { attachSpeech } from './speech'
import { LocationResolutionError } from '../src/lib/geocoding'

if (existsSync('.env')) process.loadEnvFile('.env')
const port = Number(process.env.API_PORT || 3001)
const dataFile = process.env.SIMULATION_DATA_FILE === ':memory:' ? null : resolve(process.env.SIMULATION_DATA_FILE || '.data/aegis-network.json')
const offline = process.env.SIMULATION_OFFLINE === '1'
const routePlanner = offline ? async (...args: Parameters<typeof illustrativeRoute>) => illustrativeRoute(...args) : undefined
let saved: ResponseNetwork | undefined
if (dataFile && existsSync(dataFile)) {
  try {
    const data = JSON.parse(readFileSync(dataFile, 'utf8'))
    if (data.version === 3 && Array.isArray(data.missions) && Array.isArray(data.resources) && Array.isArray(data.hospitals) && Array.isArray(data.stations) && Array.isArray(data.regions)) saved = data
  } catch { console.warn('Stored simulation could not be read; starting a new resource pool.') }
}
let engine = new ResponseEngine(saved, routePlanner)
engine.network.understandingMode = process.env.MISTRAL_API_KEY ? 'ai' : 'local'
const clients = new Set<ServerResponse>()
const submissions = new Map<string, Promise<string>>()
let lastPersisted = -1
let lastBroadcast = -1

function persist() {
  if (!dataFile || lastPersisted === engine.network.revision) return
  try {
    mkdirSync(dirname(dataFile), { recursive: true })
    writeFileSync(`${dataFile}.tmp`, JSON.stringify(engine.network))
    renameSync(`${dataFile}.tmp`, dataFile)
    lastPersisted = engine.network.revision
  } catch (error) { console.error('Could not persist the simulation:', error instanceof Error ? error.message : error) }
}

function broadcast(force = false) {
  if (!force && lastBroadcast === engine.network.revision) return
  const message = `data: ${JSON.stringify(engine.network)}\n\n`
  for (const client of clients) {
    if (client.destroyed || client.writableLength > 2_000_000) { client.destroy(); clients.delete(client); continue }
    client.write(message)
  }
  lastBroadcast = engine.network.revision
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end(JSON.stringify(value))
}
async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = ''
  for await (const chunk of request) {
    text += chunk.toString()
    if (Buffer.byteLength(text) > 40000) throw new Error('Request is too large')
  }
  const parsed = JSON.parse(text || '{}')
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error('Expected a JSON object')
  return parsed
}

const dist = resolve('dist')
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' }
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
    if (request.method === 'GET' && url.pathname === '/api/health') { json(response, 200, { ok: true, speechConfigured: Boolean(process.env.MISTRAL_API_KEY) }); return }
    if (request.method === 'GET' && url.pathname === '/api/state') { json(response, 200, engine.network); return }
    if (request.method === 'GET' && url.pathname === '/api/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
      response.write(`retry: 1500\ndata: ${JSON.stringify(engine.network)}\n\n`)
      clients.add(response)
      request.on('close', () => clients.delete(response))
      return
    }
    if (request.method === 'POST' && url.pathname === '/api/missions') {
      const body = await readBody(request)
      if (typeof body.transcript !== 'string' || !body.transcript.trim() || body.transcript.length > 12000 || typeof body.requestId !== 'string' || !/^[\w-]{8,100}$/.test(body.requestId)) {
        json(response, 400, { error: 'Provide a nonempty emergency description (up to 12,000 characters) and a request identifier.' }); return
      }
      const requestId = body.requestId
      const existing = engine.network.missions.find((mission) => mission.requestId === requestId)
      if (existing) { json(response, 200, { missionId: existing.id }); return }
      let work = submissions.get(requestId)
      if (!work) {
        const transcript = body.transcript.trim()
        work = (async () => {
          const details = await understandCall(transcript)
          const location = await resolveLocation(details, { offline })
          const mission = engine.submit(details, location, requestId)
          persist(); broadcast(true)
          return mission.id
        })()
        submissions.set(requestId, work)
      }
      try { json(response, 201, { missionId: await work }) }
      finally { submissions.delete(requestId) }
      return
    }
    const control = url.pathname.match(/^\/api\/missions\/([\w-]+)\/control$/)
    if (request.method === 'POST' && control) {
      const body = await readBody(request)
      if (body.paused !== undefined && typeof body.paused !== 'boolean' || body.speed !== undefined && ![1, 2, 4].includes(Number(body.speed))) { json(response, 400, { error: 'Invalid playback control' }); return }
      const mission = engine.control(control[1], { paused: body.paused as boolean | undefined, speed: body.speed === undefined ? undefined : Number(body.speed) })
      persist(); broadcast(true); json(response, 200, { missionId: mission.id }); return
    }
    if (process.env.SIMULATION_TEST_MODE === '1' && request.method === 'POST' && url.pathname === '/api/test/reset') {
      await engine.whenReady()
      engine = new ResponseEngine(undefined, routePlanner)
      lastPersisted = -1; lastBroadcast = -1
      broadcast(true); json(response, 200, { ok: true }); return
    }
    if (url.pathname.startsWith('/api/')) { json(response, 404, { error: 'API route not found' }); return }
    if (!['GET', 'HEAD'].includes(request.method || '')) { json(response, 405, { error: 'Method not allowed' }); return }
    const page = ['/', '/simulation'].includes(url.pathname)
    const file = resolve(dist, page ? 'index.html' : `.${decodeURIComponent(url.pathname)}`)
    if (!file.startsWith(dist + sep) || !existsSync(file) || !statSync(file).isFile()) { json(response, 404, { error: 'Page or asset not found. Run npm run build to serve the app here.' }); return }
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': page ? 'no-cache' : 'public, max-age=3600' })
    if (request.method === 'HEAD') response.end()
    else createReadStream(file).pipe(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed'
    if (!response.headersSent) json(response, error instanceof LocationResolutionError ? 422 : message === 'Mission not found' ? 404 : 400, { error: message, ...(error instanceof LocationResolutionError ? { code: error.code } : {}) })
  }
})

let previous = performance.now()
const tick = setInterval(() => {
  const now = performance.now()
  engine.tick(Math.min(1, (now - previous) / 1000))
  previous = now
  broadcast()
}, 200)
const persistence = setInterval(persist, 1000)
const heartbeat = setInterval(() => { for (const client of clients) client.write(': heartbeat\n\n') }, 15000)
const speechSockets = attachSpeech(server)
server.listen(port, '0.0.0.0', () => console.log(`Aegis Response server: http://localhost:${port} (${engine.network.understandingMode} understanding)`))
function shutdown() {
  clearInterval(tick); clearInterval(persistence); clearInterval(heartbeat)
  persist()
  for (const client of clients) client.end()
  for (const client of speechSockets.clients) client.close()
  server.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
