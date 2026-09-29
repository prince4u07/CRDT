import { describe, it, expect, beforeEach, vi } from 'vitest'
import { normalizeUrl, parseHeaders, sendRequest } from '../lib/httpClient'

const jsonResponse = (body, init = {}) => ({
  ok: init.status ? init.status < 400 : true,
  status: init.status ?? 200,
  statusText: init.statusText ?? 'OK',
  url: init.url ?? 'https://api.example.com/users',
  headers: new Headers(init.headers ?? { 'content-type': 'application/json' }),
  text: async () => body,
})

describe('normalizeUrl', () => {
  it('keeps a valid https URL', () => {
    expect(normalizeUrl('https://api.example.com/users')).toBe('https://api.example.com/users')
  })

  it('keeps a valid http URL', () => {
    expect(normalizeUrl('http://localhost:3000/api')).toBe('http://localhost:3000/api')
  })

  it('assumes https for a bare host', () => {
    expect(normalizeUrl('api.example.com/users')).toBe('https://api.example.com/users')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeUrl('  https://api.example.com  ')).toBe('https://api.example.com/')
  })

  it('rejects empty input', () => {
    expect(normalizeUrl('')).toBeNull()
    expect(normalizeUrl('   ')).toBeNull()
  })

  it('rejects dangerous protocols', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('JavaScript:alert(1)')).toBeNull()
    expect(normalizeUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(normalizeUrl('file:///etc/passwd')).toBeNull()
  })

  it('rejects hosts without a dot unless they are localhost', () => {
    expect(normalizeUrl('http://intranet/api')).toBeNull()
    expect(normalizeUrl('http://localhost/api')).toBe('http://localhost/api')
  })
})

describe('parseHeaders', () => {
  it('parses a JSON object', () => {
    expect(parseHeaders('{"A":"1","B":"2"}')).toEqual({ headers: { A: '1', B: '2' }, error: null })
  })

  it('parses key/value lines', () => {
    expect(parseHeaders('Content-Type: application/json\nX-Key: abc')).toEqual({
      headers: { 'Content-Type': 'application/json', 'X-Key': 'abc' },
      error: null,
    })
  })

  it('ignores comments and blank lines', () => {
    expect(parseHeaders('# a comment\n\nA: 1')).toEqual({ headers: { A: '1' }, error: null })
  })

  it('returns an empty object for empty input', () => {
    expect(parseHeaders('')).toEqual({ headers: {}, error: null })
    expect(parseHeaders(null)).toEqual({ headers: {}, error: null })
  })

  it('reports invalid JSON', () => {
    expect(parseHeaders('{"A": ').error).toBe('Headers are not valid JSON')
  })

  it('rejects JSON arrays and primitives', () => {
    expect(parseHeaders('["a"]').error).toBe('Headers must be a JSON object')
    expect(parseHeaders('42').error).toBe('Headers must be a JSON object')
  })

  it('reports a malformed header line', () => {
    expect(parseHeaders('not-a-header').error).toBe('Invalid header line: not-a-header')
  })

  it('stringifies nested values', () => {
    expect(parseHeaders('{"A":{"x":1}}').headers).toEqual({ A: '{"x":1}' })
  })
})

describe('sendRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    global.fetch = vi.fn()
  })

  it('refuses to send an invalid URL', async () => {
    const result = await sendRequest({ method: 'GET', url: 'javascript:alert(1)' })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/valid http\(s\) URL/)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('sends the request and formats a JSON response', async () => {
    global.fetch.mockResolvedValue(jsonResponse('{"id":1,"name":"Ada"}'))

    const result = await sendRequest({
      method: 'GET',
      url: 'https://api.example.com/users',
      headers: { Accept: 'application/json' },
    })

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/users',
      expect.objectContaining({
        method: 'GET',
        headers: { Accept: 'application/json' },
        body: undefined,
      })
    )
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.body).toBe('{\n  "id": 1,\n  "name": "Ada"\n}')
    expect(result.bodyKind).toBe('json')
    expect(typeof result.duration).toBe('number')
    expect(result.size).toMatch(/B$/)
  })

  it('sends a body for methods that allow one', async () => {
    global.fetch.mockResolvedValue(jsonResponse('{"ok":true}'))

    await sendRequest({
      method: 'POST',
      url: 'https://api.example.com/users',
      body: '{"name":"Ada"}',
    })

    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.example.com/users',
      expect.objectContaining({ method: 'POST', body: '{"name":"Ada"}' })
    )
  })

  it('never sends a body with GET or HEAD', async () => {
    global.fetch.mockResolvedValue(jsonResponse(''))

    await sendRequest({ method: 'GET', url: 'https://api.example.com', body: 'ignored' })

    expect(global.fetch.mock.calls[0][1].body).toBeUndefined()
  })

  it('reports a non-2xx response as not ok but still returns the body', async () => {
    global.fetch.mockResolvedValue(
      jsonResponse('{"error":"nope"}', { status: 422, statusText: 'Unprocessable Entity' })
    )

    const result = await sendRequest({ method: 'POST', url: 'https://api.example.com/users' })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(422)
    expect(result.body).toContain('nope')
  })

  it('explains a network failure in terms of CORS', async () => {
    global.fetch.mockRejectedValue(new TypeError('Failed to fetch'))

    const result = await sendRequest({ method: 'GET', url: 'https://api.example.com/users' })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/CORS/)
  })

  it('reports a timeout', async () => {
    global.fetch.mockImplementation(
      (url, options) =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => {
            const error = new Error('aborted')
            error.name = 'AbortError'
            reject(error)
          })
        })
    )

    const result = await sendRequest({
      method: 'GET',
      url: 'https://api.example.com/slow',
      timeoutMs: 10,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/timed out/)
  })

  it('reports cancellation when the caller aborts', async () => {
    const controller = new AbortController()
    global.fetch.mockImplementation(
      (url, options) =>
        new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
    )

    const promise = sendRequest({
      method: 'GET',
      url: 'https://api.example.com',
      signal: controller.signal,
    })
    controller.abort()

    expect((await promise).error).toBe('Request cancelled.')
  })

  it('truncates very large non-JSON bodies', async () => {
    global.fetch.mockResolvedValue(jsonResponse('x'.repeat(20000), { headers: { 'content-type': 'text/plain' } }))

    const result = await sendRequest({ method: 'GET', url: 'https://api.example.com/big' })

    expect(result.body).toContain('truncated')
    expect(result.body.length).toBeLessThan(9000)
  })
})
