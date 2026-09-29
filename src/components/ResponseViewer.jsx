function ResponseViewer({ response }) {
  if (!response) {
    return (
      <div className="mt-6 bg-gray-900 rounded-lg p-4">
        <h2 className="text-xl font-semibold mb-2">Response</h2>
        <p className="text-sm text-gray-500">
          Send a request to see the status, timing and body here.
        </p>
      </div>
    )
  }

  if (response.error) {
    return (
      <div className="mt-6 bg-gray-900 rounded-lg p-4 border border-red-900">
        <h2 className="text-xl font-semibold mb-2 text-red-400">Request failed</h2>
        <p className="text-sm text-gray-300">{response.error}</p>
      </div>
    )
  }

  return (
    <div className="mt-6 bg-gray-900 rounded-lg p-4">
      <h2 className="text-xl font-semibold mb-3">Response</h2>

      <div className="flex flex-wrap items-center gap-4 text-sm mb-3">
        <span
          className={`px-2 py-1 rounded font-bold ${
            response.ok ? 'bg-green-700' : 'bg-red-700'
          }`}
        >
          {response.status} {response.statusText}
        </span>
        <span className="text-gray-400">{response.duration} ms</span>
        <span className="text-gray-400">{response.size}</span>
      </div>

      <p className="text-xs text-gray-500 break-all mb-3">{response.url}</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-1">
          <h3 className="text-xs font-semibold text-gray-400 mb-1 uppercase">Headers</h3>
          <dl className="text-xs space-y-1 max-h-48 overflow-y-auto">
            {Object.entries(response.headers).map(([key, value]) => (
              <div key={key} className="flex gap-2">
                <dt className="text-gray-400 shrink-0">{key}:</dt>
                <dd className="truncate" title={value}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="md:col-span-2">
          <h3 className="text-xs font-semibold text-gray-400 mb-1 uppercase">Body</h3>
          <pre className="bg-gray-800 rounded p-3 text-xs overflow-auto max-h-72 whitespace-pre-wrap break-all">
            {response.body || '(empty body)'}
          </pre>
        </div>
      </div>
    </div>
  )
}

export default ResponseViewer
