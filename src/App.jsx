import { useState, useEffect, useCallback, useMemo } from 'react'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../convex/_generated'
import { crdtService } from './lib/crdtService'

function App() {
  const [requests, setRequests] = useState([])
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const [collectionId] = useState('demo-collection')
  const [convexCollectionId, setConvexCollectionId] = useState(null)

  // Convex mutations and queries
  const createCollection = useMutation(api.collections.createCollection)
  const updateCRDTDocument = useMutation(api.collections.updateCRDTDocument)
  const collections = useQuery(api.collections.listCollections)

  useEffect(() => {
    // Initialize CRDT document and sync
    const doc = crdtService.getOrCreateDocument(collectionId)
    
    // Set up WebSocket sync
    const provider = crdtService.setupWebSocketSync(collectionId, doc)
    
    // Set up offline persistence
    crdtService.setupOfflinePersistence(collectionId, doc)
    
    // Subscribe to changes
    const unsubscribe = crdtService.subscribe(collectionId, (data) => {
      setRequests(data.requests)
    })
    
    // Load initial data (cached to avoid multiple calls)
    const initialRequests = crdtService.getRequests(collectionId)
    setRequests(initialRequests)
    
    // Add sample data if empty
    if (initialRequests.length === 0) {
      crdtService.addRequest(collectionId, {
        name: 'Get Users',
        method: 'GET',
        url: 'https://api.example.com/users',
        headers: { 'Content-Type': 'application/json' },
        body: ''
      })
    }
    
    // Monitor connection status
    provider.on('status', (event) => {
      setConnectionStatus(event.status)
    })
    
    return () => {
      unsubscribe()
      crdtService.destroy(collectionId)
    }
  }, [collectionId, convexCollectionId, createCollection, updateCRDTDocument, collections])

  useEffect(() => {
    // Initialize Convex collection when collections are loaded
    initializeConvexCollection()
  }, [collections, convexCollectionId, createCollection])

  // Sync to Convex when requests change (debounced)
  useEffect(() => {
    if (!convexCollectionId || requests.length === 0) return
    
    const timeoutId = setTimeout(() => {
      syncToConvex({ requests, metadata: crdtService.getMetadata(collectionId) })
    }, 1000) // Debounce sync to avoid too frequent updates
    
    return () => clearTimeout(timeoutId)
  }, [requests, convexCollectionId, collectionId, syncToConvex])

  const initializeConvexCollection = useCallback(async () => {
    try {
      // Check if we already have a collection ID stored
      if (!convexCollectionId && collections && collections.length > 0) {
        // Use existing collection or create new one
        const existingCollection = collections.find(c => c.name === 'demo-collection')
        if (existingCollection) {
          setConvexCollectionId(existingCollection._id)
        } else {
          const newId = await createCollection({
            name: 'demo-collection',
            description: 'Demo API collection for CRDT testing'
          })
          setConvexCollectionId(newId)
        }
      }
    } catch (error) {
      console.error('Failed to initialize Convex collection:', error)
    }
  }, [convexCollectionId, collections, createCollection])

  const syncToConvex = useCallback(async (data) => {
    if (!convexCollectionId) return
    
    try {
      const documentState = crdtService.exportDocument(collectionId)
      // Convert Uint8Array to base64 for browser compatibility
      let binary = ''
      const bytes = new Uint8Array(documentState)
      const len = bytes.byteLength
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i])
      }
      const base64State = btoa(binary)
      
      await updateCRDTDocument({
        id: convexCollectionId,
        crdtDocument: base64State,
        version: data.metadata?.version || 1
      })
    } catch (error) {
      console.error('Failed to sync to Convex:', error)
    }
  }, [convexCollectionId, collectionId, updateCRDTDocument])

  const handleAddRequest = useCallback(() => {
    const newRequest = {
      name: 'New Request',
      method: 'GET',
      url: '',
      headers: {},
      body: ''
    }
    const id = crdtService.addRequest(collectionId, newRequest)
    setSelectedRequest(id)
  }, [collectionId])

  const handleSelectRequest = useCallback((request) => {
    setSelectedRequest(request.id)
  }, [])

  const handleUpdateRequest = useCallback((updates) => {
    if (selectedRequest) {
      try {
        crdtService.updateRequest(collectionId, selectedRequest, updates)
      } catch (error) {
        console.error('Failed to update request:', error)
      }
    }
  }, [collectionId, selectedRequest])

  const handleDeleteRequest = useCallback(() => {
    if (selectedRequest) {
      try {
        crdtService.deleteRequest(collectionId, selectedRequest)
        setSelectedRequest(null)
      } catch (error) {
        console.error('Failed to delete request:', error)
      }
    }
  }, [collectionId, selectedRequest])

  const selectedRequestData = useMemo(() => 
    requests.find(r => r.id === selectedRequest), 
    [requests, selectedRequest]
  )

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-6xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold mb-2">CRDT Collaborative API Workspace</h1>
          <p className="text-gray-400">Real-time collaboration with automatic conflict resolution</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 bg-gray-900 rounded-lg p-4">
            <h2 className="text-xl font-semibold mb-4">API Requests</h2>
            <div className="space-y-2">
              {requests.map((request) => (
                <div 
                  key={request.id} 
                  className={`bg-gray-800 rounded p-3 hover:bg-gray-700 cursor-pointer ${selectedRequest === request.id ? 'ring-2 ring-blue-500' : ''}`}
                  onClick={() => handleSelectRequest(request)}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-xs font-bold px-2 py-1 rounded ${
                      request.method === 'GET' ? 'bg-green-600' :
                      request.method === 'POST' ? 'bg-blue-600' :
                      request.method === 'PUT' ? 'bg-yellow-600' :
                      request.method === 'DELETE' ? 'bg-red-600' : 'bg-gray-600'
                    }`}>
                      {request.method}
                    </span>
                    <span className="text-sm truncate">{request.name}</span>
                  </div>
                  <div className="text-xs text-gray-400 truncate">{request.url}</div>
                </div>
              ))}
            </div>
            <button 
              onClick={handleAddRequest}
              className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded"
            >
              + Add Request
            </button>
          </div>

          <div className="lg:col-span-2 bg-gray-900 rounded-lg p-4">
            <h2 className="text-xl font-semibold mb-4">Request Editor</h2>
            {selectedRequestData ? (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2">Request Name</label>
                  <input 
                    type="text" 
                    value={selectedRequestData.name}
                    onChange={(e) => handleUpdateRequest({ name: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
                  />
                </div>
                <div className="grid grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Method</label>
                    <select 
                      value={selectedRequestData.method}
                      onChange={(e) => handleUpdateRequest({ method: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
                    >
                      <option>GET</option>
                      <option>POST</option>
                      <option>PUT</option>
                      <option>DELETE</option>
                    </select>
                  </div>
                  <div className="col-span-3">
                    <label className="block text-sm font-medium mb-2">URL</label>
                    <input 
                      type="text" 
                      value={selectedRequestData.url}
                      onChange={(e) => {
                        const url = e.target.value
                        // Basic URL validation to prevent javascript: and other dangerous protocols
                        if (!url.trim() || url.startsWith('http://') || url.startsWith('https://')) {
                          handleUpdateRequest({ url })
                        }
                      }}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
                      placeholder="https://api.example.com/endpoint"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Headers</label>
                  <textarea 
                    value={typeof selectedRequestData.headers === 'string' 
                      ? selectedRequestData.headers 
                      : JSON.stringify(selectedRequestData.headers || {}, null, 2)}
                    onChange={(e) => {
                      const value = e.target.value
                      try {
                        // Basic JSON validation to prevent injection
                        if (value.trim() && (value.includes('{') || value.includes('['))) {
                          const headers = JSON.parse(value)
                          // Validate that headers is an object
                          if (typeof headers === 'object' && headers !== null && !Array.isArray(headers)) {
                            handleUpdateRequest({ headers })
                          } else {
                            handleUpdateRequest({ headers: value })
                          }
                        } else {
                          handleUpdateRequest({ headers: value })
                        }
                      } catch {
                        handleUpdateRequest({ headers: value })
                      }
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white h-24 font-mono text-sm"
                    placeholder="Enter headers as JSON format"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Body</label>
                  <textarea 
                    value={selectedRequestData.body || ''}
                    onChange={(e) => handleUpdateRequest({ body: e.target.value })}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white h-32 font-mono text-sm"
                  />
                </div>
                <div className="flex gap-4">
                  <button className="bg-green-600 hover:bg-green-700 text-white py-2 px-6 rounded">
                    Send Request
                  </button>
                  <button 
                    onClick={handleDeleteRequest}
                    className="bg-red-600 hover:bg-red-700 text-white py-2 px-6 rounded"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-gray-400 text-center py-8">
                Select a request to edit or create a new one
              </div>
            )}
          </div>
        </div>

        <div className="mt-6 bg-gray-900 rounded-lg p-4">
          <h2 className="text-xl font-semibold mb-4">Collaboration Status</h2>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-3 h-3 rounded-full ${connectionStatus === 'connected' ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className="text-sm capitalize">{connectionStatus}</span>
            </div>
            <div className="text-sm text-gray-400">
              Real-time sync enabled • Offline support active • {requests.length} requests
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
