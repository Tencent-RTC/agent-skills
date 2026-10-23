import Fastify from 'fastify'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import { env } from './env.js'
import { logger } from './logger.js'
import { userSigRoutes } from './routes/userSig.js'
import { agentRoutes } from './routes/agent.js'
import { transcriptionRoutes } from './routes/transcription.js'
import { webhookRoutes } from './routes/webhook.js'

// Fastify's own logger is off; we use pino directly via ./logger.js.
//
// `removeAdditional: false` overrides Fastify's AJV default, which is
// `removeAdditional: true`. Under that default `additionalProperties: false`
// silently *deletes* unknown fields instead of rejecting them — so a client
// typo is swallowed, the request proceeds with the field missing, and the
// failure surfaces later as an opaque error from the Tencent API. Rejecting
// up front is both safer and far easier to debug, and this server only talks
// to its own front-end, so there is no third-party payload to stay lenient
// about. (Webhook bodies are unaffected: they are intentionally not schema'd,
// since Tencent Cloud may add fields at any time.)
const app = Fastify({
  logger: false,
  ajv: { customOptions: { removeAdditional: false } },
})

// ---- Plugins ------------------------------------------------

await app.register(cors, {
  origin: ['http://localhost:5173'],
})

await app.register(swagger, {
  openapi: {
    info: { title: 'TRTC Voice AI API', version: '1.0.0' },
  },
})

await app.register(swaggerUi, { routePrefix: '/docs' })

// ---- Error handler ------------------------------------------
// Logs SDK code + requestId for traceability; sends structured error to client.
// 4xx is the client's problem and only warrants a warning — logging schema
// rejections at error level buries the 5xx that actually need attention.

app.setErrorHandler((err, request, reply) => {
  const code = (err as any).code
  const requestId = (err as any).requestId
  const status = err.statusCode ?? 500
  const logAt = status >= 500 ? logger.error : logger.warn
  logAt({ err, code, requestId, status, path: request.url }, 'request error')
  reply.status(status).send({
    ok: false,
    error: err.message,
    ...(code && { code }),
    ...(requestId && { requestId }),
  })
})

// ---- Routes -------------------------------------------------

await app.register(userSigRoutes)
await app.register(agentRoutes, { prefix: '/agent' })
await app.register(transcriptionRoutes, { prefix: '/transcription' })
await app.register(webhookRoutes)

// ---- Health -------------------------------------------------

app.get('/health', async () => {
  return {
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      trtc: env.TRTC_SDK_APP_ID ? 'ok' : 'missing',
      tencent: env.TENCENT_CLOUD_SECRET_ID ? 'ok' : 'missing',
      llm: env.LLM_API_KEY ? 'ok' : 'missing',
    },
  }
})

// ---- Start --------------------------------------------------

try {
  await app.listen({ port: env.SERVER_PORT, host: '0.0.0.0' })
  logger.info({ port: env.SERVER_PORT }, `server listening`)
} catch (err) {
  logger.error({ err }, 'failed to start server')
  process.exit(1)
}
