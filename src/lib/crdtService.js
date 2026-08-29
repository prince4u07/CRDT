import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';

class CRDTService {
  constructor() {
    this.docs = new Map(); // Store Yjs documents by collection ID
    this.providers = new Map(); // Store WebSocket providers
    this.persistences = new Map(); // Store IndexedDB persistences
  }

  /**
   * Create or load a Yjs document for an API collection
   */
  getOrCreateDocument(collectionId) {
    if (this.docs.has(collectionId)) {
      return this.docs.get(collectionId);
    }

    const doc = new Y.Doc();
    
    // Initialize document structure if new
    const requests = doc.getArray('requests');
    const metadata = doc.getMap('metadata');
    
    if (requests.length === 0) {
      // Initialize with default structure
      metadata.set('name', 'Untitled Collection');
      metadata.set('createdAt', Date.now());
      metadata.set('version', 1);
    }

    this.docs.set(collectionId, doc);
    return doc;
  }

  /**
   * Set up WebSocket synchronization for a document
   */
  setupWebSocketSync(collectionId, doc, wsUrl = 'ws://localhost:1234') {
    if (this.providers.has(collectionId)) {
      return this.providers.get(collectionId);
    }

    const provider = new WebsocketProvider(
      `${wsUrl}?room=collection-${collectionId}`,
      `collection-${collectionId}`,
      doc,
      { connect: true }
    );

    // Handle connection status
    provider.on('status', (event) => {
      console.log(`WebSocket status for ${collectionId}:`, event.status);
    });

    // Handle sync complete
    provider.on('sync', (isSynced) => {
      console.log(`Sync ${isSynced ? 'complete' : 'started'} for ${collectionId}`);
    });

    this.providers.set(collectionId, provider);
    return provider;
  }

  /**
   * Set up IndexedDB persistence for offline support
   */
  setupOfflinePersistence(collectionId, doc) {
    if (this.persistences.has(collectionId)) {
      return this.persistences.get(collectionId);
    }

    const persistence = new IndexeddbPersistence(
      `crdt-collection-${collectionId}`,
      doc
    );

    persistence.on('synced', () => {
      console.log(`Offline data synced for ${collectionId}`);
    });

    this.persistences.set(collectionId, persistence);
    return persistence;
  }

  /**
   * Add a new API request to the collection
   */
  addRequest(collectionId, requestData) {
    const doc = this.getOrCreateDocument(collectionId);
    const requests = doc.getArray('requests');
    
    const requestMap = new Y.Map();
    requestMap.set('id', requestData.id || crypto.randomUUID());
    requestMap.set('name', requestData.name || 'Untitled Request');
    requestMap.set('method', requestData.method || 'GET');
    requestMap.set('url', requestData.url || '');
    requestMap.set('headers', JSON.stringify(requestData.headers || {}));
    requestMap.set('body', requestData.body || '');
    requestMap.set('createdAt', Date.now());
    requestMap.set('updatedAt', Date.now());

    requests.push([requestMap]);
    
    // Update metadata
    const metadata = doc.getMap('metadata');
    metadata.set('updatedAt', Date.now());
    
    return requestMap.get('id');
  }

  /**
   * Update an existing API request
   */
  updateRequest(collectionId, requestId, updates) {
    const doc = this.getOrCreateDocument(collectionId);
    const requests = doc.getArray('requests');
    
    let found = false;
    requests.forEach((requestMap) => {
      if (requestMap.get('id') === requestId) {
        Object.keys(updates).forEach(key => {
          // Stringify headers for consistent storage
          if (key === 'headers' && typeof updates[key] === 'object') {
            requestMap.set(key, JSON.stringify(updates[key]));
          } else {
            requestMap.set(key, updates[key]);
          }
        });
        requestMap.set('updatedAt', Date.now());
        found = true;
      }
    });

    if (found) {
      const metadata = doc.getMap('metadata');
      metadata.set('updatedAt', Date.now());
    }

    return found;
  }

  /**
   * Delete an API request
   */
  deleteRequest(collectionId, requestId) {
    const doc = this.getOrCreateDocument(collectionId);
    const requests = doc.getArray('requests');
    
    let foundIndex = -1;
    requests.forEach((requestMap, index) => {
      if (requestMap.get('id') === requestId) {
        foundIndex = index;
      }
    });

    if (foundIndex !== -1) {
      requests.delete(foundIndex, 1);
      const metadata = doc.getMap('metadata');
      metadata.set('updatedAt', Date.now());
      return true;
    }

    return false;
  }

  /**
   * Get all requests from a collection
   */
  getRequests(collectionId) {
    const doc = this.getOrCreateDocument(collectionId);
    const requests = doc.getArray('requests');
    
    return requests.map((requestMap) => {
      const headers = requestMap.get('headers');
      let parsedHeaders = headers;
      try {
        parsedHeaders = typeof headers === 'string' ? JSON.parse(headers) : headers;
      } catch {
        parsedHeaders = headers;
      }
      
      return {
        id: requestMap.get('id'),
        name: requestMap.get('name'),
        method: requestMap.get('method'),
        url: requestMap.get('url'),
        headers: parsedHeaders,
        body: requestMap.get('body'),
        createdAt: requestMap.get('createdAt'),
        updatedAt: requestMap.get('updatedAt'),
      };
    });
  }

  /**
   * Get collection metadata
   */
  getMetadata(collectionId) {
    const doc = this.getOrCreateDocument(collectionId);
    const metadata = doc.getMap('metadata');
    
    return {
      name: metadata.get('name'),
      createdAt: metadata.get('createdAt'),
      updatedAt: metadata.get('updatedAt'),
      version: metadata.get('version'),
    };
  }

  /**
   * Update collection metadata
   */
  updateMetadata(collectionId, updates) {
    const doc = this.getOrCreateDocument(collectionId);
    const metadata = doc.getMap('metadata');
    
    Object.keys(updates).forEach(key => {
      metadata.set(key, updates[key]);
    });
  }

  /**
   * Subscribe to document changes
   */
  subscribe(collectionId, callback) {
    const doc = this.getOrCreateDocument(collectionId);
    
    const handler = () => {
      callback({
        requests: this.getRequests(collectionId),
        metadata: this.getMetadata(collectionId),
      });
    };

    doc.on('update', handler);
    
    // Return unsubscribe function
    return () => {
      doc.off('update', handler);
    };
  }

  /**
   * Export document state for persistence
   */
  exportDocument(collectionId) {
    const doc = this.getOrCreateDocument(collectionId);
    return Y.encodeStateAsUpdate(doc);
  }

  /**
   * Import document state
   */
  importDocument(collectionId, state) {
    const doc = this.getOrCreateDocument(collectionId);
    Y.applyUpdate(doc, state);
  }

  /**
   * Clean up resources for a collection
   */
  destroy(collectionId) {
    const provider = this.providers.get(collectionId);
    if (provider) {
      provider.destroy();
      this.providers.delete(collectionId);
    }

    const persistence = this.persistences.get(collectionId);
    if (persistence) {
      // IndexedDBPersistence doesn't have a destroy method, it's automatically cleaned up
      this.persistences.delete(collectionId);
    }

    const doc = this.docs.get(collectionId);
    if (doc) {
      doc.destroy();
      this.docs.delete(collectionId);
    }
  }
}

// Export singleton instance
export const crdtService = new CRDTService();
