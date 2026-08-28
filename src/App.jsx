import { useState, useEffect } from 'react'
import { crdtService } from './lib/crdtService'

function App() {
  const [requests, setRequests] = useState([])
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [connectionStatus, setConnectionStatus] = useState('disconnected')
  const [collectionId] = useState('demo-collection')

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
    
    // Load initial data
    setRequests(crdtService.getRequests(collectionId))
    
    // Add sample data if empty
    if (crdtService.getRequests(collectionId).length === 0) {
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
  }, [collectionId])

  const handleAddRequest = () => {
    const newRequest = {
      name: 'New Request',
      method: 'GET',
      url: '',
      headers: {},
      body: ''
    }
    const id = crdtService.addRequest(collectionId, newRequest)
    setSelectedRequest(id)
  }

  const handleSelectRequest = (request) => {
    setSelectedRequest(request.id)
  }

  const handleUpdateRequest = (updates) => {
    if (selectedRequest) {
      crdtService.updateRequest(collectionId, selectedRequest, updates)
    }
  }

  const handleDeleteRequest = () => {
    if (selectedRequest) {
      crdtService.deleteRequest(collectionId, selectedRequest)
      setSelectedRequest(null)
    }
  }

  const selectedRequestData = requests.find(r => r.id === selectedRequest)

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
                      onChange={(e) => handleUpdateRequest({ url: e.target.value })}
                      className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
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
                      try {
                        const headers = JSON.parse(e.target.value)
                        handleUpdateRequest({ headers })
                      } catch {
                        handleUpdateRequest({ headers: e.target.value })
                      }
                    }}
                    className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white h-24 font-mono text-sm"
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
