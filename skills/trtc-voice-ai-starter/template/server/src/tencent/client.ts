import { createRequire } from 'node:module'
import { env } from '../env.js'
import { resolveEndpoint } from './endpoint.js'
import type {
  StartAIConversationRequest,
  StopAIConversationRequest,
  ControlAIConversationRequest,
  UpdateAIConversationRequest,
  DescribeAIConversationRequest,
  StartAITranscriptionRequest,
  StopAITranscriptionRequest,
} from './types.js'

// tencentcloud-sdk-nodejs is CJS; use createRequire for ESM compatibility
const require = createRequire(import.meta.url)
const tencentcloud = require('tencentcloud-sdk-nodejs')
const TrtcClient = tencentcloud.trtc.v20190722.Client

const client = new TrtcClient({
  credential: {
    secretId: env.TENCENT_CLOUD_SECRET_ID,
    secretKey: env.TENCENT_CLOUD_SECRET_KEY,
  },
  region: env.TENCENT_CLOUD_REGION,
  profile: {
    httpProfile: {
      // Derived from the region: ap-guangzhou lives on the China site, the
      // other four on the international one. See ./endpoint.ts.
      endpoint: resolveEndpoint(env.TENCENT_CLOUD_REGION, env.TENCENT_CLOUD_ENDPOINT),
    },
  },
})

// ---- Voice Agent APIs ----------------------------------------
// Request types come from the SDK (see ./types.ts), so a misspelled or
// misplaced field is a compile error rather than a runtime API rejection.

export async function startAIConversation(params: StartAIConversationRequest) {
  return client.StartAIConversation(params)
}

export async function stopAIConversation(params: StopAIConversationRequest) {
  return client.StopAIConversation(params)
}

export async function controlAIConversation(params: ControlAIConversationRequest) {
  return client.ControlAIConversation(params)
}

export async function updateAIConversation(params: UpdateAIConversationRequest) {
  return client.UpdateAIConversation(params)
}

/** Not used by the demo UI — kept as a reference for polling task state. */
export async function describeAIConversation(params: DescribeAIConversationRequest) {
  return client.DescribeAIConversation(params)
}

// ---- Transcription APIs (bilingual subtitle toggle) ----------

export async function startAITranscription(params: StartAITranscriptionRequest) {
  return client.StartAITranscription(params)
}

export async function stopAITranscription(params: StopAITranscriptionRequest) {
  return client.StopAITranscription(params)
}
