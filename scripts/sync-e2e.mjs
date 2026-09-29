/**
 * End-to-end check of the sync server: real WebSocket clients, real Yjs docs.
 *
 * Run with: npm run test:e2e
 *
 * It boots server.js on a throwaway port with persistence in a temp directory,
 * so it never disturbs a dev server or your real snapshots.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import WebSocket from 'ws'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const PORT = Number(process.env.E2E_PORT || 1236)
const ROOM = 'collection-e2e'
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const dataDir = await mkdtemp(join(tmpdir(), 'crdt-e2e-'))
let failures = 0
let currentServer = null

const startServer = (port = PORT) => {
  const proc = spawn(process.execPath, [join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), PERSIST_DIR: dataDir, LOG_LEVEL: 'error' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.resume()
  proc.stderr.on('data', (chunk) => {
    const text = String(chunk)
    if (/error|Error/.test(text)) process.stderr.write(`  [srv] ${text}`)
  })
  return proc
}

const waitFor = async (label, predicate, timeout = 10000) => {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    if (await predicate()) return
    await sleep(50)
  }
  throw new Error(`timed out waiting for: ${label}`)
}

const canConnect = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' })
    const done = (value) => {
      socket.destroy()
      resolve(value)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })

/** Wait until the port is actually accepting connections (no fixed sleeps). */
const waitForServer = (port = PORT) =>
  waitFor(`server listening on ${port}`, () => canConnect(port), 15000)

const connect = (room = ROOM) => {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(`ws://localhost:${PORT}`, room, doc, {
    WebSocketPolyfill: WebSocket,
    connect: true,
    disableBc: true, // force everything through the server
  })
  return { doc, provider, requests: doc.getArray('requests') }
}

const assert = (condition, message) => {
  if (!condition) throw new Error(`assertion failed: ${message}`)
  console.log(`  ok  ${message}`)
}

/**
 * Reconnect the way crdtService does: after the socket comes back the local
 * awareness state is written again, which bumps the clock so peers accept the
 * re-announcement instead of discarding it as stale.
 */
const reconnect = async (client) => {
  client.provider.connect()
  await waitFor(`${client.label || 'client'} reconnected`, () => client.provider.wsconnected)
  const state = client.provider.awareness.getLocalState()
  if (state) client.provider.awareness.setLocalState({ ...state })
}

const scenario = async (name, fn) => {
  console.log(`\n- ${name}`)
  try {
    await fn()
  } catch (error) {
    failures++
    console.log(`  FAIL ${error.message}`)
  }
}

const clients = []

try {
  currentServer = startServer()
  await waitForServer()

  const a = connect()
  const b = connect()
  clients.push(a, b)
  await waitFor('both clients connected', () => a.provider.wsconnected && b.provider.wsconnected)

  await scenario('edits replicate between clients', async () => {
    a.doc.transact(() => {
      const request = new Y.Map()
      request.set('id', 'r1')
      request.set('name', 'Get Users')
      a.requests.push([request])
    })
    await waitFor('replication', () => b.requests.length === 1)
    assert(b.requests.get(0).get('name') === 'Get Users', 'request replicated to peer')
  })

  await scenario('presence (awareness) is shared', async () => {
    a.provider.awareness.setLocalStateField('user', { name: 'Alice' })
    b.provider.awareness.setLocalStateField('user', { name: 'Bob' })
    await waitFor('presence', () => b.provider.awareness.getStates().size === 2)
    const names = [...b.provider.awareness.getStates().values()].map((s) => s?.user?.name)
    assert(names.includes('Alice') && names.includes('Bob'), `both users visible: ${names.join(', ')}`)
  })

  await scenario('concurrent offline edits merge without conflicts', async () => {
    a.provider.disconnect()
    b.provider.disconnect()
    await sleep(300)

    a.doc.transact(() => a.requests.get(0).set('url', 'https://a.example.com/v2'))
    b.doc.transact(() => b.requests.get(0).set('method', 'POST'))

    await reconnect(a)
    await reconnect(b)

    await waitFor('convergence', () => {
      const x = a.requests.get(0)
      const y = b.requests.get(0)
      return x.get('url') === y.get('url') && x.get('method') === y.get('method') &&
        x.get('url') === 'https://a.example.com/v2' && x.get('method') === 'POST'
    })
    assert(a.requests.length === 1 && b.requests.length === 1, 'no duplicated or lost requests')
    assert(a.requests.get(0).get('url') === b.requests.get(0).get('url'), 'urls converged')
    assert(a.requests.get(0).get('method') === b.requests.get(0).get('method'), 'methods converged')
  })

  await scenario('a late joiner receives the full document', async () => {
    const c = connect()
    clients.push(c)
    await waitFor('late joiner synced', () => c.provider.synced)
    await waitFor('late joiner history', () => c.requests.length === 1)
    assert(
      c.requests.get(0).get('url') === 'https://a.example.com/v2',
      'late joiner received existing document (a stateless relay cannot do this)'
    )
    c.provider.destroy()
  })

  await scenario('rooms are isolated from each other', async () => {
    const d = connect('collection-other')
    clients.push(d)
    await waitFor('other room synced', () => d.provider.synced)
    assert(d.requests.length === 0, 'unrelated room is empty')
    d.provider.destroy()
  })

  await scenario('presence follows a dropped and returning client', async () => {
    // y-websocket keeps its awareness state when it disconnects, so the server
    // is the only place that can clean it up when the socket goes away.
    const names = () => [...a.provider.awareness.getStates().values()].map((s) => s?.user?.name)
    await waitFor('both peers online', () => a.provider.awareness.getStates().size === 2)

    b.provider.disconnect()
    await waitFor('presence removal', () => a.provider.awareness.getStates().size === 1)
    assert(!names().includes('Bob'), `stale presence cleaned up (online: ${names().join(', ')})`)

    // On the way back in, re-announce with a fresh awareness clock, exactly as
    // crdtService.republishPresence does after a reconnect.
    await reconnect(b)

    await waitFor('presence restored', () => a.provider.awareness.getStates().size === 2)
    assert(names().includes('Bob'), `presence came back (online: ${names().join(', ')})`)
  })

  for (const client of clients) client.provider.destroy()
  clients.length = 0
  await sleep(2500) // allow the debounced snapshot to flush
  currentServer.kill('SIGTERM')
  await sleep(1000)

  await scenario('documents survive a server restart', async () => {
    currentServer = startServer()
    await waitForServer()
    const e = connect()
    clients.push(e)
    await waitFor('reconnected', () => e.provider.synced)
    await waitFor('restored', () => e.requests.length === 1)
    assert(e.requests.length === 1, 'document restored from disk')
    assert(e.requests.get(0).get('method') === 'POST', 'restored with merged values')
    e.provider.destroy()
    clients.length = 0
  })

  await scenario('malformed messages cannot take the server down', async () => {
    const port = PORT + 1
    const server = startServer(port)
    await waitForServer(port)
    const socket = new WebSocket(`ws://localhost:${port}/collection-junk`)
    await sleep(500)
    socket.send(Buffer.from([0xff, 0xff, 0xff, 0xff]))
    socket.send('not binary at all')
    await sleep(500)
    assert(socket.readyState === WebSocket.OPEN, 'connection survives garbage input')
    socket.close()
    server.kill('SIGTERM')
    await sleep(500)
  })
} finally {
  clients.forEach((c) => c.provider.destroy())
  if (currentServer && currentServer.exitCode === null) currentServer.kill('SIGKILL')
  await rm(dataDir, { recursive: true, force: true }).catch(() => {})
}

console.log(failures === 0 ? '\nAll sync server checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
