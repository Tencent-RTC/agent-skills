import { useEffect } from 'react'
import TRTC from 'trtc-sdk-v5'
import { CmdId, MessageType } from '../types/events.js'
import type {
  IncomingMessage,
  SubtitleMessage,
  StatusMessage,
  MetricMessage,
  ErrorMessage,
} from '../types/events.js'

interface Handlers {
  onSubtitle?: (msg: SubtitleMessage) => void
  onStatus?: (msg: StatusMessage) => void
  onMetric?: (msg: MetricMessage) => void
  onError?: (msg: ErrorMessage) => void
}

const decoder = new TextDecoder()

/**
 * Subscribe to TRTC custom messages (cmdID=1, bot → client).
 * Parses the raw ArrayBuffer payload and routes by type number.
 *
 * Message types (source: doc 68337, 68332-68335):
 *   10000 = subtitle  10001 = status  10020 = metric  10030 = error
 */
export function useCustomMessage(
  trtc: InstanceType<typeof TRTC> | null,
  handlers: Handlers
) {
  useEffect(() => {
    if (!trtc) return

    const handleMessage = (event: { cmdId: number; data: ArrayBuffer }) => {
      // Only process messages from the bot
      if (event.cmdId !== CmdId.FromBot) return

      let parsed: IncomingMessage
      try {
        parsed = JSON.parse(decoder.decode(event.data)) as IncomingMessage
      } catch {
        return
      }

      switch (parsed.type) {
        case MessageType.Subtitle:
          handlers.onSubtitle?.(parsed)
          break
        case MessageType.Status:
          handlers.onStatus?.(parsed)
          break
        case MessageType.Metric:
          handlers.onMetric?.(parsed)
          break
        case MessageType.Error:
          handlers.onError?.(parsed)
          break
      }
    }

    trtc.on(TRTC.EVENT.CUSTOM_MESSAGE, handleMessage)

    return () => {
      trtc.off(TRTC.EVENT.CUSTOM_MESSAGE, handleMessage)
    }
  }, [trtc, handlers.onSubtitle, handlers.onStatus, handlers.onMetric, handlers.onError])
}
