import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { crdtService, colorForName } from './lib/crdtService'
import { isConvexConfigured, convexService } from './lib/convexService'
import { sendRequest } from './lib/httpClient'
import RequestList from './components/RequestList'
import RequestEditor from './components/RequestEditor'
import ResponseViewer from './components/ResponseViewer'
import PresenceBar from './components/PresenceBar'

const COLLECTION_SLUG = 'demo-collection'
const IDENTITY_KEY = 'crdt.identity'
const SNAPSHOT_DEBOUNCE_MS = 2000
const FIRST_SYNC_WAIT_MS = 3000

const SAMPLE_REQUEST = {
  name: 'Get Users',
  method: 'GET',
  url: 'https://api.example.com/users',
  headers: { 'Content-Type': 'application/json' },
  body: '',
}

const loadIdentity = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null')
    if (stored?.name) return { name: stored.name, color: stored.color || colorForName(stored.name) }
  } catch {
    // A corrupt entry should never stop the app from loading.
  }
  return null
}

const saveIdentity = (identity) => {
  try {
    localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity))
  } catch {
    // Private browsing modes can reject writes; identity is not critical.
  }
}

function App() {
  const [requests, setRequests] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [peers, setPeers] = useState([])
  const [status, setStatus] = useState('connecting')
  const [synced, setSynced] = useState(false)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [response, setResponse] = useState(null)
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState(null)
  const [identity, setIdentity] = useState(() => loadIdentity() || { name: 'Anonymous', color: '#38bdf8' })

  const sendingRef = useRef(null)
  const bootstrappedRef = useRef(false)
  const [reloadToken, setReloadToken] = useState(0)
  // The setup effect must not re-run when the display name changes, so the
  // initial identity is read from a ref instead of the state.
  const identityRef = useRef(identity)

  // ---------------------------------------------------------------- handlers
  // All callbacks are declared before the effects that depend on them, so
  // there is no temporal-dead-zone access while rendering.

  const applyPatch = useCallback((patch) => {
    if (!selectedId) return
    crdtService.updateRequest(COLLECTION_SLUG, selectedId, patch)
  }, [selectedId])

  const handleAddRequest = useCallback(() => {
    const id = crdtService.addRequest(COLLECTION_SLUG, { name: 'New Request' })
    setSelectedId(id)
    setResponse(null)
  }, [])

  const handleSelectRequest = useCallback((id) => {
    setSelectedId(id)
    setResponse(null)
  }, [])

  const handleDeleteRequest = useCallback(() => {
    if (!selectedId) return
    if (crdtService.deleteRequest(COLLECTION_SLUG, selectedId)) {
      setSelectedId(null)
      setResponse(null)
    }
  }, [selectedId])

  const handleDuplicateRequest = useCallback(() => {
    if (!selectedId) return
    const id = crdtService.duplicateRequest(COLLECTION_SLUG, selectedId)
    if (id) setSelectedId(id)
  }, [selectedId])

  const handleSend = useCallback(async () => {
    const request = selectedId ? crdtService.getRequest(COLLECTION_SLUG, selectedId) : null
    if (!request) return

    sendingRef.current?.abort()
    const controller = new AbortController()
    sendingRef.current = controller
    setSending(true)
    setResponse(null)

    const result = await sendRequest({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body,
      signal: controller.signal,
    })

    if (!controller.signal.aborted) {
      setResponse(result)
      setSending(false)
      sendingRef.current = null
    }
  }, [selectedId])

  const handleUndo = useCallback(() => {
    crdtService.undo(COLLECTION_SLUG)
  }, [])

  const handleRedo = useCallback(() => {
    crdtService.redo(COLLECTION_SLUG)
  }, [])

  const handleRename = useCallback((name) => {
    const trimmed = name.trim()
    if (!trimmed) {
      setIdentity(identityRef.current)
      return
    }
    const next = { ...identityRef.current, name: trimmed, color: colorForName(trimmed) }
    identityRef.current = next
    setIdentity(next)
    saveIdentity(next)
    crdtService.setLocalUser(COLLECTION_SLUG, next)
  }, [])

  const handleClearCache = useCallback(async () => {
    if (!window.confirm('Clear the local offline copy of this collection? Changes synced to the server are kept.')) return
    try {
      await crdtService.clearLocalCache(COLLECTION_SLUG)
      // Re-open the collection so a fresh (empty) offline cache is attached;
      // otherwise later edits would no longer be cached. Bootstrapping runs
      // again so the re-opened document can refill itself if the server is
      // unreachable.
      bootstrappedRef.current = false
      setReloadToken((token) => token + 1)
      setNotice({ tone: 'info', text: 'Local offline cache cleared.' })
    } catch (error) {
      setNotice({ tone: 'error', text: `Could not clear the cache: ${error.message}` })
    }
  }, [])

  const refreshUndoState = useCallback(() => {
    setCanUndo(crdtService.canUndo(COLLECTION_SLUG))
    setCanRedo(crdtService.canRedo(COLLECTION_SLUG))
  }, [])

  // ------------------------------------------------------------------- setup
  useEffect(() => {
    let active = true
    let cleanup = () => {}
    bootstrappedRef.current = false

    // One effect owns the whole lifecycle: document + IndexedDB + WebSocket +
    // presence, and tears all of it down again on unmount.
    const setup = async () => {
      await crdtService.initCollection(COLLECTION_SLUG, { user: identityRef.current })
      if (!active) return

      const unsubscribeStatus = crdtService.onStatusChange(COLLECTION_SLUG, (next) => {
        setStatus(next.status)
        setSynced(next.synced)
      })
      const unsubscribePresence = crdtService.onPresenceChange(COLLECTION_SLUG, setPeers)
      const unsubscribeDoc = crdtService.subscribe(COLLECTION_SLUG, (data) => {
        setRequests(data.requests)
        refreshUndoState()
      })

      // Seed a brand new collection with a sample request, and restore one from
      // the Convex snapshot when the browser brings nothing of its own. Both
      // happen only after the first sync, so a stored snapshot can never be
      // merged on top of live state (which would resurrect deleted requests).
      if (!bootstrappedRef.current) {
        bootstrappedRef.current = true
        await crdtService.waitForInitialSync(COLLECTION_SLUG, FIRST_SYNC_WAIT_MS)
        if (!active) return

        if (crdtService.getRequests(COLLECTION_SLUG).length === 0) {
          if (isConvexConfigured) {
            try {
              const snapshot = await convexService.loadSnapshot(COLLECTION_SLUG)
              if (snapshot) {
                crdtService.importDocument(COLLECTION_SLUG, snapshot)
                setNotice({ tone: 'info', text: 'Restored this collection from the Convex snapshot.' })
              }
            } catch (error) {
              console.warn('[app] could not load the Convex snapshot:', error)
            }
          }

          if (active && crdtService.getRequests(COLLECTION_SLUG).length === 0) {
            crdtService.addRequest(COLLECTION_SLUG, SAMPLE_REQUEST)
          }
        }
      }

      if (!active) return
      cleanup = () => {
        unsubscribeStatus()
        unsubscribePresence()
        unsubscribeDoc()
      }
    }

    setup().catch((error) => {
      console.error('[app] failed to initialise the collection:', error)
      setNotice({ tone: 'error', text: `Could not open collection: ${error.message}` })
    })

    return () => {
      active = false
      cleanup()
      crdtService.destroy(COLLECTION_SLUG)
    }
  }, [refreshUndoState, reloadToken])

  // Broadcast the open request so other users can see who is editing what.
  useEffect(() => {
    crdtService.setEditing(COLLECTION_SLUG, selectedId)
  }, [selectedId])

  // Notices are informational; clear them after a few seconds.
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  // Undo/redo keyboard shortcuts (ignored while typing in a field, so the
  // browser's own text undo still works).
  useEffect(() => {
    const onKeyDown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      event.preventDefault()
      if (event.shiftKey) crdtService.redo(COLLECTION_SLUG)
      else crdtService.undo(COLLECTION_SLUG)
      refreshUndoState()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [refreshUndoState])

  // Push a Yjs snapshot to Convex (debounced) so a new browser can bootstrap.
  useEffect(() => {
    if (!isConvexConfigured || requests.length === 0) return
    const timer = setTimeout(async () => {
      try {
        const record = await convexService.ensureCollection(
          COLLECTION_SLUG,
          crdtService.getMetadata(COLLECTION_SLUG).name,
          'Demo API collection for CRDT testing'
        )
        await convexService.pushSnapshot(record._id, crdtService.exportDocument(COLLECTION_SLUG))
      } catch (error) {
        console.warn('[app] Convex snapshot failed:', error)
      }
    }, SNAPSHOT_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [requests])

  useEffect(() => () => sendingRef.current?.abort(), [])

  // ------------------------------------------------------------------ render
  const selectedRequest = useMemo(
    () => requests.find((request) => request.id === selectedId) || null,
    [requests, selectedId]
  )

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold mb-2">CRDT Collaborative API Workspace</h1>
            <p className="text-gray-400">
              Real-time collaboration with automatic conflict resolution
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="identity" className="text-xs text-gray-400">
              You are
            </label>
            <input
              id="identity"
              type="text"
              value={identity.name}
              onChange={(event) => setIdentity({ ...identity, name: event.target.value })}
              onBlur={(event) => handleRename(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
              className="bg-gray-800 border border-gray-700 rounded px-3 py-1 text-sm w-40"
            />
            <button
              type="button"
              onClick={handleClearCache}
              className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700"
              title="Delete the IndexedDB copy of this collection"
            >
              Clear local cache
            </button>
          </div>
        </header>

        {notice && (
          <div
            role="status"
            className={`mb-4 rounded px-4 py-2 text-sm ${
              notice.tone === 'error' ? 'bg-red-950 text-red-200' : 'bg-gray-900 text-gray-300'
            }`}
          >
            {notice.text}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <RequestList
            requests={requests}
            selectedId={selectedId}
            peers={peers}
            onSelect={handleSelectRequest}
            onAdd={handleAddRequest}
          />

          {selectedRequest ? (
            <RequestEditor
              key={selectedRequest.id}
              request={selectedRequest}
              sending={sending}
              canUndo={canUndo}
              canRedo={canRedo}
              onChange={applyPatch}
              onSend={handleSend}
              onDuplicate={handleDuplicateRequest}
              onDelete={handleDeleteRequest}
              onUndo={handleUndo}
              onRedo={handleRedo}
            />
          ) : (
            <div className="lg:col-span-2 bg-gray-900 rounded-lg p-4 flex items-center justify-center">
              <p className="text-gray-400">Select a request to edit or create a new one</p>
            </div>
          )}
        </div>

        <ResponseViewer response={response} />

        <PresenceBar
          peers={peers}
          status={status}
          synced={synced}
          requestCount={requests.length}
        />
      </div>
    </div>
  )
}

export default App
