import type { FastifyInstance } from 'fastify'
import { buildAgentPayload } from '../config/providers.js'
import type { StartOpts } from '../config/providers.js'
import {
  startAIConversation,
  stopAIConversation,
  controlAIConversation,
  updateAIConversation,
} from '../tencent/client.js'
import { logger } from '../logger.js'
import {
  numericRoomId,
  trtcUserId,
  taskId as taskIdSchema,
  okResponse,
  isRoomIdInRange,
  ROOM_ID_RANGE_ERROR,
} from './schemas.js'

// ============================================================
// Agent control endpoints
//
// Every route carries a JSON schema. Without one, a missing `taskId` reaches
// the Tencent SDK and comes back as an opaque 500; with one,
// Fastify answers 400 and names the field.
//
// `additionalProperties: false` rejects unknown fields rather than stripping
// them — see the AJV configuration in index.ts. The exception is the three
// `*Overrides` objects: their keys are filtered by the allow-list in
// config/overrides.ts, which is the layer that knows which ones are safe.
// ============================================================

/** Free-form object; contents are allow-listed in config/overrides.ts. */
const overridesSchema = { type: 'object' } as const

export async function agentRoutes(app: FastifyInstance) {
  // POST /agent/start
  // Body type is reused from providers.ts so the route and the payload builder
  // can never drift apart.
  app.post<{ Body: StartOpts }>('/start', {
    schema: {
      body: {
        type: 'object',
        required: ['roomId', 'targetUserId'],
        properties: {
          roomId: numericRoomId,
          targetUserId: trtcUserId,
          systemPrompt: { type: 'string', maxLength: 8192 },
          greeting: { type: 'string', maxLength: 1024 },
          sttOverrides: overridesSchema,
          llmOverrides: overridesSchema,
          ttsOverrides: overridesSchema,
        },
        additionalProperties: false,
      },
    },
    handler: async (request, reply) => {
      // Shape is enforced by the schema; the numeric upper bound cannot be
      // expressed there. See routes/schemas.ts.
      if (!isRoomIdInRange(request.body.roomId)) {
        return reply.code(400).send({ ok: false, error: ROOM_ID_RANGE_ERROR })
      }

      const payload = buildAgentPayload(request.body)
      logger.info({ roomId: request.body.roomId }, 'starting AI conversation')

      const result = await startAIConversation(payload)
      return {
        taskId: result.TaskId,
        sessionId: result.SessionId ?? null,
        roomId: request.body.roomId,
        botUserId: payload.AgentConfig.UserId,
        status: 'started',
      }
    },
  })

  // POST /agent/stop
  app.post<{ Body: { taskId: string } }>('/stop', {
    schema: {
      body: {
        type: 'object',
        required: ['taskId'],
        properties: { taskId: taskIdSchema },
        additionalProperties: false,
      },
    },
    handler: async (request, reply) => {
      const { taskId } = request.body
      await stopAIConversation({ TaskId: taskId })
      logger.info({ taskId }, 'AI conversation stopped')
      return { ok: true, taskId }
    },
  })

  // POST /agent/control  (interrupt or push text)
  app.post<{
    Body: {
      taskId: string
      command: 'interrupt' | 'server_push_text'
      text?: string
    }
  }>('/control', {
    schema: {
      body: {
        type: 'object',
        required: ['taskId', 'command'],
        properties: {
          taskId: taskIdSchema,
          command: { type: 'string', enum: ['interrupt', 'server_push_text'] },
          text: { type: 'string', minLength: 1, maxLength: 4096 },
        },
        additionalProperties: false,
      },
      response: okResponse,
    },
    handler: async (request, reply) => {
      const { taskId, command, text } = request.body

      if (command === 'interrupt') {
        await controlAIConversation({ TaskId: taskId, Command: 'InterruptBroadcast' })
        return { ok: true }
      }

      // `command` is constrained to the two values above by the schema, so this
      // is the server_push_text branch.
      if (!text) {
        return reply.code(400).send({ error: 'text is required for server_push_text' })
      }
      await controlAIConversation({
        TaskId: taskId,
        Command: 'ServerPushText',
        ServerPushText: { Text: text },
      })
      return { ok: true }
    },
  })

  // POST /agent/update  (update prompt or context at runtime)
  app.post<{
    Body: {
      taskId: string
      systemPrompt?: string
      temperature?: number
    }
  }>('/update', {
    schema: {
      body: {
        type: 'object',
        required: ['taskId'],
        properties: {
          taskId: taskIdSchema,
          systemPrompt: { type: 'string', minLength: 1, maxLength: 8192 },
          temperature: { type: 'number', minimum: 0, maximum: 2 },
        },
        additionalProperties: false,
      },
      response: okResponse,
    },
    handler: async (request, reply) => {
      const { taskId, systemPrompt, temperature } = request.body

      const llmConfig: Record<string, unknown> = {}
      if (systemPrompt) llmConfig.SystemPrompt = systemPrompt
      if (temperature !== undefined) llmConfig.Temperature = temperature

      if (Object.keys(llmConfig).length === 0) {
        return reply
          .code(400)
          .send({ error: 'at least one of systemPrompt or temperature is required' })
      }

      await updateAIConversation({
        TaskId: taskId,
        LLMConfig: JSON.stringify(llmConfig),
      })
      return { ok: true }
    },
  })
}
