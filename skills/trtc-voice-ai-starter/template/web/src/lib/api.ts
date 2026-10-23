// ============================================================
// Backend API client
//
// All requests go to /api/* which Vite proxies to
// http://localhost:3000 during development.
// ============================================================

const BASE = '/api'

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    // Server sends { ok:false, error, code?, requestId? }; `message` only from the non-JSON fallback
    throw new Error(err?.error ?? err?.message ?? `Request failed: ${res.status}`)
  }
  return res.json()
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin)
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const res = await fetch(url.toString())
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    // Server sends { ok:false, error, code?, requestId? }; `message` only from the non-JSON fallback
    throw new Error(err?.error ?? err?.message ?? `Request failed: ${res.status}`)
  }
  return res.json()
}

// ---- UserSig ------------------------------------------------
//
// Note: when the server sets `USERSIG_AUTH_TOKEN`, this call returns 401 —
// deliberately. The browser does not send that token, because a secret put in
// a `VITE_*` variable is compiled into the JS bundle and readable by anyone.
// The token exists for server-to-server callers. In a real app (Path B) the
// browser authenticates with its own session cookie and the server derives the
// userId from that session; see routes/userSig.ts and SKILL.md §9 Step 3.

export function fetchUserSig(userId: string) {
  return get<{ sdkAppId: number; userId: string; userSig: string; expireTime: number }>(
    '/userSig',
    { userId }
  )
}

// ---- Agent --------------------------------------------------

export interface StartAgentResult {
  taskId: string
  sessionId: string | null
  roomId: string
  botUserId: string
  status: string
}

export function startAgent(params: {
  roomId: string
  targetUserId: string
  systemPrompt?: string
  greeting?: string
}) {
  return post<StartAgentResult>('/agent/start', params)
}

export function stopAgent(taskId: string) {
  return post<{ ok: boolean; taskId: string }>('/agent/stop', { taskId })
}

export function interruptAgent(taskId: string) {
  return post<{ ok: boolean }>('/agent/control', { taskId, command: 'interrupt' })
}

export function pushTextToAgent(taskId: string, text: string) {
  return post<{ ok: boolean }>('/agent/control', { taskId, command: 'server_push_text', text })
}

export function updateAgentPrompt(taskId: string, systemPrompt: string) {
  return post<{ ok: boolean }>('/agent/update', { taskId, systemPrompt })
}

// ---- Transcription (bilingual subtitle toggle) --------------

export function startTranscription(params: {
  roomId: string
  agentUserId: string
  sourceLanguage?: string
}) {
  return post<{ transcriptionTaskId: string }>('/transcription/start', params)
}

export function stopTranscription(transcriptionTaskId: string) {
  return post<{ ok: boolean }>('/transcription/stop', { transcriptionTaskId })
}

// ---- Health -------------------------------------------------

export function fetchHealth() {
  return get<{ status: string; env: Record<string, string> }>('/health')
}
