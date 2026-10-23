// ============================================================
// Shared JSON-schema fragments
//
// The same three identifiers appear across the agent and transcription
// routes. Defining them once means a rule cannot be tightened in one route
// and forgotten in another.
//
// The limits are not invented. They come from the TRTC SDK's own
// documentation of `enterRoom` — see `options.roomId` / `options.userId` in
// trtc-sdk-v5/index.d.ts — and from the `StartAIConversation` request
// definition in tencentcloud-sdk-nodejs/.../trtc_models.d.ts, which points at
// https://cloud.tencent.com/document/product/647/46351#roomid
//
// Note on `additionalProperties: false`: Fastify configures AJV with
// `removeAdditional: false` in index.ts, so unknown fields are *rejected*
// with 400 rather than silently stripped (which is AJV's default under
// Fastify). See the comment there for why.
// ============================================================

/**
 * Upper bound for a numeric TRTC room ID.
 *
 * Official wording: "the value must be an integer between 1 and 4294967294"
 * (2^32 - 2).
 */
export const MAX_NUMERIC_ROOM_ID = 4294967294

/**
 * Shape of a numeric TRTC room ID: 1–10 digits, no leading zero.
 *
 * `RoomIdType: 0` in the StartAIConversation payload means "numeric room", so
 * a non-numeric value is always invalid here — but without this pattern it
 * reached the Tencent API and came back as an opaque 500
 * (`invalid literal for int() with base 10`), verified by hand.
 *
 * This covers the *shape* only. A string schema cannot express a numeric
 * upper bound, and the exact regex for ≤ 4294967294 is a ten-branch
 * alternation that nobody can review — so the bound lives in
 * `isRoomIdInRange` and routes apply both.
 *
 * Note that TRTC treats the string room "123" and the numeric room 123 as
 * different rooms; supporting string rooms would mean sending
 * `RoomIdType: 1` and is out of scope for this starter.
 */
export const numericRoomId = {
  type: 'string',
  pattern: '^[1-9][0-9]{0,9}$',
  maxLength: 10,
} as const

/**
 * Value-range half of the room-ID check; see `MAX_NUMERIC_ROOM_ID`.
 *
 * Self-contained on purpose: it re-checks the digits instead of trusting the
 * caller to have run `numericRoomId` first. `Number()` is far too permissive
 * for a validator — it reads `'1e3'` as 1000 and `'0x10'` as 16, both of
 * which would slip through a bare range comparison.
 */
export function isRoomIdInRange(roomId: string): boolean {
  if (!/^[0-9]+$/.test(roomId)) return false
  const n = Number(roomId)
  return n >= 1 && n <= MAX_NUMERIC_ROOM_ID
}

/** Reason phrase shared by every route that validates a room ID. */
export const ROOM_ID_RANGE_ERROR =
  `roomId must be an integer between 1 and ${MAX_NUMERIC_ROOM_ID}`

/**
 * A TRTC user ID.
 *
 * SDK guidance for `enterRoom`: "It is recommended to limit the length to 32
 * bytes, and only allow uppercase and lowercase English letters (a-zA-Z),
 * numbers (0-9), underscores, and hyphens." The character class is also what
 * keeps these IDs safe to put in signatures and log lines.
 *
 * The pattern is ASCII-only, so 32 characters is 32 bytes.
 */
export const trtcUserId = {
  type: 'string',
  pattern: '^[A-Za-z0-9_-]{1,32}$',
} as const

/** A task ID handed back by the Tencent API and echoed by the client. */
export const taskId = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
} as const

/** `{ ok: boolean }` — the response shape shared by the mutating routes. */
export const okResponse = {
  200: {
    type: 'object',
    properties: { ok: { type: 'boolean' } },
  },
} as const
