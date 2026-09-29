import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const PORT = Number(process.env.PORT || 1234)
const HOST = process.env.HOST || '0.0.0.0'
const MAX_MESSAGE_SIZE = 1024 * 1024 // 1MB max message size
const MAX_CLIENTS_PER_ROOM = Number(process.env.MAX_CLIENTS_PER_ROOM || 100)
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 1000)
const PERSIST_DIR = process.env.PERSIST_DIR || join(process.cwd(), '.yjs-data')
const PERSIST_DEBOUNCE_MS = Number(process.env.PERSIST_DEBOUNCE_MS || 2000)
const MAX_ROOM_ID = 128
const PERSIST_ENABLED = process.env.PERSIST !== 'false'

const messageSync = 0
const messageAwareness = 1
const messageQueryAwareness = 3

const log = (...args) => console.log(new Date().toISOString().slice(11, 19), '[sync]', ...args)

/**
 * Sanitise a room name so it can never escape the persistence directory.
 * Room ids are opaque strings, so we keep them URL/filename safe.
 */
const sanitizeRoomName = (raw) => {
  const room = String(raw || 'default')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/^\.+/, '')
    .slice(0, MAX_ROOM_ID)
  return room || 'default'
}

/**
 * A room is the server-side authoritative copy of one Yjs document plus the
 * awareness (presence) state of everybody currently connected to it.
 *
 * The document is the single source of truth for late joiners: a client that
 * connects to an otherwise empty room still receives the full history, which a
 * stateless relay could not do.
 */
