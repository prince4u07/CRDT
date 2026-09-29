import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { IndexeddbPersistence, clearDocument } from 'y-indexeddb'

const DEFAULT_WS_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_WS_URL) || 'ws://localhost:1234'

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

/** Presence cursor colours, so every user is visually distinct. */
const PRESENCE_COLORS = [
  '#38bdf8', '#f472b6', '#4ade80', '#fbbf24',
  '#a78bfa', '#fb7185', '#2dd4bf', '#f97316',
]

/**
 * `crypto.randomUUID` only exists in secure contexts, so a user opening the app
 * from a LAN address (http://192.168.x.x) would break. Fall back to a random
 * string that is still unique enough for a single document.
 */
const generateId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const colorForName = (name = '') => {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return PRESENCE_COLORS[hash % PRESENCE_COLORS.length]
}

/**
 * Headers are stored as a nested Y.Map instead of a JSON string so that two
 * users editing *different* headers of the same request both keep their change
 * (a Y.Map merges per key; a single string would be last-write-wins).
 */
const readHeaders = (requestMap) => {
  const raw = requestMap.get('headers')
  if (raw instanceof Y.Map) return raw.toJSON()
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { [raw]: '' }
    } catch {
      return raw ? { [raw]: '' } : {}
    }
  }
  return {}
}

/** Replace the whole header set, deleting keys that disappeared. */
const writeHeaders = (requestMap, next) => {
  let current = requestMap.get('headers')

  if (!(current instanceof Y.Map)) {
    // Legacy documents stored headers as a JSON string; swap in a real Y.Map.
    const map = new Y.Map()
    Object.entries(readHeaders(requestMap)).forEach(([key, value]) => map.set(key, String(value)))
    requestMap.set('headers', map)
    current = map
  }

  if (next === undefined) return // migration only

  // Accept a JSON string, but leave the document untouched when it is still
  // being typed and is not valid yet.
  let source = next
  if (typeof next === 'string') {
    try {
      source = JSON.parse(next)
    } catch {
      return
    }
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) return

  Object.entries(source).forEach(([key, value]) => {
    if (current.get(key) !== String(value)) current.set(key, String(value))
  })
  for (const key of current.keys()) {
    if (!(key in source)) current.delete(key)
  }
}

/**
 * Owns every live Yjs document in the app. A CRDTService instance is a
 * singleton: the document must be the same object for the lifetime of the
 * session, otherwise the WebSocket provider and IndexedDB persistence would
 * each hold a different, diverging copy.
 */
class CRDTService {
  constructor() {
    this.docs = new Map() // collectionId -> Y.Doc
    this.providers = new Map() // collectionId -> WebsocketProvider
    this.persistences = new Map() // collectionId -> IndexeddbPersistence
    this.undoManagers = new Map() // collectionId -> Y.UndoManager
    this.statusSubscribers = new Map() // collectionId -> Set<fn>
    this.presenceSubscribers = new Map() // collectionId -> Set<fn>
    this.localUser = { name: 'Anonymous', color: PRESENCE_COLORS[0] }
  }

  // ---------------------------------------------------------------- documents

  /** Get (or lazily create) the Yjs document backing a collection. */
  getOrCreateDocument(collectionId) {
    const existing = this.docs.get(collectionId)
    if (existing) return existing

    const doc = new Y.Doc()
    doc.getArray('requests')
    doc.getMap('metadata')
    this.docs.set(collectionId, doc)
    return doc
  }

  /**
   * Full setup for a collection: document, offline persistence, real-time
   * sync, presence and undo/redo.
   *
   * Defaults are seeded *after* IndexedDB has loaded, otherwise the seed would
   * race the cached state and produce a duplicated sample request.
   *
   * @returns {Promise<{ doc: Y.Doc, provider: WebsocketProvider }>}
   */
  async initCollection(collectionId, options = {}) {
    const doc = this.getOrCreateDocument(collectionId)
    const persistence = this.setupOfflinePersistence(collectionId, doc)
    const provider = this.setupWebSocketSync(collectionId, doc, options.wsUrl)
    this.setupUndoManager(collectionId, doc)

    if (options.user) this.setLocalUser(collectionId, options.user)

    try {
      await persistence.whenSynced
    } catch (error) {
      console.warn(`[crdt] offline cache unavailable for ${collectionId}:`, error)
    }

    this.migrateLegacyHeaders(collectionId)
    this.seedDefaults(collectionId, options.initialRequest)

    return { doc, provider, persistence }
  }

