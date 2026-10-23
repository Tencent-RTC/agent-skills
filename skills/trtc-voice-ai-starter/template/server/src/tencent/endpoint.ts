// ============================================================
// Tencent Cloud API endpoint resolution
//
// Tencent Cloud runs two independent API sites, and an account only
// exists on one of them:
//
//   ap-guangzhou                     → trtc.tencentcloudapi.com       (China site)
//   ap-singapore · ap-tokyo ·
//   na-ashburn · na-siliconvalley    → trtc.intl.tencentcloudapi.com  (International site)
//
// The endpoint used to be hardcoded to the international host while
// `.env.example` defaulted the region to `ap-guangzhou`, so the
// out-of-the-box configuration pointed a China-site region at the
// international host. Deriving it removes the trap.
//
// `TENCENT_CLOUD_ENDPOINT` stays available as an escape hatch: the
// region → site mapping is stable for the five regions that
// StartAIConversation supports, but a private or future endpoint
// should not require a code change.
// ============================================================

/**
 * The only regions `StartAIConversation` supports (doc: https://trtc.io/document/64963).
 *
 * Keep in sync with `scripts/verify-credentials.mjs`, which validates the
 * same list before the server is ever started.
 */
export const SUPPORTED_REGIONS = [
  'ap-guangzhou',
  'ap-singapore',
  'ap-tokyo',
  'na-ashburn',
  'na-siliconvalley',
] as const

export type SupportedRegion = (typeof SUPPORTED_REGIONS)[number]

export const CHINA_SITE_ENDPOINT = 'trtc.tencentcloudapi.com'
export const INTL_SITE_ENDPOINT = 'trtc.intl.tencentcloudapi.com'

/** Regions served by the China site; everything else is international. */
const CHINA_SITE_REGIONS: ReadonlySet<string> = new Set<SupportedRegion>(['ap-guangzhou'])

/**
 * Resolve the TRTC API host for a region.
 *
 * @param region   value of `TENCENT_CLOUD_REGION`
 * @param override value of `TENCENT_CLOUD_ENDPOINT`; wins when non-empty
 */
export function resolveEndpoint(region: string, override?: string): string {
  const trimmed = override?.trim()
  if (trimmed) return trimmed
  return CHINA_SITE_REGIONS.has(region) ? CHINA_SITE_ENDPOINT : INTL_SITE_ENDPOINT
}
