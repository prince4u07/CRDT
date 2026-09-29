const STATUS_STYLES = {
  connected: 'bg-green-500',
  connecting: 'bg-yellow-500',
  disconnected: 'bg-red-500',
  error: 'bg-red-500',
}

const STATUS_LABELS = {
  connected: 'Live — syncing with collaborators',
  connecting: 'Connecting to the sync server…',
  disconnected: 'Offline — changes are saved locally and will sync on reconnect',
  error: 'Sync server unreachable — working offline',
}

function PresenceBar({ peers, status, synced, requestCount }) {
  return (
    <div className="mt-6 bg-gray-900 rounded-lg p-4 flex flex-wrap items-center gap-6 justify-between">
      <div>
        <h2 className="text-sm font-semibold mb-2 text-gray-300">Collaboration Status</h2>
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full ${STATUS_STYLES[status] || 'bg-gray-500'}`} />
          <span className="text-sm">{STATUS_LABELS[status] || status}</span>
        </div>
        <p className="text-xs text-gray-500 mt-1">
          {requestCount} request{requestCount === 1 ? '' : 's'}
          {synced ? ' • in sync' : ' • local copy'}
        </p>
      </div>

      <div>
        <h2 className="text-sm font-semibold mb-2 text-gray-300">
          Online ({peers.length})
        </h2>
        {peers.length === 0 ? (
          <p className="text-xs text-gray-500">Nobody else is here yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {peers.map((peer) => (
              <li
                key={peer.clientId}
                title={peer.isSelf ? 'You' : peer.name}
                className="flex items-center gap-2 px-2 py-1 rounded-full bg-gray-800 text-xs"
              >
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: peer.color }}
                />
                <span>{peer.isSelf ? `${peer.name} (you)` : peer.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export default PresenceBar
