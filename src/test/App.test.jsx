import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

const SAMPLE = {
  id: 'request-1',
  name: 'Get Users',
  method: 'GET',
  url: 'https://api.example.com/users',
  headers: { 'Content-Type': 'application/json' },
  body: '',
  createdAt: 1,
  updatedAt: 1,
  updatedBy: 'Ada',
}

const METADATA = { name: 'Untitled Collection', version: 1, createdAt: 1, updatedAt: 1 }

const PEERS = [
  { clientId: 1, name: 'Ada', color: '#f00', isSelf: true, editing: null },
  { clientId: 2, name: 'Bob', color: '#0f0', isSelf: false, editing: 'request-1' },
]

/**
 * Test doubles are built inside `vi.hoisted` because `vi.mock` factories run
 * before the module body. The CRDT double keeps real state so the controlled
 * inputs in the editor can be driven with user events.
 */
const harness = vi.hoisted(() => {
  const state = { requests: [], listeners: new Set(), nextId: 2 }
  const metadata = { name: 'Untitled Collection', version: 1, createdAt: 1, updatedAt: 1 }

  const snapshot = () =>
    state.requests.map((request) => ({ ...request, headers: { ...request.headers } }))
  const emit = () => {
    const payload = { requests: snapshot(), metadata: { ...metadata } }
    state.listeners.forEach((callback) => callback(payload))
  }

  const crdtService = {
    initCollection: vi.fn(async () => ({ doc: {}, provider: {} })),
    waitForInitialSync: vi.fn(async () => true),
    subscribe: vi.fn((collectionId, callback) => {
      state.listeners.add(callback)
      callback({ requests: snapshot(), metadata: { ...metadata } })
      return () => state.listeners.delete(callback)
    }),
    onStatusChange: vi.fn(() => () => {}),
    onPresenceChange: vi.fn(() => () => {}),
    getRequests: vi.fn(() => snapshot()),
    getRequest: vi.fn((collectionId, requestId) =>
      state.requests.find((request) => request.id === requestId) || null
    ),
    getMetadata: vi.fn(() => ({ ...metadata })),
    addRequest: vi.fn((collectionId, data) => {
      const id = `request-${state.nextId++}`
      state.requests.push({
        id,
        name: 'New Request',
        method: 'GET',
        url: '',
        headers: {},
        body: '',
        createdAt: 1,
        updatedAt: 1,
        updatedBy: 'Anonymous',
        ...data,
      })
      emit()
      return id
    }),
    updateRequest: vi.fn((collectionId, requestId, patch) => {
      const request = state.requests.find((item) => item.id === requestId)
      if (!request) return false
      Object.assign(request, patch)
      emit()
      return true
    }),
    deleteRequest: vi.fn((collectionId, requestId) => {
      const index = state.requests.findIndex((item) => item.id === requestId)
      if (index === -1) return false
      state.requests.splice(index, 1)
      emit()
      return true
    }),
    duplicateRequest: vi.fn((collectionId, requestId) => {
      const source = state.requests.find((item) => item.id === requestId)
      if (!source) return null
      const id = `request-${state.nextId++}`
      state.requests.splice(state.requests.indexOf(source) + 1, 0, {
        ...source,
        id,
        name: `${source.name} copy`,
      })
      emit()
      return id
    }),
    undo: vi.fn(),
    redo: vi.fn(),
    canUndo: vi.fn(() => false),
    canRedo: vi.fn(() => false),
    setLocalUser: vi.fn(),
    setEditing: vi.fn(),
    exportDocument: vi.fn(() => new Uint8Array([1, 2, 3])),
    importDocument: vi.fn(() => {
      state.requests.push({
        ...SAMPLE,
        id: 'restored',
        name: 'Restored Request',
        headers: { ...SAMPLE.headers },
      })
      emit()
      return true
    }),
    clearLocalCache: vi.fn(async () => true),
    destroy: vi.fn(),
  }

  return {
    state,
    metadata,
    snapshot,
    crdtService,
    httpClient: { sendRequest: vi.fn() },
    convex: {
      isConvexConfigured: false,
      convexService: {
        loadSnapshot: vi.fn(async () => null),
        ensureCollection: vi.fn(async () => ({ _id: 'convex-1' })),
        pushSnapshot: vi.fn(async () => 1),
      },
    },
  }
})

