import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { env } from '../env.js'
import { genUserSig } from '../tencent/userSig.js'
import { trtcUserId } from './schemas.js'
import { logger } from '../logger.js'

// ============================================================
// GET /userSig
//
// This endpoint mints room-entry credentials, so it is the one place in the
// starter kit where "it's only a demo" has a real cost: an open /userSig lets
// anyone enter any room as any identity in your SDKAppId, on your bill.
//
// Two layers of defence, both visible in the code:
//
//   * `USERSIG_AUTH_TOKEN` — when set, a Bearer token is required. Unset is
//     allowed (local development would otherwise need a login flow), but the
//     server logs a warning at startup so it is never silently open.
//   * `userId` pattern — restricted to [A-Za-z0-9_-]{1,64}. The userId ends up
//     in signatures, log lines and room membership; free-form input there is
//     an injection surface with no upside.
//
// ⚠️ Path B: do NOT copy this endpoint as-is. Derive `userId` from your own
// authenticated session instead of accepting it as a query parameter —
// otherwise any logged-in user can impersonate any other. SKILL.md §9 Step 3.
// ============================================================

function bearerTokenMatches(request: FastifyRequest, expected: string): boolean {
  const header = request.headers.authorization
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false

  const provided = Buffer.from(header.slice('Bearer '.length))
  const want = Buffer.from(expected)
  // timingSafeEqual throws on length mismatch, which itself leaks length;
  // compare lengths first and return the same generic failure either way.
  if (provided.length !== want.length) return false
  return timingSafeEqual(provided, want)
}

export async function userSigRoutes(app: FastifyInstance) {
  if (!env.USERSIG_AUTH_TOKEN) {
    logger.warn(
      'GET /userSig is unauthenticated: anyone who can reach this server can issue ' +
        'room credentials for any userId. Set USERSIG_AUTH_TOKEN before exposing it ' +
        'beyond localhost.'
    )
  }

  app.get<{ Querystring: { userId: string } }>('/userSig', {
    schema: {
      querystring: {
        type: 'object',
        required: ['userId'],
        properties: {
          userId: trtcUserId,
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'object',
          properties: {
            sdkAppId: { type: 'number' },
            userId: { type: 'string' },
            userSig: { type: 'string' },
            expireTime: { type: 'number' },
          },
        },
      },
    },
    handler: async (request, reply) => {
      const authToken = env.USERSIG_AUTH_TOKEN
      if (authToken && !bearerTokenMatches(request, authToken)) {
        logger.warn({ ip: request.ip }, 'userSig request rejected: bad or missing bearer token')
        return reply.code(401).send({ ok: false, error: 'unauthorized' })
      }

      const { userId } = request.query
      const { userSig, expireTime } = genUserSig(userId)
      return { sdkAppId: env.TRTC_SDK_APP_ID, userId, userSig, expireTime }
    },
  })
}