class Room {
  constructor(name) {
    this.name = name
    this.doc = new Y.Doc()
    this.awareness = new awarenessProtocol.Awareness(this.doc)
    this.awareness.setLocalState(null) // the server is not a participant
    this.conns = new Set()
    this.persistTimer = null
    this.destroyed = false
    this.ready = Promise.resolve()

    this.doc.on('update', this.#onDocUpdate)
    this.awareness.on('update', this.#onAwarenessUpdate)
  }

  get clientCount() {
    return this.conns.size
  }

  #onDocUpdate = (update, origin) => {
    if (origin === 'persistence') return // just loaded from disk, nothing to save
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeUpdate(encoder, update)
    this.broadcast(encoding.toUint8Array(encoder), origin instanceof Object ? origin : null)
    this.schedulePersist()
  }

  #onAwarenessUpdate = ({ added, updated, removed }, origin) => {
    // Remember which awareness ids a socket introduced so they can be removed
    // when that socket disconnects.
    if (origin && typeof origin.controlledIds?.add === 'function') {
      added.forEach((id) => origin.controlledIds.add(id))
      removed.forEach((id) => origin.controlledIds.delete(id))
    }

    const changed = added.concat(updated, removed)
    if (changed.length === 0) return

    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageAwareness)
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)
    )
    // Echoing to the sender is safe: applyAwarenessUpdate ignores updates whose
    // clock it has already seen, so this cannot loop.
    this.broadcast(encoding.toUint8Array(encoder), null)
  }

  addConnection(conn) {
    this.conns.add(conn)
  }

  /**
   * Drop a socket and clean up the presence it introduced, so a collaborator
   * that closes the tab or loses the network does not linger in the UI.
   */
  removeConnection(conn) {
    this.conns.delete(conn)
    const controlled = Array.from(conn.controlledIds)
    conn.controlledIds.clear()
    if (controlled.length > 0) {
      awarenessProtocol.removeAwarenessStates(this.awareness, controlled, null)
    }
  }

  /** Send the whole document to a freshly connected client (sync step 1/2). */
  sendStateTo(socket) {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeSyncStep1(encoder, this.doc)
    socket.send(encoding.toUint8Array(encoder))

    const states = this.awareness.getStates()
    if (states.size > 0) {
      const awarenessEncoder = encoding.createEncoder()
      encoding.writeVarUint(awarenessEncoder, messageAwareness)
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(states.keys()))
      )
      socket.send(encoding.toUint8Array(awarenessEncoder))
    }
  }

  broadcast(message, exclude = null) {
    for (const conn of this.conns) {
      if (conn === exclude || conn.socket.readyState !== 1) continue
      try {
        conn.socket.send(message)
      } catch (error) {
        log('failed to send to client:', error.message)
      }
    }
  }

  schedulePersist() {
    if (!PERSIST_ENABLED || this.destroyed) return
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.persist().catch((error) => log('persist failed:', error.message))
    }, PERSIST_DEBOUNCE_MS)
    this.persistTimer.unref?.()
  }

  async persist() {
    if (!PERSIST_ENABLED) return
    try {
      await mkdir(PERSIST_DIR, { recursive: true })
      const update = Y.encodeStateAsUpdate(this.doc)
      await writeFile(join(PERSIST_DIR, `${this.name}.bin`), Buffer.from(update))
    } catch (error) {
      log('persist failed:', error.message)
    }
  }

  async loadPersisted() {
    if (!PERSIST_ENABLED) return false
    try {
      const buffer = await readFile(join(PERSIST_DIR, `${this.name}.bin`))
      Y.applyUpdate(this.doc, new Uint8Array(buffer), 'persistence')
      return true
    } catch (error) {
      if (error.code !== 'ENOENT') log('failed to load snapshot:', error.message)
      return false
    }
  }

  destroy() {
    this.destroyed = true
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.doc.off('update', this.#onDocUpdate)
    this.awareness.off('update', this.#onAwarenessUpdate)
    this.doc.destroy()
    this.awareness.destroy()
  }
}

const rooms = new Map()

/**
 * Look up a room, creating it synchronously so the connection handlers below
 * can be attached without losing the client's first (sync) message.
 * Persistence is loaded through `room.ready`, which gates all message
 * processing so nobody ever observes a half-loaded document.
 */
const getRoom = (rawName) => {
  const name = sanitizeRoomName(rawName)
  const existing = rooms.get(name)
  if (existing) return existing

  if (rooms.size >= MAX_ROOMS) {
    throw new Error('server is at capacity, try again later')
  }

  const room = new Room(name)
  rooms.set(name, room)
  room.ready = room.loadPersisted().then(() => {
    log(`room ready: ${name}`)
  })
  return room
}

/** Persist and drop rooms that nobody is connected to. */
const evictEmptyRooms = async () => {
  for (const [name, room] of rooms) {
    if (room.clientCount > 0) continue
    await room.persist()
    room.destroy()
    rooms.delete(name)
    log(`room closed: ${name}`)
  }
}

const wss = new WebSocketServer({
  host: HOST,
  port: PORT,
  maxPayload: MAX_MESSAGE_SIZE
})

wss.on('connection', (socket, req) => {
  const clientIp = req.socket.remoteAddress
  if (socket.binaryType !== 'nodebuffer') socket.binaryType = 'arraybuffer'

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  // y-websocket puts the room in the path; `?room=` is accepted as a fallback.
  const pathRoom = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  const roomName = sanitizeRoomName(url.searchParams.get('room') || pathRoom || 'default')

  let room
  try {
    room = getRoom(roomName)
  } catch (error) {
    log('rejecting connection:', error.message)
    socket.close(1013, 'Server at capacity')
    return
  }

  if (room.clientCount >= MAX_CLIENTS_PER_ROOM) {
    log(`room ${roomName} is full, rejecting connection`)
    socket.close(1013, 'Room full')
    return
  }

  const conn = { socket, controlledIds: new Set() }
  room.addConnection(conn)
  log(`client joined ${roomName} (${room.clientCount} online) from ${clientIp}`)

  const handleMessage = (data) => {
    try {
      if (data.byteLength > MAX_MESSAGE_SIZE) {
        log(`message too large from ${clientIp}`)
        socket.close(1009, 'Message too large')
        return
      }

      const message = new Uint8Array(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
      )
      const encoder = encoding.createEncoder()
      const decoder = decoding.createDecoder(message)
      const messageType = decoding.readVarUint(decoder)

      switch (messageType) {
        case messageSync:
          encoding.writeVarUint(encoder, messageSync)
          syncProtocol.readSyncMessage(decoder, encoder, room.doc, conn)
          // Only reply when the incoming message asked for a reply.
          if (encoding.length(encoder) > 1) {
            socket.send(encoding.toUint8Array(encoder))
          }
          break
        case messageAwareness:
          awarenessProtocol.applyAwarenessUpdate(
            room.awareness,
            decoding.readVarUint8Array(decoder),
            conn
          )
          break
        case messageQueryAwareness: {
          const states = room.awareness.getStates()
          if (states.size === 0) break
          encoding.writeVarUint(encoder, messageAwareness)
          encoding.writeVarUint8Array(
            encoder,
            awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(states.keys()))
          )
          socket.send(encoding.toUint8Array(encoder))
          break
        }
        default:
          log(`unknown message type ${messageType} from ${clientIp}`)
      }
    } catch (error) {
      // A malformed update must not take the whole room down.
      log('error handling message:', error.message)
    }
  }

  // Buffer anything that arrives while the persisted snapshot is still loading.
  let ready = false
  const pending = []
  socket.on('message', (data) => {
    if (ready) handleMessage(data)
    else pending.push(data)
  })

  room.ready.then(() => {
    ready = true
    room.sendStateTo(socket)
    while (pending.length > 0) handleMessage(pending.shift())
  }).catch((error) => {
    log('failed to load room:', error.message)
    socket.close(1011, 'Failed to load room')
  })

  socket.on('close', () => {
    room.removeConnection(conn)
    log(`client left ${roomName} (${room.clientCount} online) from ${clientIp}`)
    if (room.clientCount === 0) {
      evictEmptyRooms().catch((error) => log('eviction failed:', error.message))
    }
  })

  socket.on('error', (error) => {
    log(`socket error from ${clientIp}:`, error.message)
  })
})

wss.on('error', (error) => {
  console.error('WebSocket server error:', error)
  process.exit(1)
})

const shutdown = async () => {
  log('shutting down, persisting rooms…')
  await Promise.all(Array.from(rooms.values()).map((room) => room.persist()))
  for (const room of rooms.values()) room.destroy()
  rooms.clear()
  wss.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 2000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

if (PERSIST_ENABLED) {
  mkdir(PERSIST_DIR, { recursive: true })
    .then(() => readdir(PERSIST_DIR))
    .then((files) => log(`persistence ready in ${PERSIST_DIR} (${files.length} snapshots)`))
    .catch((error) => log('persistence unavailable:', error.message))
}

log(`listening on ws://${HOST}:${PORT}`)
log('ready for real-time CRDT sync')
