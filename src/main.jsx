import React from 'react'
import ReactDOM from 'react-dom/client'
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import App from './App.jsx'
import './index.css'

const convexUrl = import.meta.env.VITE_CONVEX_URL

if (!convexUrl) {
  // Convex is optional: the CRDT + WebSocket + IndexedDB app runs without it.
  console.warn(
    '[crdt] VITE_CONVEX_URL is not set. Running without Convex persistence; ' +
      'run `npx convex dev` and check .env.local to enable snapshots.'
  )
}

const convex = convexUrl ? new ConvexReactClient(convexUrl) : null

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {convex ? (
      <ConvexProvider client={convex}>
        <App />
      </ConvexProvider>
    ) : (
      <App />
    )}
  </React.StrictMode>
)
