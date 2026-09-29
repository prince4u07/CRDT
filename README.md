# CRDT-Based Real-Time Collaborative API Workspace

A collaborative API request editor that allows multiple users to edit the same collection simultaneously with automatic conflict resolution - like Figma, but for API requests.

## 🎯 The Problem Solved

Traditional API collaboration tools (like Postman's shared collections) have slow sync and conflicting edits just overwrite each other. This project uses **CRDTs (Conflict-Free Replicated Data Types)** to guarantee that concurrent edits merge automatically without conflicts, even when users are offline.

## 🚀 What Makes This Special

**DSA Achievement**: Implements a genuine CRDT - an advanced data structure rarely seen in student projects. Used in production by Google Docs, Figma, and Redis. The YATA algorithm guarantees mathematical convergence regardless of update order.

## 🛠 Tech Stack

- **Frontend**: React + Vite + Tailwind CSS
- **CRDT Engine**: Yjs (YATA algorithm implementation)
- **Real-time Sync**: Custom stateful WebSocket server (`server.js`, `y-protocols`)
- **Offline Storage**: IndexedDB via y-indexeddb
- **Server Persistence**: Appended Yjs snapshots under `.yjs-data/`
- **Backend Persistence**: Convex (shared document snapshots)
- **Tests**: Vitest (119 unit/integration tests) + a real two-client E2E script
- **Package Manager**: npm

## 🏗 Architecture

```
┌─────────────────┐     WebSocket     ┌──────────────────┐
│   React UI      │ ◄──────────────► │  WebSocket Server │
│                 │    (Yjs sync)     │  (Room-based)     │
└────────┬────────┘   + awareness      └────────┬─────────┘
         │                                      │
         │                              debounced Yjs snapshots
         │ IndexedDB                                │
         ▼                                          ▼
┌─────────────────┐                   ┌──────────────────┐
│  Offline Cache  │                   │  .yjs-data/ room │
│  (y-indexeddb)  │                   │      files       │
└─────────────────┘                   └────────┬─────────┘
                                                │
                                                ▼
                                       ┌──────────────────┐
                                       │   Convex Backend  │
                                       │ (room snapshots)  │
                                       └──────────────────┘
```

The browser restores from Convex only when it has nothing of its own **and** the
first WebSocket sync has completed, so a stored snapshot can never be merged on
top of live server state (which would resurrect deleted requests).

## 🔄 How It Works

### CRDT Workflow

1. **Document Creation**: Each API collection is a Yjs document containing:
   - `Y.Map` for metadata (name, timestamps)
   - `Y.Array` for the list of API requests
   - Each request is a `Y.Map` with URL, method, headers, body

2. **Local Edits**: When you edit a request:
   - Changes are applied instantly to the local Yjs document
   - No network round-trip needed (optimistic updates)
   - UI updates immediately

3. **CRDT Merge**: Yjs automatically handles conflicts:
   - Concurrent edits to different fields → both preserved
   - Concurrent edits to same field → deterministic merge
   - No "last write wins" - both changes survive

4. **Sync Protocol**:
   - Client sends update vector to WebSocket server
   - Server broadcasts to other clients in same room
   - Each client applies updates using CRDT merge rules
   - Guaranteed convergence across all clients

5. **Offline Support**:
   - All changes saved to IndexedDB instantly
   - Works without internet connection
   - When reconnecting, offline changes sync automatically
   - CRDT merge handles any conflicts from offline period

6. **Presence**:
   - Each client publishes its name, colour and the request it is editing
   - The server drops the presence of a socket that disconnects, so a closed tab
     disappears from the list instead of lingering
   - On reconnect the client re-publishes its state with a **fresh awareness
     clock**; without that bump every peer would discard the re-announcement as
     stale and the collaborator would stay invisible until the next heartbeat

7. **Request execution**:
   - Sending a request runs a browser `fetch` (the browser enforces CORS)
   - Method, headers and body are validated before the request leaves the app
   - The response status, headers and body are rendered in a response viewer
   - There is no server-side proxy, so no SSRF surface is introduced

### Data Flow Example

```
User A edits request URL            User B edits request method
         │                                     │
         ▼                                     ▼
   Local Yjs update                    Local Yjs update
         │                                     │
         ▼                                     ▼
   IndexedDB save                      IndexedDB save
         │                                     │
         └────────────┬───────────────────────┘
                      ▼
              WebSocket broadcast
                      │
        ┌─────────────┴─────────────┐
        ▼                           ▼
   User B receives update      User A receives update
        │                           │
        ▼                           ▼
   CRDT merge applied          CRDT merge applied
        │                           │
        ▼                           ▼
   Both see complete state   Both see complete state
```

## 📦 Setup Instructions

```bash
# Install dependencies
npm install

# Start WebSocket server (for real-time sync)
npm run server

# Start Convex backend (optional; needed to restore/save shared snapshots)
npx convex dev

# Start frontend development server
npm run dev
```

The app will be available at http://localhost:5173

### Environment

Copy `.env.example` to `.env.local` and adjust as needed:

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_WS_URL` | WebSocket sync server | `ws://localhost:1234` |
| `VITE_CONVEX_URL` | Convex deployment URL | unset (Convex disabled) |

The app runs without Convex: the WebSocket server is the source of truth and
keeps its own snapshots in `.yjs-data/`.

## 🧪 Tests

```bash
npm test           # Vitest: CRDT service, HTTP client, App integration
npm run test:e2e   # spawns the real server + two Yjs clients
npm run lint
npm run build
```

`npm run test:e2e` boots `server.js` on a free port and verifies edit
replication, awareness (including a dropped and returning client), concurrent
offline merges, late-joiner sync, room isolation, restart persistence and
malformed-message handling.

## 🎮 Usage

1. **Open the app**: Navigate to http://localhost:5173
2. **Add requests**: Click "+ Add Request" to create new API requests
3. **Edit requests**: Click any request to edit name, method, URL, headers, body
4. **Collaborate**: Open the app in multiple browser windows to see real-time sync
5. **Test offline**: Disconnect internet - edits continue working and sync when reconnected
6. **Send a request**: Choose "Send" to execute it and inspect the response
7. **Move data**: Export/import the collection as a Yjs binary document

## 🔑 Key Features

- **Zero Conflicts**: CRDT guarantees automatic merge of concurrent edits
- **Real-time Sync**: Changes propagate instantly across all connected clients
- **Offline-First**: Works without internet, syncs automatically when reconnected
- **Room-Based**: Different collections can be edited independently
- **Presence**: See who is online and which request each person is editing
- **Durable**: The server keeps per-room snapshots on disk; Convex keeps shared ones
- **Import / Export**: Move a whole collection as a Yjs binary document
- **Request Execution**: Send a request and inspect status, headers and body
- **Fast**: Yjs is 10-50x faster than alternatives like Automerge

## ⚠️ Known Limitations

- **No authentication or authorization**: every client that knows a collection id
  can read and edit that collection, and the local identity is not verified
- **No server-side request proxy**: requests run in the browser, so cross-origin
  targets need permissive CORS headers
- **Convex is snapshot-based**: a client only restores a stored snapshot when it
  has no local content of its own, which means two brand-new browsers joining an
  empty-looking collection can each bootstrap independently
- **Awareness is ephemeral**: presence is intentionally not persisted

## 🧠 Technical Deep Dive

### Yjs CRDT Implementation

The project uses Yjs's shared types:
- **Y.Map**: Key-value CRDT for request properties
- **Y.Array**: List CRDT for the request collection
- **YATA Algorithm**: Yet Another Transformation Approach for merge semantics

### Why Yjs Over Alternatives

- **Performance**: 10-50x faster than Automerge, smaller memory footprint
- **Maturity**: Used by Jupyter, Evernote, Sanity Studio in production
- **Ecosystem**: Excellent WebSocket and IndexedDB integrations
- **Simplicity**: Clean API, well-documented

### Conflict Resolution Examples

**Scenario 1: Different fields**
- User A changes URL to `/api/v2/users`
- User B changes method to `POST`
- Result: Both changes preserved, final state has new URL and POST method

**Scenario 2: Same field, concurrent**
- User A adds header `Authorization: Bearer token1`
- User B adds header `Authorization: Bearer token2`
- Result: CRDT merge determines final state based on operation order

**Scenario 3: Offline conflicts**
- User A edits offline for 1 hour
- User B edits online during same period
- Result: When A reconnects, both sets of changes merge automatically

## 📁 Project Structure

```
CRDT/
├── convex/                 # Convex backend
│   ├── schema.ts           # Database schema
│   └── collections.ts      # Backend functions
├── src/
│   ├── components/
│   │   ├── PresenceBar.jsx     # Connection state and online users
│   │   ├── RequestEditor.jsx   # Name/method/URL/headers/body, undo, send
│   │   ├── RequestList.jsx     # Request list with presence indicators
│   │   └── ResponseViewer.jsx  # Response status, headers and body
│   ├── lib/
│   │   ├── convexService.js    # Convex HTTP client + snapshot encoding
│   │   ├── crdtService.js      # Yjs document, persistence, sync, presence
│   │   └── httpClient.js       # Browser request execution
│   ├── test/                    # Vitest suites (crdtService, httpClient,
│   │                            #   convexService, App integration)
│   ├── App.jsx                 # Lifecycle, bootstrap, cache controls
│   ├── main.jsx                # React entry point
│   └── index.css               # Tailwind styles
├── scripts/
│   └── sync-e2e.mjs         # Two-client E2E against the real server
├── server.js                # WebSocket sync server
├── package.json
├── vite.config.js
└── tailwind.config.js
```

## 🎓 Learning Resources

- **CRDT Theory**: [CRDTs for Dummies](https://www.juxt.pro/articles/crdts-for-dummies)
- **Yjs Documentation**: [https://docs.yjs.dev/](https://docs.yjs.dev/)
- **YATA Paper**: [The YATA algorithm](https://arxiv.org/abs/2004.12942)

## 🔮 Future Enhancements

- User authentication and per-collection authorization
- Request history and time-travel debugging
- Multiple collections per workspace
- Import/export from Postman collections
- Environment variables support
- A server-side proxy with an allowlist for cross-origin requests

## 📄 License

ISC

## 🤝 Contributing

This is a demonstration project for learning CRDTs and real-time collaboration patterns.
