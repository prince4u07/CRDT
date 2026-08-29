import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'
import { crdtService } from '../lib/crdtService'

describe('CRDTService', () => {
  const collectionId = 'test-collection'

  beforeEach(() => {
    // Clean up before each test
    if (crdtService.docs.has(collectionId)) {
      crdtService.destroy(collectionId)
    }
  })

  afterEach(() => {
    // Clean up after each test
    if (crdtService.docs.has(collectionId)) {
      crdtService.destroy(collectionId)
    }
  })

  describe('getOrCreateDocument', () => {
    it('should create a new document for a collection', () => {
      const doc = crdtService.getOrCreateDocument(collectionId)
      expect(doc).toBeDefined()
      expect(crdtService.docs.has(collectionId)).toBe(true)
    })

    it('should return existing document if already created', () => {
      const doc1 = crdtService.getOrCreateDocument(collectionId)
      const doc2 = crdtService.getOrCreateDocument(collectionId)
      expect(doc1).toBe(doc2)
    })

    it('should initialize document structure', () => {
      const doc = crdtService.getOrCreateDocument(collectionId)
      const requests = doc.getArray('requests')
      const metadata = doc.getMap('metadata')
      
      expect(requests).toBeDefined()
      expect(metadata).toBeDefined()
      expect(metadata.get('name')).toBe('Untitled Collection')
      expect(metadata.get('version')).toBe(1)
    })
  })

  describe('addRequest', () => {
    it('should add a new request to the collection', () => {
      const requestData = {
        name: 'Test Request',
        method: 'GET',
        url: 'https://api.example.com/test',
        headers: { 'Content-Type': 'application/json' },
        body: ''
      }

      const id = crdtService.addRequest(collectionId, requestData)
      expect(id).toBeDefined()

      const requests = crdtService.getRequests(collectionId)
      expect(requests.length).toBe(1)
      expect(requests[0].name).toBe('Test Request')
      expect(requests[0].method).toBe('GET')
    })

    it('should generate ID if not provided', () => {
      const requestData = {
        name: 'Test Request',
        method: 'GET',
        url: 'https://api.example.com/test'
      }

      const id = crdtService.addRequest(collectionId, requestData)
      expect(id).toBeDefined()
      expect(typeof id).toBe('string')
    })

    it('should use provided ID if available', () => {
      const customId = 'custom-id-123'
      const requestData = {
        id: customId,
        name: 'Test Request',
        method: 'GET',
        url: 'https://api.example.com/test'
      }

      const id = crdtService.addRequest(collectionId, requestData)
      expect(id).toBe(customId)
    })

    it('should set default values for missing fields', () => {
      const requestData = {
        name: 'Test Request'
      }

      crdtService.addRequest(collectionId, requestData)
      const requests = crdtService.getRequests(collectionId)
      
      expect(requests[0].method).toBe('GET')
      expect(requests[0].url).toBe('')
      expect(requests[0].headers).toEqual({})
      expect(requests[0].body).toBe('')
    })
  })

  describe('updateRequest', () => {
    beforeEach(() => {
      crdtService.addRequest(collectionId, {
        name: 'Original Name',
        method: 'GET',
        url: 'https://api.example.com/original'
      })
    })

    it('should update an existing request', () => {
      const requests = crdtService.getRequests(collectionId)
      const requestId = requests[0].id

      const success = crdtService.updateRequest(collectionId, requestId, {
        name: 'Updated Name',
        method: 'POST'
      })

      expect(success).toBe(true)

      const updatedRequests = crdtService.getRequests(collectionId)
      expect(updatedRequests[0].name).toBe('Updated Name')
      expect(updatedRequests[0].method).toBe('POST')
    })

    it('should return false for non-existent request', () => {
      const success = crdtService.updateRequest(collectionId, 'non-existent-id', {
        name: 'Updated Name'
      })

      expect(success).toBe(false)
    })

    it('should stringify headers when updating', () => {
      const requests = crdtService.getRequests(collectionId)
      const requestId = requests[0].id

      const headers = { 'Authorization': 'Bearer token' }
      crdtService.updateRequest(collectionId, requestId, { headers })

      const updatedRequests = crdtService.getRequests(collectionId)
      expect(updatedRequests[0].headers).toEqual(headers)
    })

    it('should update updatedAt timestamp', () => {
      const requests = crdtService.getRequests(collectionId)
      const requestId = requests[0].id
      
      // Force a small delay to ensure timestamp difference
      const start = Date.now()
      while (Date.now() - start < 10) {
        // busy wait to ensure time passes
      }
      
      crdtService.updateRequest(collectionId, requestId, { name: 'Updated' })
      const updatedRequests = crdtService.getRequests(collectionId)
      expect(updatedRequests[0].updatedAt).toBeGreaterThan(requests[0].updatedAt)
    })
  })

  describe('deleteRequest', () => {
    beforeEach(() => {
      crdtService.addRequest(collectionId, {
        name: 'Request 1',
        method: 'GET',
        url: 'https://api.example.com/1'
      })
      crdtService.addRequest(collectionId, {
        name: 'Request 2',
        method: 'POST',
        url: 'https://api.example.com/2'
      })
    })

    it('should delete an existing request', () => {
      const requests = crdtService.getRequests(collectionId)
      const requestId = requests[0].id

      const success = crdtService.deleteRequest(collectionId, requestId)
      expect(success).toBe(true)

      const updatedRequests = crdtService.getRequests(collectionId)
      expect(updatedRequests.length).toBe(1)
      expect(updatedRequests[0].name).toBe('Request 2')
    })

    it('should return false for non-existent request', () => {
      const success = crdtService.deleteRequest(collectionId, 'non-existent-id')
      expect(success).toBe(false)
    })

    it('should not affect other requests when deleting one', () => {
      const requests = crdtService.getRequests(collectionId)
      const requestId = requests[0].id

      crdtService.deleteRequest(collectionId, requestId)

      const updatedRequests = crdtService.getRequests(collectionId)
      expect(updatedRequests.length).toBe(1)
      expect(updatedRequests[0].name).toBe('Request 2')
      expect(updatedRequests[0].method).toBe('POST')
    })
  })

  describe('getRequests', () => {
    it('should return empty array for new collection', () => {
      const requests = crdtService.getRequests(collectionId)
      expect(requests).toEqual([])
    })

    it('should return all requests in collection', () => {
      crdtService.addRequest(collectionId, {
        name: 'Request 1',
        method: 'GET',
        url: 'https://api.example.com/1'
      })
      crdtService.addRequest(collectionId, {
        name: 'Request 2',
        method: 'POST',
        url: 'https://api.example.com/2'
      })

      const requests = crdtService.getRequests(collectionId)
      expect(requests.length).toBe(2)
      expect(requests[0].name).toBe('Request 1')
      expect(requests[1].name).toBe('Request 2')
    })

    it('should parse headers from string to object', () => {
      crdtService.addRequest(collectionId, {
        name: 'Test Request',
        method: 'GET',
        url: 'https://api.example.com/test',
        headers: { 'Content-Type': 'application/json' }
      })

      const requests = crdtService.getRequests(collectionId)
      expect(requests[0].headers).toEqual({ 'Content-Type': 'application/json' })
      expect(typeof requests[0].headers).toBe('object')
    })

    it('should handle invalid headers gracefully', () => {
      const doc = crdtService.getOrCreateDocument(collectionId)
      const requests = doc.getArray('requests')
      
      const requestMap = new Y.Map()
      requestMap.set('id', 'test-id')
      requestMap.set('name', 'Test')
      requestMap.set('method', 'GET')
      requestMap.set('url', 'https://api.example.com')
      requestMap.set('headers', 'invalid json string')
      requestMap.set('body', '')
      requests.push([requestMap])

      const retrievedRequests = crdtService.getRequests(collectionId)
      expect(retrievedRequests[0].headers).toBe('invalid json string')
    })
  })

  describe('getMetadata', () => {
    it('should return metadata for collection', () => {
      const metadata = crdtService.getMetadata(collectionId)
      expect(metadata).toBeDefined()
      expect(metadata.name).toBe('Untitled Collection')
      expect(metadata.version).toBe(1)
      expect(metadata.createdAt).toBeDefined()
      // updatedAt might not be set initially, so we don't check for it
    })
  })

  describe('updateMetadata', () => {
    it('should update metadata fields', () => {
      crdtService.updateMetadata(collectionId, {
        name: 'Updated Collection Name',
        version: 2
      })

      const metadata = crdtService.getMetadata(collectionId)
      expect(metadata.name).toBe('Updated Collection Name')
      expect(metadata.version).toBe(2)
    })
  })

  describe('subscribe', () => {
    it('should call callback on document changes', () => {
      let callbackCalled = false
      let callbackData = null

      const unsubscribe = crdtService.subscribe(collectionId, (data) => {
        callbackCalled = true
        callbackData = data
      })

      crdtService.addRequest(collectionId, {
        name: 'Test Request',
        method: 'GET',
        url: 'https://api.example.com/test'
      })

      expect(callbackCalled).toBe(true)
      expect(callbackData).toBeDefined()
      expect(callbackData.requests.length).toBe(1)

      unsubscribe()
    })

    it('should provide unsubscribe function', () => {
      const unsubscribe = crdtService.subscribe(collectionId, () => {})
      expect(typeof unsubscribe).toBe('function')
      unsubscribe() // Should not throw
    })
  })

  describe('exportDocument and importDocument', () => {
    it('should export and import document state', () => {
      crdtService.addRequest(collectionId, {
        name: 'Test Request',
        method: 'GET',
        url: 'https://api.example.com/test'
      })

      const exportedState = crdtService.exportDocument(collectionId)
      expect(exportedState).toBeDefined()
      expect(exportedState instanceof Uint8Array).toBe(true)

      // Create new collection and import
      const newCollectionId = 'new-collection'
      crdtService.importDocument(newCollectionId, exportedState)

      const importedRequests = crdtService.getRequests(newCollectionId)
      expect(importedRequests.length).toBe(1)
      expect(importedRequests[0].name).toBe('Test Request')

      crdtService.destroy(newCollectionId)
    })
  })

  describe('destroy', () => {
    it('should clean up document and resources', () => {
      crdtService.getOrCreateDocument(collectionId)
      crdtService.setupWebSocketSync(collectionId, crdtService.docs.get(collectionId))
      // Skip persistence in test environment due to IndexedDB limitations
      // crdtService.setupOfflinePersistence(collectionId, crdtService.docs.get(collectionId))

      expect(crdtService.docs.has(collectionId)).toBe(true)
      expect(crdtService.providers.has(collectionId)).toBe(true)
      // expect(crdtService.persistences.has(collectionId)).toBe(true)

      crdtService.destroy(collectionId)

      expect(crdtService.docs.has(collectionId)).toBe(false)
      expect(crdtService.providers.has(collectionId)).toBe(false)
      // expect(crdtService.persistences.has(collectionId)).toBe(false)
    })
  })
})