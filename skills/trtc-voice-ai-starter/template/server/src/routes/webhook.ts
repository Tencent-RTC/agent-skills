import { appendFileSync, mkdirSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import { verifyTencentSignature } from '../tencent/webhook.js'
import {
  AIEvent,
  AI_SERVICE_EVENT_GROUP,
  LEAVE_CODE_REASONS,
  type AICallbackBody,
} from '../tencent/callbackEvents.js'
import { env } from '../env.js'
import { logger } from '../logger.js'

// ============================================================
// POST /webhook/agent-events
//
// Receives Conversational AI lifecycle events from Tencent Cloud.
// Doc: https://www.tencentcloud.com/document/product/647/68331
//
// Register the public URL and the signing key in the TRTC console; for local
// development use ngrok. The key is "up to 32 characters, uppercase and
// lowercase letters and digits" — set the same value as
// WEBHOOK_SIGNING_SECRET.
//
// Both halves of "receive a request and append it to a file" are attack
// surface, so:
//
//   * Unsigned deliveries are rejected (see tencent/webhook.ts). An empty
//     secret used to mean "skip verification", which made this an
//     unauthenticated append-to-disk endpoint.
//   * The body is capped at WEBHOOK_BODY_LIMIT_BYTES and the log file at
//     WEBHOOK_LOG_MAX_BYTES, so neither one huge POST nor a flood of small
//     ones can fill the disk.
//   * Nothing is written before the signature verifies.
//
// Responses are always 2xx with `{"code":0}`, which is what the docs ask for.
// Tencent retries on failure — immediately, then every 10s for up to a
// minute — and must receive a response within 5 seconds, so handlers here
// stay cheap and any real work belongs on a queue. Because retries happen,
// handlers must also be idempotent: de-duplicate on
// TaskId + EventType + EventMsTs (or RoundId).
// ============================================================

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_DIR = resolve(__dirname, '../../data')
const CONVERSATIONS_LOG = resolve(DATA_DIR, 'conversations.jsonl')

/** Per-request body cap. Lifecycle events are a few hundred bytes. */
const WEBHOOK_BODY_LIMIT_BYTES = 64 * 1024

mkdirSync(DATA_DIR, { recursive: true })

function currentLogSize(): number {
  try {
    return statSync(CONVERSATIONS_LOG).size
  } catch {
    return 0 // not created yet
  }
}

/** Append one event, unless the log has already hit its cap. */
function appendEvent(event: unknown): void {
  const line = JSON.stringify(event) + '\n'

  if (currentLogSize() + line.length > env.WEBHOOK_LOG_MAX_BYTES) {
    logger.warn(
      { limit: env.WEBHOOK_LOG_MAX_BYTES, file: CONVERSATIONS_LOG },
      'conversation log is at its size limit — event not written. Rotate or delete the file, or raise WEBHOOK_LOG_MAX_BYTES.'
    )
    return
  }

  try {
    appendFileSync(CONVERSATIONS_LOG, line)
  } catch (err) {
    logger.error({ err }, 'failed to write conversation log')
  }
}

function handleEvent(body: AICallbackBody): void {
  const info = body.EventInfo ?? {}
  const payload = info.Payload ?? {}
  const taskId = info.TaskId

  switch (body.EventType) {
    case AIEvent.Start:
      // Payload.Status: 0 = started, 1 = failed to start.
      if (payload.Status === 0) {
        logger.info({ taskId, roomId: info.RoomId }, 'AI task started')
      } else {
        logger.error({ taskId, roomId: info.RoomId, payload }, 'AI task failed to start')
      }
      break

    case AIEvent.Stop: {
      const code = payload.LeaveCode
      const reason =
        typeof code === 'number' ? (LEAVE_CODE_REASONS[code] ?? `unknown code ${code}`) : 'unknown'
      // 98 = internal error (docs recommend retrying), 99 = bot left alone.
      const log = code === 98 || code === 99 ? logger.warn : logger.info
      log({ taskId, leaveCode: code, reason }, 'AI task stopped')
      appendEvent(body)
      break
    }

    case AIEvent.Message:
      // Complete STT sentence or complete LLM reply — the conversation record.
      logger.debug({ taskId, roundId: payload.RoundId }, 'conversation message')
      appendEvent(body)
      break

    case AIEvent.ErrorMetric:
      logger.error({ taskId, payload }, 'AI metric error')
      break

    case AIEvent.SessionStatus:
      logger.info({ taskId, status: payload.Status }, 'AI session status')
      break

    case AIEvent.SpeechStart:
    case AIEvent.SpeakingFinished:
    case AIEvent.Metric:
      logger.debug({ taskId, eventType: body.EventType, payload }, 'AI event')
      break

    default:
      // Tencent may add event types at any time; log and acknowledge.
      logger.debug({ eventType: body.EventType }, 'unhandled callback event')
  }
}

export async function webhookRoutes(app: FastifyInstance) {
  if (!env.WEBHOOK_SIGNING_SECRET) {
    if (env.WEBHOOK_ALLOW_UNSIGNED) {
      logger.warn(
        'WEBHOOK_ALLOW_UNSIGNED=true — /webhook/agent-events accepts unsigned deliveries. ' +
          'Local development only; never enable this on a public URL.'
      )
    } else {
      logger.info(
        'WEBHOOK_SIGNING_SECRET is not set — /webhook/agent-events will reject every ' +
          'delivery. Set the same key you configured in the TRTC console, or ' +
          'WEBHOOK_ALLOW_UNSIGNED=true for local testing.'
      )
    }
  }

  // Scoped to this plugin: retains the raw body so the HMAC is computed over
  // the bytes actually delivered — Tencent sends tab-indented JSON and the
  // docs say not to transform it — and enforces the size cap at parse time.
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit: WEBHOOK_BODY_LIMIT_BYTES },
    (request, body, done) => {
      ;(request as typeof request & { rawBody?: string }).rawBody = body as string
      try {
        done(null, JSON.parse(body as string))
      } catch (err) {
        done(err as Error)
      }
    }
  )

  app.post('/webhook/agent-events', async (request, reply) => {
    const verified = verifyTencentSignature(request)
    if (!verified.ok) {
      logger.warn({ ip: request.ip, reason: verified.reason }, 'webhook rejected')
      return { code: -1, message: verified.reason }
    }

    const body = request.body as AICallbackBody

    // Other TRTC event groups can be routed to the same URL; ignore anything
    // that is not the AI service group rather than mis-reading its EventType.
    if (body.EventGroupId !== undefined && body.EventGroupId !== AI_SERVICE_EVENT_GROUP) {
      logger.debug({ eventGroupId: body.EventGroupId }, 'ignoring non-AI-service event group')
      return { code: 0 }
    }

    handleEvent(body)

    // The docs ask for {"code":0}; the response body is otherwise ignored.
    return { code: 0 }
  })
}
