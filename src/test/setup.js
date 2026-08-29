import '@testing-library/jest-dom'
import { vi } from 'vitest'

// Mock crypto.randomUUID for environments that don't support it
if (!global.crypto?.randomUUID) {
  Object.defineProperty(global, 'crypto', {
    value: {
      randomUUID: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9),
    },
    writable: true,
    configurable: true
  })
}

// Mock IndexedDB for testing
const mockDB = {
  close: vi.fn(),
  transaction: vi.fn(() => ({
    objectStore: vi.fn(() => ({
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    })),
  })),
}

const mockRequest = {
  result: mockDB,
  onsuccess: null,
  onerror: null,
  onupgradeneeded: null,
}

global.indexedDB = {
  open: vi.fn(() => mockRequest),
  deleteDatabase: vi.fn(),
}

// Mock WebSocket for testing
global.WebSocket = class MockWebSocket {
  constructor(url) {
    this.url = url
    this.readyState = 0
    setTimeout(() => {
      this.readyState = 1
      if (this.onopen) this.onopen()
    }, 100)
  }
  send() {}
  close() {
    this.readyState = 3
    if (this.onclose) this.onclose()
  }
}