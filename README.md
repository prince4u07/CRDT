# CRDT-Based Real-Time Collaborative API Workspace

A collaborative API request editor that allows multiple users to edit the same collection simultaneously with automatic conflict resolution - like Figma, but for API requests.

## 🎯 The Problem Solved

Traditional API collaboration tools (like Postman's shared collections) have slow sync and conflicting edits just overwrite each other. This project uses **CRDTs (Conflict-Free Replicated Data Types)** to guarantee that concurrent edits merge automatically without conflicts, even when users are offline.

## 🚀 What Makes This Special

**DSA Achievement**: Implements a genuine CRDT - an advanced data structure rarely seen in student projects. Used in production by Google Docs, Figma, and Redis. The YATA algorithm guarantees mathematical convergence regardless of update order.

## 🛠 Tech Stack

- **Frontend**: React + Vite + Tailwind CSS
- **CRDT Engine**: Yjs (YATA algorithm implementation)
- **Real-time Sync**: Custom WebSocket server
- **Offline Storage**: IndexedDB via y-indexeddb
- **Backend Persistence**: Convex
- **Package Manager**: npm

## 🏗 Architecture

```
┌─────────────────┐     WebSocket     ┌──────────────────┐
│   React UI      │ ◄──────────────► │  WebSocket Server │
│                 │    (Yjs sync)     │  (Room-based)     │
└────────┬────────┘                   └────────┬─────────┘
         │                                      │
         │                                      │
         │ IndexedDB                            │
         ▼                                      ▼
┌─────────────────┐                   ┌──────────────────┐
│  Offline Cache  │                   │   Convex Backend  │
│  (y-indexeddb)  │                   │  (Persistence)   │
└─────────────────┘                   └──────────────────┘
```

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

# Start Convex backend (for persistence)
npx convex dev

# Start frontend development server
npm run dev
```

The app will be available at http://localhost:5173

## 🎮 Usage

1. **Open the app**: Navigate to http://localhost:5173
2. **Add requests**: Click "+ Add Request" to create new API requests
3. **Edit requests**: Click any request to edit name, method, URL, headers, body
4. **Collaborate**: Open the app in multiple browser windows to see real-time sync
5. **Test offline**: Disconnect internet - edits continue working and sync when reconnected

## 🔑 Key Features

- **Zero Conflicts**: CRDT guarantees automatic merge of concurrent edits
- **Real-time Sync**: Changes propagate instantly across all connected clients
- **Offline-First**: Works without internet, syncs automatically when reconnected
- **Room-Based**: Different collections can be edited independently
- **Persistent**: Convex backend stores document snapshots and history
- **Fast**: Yjs is 10-50x faster than alternatives like Automerge

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
├── convex/              # Convex backend
│   ├── schema.ts        # Database schema
│   └── collections.ts   # Backend functions
├── src/
│   ├── lib/
│   │   └── crdtService.js  # Yjs CRDT operations
│   ├── App.jsx          # Main React component
│   ├── main.jsx         # React entry point
│   └── index.css        # Tailwind styles
├── server.js            # WebSocket sync server
├── package.json
├── vite.config.js
└── tailwind.config.js
```

## 🎓 Learning Resources

- **CRDT Theory**: [CRDTs for Dummies](https://www.juxt.pro/articles/crdts-for-dummies)
- **Yjs Documentation**: [https://docs.yjs.dev/](https://docs.yjs.dev/)
- **YATA Paper**: [The YATA algorithm](https://arxiv.org/abs/2004.12942)

## 🔮 Future Enhancements

- User authentication and presence awareness
- Request history and time-travel debugging
- Multiple collections per workspace
- Import/export from Postman collections
- Request execution and response viewer
- Environment variables support

## 📄 License

ISC

## 🤝 Contributing

This is a demonstration project for learning CRDTs and real-time collaboration patterns.
