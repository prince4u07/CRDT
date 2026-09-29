import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ConvexService, isConvexConfigured, toBase64, fromBase64 } from '../lib/convexService'

const URL = 'https://example.convex.cloud'
const SLUG = 'demo-collection'

const jsonResponse = (payload, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
})

/** The arguments of the last fetch call, with the body already parsed. */
const lastCall = () => {
  const [, init] = fetch.mock.calls[fetch.mock.calls.length - 1]
  return { url: fetch.mock.calls[fetch.mock.calls.length - 1][0], body: JSON.parse(init.body) }
}

describe('ConvexService', () => {
  beforeEach(() => {
    fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('base64 helpers', () => {
    it('round-trips arbitrary bytes', () => {
      const bytes = new Uint8Array([0, 1, 127, 128, 254, 255, 42])
      expect(fromBase64(toBase64(bytes))).toEqual(bytes)
    })

    it('round-trips payloads larger than one chunk', () => {
      const bytes = new Uint8Array(0x8000 * 2 + 7)
      for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256
      const restored = fromBase64(toBase64(bytes))
      expect(restored).toHaveLength(bytes.length)
      expect(restored[bytes.length - 1]).toBe(bytes[bytes.length - 1])
    })

    it('treats a missing value as an empty snapshot', () => {
      expect(fromBase64('')).toEqual(new Uint8Array(0))
      expect(fromBase64(undefined)).toEqual(new Uint8Array(0))
    })
  })

  describe('configuration', () => {
    it('mirrors the VITE_CONVEX_URL configuration flag', () => {
      expect(isConvexConfigured).toBe(Boolean(import.meta.env?.VITE_CONVEX_URL))
    })

    it('stays disabled without a URL', () => {
      expect(new ConvexService('').enabled).toBe(false)
    })

    it('refuses to call Convex while it is disabled', async () => {
      await expect(new ConvexService('').listCollections()).rejects.toThrow(/not configured/i)
      expect(fetch).not.toHaveBeenCalled()
    })
  })

  describe('queries', () => {
    it('posts the function path to the query endpoint', async () => {
      fetch.mockResolvedValue(jsonResponse({ status: 'success', value: [{ _id: 'c1', slug: SLUG }] }))

      const collections = await new ConvexService(URL).listCollections()

      expect(collections).toEqual([{ _id: 'c1', slug: SLUG }])
      const call = lastCall()
      expect(call.url).toBe(`${URL}/api/query`)
      expect(call.body.path).toBe('collections:listCollections')
    })

    it('looks a collection up by slug', async () => {
      fetch.mockResolvedValue(jsonResponse({ status: 'success', value: { _id: 'c1', slug: SLUG } }))

      const record = await new ConvexService(URL).getCollectionBySlug(SLUG)

      expect(record.slug).toBe(SLUG)
      expect(lastCall().body.args[0]).toEqual({ slug: SLUG })
    })

    it('turns a Convex error into a readable Error', async () => {
      fetch.mockResolvedValue(jsonResponse({ status: 'error', errorMessage: 'not found' }))

      await expect(new ConvexService(URL).getCollectionBySlug(SLUG)).rejects.toThrow(/not found/)
    })

    it('surfaces a transport failure with the response text', async () => {
      fetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom', json: async () => ({}) })

      await expect(new ConvexService(URL).listCollections()).rejects.toThrow(/boom/)
    })
  })

  describe('mutations', () => {
    it('creates a collection', async () => {
      fetch.mockResolvedValue(jsonResponse({ status: 'success', value: 'c2' }))

      const id = await new ConvexService(URL).createCollection('Demo', 'desc', SLUG)

      expect(id).toBe('c2')
      expect(lastCall().url).toBe(`${URL}/api/mutation`)
      expect(lastCall().body.path).toBe('collections:createCollection')
    })

    it('reuses an existing collection instead of creating a second one', async () => {
      fetch.mockResolvedValue(jsonResponse({ status: 'success', value: { _id: 'c1', slug: SLUG } }))

      const record = await new ConvexService(URL).ensureCollection(SLUG, 'Demo', 'desc')

      expect(record._id).toBe('c1')
      expect(fetch).toHaveBeenCalledTimes(1)
    })

    it('creates the collection when the lookup comes back empty', async () => {
      fetch
        .mockResolvedValueOnce(jsonResponse({ status: 'success', value: null }))
        .mockResolvedValueOnce(jsonResponse({ status: 'success', value: 'c3' }))

      const record = await new ConvexService(URL).ensureCollection(SLUG, 'Demo', 'desc')

      expect(record).toEqual({ _id: 'c3', slug: SLUG, name: 'Demo', description: 'desc', version: 1 })
      expect(fetch).toHaveBeenCalledTimes(2)
    })

    it('stores a snapshot as base64', async () => {
      fetch.mockResolvedValue(jsonResponse({ status: 'success', value: null }))
      const bytes = new Uint8Array([1, 2, 3, 250])

      await new ConvexService(URL).pushSnapshot('c1', bytes)

      const call = lastCall()
      expect(call.body.path).toBe('collections:updateCRDTDocument')
      expect(call.body.args[0]).toEqual({ id: 'c1', crdtDocument: toBase64(bytes) })
    })

    it('deletes a collection', async () => {
      fetch.mockResolvedValue(jsonResponse({ status: 'success', value: null }))

      await new ConvexService(URL).deleteCollection('c1')

      expect(lastCall().body.path).toBe('collections:deleteCollection')
      expect(lastCall().body.args[0]).toEqual({ id: 'c1' })
    })
  })

  describe('loadSnapshot', () => {
    it('returns the stored document as bytes', async () => {
      const bytes = new Uint8Array([9, 8, 7])
      fetch.mockResolvedValue(
        jsonResponse({ status: 'success', value: { _id: 'c1', crdtDocument: toBase64(bytes) } })
      )

      const snapshot = await new ConvexService(URL).loadSnapshot(SLUG)

      expect(snapshot).toEqual(bytes)
    })

    it('returns null when the collection has no document yet', async () => {
      fetch.mockResolvedValue(jsonResponse({ status: 'success', value: { _id: 'c1' } }))

      await expect(new ConvexService(URL).loadSnapshot(SLUG)).resolves.toBeNull()
    })

    it('returns null when the collection does not exist', async () => {
      fetch.mockResolvedValue(jsonResponse({ status: 'success', value: null }))

      await expect(new ConvexService(URL).loadSnapshot(SLUG)).resolves.toBeNull()
    })
  })
})
