import { createRequire } from 'node:module'
import { env } from '../env.js'

// tls-sig-api-v2 is CJS; use createRequire for ESM compatibility
const require = createRequire(import.meta.url)
const { Api } = require('tls-sig-api-v2')

// ============================================================
// UserSig issuance
//
// A UserSig is a bearer token for a TRTC identity: whoever holds one can
// enter rooms as that userId. Two rules follow from that, and this file used
// to break both:
//
//   1. Lifetime. The signature was valid for 7 days. A token that leaks via
//      a browser cache, a shared log or a screenshot stays usable for a week.
//      It is now 2h by default (`USERSIG_EXPIRE_SECONDS`), because the client
//      can always ask for another one.
//
//   2. Who may ask. See routes/userSig.ts — the endpoint itself must decide
//      *whether* to issue, and for *which* userId. This module only signs.
//
// Path B (integrating into an existing system): issue the UserSig from inside
// your own authenticated session and derive the userId from the session, never
// from a request parameter. SKILL.md §9 Step 3 states this as a requirement.
// ============================================================

const api = new Api(env.TRTC_SDK_APP_ID, env.TRTC_SDK_SECRET_KEY)

export function genUserSig(userId: string): { userSig: string; expireTime: number } {
  const currTime = Math.floor(Date.now() / 1000)
  const userSig = api.genUserSig(userId, env.USERSIG_EXPIRE_SECONDS)
  return { userSig, expireTime: currTime + env.USERSIG_EXPIRE_SECONDS }
}
