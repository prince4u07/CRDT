const METHOD_STYLES = {
  GET: 'bg-green-600',
  POST: 'bg-blue-600',
  PUT: 'bg-yellow-600',
  PATCH: 'bg-purple-600',
  DELETE: 'bg-red-600',
  HEAD: 'bg-teal-600',
  OPTIONS: 'bg-gray-600',
}

const methodClass = (method) => METHOD_STYLES[method] || 'bg-gray-600'

function RequestList({ requests, selectedId, peers, onSelect, onAdd }) {
  const editors = new Map()
  peers.forEach((peer) => {
    if (peer.editing) editors.set(peer.editing, peer)
  })

  return (
    <div className="lg:col-span-1 bg-gray-900 rounded-lg p-4 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">API Requests</h2>
        <span className="text-xs text-gray-400">{requests.length} total</span>
      </div>

      <div className="space-y-2 flex-1 overflow-y-auto max-h-[28rem]">
        {requests.length === 0 && (
          <p className="text-sm text-gray-500 py-4 text-center">
            No requests yet. Add one to get started.
          </p>
        )}

        {requests.map((request) => {
          const editor = editors.get(request.id)
          return (
            <button
              type="button"
              key={request.id}
              onClick={() => onSelect(request.id)}
              aria-current={selectedId === request.id}
              className={`w-full text-left bg-gray-800 rounded p-3 hover:bg-gray-700 transition ${
                selectedId === request.id ? 'ring-2 ring-blue-500' : ''
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-xs font-bold px-2 py-1 rounded ${methodClass(request.method)}`}>
                  {request.method}
                </span>
                <span className="text-sm truncate flex-1">{request.name}</span>
                {editor && (
                  <span
                    title={`${editor.name} is editing this`}
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: editor.color }}
                  />
                )}
              </div>
              <div className="text-xs text-gray-400 truncate">{request.url || 'No URL'}</div>
              {request.updatedBy && (
                <div className="text-[10px] text-gray-500 mt-1 truncate">
                  last edited by {request.updatedBy}
                </div>
              )}
            </button>
          )
        })}
      </div>

      <button
        type="button"
        onClick={onAdd}
        className="mt-4 w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded"
      >
        + Add Request
      </button>
    </div>
  )
}

export default RequestList
