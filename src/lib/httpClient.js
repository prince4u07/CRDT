/**
 * Executes an API request from the browser and normalises the outcome so the
 * UI never has to deal with thrown fetch errors.
 *
 * Requests are sent directly from the browser, which means the target server
 * must allow this origin via CORS. That is reported as a clear error rather
 * than the browser's opaque "Failed to fetch".
 */

const DANGEROUS_PROTOCOLS = ['javascript:', 'data:', 'vbscript:', 'file:', 'blob:']

/**
 * Validate and normalise a user supplied URL.
 * A bare host such as `api.example.com/users` becomes `https://api.example.com/users`.
 * @returns {string|null} the normalised URL, or null when it is not allowed
 */
export const normalizeUrl = (rawUrl) => {
  const url = String(rawUrl || '').trim()
  if (!url) return null

  const lower = url.toLowerCase()
  if (DANGEROUS_PROTOCOLS.some((protocol) => lower.startsWith(protocol))) return null

  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`

  let parsed
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') return null
  return parsed.toString()
}

/**
 * Parse the headers textarea into a flat string map.
 * Accepts a JSON object, or `Key: value` lines for convenience.
 */
export const parseHeaders = (raw) => {
  const text = String(raw || '').trim()
  if (!text) return { headers: {}, error: null }

  // Try JSON first so mistakes like a JSON array get a clear message instead
  // of "invalid header line".
  let parsed = null
  let parsedOk = false
  try {
    parsed = JSON.parse(text)
    parsedOk = true
  } catch {
    parsedOk = false
  }

  if (parsedOk) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { headers: {}, error: 'Headers must be a JSON object' }
    }
    const headers = {}
    Object.entries(parsed).forEach(([key, value]) => {
      headers[key] = typeof value === 'object' ? JSON.stringify(value) : String(value)
    })
    return { headers, error: null }
  }

  // Text that opens like JSON but does not parse is a JSON typo, not a
  // "Key: value" list.
  if (text.startsWith('{') || text.startsWith('[')) {
    return { headers: {}, error: 'Headers are not valid JSON' }
  }

  // Otherwise accept `Key: value` lines.
  const headers = {}
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const separator = trimmed.indexOf(':')
    if (separator === -1) {
      return { headers: {}, error: `Invalid header line: ${trimmed}` }
    }
    headers[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim()
  }
  return { headers, error: null }
}

const formatSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const looksLikeJson = (text) => {
  const trimmed = text.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

const previewBody = (text, contentType = '') => {
  if (!text) return { body: '', contentType }
  if (contentType.includes('json') || looksLikeJson(text)) {
    try {
      return { body: JSON.stringify(JSON.parse(text), null, 2), contentType: 'json' }
    } catch {
      return { body: text, contentType: 'text' }
    }
  }
  if (contentType.includes('html')) {
    return { body: text.slice(0, 4000), contentType: 'html' }
  }
  if (text.length > 8000) {
    return { body: `${text.slice(0, 8000)}\n… truncated (${formatSize(text.length)} total)`, contentType: 'text' }
  }
  return { body: text, contentType: 'text' }
}

/**
 * Perform a request.
 * @returns {Promise<object>} a response descriptor; never rejects
 */
export const sendRequest = async ({
  method = 'GET',
  url,
  headers = {},
  body = '',
  signal,
  timeoutMs = 30000,
}) => {
  const target = normalizeUrl(url)
  if (!target) {
    return { ok: false, error: 'Enter a valid http(s) URL before sending.' }
  }

  const verb = String(method || 'GET').toUpperCase()
  const hasBody = !['GET', 'HEAD'].includes(verb) && String(body || '').length > 0
  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = performance.now()

  try {
    const response = await fetch(target, {
      method: verb,
      headers: { ...headers },
      body: hasBody ? String(body) : undefined,
      signal: controller.signal,
      redirect: 'follow',
    })

    const rawBody = await response.text()
    const duration = Math.round(performance.now() - startedAt)
    const contentType = response.headers.get('content-type') || ''
    const { body: prettyBody, contentType: bodyKind } = previewBody(rawBody, contentType)
    const headerEntries = {}
    response.headers.forEach((value, key) => {
      headerEntries[key] = value
    })

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url || target,
      duration,
      size: formatSize(new Blob([rawBody]).size),
      headers: headerEntries,
      body: prettyBody,
      bodyKind,
    }
  } catch (error) {
    const duration = Math.round(performance.now() - startedAt)
    if (signal?.aborted) return { ok: false, error: 'Request cancelled.', duration }

    const message =
      error.name === 'AbortError'
        ? `Request timed out after ${Math.round(timeoutMs / 1000)}s.`
        : 'The request could not be sent. This is usually CORS: the target server must allow this origin (Access-Control-Allow-Origin), or the host may be unreachable.'
    return { ok: false, error: message, duration }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