  /** Write collection metadata only if the collection is genuinely empty. */
  seedDefaults(collectionId, initialRequest = null) {
    const doc = this.getOrCreateDocument(collectionId)
    const metadata = doc.getMap('metadata')
    const requests = doc.getArray('requests')

    doc.transact(() => {
      if (!metadata.has('name')) metadata.set('name', 'Untitled Collection')
      if (!metadata.has('createdAt')) metadata.set('createdAt', Date.now())
      if (!metadata.has('version')) metadata.set('version', 1)
      if (initialRequest && requests.length === 0) {
        this.addRequest(collectionId, initialRequest)
      }
    })
  }

  /** Upgrade documents written before headers became a nested Y.Map. */
  migrateLegacyHeaders(collectionId) {
    const doc = this.getOrCreateDocument(collectionId)
    const requests = doc.getArray('requests')

    const legacy = requests.toArray().filter((requestMap) => !(requestMap.get('headers') instanceof Y.Map))
    if (legacy.length === 0) return false

    doc.transact(() => legacy.forEach((requestMap) => writeHeaders(requestMap, undefined)))
    return true
  }

  // ------------------------------------------------------------------- sync

  /**
   * Attach a WebSocket provider. y-websocket encodes the room in the URL path
   * (`<serverUrl>/<roomname>`), so the room name is passed as the second
   * argument rather than being glued onto the server URL.
   */
  setupWebSocketSync(collectionId, doc, wsUrl = DEFAULT_WS_URL) {
    const existing = this.providers.get(collectionId)
    if (existing) return existing

    const room = this.roomName(collectionId)
    const provider = new WebsocketProvider(wsUrl.replace(/\/$/, ''), room, doc, {
      connect: true,
      params: { collection: collectionId },
    })

    provider.on('status', ({ status }) => {
      // y-websocket re-announces the local awareness state after a reconnect
      // with the *same* clock it had before the socket dropped. Every peer that
      // watched us leave has already moved past that clock, so they discard the
      // update as stale and the collaborator stays invisible. Writing the state
      // again bumps the clock, which makes the re-announcement acceptable.
      if (status === 'connected') this.republishPresence(collectionId)
      this.emitStatus(collectionId, status)
    })
    provider.on('sync', (isSynced) => {
      this.emitStatus(collectionId, isSynced ? 'synced' : 'connecting')
    })
    provider.on('connection-error', () => {
      this.emitStatus(collectionId, 'error')
    })

    this.providers.set(collectionId, provider)
    this.emitStatus(collectionId, provider.wsconnected ? 'connected' : 'connecting')
    return provider
  }

  roomName(collectionId) {
    return `collection-${String(collectionId).replace(/[^a-zA-Z0-9._-]/g, '-')}`
  }

