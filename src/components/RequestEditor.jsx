import { useEffect, useRef, useState } from 'react'
import { HTTP_METHODS } from '../lib/crdtService'

const toHeaderText = (headers) => JSON.stringify(headers ?? {}, null, 2)

function RequestEditor({
  request,
  sending,
  canUndo,
  canRedo,
  onChange,
  onSend,
  onDuplicate,
  onDelete,
  onUndo,
  onRedo,
}) {
  const [headersText, setHeadersText] = useState(() => toHeaderText(request.headers))
  const [headersError, setHeadersError] = useState(null)
  const headersFocused = useRef(false)

  // Follow remote edits, but never fight the user while they are typing.
  useEffect(() => {
    if (headersFocused.current) return
    setHeadersText(toHeaderText(request.headers))
  }, [request.id, request.headers])

  const handleHeadersChange = (value) => {
    setHeadersText(value)
    if (!value.trim()) {
      setHeadersError(null)
      onChange({ headers: {} })
      return
    }
    try {
      const parsed = JSON.parse(value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setHeadersError('Headers must be a JSON object')
        return
      }
      setHeadersError(null)
      onChange({ headers: parsed })
    } catch {
      setHeadersError('Not valid JSON yet — it will be saved once it parses')
    }
  }

  return (
    <div className="lg:col-span-2 bg-gray-900 rounded-lg p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Request Editor</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo your last change (Ctrl+Z)"
            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Shift+Z)"
            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Redo
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <label htmlFor="request-name" className="block text-sm font-medium mb-2">
            Request Name
          </label>
          <input
            id="request-name"
            type="text"
            value={request.name}
            onChange={(event) => onChange({ name: event.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
          />
        </div>

        <div className="grid grid-cols-4 gap-4">
          <div>
            <label htmlFor="request-method" className="block text-sm font-medium mb-2">
              Method
            </label>
            <select
              id="request-method"
              value={request.method}
              onChange={(event) => onChange({ method: event.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
            >
              {HTTP_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </div>
          <div className="col-span-3">
            <label htmlFor="request-url" className="block text-sm font-medium mb-2">
              URL
            </label>
            <input
              id="request-url"
              type="text"
              value={request.url}
              onChange={(event) => onChange({ url: event.target.value })}
              className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white"
              placeholder="https://api.example.com/endpoint"
            />
          </div>
        </div>

        <div>
          <label htmlFor="request-headers" className="block text-sm font-medium mb-2">
            Headers
          </label>
          <textarea
            id="request-headers"
            value={headersText}
            onFocus={() => {
              headersFocused.current = true
            }}
            onBlur={() => {
              headersFocused.current = false
              setHeadersText(toHeaderText(request.headers))
            }}
            onChange={(event) => handleHeadersChange(event.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white h-24 font-mono text-sm"
            placeholder='{"Content-Type": "application/json"}'
            spellCheck={false}
          />
          {headersError && <p className="text-xs text-amber-400 mt-1">{headersError}</p>}
        </div>

        <div>
          <label htmlFor="request-body" className="block text-sm font-medium mb-2">
            Body
          </label>
          <textarea
            id="request-body"
            value={request.body}
            onChange={(event) => onChange({ body: event.target.value })}
            className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-white h-32 font-mono text-sm"
            spellCheck={false}
          />
        </div>

        <div className="flex flex-wrap gap-4">
          <button
            type="button"
            onClick={onSend}
            disabled={sending}
            className="bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white py-2 px-6 rounded"
          >
            {sending ? 'Sending…' : 'Send Request'}
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            className="bg-gray-700 hover:bg-gray-600 text-white py-2 px-4 rounded"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="bg-red-600 hover:bg-red-700 text-white py-2 px-6 rounded"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

export default RequestEditor
