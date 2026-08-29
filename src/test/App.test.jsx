import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'

// Mock the crdtService
vi.mock('../lib/crdtService', () => ({
  crdtService: {
    getOrCreateDocument: vi.fn(() => ({
      getArray: vi.fn(() => ({
        length: 0,
        map: vi.fn(() => []),
        push: vi.fn(),
        forEach: vi.fn(),
        delete: vi.fn()
      })),
      getMap: vi.fn(() => ({
        get: vi.fn(() => null),
        set: vi.fn()
      })),
      on: vi.fn(),
      off: vi.fn()
    })),
    setupWebSocketSync: vi.fn(() => ({
      on: vi.fn()
    })),
    setupOfflinePersistence: vi.fn(() => ({
      on: vi.fn()
    })),
    subscribe: vi.fn(() => vi.fn()),
    getRequests: vi.fn(() => []),
    addRequest: vi.fn(() => 'test-id'),
    updateRequest: vi.fn(),
    deleteRequest: vi.fn(),
    destroy: vi.fn()
  }
}))

describe('App Component', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the main app structure', () => {
    render(<App />)
    
    expect(screen.getByText('CRDT Collaborative API Workspace')).toBeInTheDocument()
    expect(screen.getByText('Real-time collaboration with automatic conflict resolution')).toBeInTheDocument()
    expect(screen.getByText('API Requests')).toBeInTheDocument()
    expect(screen.getByText('Request Editor')).toBeInTheDocument()
  })

  it('should render collaboration status section', () => {
    render(<App />)
    
    expect(screen.getByText('Collaboration Status')).toBeInTheDocument()
  })

  it('should have Add Request button', () => {
    render(<App />)
    
    const addButton = screen.getByText('+ Add Request')
    expect(addButton).toBeInTheDocument()
  })

  it('should show empty state when no request is selected', () => {
    render(<App />)
    
    expect(screen.getByText('Select a request to edit or create a new one')).toBeInTheDocument()
  })
})