  /**
   * Resolve once the provider has finished its first sync, or after
   * `timeoutMs`. Callers use it before restoring a stored snapshot, so live
   * server state always wins; the timeout keeps an unreachable server from
   * blocking the app.
   *
   * @returns {Promise<boolean>} true when the document is in sync
   */
  waitForInitialSync(collectionId, timeoutMs = 3000) {
    const provider = this.providers.get(collectionId)
    if (!provider) return Promise.resolve(false)
    if (provider.synced) return Promise.resolve(true)

    return new Promise((resolve) => {
      let settled = false
      const finish = (synced) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        provider.off('sync', onSync)
        resolve(synced)
      }
      const onSync = (isSynced) => {
        if (isSynced) finish(true)
      }
      const timer = setTimeout(() => finish(false), timeoutMs)
      provider.on('sync', onSync)
    })
  }

  /** Attach IndexedDB so edits survive reloads and work while offline. */
  setupOfflinePersistence(collectionId, doc) {
    const existing = this.persistences.get(collectionId)
    if (existing) return existing

    const persistence = new IndexeddbPersistence(`crdt-${collectionId}`, doc)
    this.persistences.set(collectionId, persistence)
    return persistence
  }

  setupUndoManager(collectionId, doc) {
    if (this.undoManagers.has(collectionId)) return this.undoManagers.get(collectionId)

    // Only the requests list is undoable, and only local edits are tracked:
    // Yjs transactions from remote peers carry a different origin.
    const undoManager = new Y.UndoManager(doc.getArray('requests'), {
      trackedOrigins: new Set([null]),
      captureTimeout: 300,
    })
    this.undoManagers.set(collectionId, undoManager)
    return undoManager
  }

  // --------------------------------------------------------------- presence

  /** Identity broadcast to other collaborators (name + colour cursor). */
  setLocalUser(collectionId, user) {
    this.localUser = {
      name: user?.name || 'Anonymous',
      color: user?.color || colorForName(user?.name || 'Anonymous'),
    }
    const provider = this.providers.get(collectionId)
    if (!provider) return this.localUser

    provider.awareness.setLocalStateField('user', this.localUser)
    this.emitPresence(collectionId)
    return this.localUser
  }

  getLocalUser() {
    return this.localUser
  }

  /**
   * Broadcast our own identity again with a fresh awareness clock.
   *
   * Called after every (re)connect. Without it a returning collaborator is
   * silently dropped by every peer as a stale update, because the clock they
   * remember is the one from before the disconnect.
   */
  republishPresence(collectionId) {
    const provider = this.providers.get(collectionId)
    if (!provider) return false

    const state = provider.awareness.getLocalState()
    if (!state) return false

    provider.awareness.setLocalState({ ...state })
    this.emitPresence(collectionId)
    return true
  }

  /** Everyone currently connected to this collection, including yourself. */
  getPeers(collectionId) {
    const provider = this.providers.get(collectionId)
    if (!provider) return []

    const peers = []
    provider.awareness.getStates().forEach((state, clientId) => {
      if (!state?.user?.name) return
      peers.push({
        clientId,
        name: state.user.name,
        color: state.user.color || colorForName(state.user.name),
        editing: state.editing ?? null,
        isSelf: clientId === provider.awareness.clientID,
      })
    })
    return peers.sort((a, b) => (a.isSelf ? -1 : b.isSelf ? 1 : a.name.localeCompare(b.name)))
  }

  /** Tell collaborators which request you are looking at. */
  setEditing(collectionId, requestId) {
    const provider = this.providers.get(collectionId)
    if (!provider) return
    provider.awareness.setLocalStateField('editing', requestId ?? null)
    this.emitPresence(collectionId)
  }

  onPresenceChange(collectionId, callback) {
    const provider = this.providers.get(collectionId)
    if (!provider) return () => {}

    const handler = () => this.emitPresence(collectionId)
    provider.awareness.on('change', handler)

    const subscribers = this.presenceSubscribers.get(collectionId) || new Set()
    subscribers.add(callback)
    this.presenceSubscribers.set(collectionId, subscribers)
    this.emitPresence(collectionId)

    return () => {
      provider.awareness.off('change', handler)
      subscribers.delete(callback)
    }
  }

  onStatusChange(collectionId, callback) {
    const subscribers = this.statusSubscribers.get(collectionId) || new Set()
    subscribers.add(callback)
    this.statusSubscribers.set(collectionId, subscribers)
    return () => subscribers.delete(callback)
  }

  emitStatus(collectionId, status) {
    const provider = this.providers.get(collectionId)
    const enriched = {
      status,
      connected: Boolean(provider?.wsconnected),
      synced: Boolean(provider?.synced),
    }
    this.statusSubscribers.get(collectionId)?.forEach((callback) => callback(enriched))
  }

  getConnectionStatus(collectionId) {
    const provider = this.providers.get(collectionId)
    return {
      status: provider?.wsconnected ? 'connected' : 'disconnected',
      connected: Boolean(provider?.wsconnected),
      synced: Boolean(provider?.synced),
    }
  }

  emitPresence(collectionId) {
    const peers = this.getPeers(collectionId)
    this.presenceSubscribers.get(collectionId)?.forEach((callback) => callback(peers))
  }

  // ------------------------------------------------------------------- CRUD

  /**
   * Append a request. Returns the new id, or null for an invalid method.
   */
  addRequest(collectionId, requestData = {}) {
    const doc = this.getOrCreateDocument(collectionId)
    const requests = doc.getArray('requests')

    const method = HTTP_METHODS.includes(String(requestData.method || '').toUpperCase())
      ? String(requestData.method).toUpperCase()
      : 'GET'

    const requestMap = new Y.Map()
    requestMap.set('id', requestData.id || generateId())
    requestMap.set('name', String(requestData.name ?? 'Untitled Request'))
    requestMap.set('method', method)
    requestMap.set('url', String(requestData.url ?? ''))
    requestMap.set('body', String(requestData.body ?? ''))
    requestMap.set('createdAt', Date.now())
    requestMap.set('updatedAt', Date.now())
    requestMap.set('updatedBy', this.localUser.name)

    const headers = new Y.Map()
    const headerSource = typeof requestData.headers === 'string'
      ? null
      : requestData.headers || {}
    Object.entries(headerSource).forEach(([key, value]) => headers.set(key, String(value)))
    requestMap.set('headers', headers)

    doc.transact(() => {
      requests.push([requestMap])
      this.touchMetadata(collectionId)
    })

    return requestMap.get('id')
  }

  /**
   * Patch a request. Returns false when the id is unknown, so callers can tell
   * a no-op from a successful edit.
   */
  updateRequest(collectionId, requestId, updates = {}) {
    const doc = this.getOrCreateDocument(collectionId)
    const requests = doc.getArray('requests')
    let updated = false

    doc.transact(() => {
      requests.forEach((requestMap) => {
        if (requestMap.get('id') !== requestId) return

        Object.entries(updates).forEach(([key, value]) => {
          if (key === 'id' || key === 'createdAt') return // immutable
          if (key === 'headers') {
            writeHeaders(requestMap, value)
            return
          }
          if (key === 'method') {
            requestMap.set('method', HTTP_METHODS.includes(String(value).toUpperCase())
              ? String(value).toUpperCase()
              : 'GET')
            return
          }
          if (value === undefined || value === null) return
          requestMap.set(key, String(value))
        })

        requestMap.set('updatedAt', Date.now())
        requestMap.set('updatedBy', this.localUser.name)
        updated = true
      })

      if (updated) this.touchMetadata(collectionId)
    })

    return updated
  }

  deleteRequest(collectionId, requestId) {
    const doc = this.getOrCreateDocument(collectionId)
    const requests = doc.getArray('requests')
    const index = requests.toArray().findIndex((requestMap) => requestMap.get('id') === requestId)
    if (index === -1) return false

    doc.transact(() => {
      requests.delete(index, 1)
      this.touchMetadata(collectionId)
    })
    return true
  }

  /** Duplicate an existing request, inserting directly after the original. */
  duplicateRequest(collectionId, requestId) {
    const doc = this.getOrCreateDocument(collectionId)
    const requests = doc.getArray('requests')
    const index = requests.toArray().findIndex((requestMap) => requestMap.get('id') === requestId)
    if (index === -1) return null

    const source = requests.get(index)
    const headers = new Y.Map()
    Object.entries(readHeaders(source)).forEach(([key, value]) => headers.set(key, value))

    const copy = new Y.Map()
    copy.set('id', generateId())
    copy.set('name', `${source.get('name') ?? 'Untitled Request'} copy`)
    copy.set('method', source.get('method') ?? 'GET')
    copy.set('url', source.get('url') ?? '')
    copy.set('body', source.get('body') ?? '')
    copy.set('headers', headers)
    copy.set('createdAt', Date.now())
    copy.set('updatedAt', Date.now())
    copy.set('updatedBy', this.localUser.name)

    doc.transact(() => {
      requests.insert(index + 1, [copy])
      this.touchMetadata(collectionId)
    })
    return copy.get('id')
  }

  getRequest(collectionId, requestId) {
    return this.getRequests(collectionId).find((request) => request.id === requestId) || null
  }

  /** Snapshot the document as plain JSON, safe to hand to React state. */
  getRequests(collectionId) {
    const doc = this.getOrCreateDocument(collectionId)
    return doc.getArray('requests').map((requestMap) => ({
      id: requestMap.get('id'),
      name: requestMap.get('name') ?? 'Untitled Request',
      method: requestMap.get('method') ?? 'GET',
      url: requestMap.get('url') ?? '',
      headers: readHeaders(requestMap),
      body: requestMap.get('body') ?? '',
      createdAt: requestMap.get('createdAt') ?? null,
      updatedAt: requestMap.get('updatedAt') ?? null,
      updatedBy: requestMap.get('updatedBy') ?? null,
    }))
  }

  getMetadata(collectionId) {
    const metadata = this.getOrCreateDocument(collectionId).getMap('metadata')
    return {
      name: metadata.get('name') ?? 'Untitled Collection',
      createdAt: metadata.get('createdAt') ?? null,
      updatedAt: metadata.get('updatedAt') ?? null,
      version: metadata.get('version') ?? 1,
    }
  }

  updateMetadata(collectionId, updates = {}) {
    const doc = this.getOrCreateDocument(collectionId)
    doc.transact(() => {
      Object.entries(updates).forEach(([key, value]) => {
        if (value !== undefined && value !== null) doc.getMap('metadata').set(key, value)
      })
      this.touchMetadata(collectionId)
    })
  }

  touchMetadata(collectionId) {
    this.getOrCreateDocument(collectionId).getMap('metadata').set('updatedAt', Date.now())
  }

  // ------------------------------------------------------------- reactivity

  /**
   * Run `callback` whenever the document changes (local or remote) and once
   * immediately with the current state.
   */
  subscribe(collectionId, callback) {
    const doc = this.getOrCreateDocument(collectionId)
    const emit = () => callback({
      requests: this.getRequests(collectionId),
      metadata: this.getMetadata(collectionId),
    })

    doc.on('update', emit)
    emit()
    return () => doc.off('update', emit)
  }

  // ------------------------------------------------------------ persistence

  /** Binary snapshot of the whole document (for server-side persistence). */
  exportDocument(collectionId) {
    return Y.encodeStateAsUpdate(this.getOrCreateDocument(collectionId))
  }

  importDocument(collectionId, state) {
    if (!state) return false
    Y.applyUpdate(this.getOrCreateDocument(collectionId), state)
    return true
  }

  /** A document's state vector: identifies what this replica already has. */
  getStateVector(collectionId) {
    return Y.encodeStateVector(this.getOrCreateDocument(collectionId))
  }

  /** Only the updates this replica is missing relative to a state vector. */
  diffSince(collectionId, stateVector) {
    return Y.encodeStateAsUpdate(this.getOrCreateDocument(collectionId), stateVector)
  }

  // -------------------------------------------------------------- undo/redo

  undo(collectionId) {
    const undoManager = this.undoManagers.get(collectionId)
    if (!undoManager) return false
    undoManager.undo()
    return true
  }

  redo(collectionId) {
    const undoManager = this.undoManagers.get(collectionId)
    if (!undoManager) return false
    undoManager.redo()
    return true
  }

  canUndo(collectionId) {
    const undoManager = this.undoManagers.get(collectionId)
    return Boolean(undoManager?.undoStack.length)
  }

  canRedo(collectionId) {
    const undoManager = this.undoManagers.get(collectionId)
    return Boolean(undoManager?.redoStack.length)
  }

  // ------------------------------------------------------------- teardown

  /**
   * Release every resource for a collection while keeping the offline cache
   * intact (IndexedDB is only detached, not deleted).
   */
  destroy(collectionId) {
    const provider = this.providers.get(collectionId)
    if (provider) {
      provider.destroy()
      this.providers.delete(collectionId)
    }

    const undoManager = this.undoManagers.get(collectionId)
    if (undoManager) {
      undoManager.destroy()
      this.undoManagers.delete(collectionId)
    }

    const persistence = this.persistences.get(collectionId)
    if (persistence) {
      // Detaches listeners; the stored document stays on disk.
      persistence.destroy()
      this.persistences.delete(collectionId)
    }

    const doc = this.docs.get(collectionId)
    if (doc) {
      doc.destroy()
      this.docs.delete(collectionId)
    }

    this.statusSubscribers.delete(collectionId)
    this.presenceSubscribers.delete(collectionId)
  }

  /**
   * Forget the local offline copy of a collection.
   *
   * This only removes the IndexedDB database — the in-memory document is left
   * alone, so clearing the cache never propagates deletions to other
   * collaborators. Reconnecting (or reloading) rebuilds the document from the
   * sync server.
   */
  async clearLocalCache(collectionId) {
    const databaseName = `crdt-${collectionId}`
    const persistence = this.persistences.get(collectionId)

    if (persistence) {
      // clearData() detaches the listeners and deletes the database.
      await persistence.clearData()
      this.persistences.delete(collectionId)
    } else {
      // No live persistence (e.g. after destroy): delete the database directly.
      await clearDocument(databaseName)
    }
    return true
  }
}

export const crdtService = new CRDTService()
export { generateId, colorForName, HTTP_METHODS, DEFAULT_WS_URL }
