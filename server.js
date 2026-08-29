import { WebSocketServer } from 'ws';

const PORT = 1234;
const MAX_MESSAGE_SIZE = 1024 * 1024; // 1MB max message size
const MAX_CLIENTS_PER_ROOM = 100; // Prevent abuse

const wss = new WebSocketServer({ 
  port: PORT,
  maxPayload: MAX_MESSAGE_SIZE
});

console.log(`WebSocket server running on port ${PORT}`);

// Store clients by room name
const clients = new Map(); // Map room name -> Set of WebSocket connections

wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  console.log(`New client connected from ${clientIp}`);
  
  // Extract room name from URL query parameter  
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const roomName = url.searchParams.get('room') || 'default';
  
  console.log(`Client joining room: ${roomName}`);
  
  // Get or create client set for this room
  if (!clients.has(roomName)) {
    clients.set(roomName, new Set());
  }
  
  const roomClients = clients.get(roomName);
  
  // Prevent room overcrowding
  if (roomClients.size >= MAX_CLIENTS_PER_ROOM) {
    console.warn(`Room ${roomName} is full, rejecting connection`);
    ws.close(1013, 'Room full');
    return;
  }
  
  roomClients.add(ws);
  
  // Handle incoming messages - broadcast to other clients in same room
  ws.on('message', (data) => {
    try {
      // Validate message size
      if (data.length > MAX_MESSAGE_SIZE) {
        console.warn(`Message too large from ${clientIp}`);
        ws.close(1009, 'Message too large');
        return;
      }
      
      // Broadcast to other clients in the same room
      roomClients.forEach(client => {
        if (client !== ws && client.readyState === 1) {
          try {
            client.send(data);
          } catch (sendError) {
            console.error('Error sending to client:', sendError);
          }
        }
      });
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });
  
  ws.on('close', () => {
    console.log(`Client disconnected from ${clientIp}`);
    roomClients.delete(ws);
    if (roomClients.size === 0) {
      // Clean up empty rooms
      clients.delete(roomName);
    }
  });
  
  ws.on('error', (error) => {
    console.error(`WebSocket error from ${clientIp}:`, error);
  });
});

wss.on('error', (error) => {
  console.error('WebSocket server error:', error);
});

console.log('Server ready for message broadcasting');
