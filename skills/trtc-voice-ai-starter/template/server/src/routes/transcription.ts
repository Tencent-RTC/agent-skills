import { nanoid } from 'nanoid'
import type { FastifyInstance } from 'fastify'
import { startAITranscription, stopAITranscription } from '../tencent/client.js'
import { genUserSig } from '../tencent/userSig.js'
import { env } from '../env.js'
import { logger } from '../logger.js'
import type { StartAITranscriptionRequest } from '../tencent/types.js'
import {
  numericRoomId,
  trtcUserId,
  taskId as taskIdSchema,
  okResponse,
  isRoomIdInRange,
  ROOM_ID_RANGE_ERROR,
} from './schemas.js'

// Request shape is typed by the SDK (see ../tencent/types.ts).
// `TranscriptionParams` and `RecognizeConfig` were originally mis-named —
// the compiler now guards against that class of bug.

export async function transcriptionRoutes(app: FastifyInstance) {
  // POST /transcription/start  — bilingual subtitle toggle
  app.post<{
    Body: {
      roomId: string
      agentUserId: string
      sourceLanguage?: string
    }
  }>('/start', {
    schema: {
      body: {
        type: 'object',
        required: ['roomId', 'agentUserId'],
        properties: {
          roomId: numericRoomId,
          agentUserId: trtcUserId,
          // ISO 639-1, optionally with a region suffix (e.g. en, en-US)
          sourceLanguage: { type: 'string', pattern: '^[A-Za-z]{2}(-[A-Za-z0-9]{2,8})?$' },
        },
        additionalProperties: false,
      },
      response: {
        200: {
          type: 'object',
          properties: { transcriptionTaskId: { type: 'string' } },
        },
      },
    },
    handler: async (request, reply) => {
    if (!isRoomIdInRange(request.body.roomId)) {
      return reply.code(400).send({ ok: false, error: ROOM_ID_RANGE_ERROR })
    }

    const { roomId, agentUserId, sourceLanguage = env.AGENT_LANGUAGE ?? env.STT_LANGUAGE } = request.body

    // Translation target must be explicitly configured — no language auto-inference
    const translateTo = env.BILINGUAL_TARGET_LANG

    // Transcription needs its own bot to enter the room
    const botUserId = `trans_${nanoid(6)}`
    const { userSig } = genUserSig(botUserId)

    const params: StartAITranscriptionRequest = {
      SdkAppId: env.TRTC_SDK_APP_ID,
      RoomId: roomId,
      RoomIdType: 0,
      TranscriptionParams: {
        UserId: botUserId,
        UserSig: userSig,
        MaxIdleTime: 60,
        // TranscriptionMode=1: subscribe only to agentUserId's audio stream
        TranscriptionMode: 1,
        TargetUserId: agentUserId,
      },
      RecognizeConfig: {
        Language: sourceLanguage,
      },
    }

    if (translateTo) {
      params.TranslationConfig = {
        TargetLanguages: [translateTo],
        Mode: 1,
      }
    }

    logger.info({ roomId, agentUserId, sourceLanguage, translateTo }, 'starting AI transcription')
    const result = await startAITranscription(params)
    return { transcriptionTaskId: result.TaskId }
    },
  })

  // POST /transcription/stop
  app.post<{ Body: { transcriptionTaskId: string } }>('/stop', {
    schema: {
      body: {
        type: 'object',
        required: ['transcriptionTaskId'],
        properties: {
          transcriptionTaskId: taskIdSchema,
        },
        additionalProperties: false,
      },
      response: okResponse,
    },
    handler: async (request, reply) => {
      const { transcriptionTaskId } = request.body
      await stopAITranscription({ TaskId: transcriptionTaskId })
      logger.info({ transcriptionTaskId }, 'AI transcription stopped')
      return { ok: true }
    },
  })
}
