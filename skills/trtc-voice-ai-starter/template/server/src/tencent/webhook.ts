import { createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { env } from '../env.js'

// ============================================================
// Webhook signature verification
//
// Contract confirmed against the official documentation
// (https://www.tencentcloud.com/document/product/647/68331, "AI Conversation
// Server Callbacks", last updated 2026-07-03) and cross-checked against the
// test vector published there — see `webhook.test.ts`, which reproduces the
// doc's own key/body/signature triple exactly.
//
//   Headers:  Sign: base64(hmac-sha256(key, rawBody))
//             SdkAppId: <your SDKAppID>
//             Content-Type: application/json
//
//   Sign = base64( hmacsha256(key, body) )
//
// Three properties of this contract are easy to get wrong, and the earlier
// (inferred) implementation got all three wrong:
//
//   1. The header is `Sign`, not `X-TC-Signature`. The `X-TC-*` family
//      belongs to *outbound* Tencent Cloud OpenAPI calls, which sign into
//      `Authorization` with TC3-HMAC-SHA256. Callbacks are a different
//      protocol entirely.
//   2. Only the body is signed — no timestamp, no concatenation. The docs
//      are explicit: "body refers to the original package body of the
//      received callback request. Do not transform it."
//   3. The digest is base64, not hex.
//
// "Do not transform it" is the load-bearing instruction. Tencent sends
// tab-indented JSON with newlines; `JSON.stringify(request.body)` produces
// compact JSON, so re-serialising the parsed object changes the bytes and the
// HMAC can never match. routes/webhook.ts installs a content-type parser that
// retains the raw text for this reason.
//
// Note: there is no timestamp in the signature, so the signature alone does
// not prevent replay. The callback is retried by Tencent on failure
// (immediately, then every 10s for up to 1 minute), so handlers must be
// idempotent regardless — see routes/webhook.ts.
// ============================================================

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: 'not_configured' | 'missing_signature' | 'bad_signature' }

/**
 * Compute the expected `Sign` header value for a raw callback body.
 *
 * Exported so the test can check it against the vector in the official docs.
 */
export function computeCallbackSignature(key: string, rawBody: string): string {
  return createHmac('sha256', key).update(rawBody, 'utf8').digest('base64')
}

export function verifyTencentSignature(request: FastifyRequest): VerifyResult {
  const key = env.WEBHOOK_SIGNING_SECRET

  if (!key) {
    // Fail closed unless the operator explicitly opted in. An empty secret
    // used to mean "skip verification", which left /webhook/agent-events open
    // as an unauthenticated disk write.
    return env.WEBHOOK_ALLOW_UNSIGNED ? { ok: true } : { ok: false, reason: 'not_configured' }
  }

  const sign = request.headers['sign']
  if (typeof sign !== 'string' || !sign) {
    return { ok: false, reason: 'missing_signature' }
  }

  // Raw body as delivered; see the content-type parser in routes/webhook.ts.
  const rawBody = (request as FastifyRequest & { rawBody?: string }).rawBody ?? ''
  const expected = computeCallbackSignature(key, rawBody)

  const provided = Buffer.from(sign, 'utf8')
  const want = Buffer.from(expected, 'utf8')
  // timingSafeEqual throws on a length mismatch, which itself leaks length;
  // compare lengths first and report the same generic failure either way.
  if (provided.length !== want.length) return { ok: false, reason: 'bad_signature' }
  return timingSafeEqual(provided, want) ? { ok: true } : { ok: false, reason: 'bad_signature' }
}