vi.mock('../lib/crdtService', () => ({
  crdtService: harness.crdtService,
  colorForName: (name) => `#${(name || '').length.toString(16).padStart(6, '0')}`,
  HTTP_METHODS: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
}))

vi.mock('../lib/httpClient', () => ({ sendRequest: harness.httpClient.sendRequest }))

vi.mock('../lib/convexService', () => harness.convex)

const renderApp = async () => {
  const user = userEvent.setup()
  render(<App />)
  await waitFor(() => expect(harness.crdtService.initCollection).toHaveBeenCalled())
  return user
}

const openRequest = async (user) => {
  await user.click(screen.getByRole('button', { name: /Get Users/ }))
  return screen.findByLabelText('Request Name')
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    harness.state.requests = [{ ...SAMPLE, headers: { ...SAMPLE.headers } }]
    harness.state.listeners.clear()
    harness.state.nextId = 2
    harness.crdtService.canUndo.mockReturnValue(false)
    harness.crdtService.canRedo.mockReturnValue(false)
    harness.crdtService.clearLocalCache.mockResolvedValue(true)
    harness.crdtService.waitForInitialSync.mockResolvedValue(true)
    harness.convex.isConvexConfigured = false
    harness.convex.convexService.loadSnapshot.mockResolvedValue(new Uint8Array([9, 9, 9]))
    harness.httpClient.sendRequest.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' })
  })

  it('renders the workspace shell', async () => {
    await renderApp()

    expect(screen.getByText('CRDT Collaborative API Workspace')).toBeInTheDocument()
    expect(
      screen.getByText('Real-time collaboration with automatic conflict resolution')
    ).toBeInTheDocument()
    expect(screen.getByText('API Requests')).toBeInTheDocument()
    expect(screen.getByText('Response')).toBeInTheDocument()
    expect(screen.getByText('Collaboration Status')).toBeInTheDocument()
  })

  it('initialises the collection exactly once', async () => {
    await renderApp()

    expect(harness.crdtService.initCollection).toHaveBeenCalledTimes(1)
    expect(harness.crdtService.initCollection).toHaveBeenCalledWith(
      'demo-collection',
      expect.objectContaining({ user: expect.objectContaining({ name: 'Anonymous' }) })
    )
  })

  it('lists the requests delivered by the CRDT', async () => {
    await renderApp()

    expect(await screen.findByText('Get Users')).toBeInTheDocument()
    expect(screen.getByText('https://api.example.com/users')).toBeInTheDocument()
    expect(screen.getByText('1 total')).toBeInTheDocument()
    expect(screen.getByText('last edited by Ada')).toBeInTheDocument()
  })

  it('shows the empty state until a request is selected', async () => {
    await renderApp()
    expect(screen.getByText('Select a request to edit or create a new one')).toBeInTheDocument()
  })

  it('waits for the first sync before deciding what to seed', async () => {
    await renderApp()
    expect(harness.crdtService.waitForInitialSync).toHaveBeenCalledWith('demo-collection', 3000)
  })

  it('seeds a sample request into an empty collection', async () => {
    harness.state.requests = []
    await renderApp()

    await waitFor(() =>
      expect(harness.crdtService.addRequest).toHaveBeenCalledWith(
        'demo-collection',
        expect.objectContaining({ name: 'Get Users' })
      )
    )
    expect(harness.crdtService.importDocument).not.toHaveBeenCalled()
  })

  it('restores a stored snapshot instead of seeding the sample', async () => {
    harness.state.requests = []
    harness.convex.isConvexConfigured = true
    await renderApp()

    await waitFor(() =>
      expect(harness.crdtService.importDocument).toHaveBeenCalledWith(
        'demo-collection',
        expect.any(Uint8Array)
      )
    )
    expect(harness.crdtService.addRequest).not.toHaveBeenCalled()
    expect(await screen.findByText('Restored Request')).toBeInTheDocument()
    expect(
      await screen.findByText('Restored this collection from the Convex snapshot.')
    ).toBeInTheDocument()
  })

  it('never restores a snapshot over existing content', async () => {
    harness.convex.isConvexConfigured = true
    await renderApp()

    await waitFor(() => expect(harness.crdtService.waitForInitialSync).toHaveBeenCalled())
    expect(harness.crdtService.importDocument).not.toHaveBeenCalled()
    expect(harness.crdtService.addRequest).not.toHaveBeenCalled()
  })

  it('opens the editor when a request is selected', async () => {
    const user = await renderApp()
    const name = await openRequest(user)

    expect(name).toHaveValue('Get Users')
    expect(screen.getByLabelText('URL')).toHaveValue('https://api.example.com/users')
    expect(screen.getByLabelText('Method')).toHaveValue('GET')
    expect(screen.getByLabelText('Headers')).toHaveValue(JSON.stringify(SAMPLE.headers, null, 2))
  })

  it('adds a request through the CRDT service', async () => {
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: '+ Add Request' }))

    expect(harness.crdtService.addRequest).toHaveBeenCalledWith('demo-collection', {
      name: 'New Request',
    })
    expect(await screen.findByLabelText('Request Name')).toHaveValue('New Request')
    expect(screen.getByText('2 total')).toBeInTheDocument()
  })

  it('edits the request through the CRDT service', async () => {
    const user = await renderApp()
    const name = await openRequest(user)

    await user.clear(name)
    await user.type(name, 'List Users')

    expect(harness.crdtService.updateRequest).toHaveBeenLastCalledWith('demo-collection', 'request-1', {
      name: 'List Users',
    })
    expect(await screen.findByText('List Users')).toBeInTheDocument()
  })

  it('commits headers once they parse as JSON', async () => {
    const user = await renderApp()
    await openRequest(user)

    const headers = screen.getByLabelText('Headers')
    harness.crdtService.updateRequest.mockClear()
    await user.clear(headers)
    await user.type(headers, '{{"X-Test": "1"}')

    expect(harness.crdtService.updateRequest).toHaveBeenLastCalledWith('demo-collection', 'request-1', {
      headers: { 'X-Test': '1' },
    })
  })

  it('does not commit half-typed headers', async () => {
    const user = await renderApp()
    await openRequest(user)

    const headers = screen.getByLabelText('Headers')
    harness.crdtService.updateRequest.mockClear()
    await user.clear(headers)
    await user.type(headers, '{{"broken"')

    const headerPatches = harness.crdtService.updateRequest.mock.calls
      .map((call) => call[2].headers)
      .filter((value) => value !== undefined)

    // Only the "field cleared" commit; the broken JSON was never stored.
    expect(headerPatches).toEqual([{}])
    expect(await screen.findByText(/Not valid JSON yet/)).toBeInTheDocument()
  })

  it('deletes the selected request and clears the editor', async () => {
    const user = await renderApp()
    await openRequest(user)
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(harness.crdtService.deleteRequest).toHaveBeenCalledWith('demo-collection', 'request-1')
    expect(screen.getByText('Select a request to edit or create a new one')).toBeInTheDocument()
    expect(screen.getByText('0 total')).toBeInTheDocument()
  })

  it('duplicates the selected request', async () => {
    const user = await renderApp()
    await openRequest(user)
    await user.click(screen.getByRole('button', { name: 'Duplicate' }))

    expect(harness.crdtService.duplicateRequest).toHaveBeenCalledWith('demo-collection', 'request-1')
    expect(await screen.findByText('Get Users copy')).toBeInTheDocument()
    expect(screen.getByText('2 total')).toBeInTheDocument()
  })

  it('sends the selected request and renders the response', async () => {
    harness.httpClient.sendRequest.mockResolvedValue({
      ok: true,
      status: 201,
      statusText: 'Created',
      url: 'https://api.example.com/users',
      duration: 42,
      size: '18 B',
      headers: { 'content-type': 'application/json' },
      body: '{\n  "id": 1\n}',
      bodyKind: 'json',
    })

    const user = await renderApp()
    await openRequest(user)
    await user.click(screen.getByRole('button', { name: 'Send Request' }))

    expect(harness.httpClient.sendRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: SAMPLE.headers,
        body: '',
      })
    )
    expect(await screen.findByText('201 Created')).toBeInTheDocument()
    expect(screen.getByText('42 ms')).toBeInTheDocument()
    expect(screen.getByText('18 B')).toBeInTheDocument()
  })

  it('reports a failed request instead of crashing', async () => {
    harness.httpClient.sendRequest.mockResolvedValue({
      ok: false,
      error: 'The request could not be sent.',
    })

    const user = await renderApp()
    await openRequest(user)
    await user.click(screen.getByRole('button', { name: 'Send Request' }))

    expect(await screen.findByText('Request failed')).toBeInTheDocument()
    expect(screen.getByText('The request could not be sent.')).toBeInTheDocument()
  })

  it('shows presence and connection status', async () => {
    await renderApp()
    await waitFor(() => expect(harness.crdtService.onStatusChange).toHaveBeenCalled())

    const [, onStatus] = harness.crdtService.onStatusChange.mock.calls[0]
    const [, onPresence] = harness.crdtService.onPresenceChange.mock.calls[0]
    act(() => {
      onStatus({ status: 'connected', connected: true, synced: true })
      onPresence(PEERS)
    })

    expect(await screen.findByText('Ada (you)')).toBeInTheDocument()
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Online (2)')).toBeInTheDocument()
    expect(screen.getByText(/in sync/)).toBeInTheDocument()
  })

  it('flags the request another user is editing', async () => {
    await renderApp()
    await waitFor(() => expect(harness.crdtService.onPresenceChange).toHaveBeenCalled())

    const [, onPresence] = harness.crdtService.onPresenceChange.mock.calls[0]
    act(() => onPresence([PEERS[1]]))

    expect(await screen.findByTitle('Bob is editing this')).toBeInTheDocument()
  })

  it('broadcasts which request is open', async () => {
    const user = await renderApp()
    await openRequest(user)

    expect(harness.crdtService.setEditing).toHaveBeenLastCalledWith('demo-collection', 'request-1')
  })

  it('announces the identity on blur', async () => {
    const user = await renderApp()

    const input = screen.getByLabelText('You are')
    await user.clear(input)
    await user.type(input, 'Grace{Enter}')

    expect(harness.crdtService.setLocalUser).toHaveBeenCalledWith(
      'demo-collection',
      expect.objectContaining({ name: 'Grace' })
    )
  })

  it('forwards undo and redo to the service', async () => {
    harness.crdtService.canUndo.mockReturnValue(true)
    harness.crdtService.canRedo.mockReturnValue(true)

    const user = await renderApp()
    await openRequest(user)

    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(harness.crdtService.undo).toHaveBeenCalledWith('demo-collection')

    await user.click(screen.getByRole('button', { name: 'Redo' }))
    expect(harness.crdtService.redo).toHaveBeenCalledWith('demo-collection')
  })

  it('clears the offline cache after confirmation', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Clear local cache' }))

    await waitFor(() =>
      expect(harness.crdtService.clearLocalCache).toHaveBeenCalledWith('demo-collection')
    )
    expect(confirm).toHaveBeenCalled()
    expect(await screen.findByText('Local offline cache cleared.')).toBeInTheDocument()
  })

  it('re-opens the collection after the cache is cleared', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const user = await renderApp()
    expect(harness.crdtService.initCollection).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Clear local cache' }))

    // The live document is torn down and re-created, so later edits are cached
    // again instead of living only in memory.
    await waitFor(() => expect(harness.crdtService.initCollection).toHaveBeenCalledTimes(2))
    expect(harness.crdtService.destroy).toHaveBeenCalledWith('demo-collection')
  })

  it('keeps the cache when the confirmation is declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = await renderApp()

    await user.click(screen.getByRole('button', { name: 'Clear local cache' }))

    expect(harness.crdtService.clearLocalCache).not.toHaveBeenCalled()
  })

  it('tears the collection down on unmount', async () => {
    const { unmount } = render(<App />)
    await waitFor(() => expect(harness.crdtService.initCollection).toHaveBeenCalled())

    unmount()
    expect(harness.crdtService.destroy).toHaveBeenCalledWith('demo-collection')
  })
})
