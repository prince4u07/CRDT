import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as Y from 'yjs'
import { crdtService } from '../lib/crdtService'

const COLLECTION = 'test-collection'

const cleanupCollection = (id = COLLECTION) => {
  if (crdtService.docs.has(id) || crdtService.providers.has(id)) {
    crdtService.destroy(id)
  }
}

describe('CRDTService', () => {
  // IndexedDB survives destroy() by design, so each test also starts from an
  // empty offline cache.
  beforeEach(async () => {
    cleanupCollection()
    await crdtService.clearLocalCache(COLLECTION)
  })
  afterEach(cleanupCollection)

  describe('getOrCreateDocument', () => {
    it('creates a document once per collection', () => {
      const first = crdtService.getOrCreateDocument(COLLECTION)
      const second = crdtService.getOrCreateDocument(COLLECTION)

      expect(first).toBeDefined()
      expect(first).toBe(second)
      expect(crdtService.docs.has(COLLECTION)).toBe(true)
    })

    it('exposes the requests array and metadata map', () => {
      const doc = crdtService.getOrCreateDocument(COLLECTION)

      expect(doc.getArray('requests')).toBeDefined()
      expect(doc.getMap('metadata')).toBeDefined()
    })

    it('does not seed defaults before the offline cache has loaded', () => {
      crdtService.getOrCreateDocument(COLLECTION)

      // Seeding here would race IndexedDB and duplicate the sample request.
      expect(crdtService.getMetadata(COLLECTION).version).toBe(1)
      expect(crdtService.getRequests(COLLECTION)).toEqual([])
    })

    it('seeds metadata and a sample request via initCollection', async () => {
      await crdtService.initCollection(COLLECTION, {
        user: { name: 'Tester' },
        initialRequest: { name: 'Sample', method: 'GET', url: 'https://example.com' },
      })

      const metadata = crdtService.getMetadata(COLLECTION)
      expect(metadata.name).toBe('Untitled Collection')
      expect(metadata.version).toBe(1)
      expect(metadata.createdAt).toBeGreaterThan(0)
      expect(crdtService.getRequests(COLLECTION)).toHaveLength(1)
    })

    it('does not re-seed when the offline cache already has content', async () => {
      await crdtService.initCollection(COLLECTION, {
        initialRequest: { name: 'Sample' },
      })
      crdtService.destroy(COLLECTION)

      // Re-opening must reuse the cached document, not add another sample.
      await crdtService.initCollection(COLLECTION, {
        initialRequest: { name: 'Sample' },
      })
      expect(crdtService.getRequests(COLLECTION)).toHaveLength(1)
    })
  })

  describe('addRequest', () => {
    it('adds a request with the supplied values', () => {
      const id = crdtService.addRequest(COLLECTION, {
        name: 'Test Request',
        method: 'GET',
        url: 'https://api.example.com/test',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      })

      const [request] = crdtService.getRequests(COLLECTION)
      expect(request.id).toBe(id)
      expect(request.name).toBe('Test Request')
      expect(request.method).toBe('GET')
      expect(request.url).toBe('https://api.example.com/test')
      expect(request.headers).toEqual({ 'Content-Type': 'application/json' })
    })

    it('generates an id when none is provided', () => {
      const id = crdtService.addRequest(COLLECTION, { name: 'Test' })
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('keeps a caller supplied id', () => {
      const id = crdtService.addRequest(COLLECTION, { id: 'custom-id-123' })
      expect(id).toBe('custom-id-123')
    })

    it('fills in defaults for missing fields', () => {
      crdtService.addRequest(COLLECTION, { name: 'Minimal' })
      const [request] = crdtService.getRequests(COLLECTION)

      expect(request.method).toBe('GET')
      expect(request.url).toBe('')
      expect(request.headers).toEqual({})
      expect(request.body).toBe('')
    })

    it('normalises an unsupported method to GET', () => {
      crdtService.addRequest(COLLECTION, { name: 'Weird', method: 'TRACE' })
      expect(crdtService.getRequests(COLLECTION)[0].method).toBe('GET')
    })

    it('records who created and last edited the request', () => {
      crdtService.setLocalUser(COLLECTION, { name: 'Ada' })
      crdtService.addRequest(COLLECTION, { name: 'Owned' })

      const [request] = crdtService.getRequests(COLLECTION)
      expect(request.updatedBy).toBe('Ada')
      expect(request.createdAt).toBeGreaterThan(0)
    })
  })

  describe('updateRequest', () => {
    let requestId

    beforeEach(() => {
      requestId = crdtService.addRequest(COLLECTION, {
        name: 'Original',
        method: 'GET',
        url: 'https://api.example.com/original',
      })
    })

    it('updates the requested fields', () => {
      expect(crdtService.updateRequest(COLLECTION, requestId, { name: 'Renamed', method: 'post' })).toBe(true)

      const [request] = crdtService.getRequests(COLLECTION)
      expect(request.name).toBe('Renamed')
      expect(request.method).toBe('POST')
    })

    it('returns false for an unknown id', () => {
      expect(crdtService.updateRequest(COLLECTION, 'nope', { name: 'x' })).toBe(false)
    })

    it('coerces every value to a string so the schema stays stable', () => {
      crdtService.updateRequest(COLLECTION, requestId, { name: 42, url: 7 })
      const [request] = crdtService.getRequests(COLLECTION)
      expect(request.name).toBe('42')
      expect(request.url).toBe('7')
    })

    it('refuses to change the id or creation time', () => {
      const before = crdtService.getRequests(COLLECTION)[0]
      crdtService.updateRequest(COLLECTION, requestId, { id: 'hacked', createdAt: 0 })
      const after = crdtService.getRequests(COLLECTION)[0]

      expect(after.id).toBe(before.id)
      expect(after.createdAt).toBe(before.createdAt)
    })

    it('replaces the header set and removes deleted keys', () => {
      crdtService.updateRequest(COLLECTION, requestId, { headers: { A: '1', B: '2' } })
      crdtService.updateRequest(COLLECTION, requestId, { headers: { A: '9' } })

      expect(crdtService.getRequests(COLLECTION)[0].headers).toEqual({ A: '9' })
    })

    it('accepts headers as a JSON string', () => {
      crdtService.updateRequest(COLLECTION, requestId, { headers: '{"X-Test":"yes"}' })
      expect(crdtService.getRequests(COLLECTION)[0].headers).toEqual({ 'X-Test': 'yes' })
    })

    it('ignores header text that is not valid JSON yet', () => {
      crdtService.updateRequest(COLLECTION, requestId, { headers: { A: '1' } })
      crdtService.updateRequest(COLLECTION, requestId, { headers: '{"A": ' })

      // The last valid value survives; the half-typed text is not committed.
      expect(crdtService.getRequests(COLLECTION)[0].headers).toEqual({ A: '1' })
    })

    it('advances updatedAt', () => {
      const before = crdtService.getRequests(COLLECTION)[0].updatedAt
      crdtService.updateRequest(COLLECTION, requestId, { name: 'Updated' })
      expect(crdtService.getRequests(COLLECTION)[0].updatedAt).toBeGreaterThanOrEqual(before)
    })
  })

  describe('header merging (the point of using a nested Y.Map)', () => {
    it('keeps concurrent edits to different headers', () => {
      // Two replicas of the same document, each with its own offline copy.
      const source = crdtService.getOrCreateDocument(COLLECTION)
      const id = crdtService.addRequest(COLLECTION, { name: 'Shared' })

      const replicaA = new Y.Doc()
      const replicaB = new Y.Doc()
      Y.applyUpdate(replicaA, Y.encodeStateAsUpdate(source))
      Y.applyUpdate(replicaB, Y.encodeStateAsUpdate(source))

      const findRequest = (doc) =>
        doc.getArray('requests').toArray().find((map) => map.get('id') === id)

      findRequest(replicaA).get('headers').set('X-Alice', '1')
      findRequest(replicaB).get('headers').set('X-Bob', '2')

      Y.applyUpdate(source, Y.encodeStateAsUpdate(replicaA))
      Y.applyUpdate(source, Y.encodeStateAsUpdate(replicaB))

      expect(crdtService.getRequests(COLLECTION)[0].headers).toEqual({
        'X-Alice': '1',
        'X-Bob': '2',
      })
    })
  })

  describe('deleteRequest', () => {
    beforeEach(() => {
      crdtService.addRequest(COLLECTION, { name: 'Request 1', method: 'GET' })
      crdtService.addRequest(COLLECTION, { name: 'Request 2', method: 'POST' })
    })

    it('removes only the targeted request', () => {
      const [first, second] = crdtService.getRequests(COLLECTION)
      expect(crdtService.deleteRequest(COLLECTION, first.id)).toBe(true)

      const remaining = crdtService.getRequests(COLLECTION)
      expect(remaining).toHaveLength(1)
      expect(remaining[0].id).toBe(second.id)
      expect(remaining[0].name).toBe('Request 2')
    })

    it('returns false for an unknown id', () => {
      expect(crdtService.deleteRequest(COLLECTION, 'nope')).toBe(false)
    })
  })

  describe('duplicateRequest', () => {
    it('inserts a copy directly after the original', () => {
      const id = crdtService.addRequest(COLLECTION, {
        name: 'Original',
        method: 'POST',
        url: 'https://api.example.com',
        headers: { A: '1' },
        body: 'payload',
      })

      const copyId = crdtService.duplicateRequest(COLLECTION, id)
      const requests = crdtService.getRequests(COLLECTION)

      expect(requests.map((request) => request.id)).toEqual([id, copyId])
      expect(requests[1].name).toBe('Original copy')
      expect(requests[1].method).toBe('POST')
      expect(requests[1].headers).toEqual({ A: '1' })
      expect(requests[1].body).toBe('payload')
    })

    it('gives the copy its own independent header map', () => {
      const id = crdtService.addRequest(COLLECTION, { name: 'Original', headers: { A: '1' } })
      const copyId = crdtService.duplicateRequest(COLLECTION, id)

      crdtService.updateRequest(COLLECTION, copyId, { headers: { B: '2' } })

      const [original, copy] = crdtService.getRequests(COLLECTION)
      expect(original.headers).toEqual({ A: '1' })
      expect(copy.headers).toEqual({ B: '2' })
    })

    it('returns null for an unknown id', () => {
      expect(crdtService.duplicateRequest(COLLECTION, 'nope')).toBeNull()
    })
  })

  describe('getRequests', () => {
    it('is empty for a new collection', () => {
      expect(crdtService.getRequests(COLLECTION)).toEqual([])
    })

    it('parses legacy JSON-string headers', () => {
      const doc = crdtService.getOrCreateDocument(COLLECTION)
      const requestMap = new Y.Map()
      requestMap.set('id', 'legacy')
      requestMap.set('name', 'Legacy')
      requestMap.set('method', 'GET')
      requestMap.set('url', 'https://api.example.com')
      requestMap.set('body', '')
      requestMap.set('headers', '{"Content-Type":"application/json"}')
      doc.getArray('requests').push([requestMap])

      expect(crdtService.getRequests(COLLECTION)[0].headers).toEqual({
        'Content-Type': 'application/json',
      })
    })

    it('migrates legacy string headers into a Y.Map', () => {
      const doc = crdtService.getOrCreateDocument(COLLECTION)
      const requestMap = new Y.Map()
      requestMap.set('id', 'legacy')
      requestMap.set('headers', '{"A":"1"}')
      doc.getArray('requests').push([requestMap])

      expect(crdtService.migrateLegacyHeaders(COLLECTION)).toBe(true)
      expect(requestMap.get('headers')).toBeInstanceOf(Y.Map)
      expect(crdtService.getRequests(COLLECTION)[0].headers).toEqual({ A: '1' })
    })

    it('never returns a live Yjs type to React', () => {
      crdtService.addRequest(COLLECTION, { name: 'Plain', headers: { A: '1' } })
      const [request] = crdtService.getRequests(COLLECTION)
      expect(request.headers).toEqual({ A: '1' })
      expect(Object.values(request).some((value) => value instanceof Y.AbstractType)).toBe(false)
    })
  })

  describe('metadata', () => {
    it('returns defaults before initialisation', () => {
      const metadata = crdtService.getMetadata(COLLECTION)
      expect(metadata.name).toBe('Untitled Collection')
      expect(metadata.version).toBe(1)
    })

    it('updates individual fields', () => {
      crdtService.updateMetadata(COLLECTION, { name: 'Renamed', version: 2 })
      const metadata = crdtService.getMetadata(COLLECTION)
      expect(metadata.name).toBe('Renamed')
      expect(metadata.version).toBe(2)
    })

    it('is touched by mutations', () => {
      crdtService.addRequest(COLLECTION, { name: 'One' })
      expect(crdtService.getMetadata(COLLECTION).updatedAt).toBeGreaterThan(0)
    })
  })

  describe('subscribe', () => {
    it('fires immediately and on every change', () => {
      const seen = []
      const unsubscribe = crdtService.subscribe(COLLECTION, (data) => seen.push(data.requests.length))

      expect(seen).toEqual([0])
      crdtService.addRequest(COLLECTION, { name: 'One' })
      expect(seen).toEqual([0, 1])

      unsubscribe()
      crdtService.addRequest(COLLECTION, { name: 'Two' })
      expect(seen).toEqual([0, 1])
    })

    it('passes metadata alongside the requests', () => {
      const unsubscribe = crdtService.subscribe(COLLECTION, () => {})
      let latest = null
      const second = crdtService.subscribe(COLLECTION, (data) => {
        latest = data
      })

      crdtService.updateMetadata(COLLECTION, { name: 'Named' })
      expect(latest.metadata.name).toBe('Named')
      expect(Array.isArray(latest.requests)).toBe(true)

      unsubscribe()
      second()
    })
  })

  describe('export / import', () => {
    it('round-trips a document into another collection', () => {
      crdtService.addRequest(COLLECTION, { name: 'Exported', method: 'PUT' })
      const state = crdtService.exportDocument(COLLECTION)

      expect(state).toBeInstanceOf(Uint8Array)

      const target = 'imported-collection'
      crdtService.importDocument(target, state)
      const [request] = crdtService.getRequests(target)

      expect(request.name).toBe('Exported')
      expect(request.method).toBe('PUT')
      crdtService.destroy(target)
    })

    it('ignores an empty update instead of throwing', () => {
      expect(crdtService.importDocument('empty-collection', null)).toBe(false)
      crdtService.destroy('empty-collection')
    })

    it('produces a state vector and a diff that closes the gap', () => {
      crdtService.addRequest(COLLECTION, { name: 'First' })
      const vector = crdtService.getStateVector(COLLECTION)
      crdtService.addRequest(COLLECTION, { name: 'Second' })

      const diff = crdtService.diffSince(COLLECTION, vector)
      expect(diff).toBeInstanceOf(Uint8Array)
      expect(diff.byteLength).toBeGreaterThan(0)
    })
  })

  describe('undo / redo', () => {
    it('undoes and redoes a local change', async () => {
      await crdtService.initCollection(COLLECTION)
      const id = crdtService.addRequest(COLLECTION, { name: 'Undoable' })
      expect(crdtService.canUndo(COLLECTION)).toBe(true)

      crdtService.undo(COLLECTION)
      expect(crdtService.getRequests(COLLECTION)).toHaveLength(0)

      crdtService.redo(COLLECTION)
      expect(crdtService.getRequests(COLLECTION)[0].id).toBe(id)
    })

    it('is a no-op when undo was never initialised', () => {
      expect(crdtService.canUndo('never-initialised')).toBe(false)
      expect(crdtService.undo('never-initialised')).toBe(false)
    })
  })

  describe('presence', () => {
    it('reports a disconnected collection as offline without a provider', () => {
      const status = crdtService.getConnectionStatus('no-provider')
      expect(status.connected).toBe(false)
      expect(status.status).toBe('disconnected')
      expect(crdtService.getPeers('no-provider')).toEqual([])
    })

    it('assigns a stable colour to a name', () => {
      const user = crdtService.setLocalUser(COLLECTION, { name: 'Ada Lovelace' })
      expect(user.name).toBe('Ada Lovelace')
      expect(user.color).toMatch(/^#[0-9a-f]{6}$/i)
      expect(crdtService.getLocalUser().color).toBe(user.color)
    })

    it('re-announces the local state with a fresh clock on reconnect', async () => {
      await crdtService.initCollection(COLLECTION, { user: { name: 'Ada' } })
      const provider = crdtService.providers.get(COLLECTION)
      const clockBefore = provider.awareness.meta.get(provider.awareness.clientID).clock

      // y-websocket re-sends the old state after a reconnect; peers reject that
      // as stale, so the service has to bump the clock itself.
      crdtService.republishPresence(COLLECTION)

      const clockAfter = provider.awareness.meta.get(provider.awareness.clientID).clock
      expect(clockAfter).toBeGreaterThan(clockBefore)
      expect(provider.awareness.getLocalState().user).toEqual(
        expect.objectContaining({ name: 'Ada' })
      )
    })

    it('re-publishes presence when the socket reports it is connected', async () => {
      await crdtService.initCollection(COLLECTION, { user: { name: 'Ada' } })
      const provider = crdtService.providers.get(COLLECTION)
      const setLocalState = vi.spyOn(provider.awareness, 'setLocalState')
      const clockBefore = provider.awareness.meta.get(provider.awareness.clientID).clock

      provider.emit('status', [{ status: 'connected' }])

      expect(setLocalState).toHaveBeenCalled()
      expect(provider.awareness.meta.get(provider.awareness.clientID).clock).toBeGreaterThan(
        clockBefore
      )
    })

    it('does not announce an empty local state', async () => {
      await crdtService.initCollection(COLLECTION)
      const provider = crdtService.providers.get(COLLECTION)
      provider.awareness.setLocalState(null)

      expect(crdtService.republishPresence(COLLECTION)).toBe(false)
    })
  })

  describe('waitForInitialSync', () => {
    it('resolves false when the collection has no provider', async () => {
      await expect(crdtService.waitForInitialSync(COLLECTION, 10)).resolves.toBe(false)
    })

    it('resolves true as soon as the provider reports the first sync', async () => {
      await crdtService.initCollection(COLLECTION)
      const provider = crdtService.providers.get(COLLECTION)

      const pending = crdtService.waitForInitialSync(COLLECTION, 1000)
      const listenersWhileWaiting = provider._observers.get('sync').size
      provider.emit('sync', [true])
      provider.synced = true

      await expect(pending).resolves.toBe(true)
      expect(provider._observers.get('sync').size).toBe(listenersWhileWaiting - 1)
    })

    it('gives up after the timeout so an offline server cannot block the app', async () => {
      await crdtService.initCollection(COLLECTION)
      const provider = crdtService.providers.get(COLLECTION)

      const listenersBefore = provider._observers.get('sync').size

      const started = Date.now()
      await expect(crdtService.waitForInitialSync(COLLECTION, 20)).resolves.toBe(false)
      expect(Date.now() - started).toBeLessThan(1000)
      // The listener is removed on both the timeout and the sync path, so a
      // reconnect does not pile up stale waiters.
      expect(provider._observers.get('sync').size).toBe(listenersBefore)
    })
  })

  describe('destroy', () => {
    it('releases the document and the provider', () => {
      crdtService.getOrCreateDocument(COLLECTION)
      crdtService.setupWebSocketSync(COLLECTION, crdtService.docs.get(COLLECTION), 'ws://127.0.0.1:1')

      expect(crdtService.docs.has(COLLECTION)).toBe(true)
      expect(crdtService.providers.has(COLLECTION)).toBe(true)

      crdtService.destroy(COLLECTION)

      expect(crdtService.docs.has(COLLECTION)).toBe(false)
      expect(crdtService.providers.has(COLLECTION)).toBe(false)
      expect(crdtService.persistences.has(COLLECTION)).toBe(false)
    })

    it('keeps the offline cache so a reload can restore it', async () => {
      await crdtService.initCollection(COLLECTION)
      crdtService.addRequest(COLLECTION, { name: 'Cached' })
      crdtService.destroy(COLLECTION)

      // Re-opening the same collection restores the request from IndexedDB.
      await crdtService.initCollection(COLLECTION)
      const names = crdtService.getRequests(COLLECTION).map((request) => request.name)
      expect(names).toContain('Cached')
    })
  })

  describe('clearLocalCache', () => {
    it('drops the stored document without touching the live one', async () => {
      await crdtService.initCollection(COLLECTION)
      crdtService.addRequest(COLLECTION, { name: 'Temporary' })

      await crdtService.clearLocalCache(COLLECTION)
      // Clearing the cache must never broadcast a deletion to collaborators.
      expect(crdtService.getRequests(COLLECTION).map((r) => r.name)).toEqual(['Temporary'])

      crdtService.destroy(COLLECTION)
      await crdtService.initCollection(COLLECTION)

      const names = crdtService.getRequests(COLLECTION).map((request) => request.name)
      expect(names).not.toContain('Temporary')
    })

    it('works even when nothing is currently persisted', async () => {
      await expect(crdtService.clearLocalCache('never-used')).resolves.toBe(true)
    })
  })
})
