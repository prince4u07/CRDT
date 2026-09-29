import '@testing-library/jest-dom'
import 'fake-indexeddb/auto'
import { afterEach, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

// jsdom has no `crypto.randomUUID`; provide a deterministic stand-in.
if (!global.crypto?.randomUUID) {
  let counter = 0
  Object.defineProperty(global, 'crypto', {
    value: {
      ...global.crypto,
      randomUUID: () => `test-uuid-${(counter++).toString().padStart(4, '0')}`,
    },
    writable: true,
    configurable: true,
  })
}

if (!global.URL.createObjectURL) {
  global.URL.createObjectURL = () => 'blob:mock'
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})
