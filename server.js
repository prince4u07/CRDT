import { WebSocketServer } from 'ws';
import * as Y from 'yjs';

const PORT = 1234;

const wss = new WebSocketServer({ port: PORT });

console.log(`Yjs WebSocket server running on port ${PORT}`);

// Store documents by room name
const docs = new Map();
const clients = new Map(); // Map room name -> Set of WebSocket connections

wss.on('connection', (ws, req) => {
  console.log('New client connected');
  
  // Extract room name from URL query parameter  
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const roomName = url.searchParams.get('room') || 'default';
  
  console.log(`Client joining room: ${roomName}`);
  
  // Get or create document for this room
  if (!docs.has(roomName)) {
    const doc = new Y.Doc();
    docs.set(roomName, doc);
    clients.set(roomName, new Set());
  }
  
  const doc = docs.get(roomName);
  const roomClients = clients.get(roomName);
  roomClients.add(ws);
  
  // Set up Yjs sync protocol - send state vector first
  ws.send(Buffer.from(Y.encodeStateVector(doc)));
  
  // Then send full state
  ws.send(Buffer.from(Y.encodeStateAsUpdate(doc)));
  
  // Handle incoming updates
  ws.on('message', (data) => {
    try {
      Y.applyUpdate(doc, data);
      
      // Broadcast to other clients in the same room
      const updateBuffer = Buffer.from(Y.encodeStateAsUpdate(doc));
      roomClients.forEach(client => {
        if (client !== ws && client.readyState === 1) {
          client.send(updateBuffer);
        }
      });
    } catch (error) {
      console.error('Error applying update:', error);
    }
  });
  
  ws.on('close', () => {
    console.log('Client disconnected');
    roomClients.delete(ws);
    if (roomClients.size === 0) {
      // Clean up empty rooms
      docs.delete(roomName);
      clients.delete(roomName);
    }
  });
});

wss.on('error', (error) => {
  console.error('WebSocket server error:', error);
});

console.log('Server ready for CRDT synchronization');
