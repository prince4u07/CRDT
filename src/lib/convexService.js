import { ConvexHttpClient } from 'convex/browser'
// The generated module is imported by its file name: a bare directory import is
// not resolved by the bundler, and Convex is optional here, so nothing may
// depend on code generation having run.
import { api } from '../../convex/_generated/api'

const CONVEX_URL = import.meta.env?.VITE_CONVEX_URL || ''

/**
 * A Convex function reference is an opaque object; this symbol carries the
 * `module:function` path. It is only used to make error messages readable.
 */
const FUNCTION_NAME = Symbol.for('functionName')
const functionPath = (reference) => {
  const name = typeof reference === 'object' && reference !== null ? reference[FUNCTION_NAME] : null
  return typeof name === 'string' ? name : 'function'
}

/**
 * Convex is an optional part of this app: collaboration itself (CRDT +
 * WebSocket + IndexedDB) works without it. It stores one base64 Yjs snapshot
 * per collection so a fresh browser can bootstrap from a shared document, and
 * keeps the list of collections on the backend.
 */
export const isConvexConfigured = Boolean(CONVEX_URL)

/** Byte-exact Uint8Array -> base64 (safe for binary data, not just text). */
export const toBase64 = (bytes) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  const CHUNK = 0x8000 // chunked to stay clear of the argument-count limit
  for (let i = 0; i < view.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, view.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export const fromBase64 = (base64) => {
  if (!base64) return new Uint8Array(0)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * A thin, React-free wrapper around Convex. The reactive hooks (`useQuery`,
 * `useMutation`) stay in the components; everything that can be called from
 * plain async code lives here, which also makes it straightforward to unit
 * test.
 */
class ConvexService {
  constructor(url = CONVEX_URL) {
    this.url = url
    this.client = url ? new ConvexHttpClient(url) : null
  }

  get enabled() {
    return Boolean(this.client)
  }

  /** Run a Convex call, converting any failure into a clear error. */
  async #call(kind, operation, args) {
    if (!this.client) throw new Error('Convex is not configured (set VITE_CONVEX_URL)')
    const name = functionPath(operation)
    try {
      return await this.client[kind](operation, args)
    } catch (error) {
      throw new Error(`Convex ${name} failed: ${error?.message || error}`)
    }
  }

  listCollections() {
    return this.#call('query', api.collections.listCollections, {})
  }

  getCollectionBySlug(slug) {
    return this.#call('query', api.collections.getCollectionBySlug, { slug })
  }

  createCollection(name, description, slug) {
    return this.#call('mutation', api.collections.createCollection, {
      name,
      description,
      slug,
    })
  }

  /** Find the collection for a room, creating it on first use. */
  async ensureCollection(slug, name, description) {
    const existing = await this.getCollectionBySlug(slug)
    if (existing) return existing

    const id = await this.createCollection(name, description, slug)
    return { _id: id, slug, name, description, version: 1 }
  }

  /** Persist a Yjs snapshot; the server bumps the version for us. */
  pushSnapshot(id, documentState) {
    return this.#call('mutation', api.collections.updateCRDTDocument, {
      id,
      crdtDocument: toBase64(documentState),
    })
  }

  /** Fetch the stored snapshot for a collection, or null when there is none. */
  async loadSnapshot(slug) {
    const record = await this.getCollectionBySlug(slug)
    if (!record?.crdtDocument) return null
    return fromBase64(record.crdtDocument)
  }

  deleteCollection(id) {
    return this.#call('mutation', api.collections.deleteCollection, { id })
  }
}

export const convexService = new ConvexService()
export { ConvexService }
