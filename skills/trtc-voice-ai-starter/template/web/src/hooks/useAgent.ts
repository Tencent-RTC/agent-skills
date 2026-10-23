import { useState, useCallback } from 'react'
import {
  startAgent,
  stopAgent,
  interruptAgent,
  pushTextToAgent,
  updateAgentPrompt,
} from '../lib/api.js'

export function useAgent(roomId: string, userId: string) {
  const [taskId, setTaskId] = useState<string | null>(null)
  const [botUserId, setBotUserId] = useState<string | null>(null)
  const [isActive, setIsActive] = useState(false)

  // Errors are thrown to the caller (App.tsx catches them and shows a banner)
  // rather than held here, so there is a single source of truth for the message.
  const start = useCallback(async (opts?: { systemPrompt?: string; greeting?: string }) => {
    const result = await startAgent({ roomId, targetUserId: userId, ...opts })
    setTaskId(result.taskId)
    setBotUserId(result.botUserId)
    setIsActive(true)
    return result
  }, [roomId, userId])

  const stop = useCallback(async () => {
    if (!taskId) return
    await stopAgent(taskId)
    setTaskId(null)
    setBotUserId(null)
    setIsActive(false)
  }, [taskId])

  const interrupt = useCallback(async () => {
    if (!taskId) return
    await interruptAgent(taskId)
  }, [taskId])

  const pushText = useCallback(async (text: string) => {
    if (!taskId) return
    await pushTextToAgent(taskId, text)
  }, [taskId])

  const updatePrompt = useCallback(async (systemPrompt: string) => {
    if (!taskId) return
    await updateAgentPrompt(taskId, systemPrompt)
  }, [taskId])

  return {
    taskId,
    botUserId,
    isActive,
    start,
    stop,
    // Not used by the default UI — reference implementations for Path B
    interrupt,
    pushText,
    updatePrompt,
  }
}
