// 后端 API 客户端：调用 FastAPI 后端签发 UserSig（含旁听身份）、登记房间、扇出/停止 AI 翻译会话。
// 所有密钥都留在后端，前端只拿临时 UserSig（符合 secrets 不落地原则）。

export interface BackendConfig {
  sdkappid: number
  userid: string
  usersig: string
  listener_userid: string
  listener_usersig: string
  modes: Record<string, { source_label: string; target_label: string }>
}

export interface HealthInfo {
  status: string
  trtc_configured: boolean
  tencent_configured: boolean
  llm_configured: boolean
  missing: string[]
  modes: string[]
}

async function postJson<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const msg = (data?.detail?.message) || (data?.detail) || `HTTP ${res.status}`
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }
  return data as T
}

export async function fetchHealth(): Promise<HealthInfo> {
  const res = await fetch('/api/v1/health')
  return res.json()
}

/** 向后端申请一组临时凭据（真人 + 旁听客户端身份）。userId 可选，不传则后端随机生成。 */
export function fetchConfig(userId?: string): Promise<BackendConfig> {
  return postJson<BackendConfig>('/api/v1/config', { userid: userId ?? null })
}

/** 房主建房后登记房间归属（用于后续主持人权限校验）。 */
export function registerRoom(roomId: string, ownerUserId: string): Promise<{ ok: boolean }> {
  return postJson('/api/v1/room/register', { roomId, ownerUserId })
}

export interface SessionStartParams {
  roomId: string
  roomIdType: number
  callerUserId: string
  mode: string
  participants: string[]
  ttsEnabled: boolean
}

export interface BotInfo {
  botUserId: string
  targetUserId: string
}

export interface SessionState {
  active: boolean
  mode: string | null
  bots: BotInfo[]
}

export function startSession(params: SessionStartParams): Promise<SessionState & { taskIds: string[] }> {
  return postJson('/api/v1/session/start', params)
}

export function stopSession(params: { roomId: string; callerUserId: string }): Promise<{ ok: boolean; stopped: number }> {
  return postJson('/api/v1/session/stop', params)
}

export async function fetchSessionState(roomId: string): Promise<SessionState> {
  const res = await fetch(`/api/v1/session/state?roomId=${encodeURIComponent(roomId)}`)
  return res.json()
}
