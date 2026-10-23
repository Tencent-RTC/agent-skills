import { useState, useCallback } from 'react'
import { useTRTC } from './hooks/useTRTC.js'
import { useAgent } from './hooks/useAgent.js'
import { ControlBar } from './components/ControlBar.js'
import { SubtitleStream } from './components/SubtitleStream.js'
import { StatusPanel } from './components/StatusPanel.js'
import { stopThenLeave } from './lib/session.js'
import type { SessionState } from './types/events.js'
import './styles/tokens.css'
import './App.css'

// Stable IDs for this browser session — roomId must be numeric for TRTC API
const SESSION_USER_ID = `user_${Math.random().toString(36).slice(2, 8)}`
const SESSION_ROOM_ID = String(Math.floor(Math.random() * 9000000) + 1000000)

export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const { isJoined, isMuted, agentState, botError, subtitles, metrics, join, leave, setMuted } =
    useTRTC({ userId: SESSION_USER_ID })

  const { start, stop } = useAgent(SESSION_ROOM_ID, SESSION_USER_ID)

  const handleStart = useCallback(async () => {
    setErrorMsg(null)
    setSessionState('connecting')
    try {
      await join(SESSION_ROOM_ID)
      await start()
      setSessionState('active')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to start session')
      await leave().catch(() => {})
      setSessionState('idle')
    }
  }, [join, start, leave])

  const handleStop = useCallback(async () => {
    setErrorMsg(null)
    setSessionState('stopping')
    // Leaves the room even if stopping the agent fails — see lib/session.ts.
    // A task that could not be stopped ends on its own once the room is
    // empty (AGENT_MAX_IDLE_TIME), so there is nothing for the user to retry.
    const err = await stopThenLeave(stop, leave)
    if (err) setErrorMsg(`Left the room, but stopping the agent failed: ${err.message}`)
    setSessionState('idle')
  }, [stop, leave])

  const handleToggleMute = useCallback(() => {
    setMuted(!isMuted)
  }, [setMuted, isMuted])

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-logo">TRTC Voice AI</span>
        {sessionState === 'active' && (
          <span className="app-room-chip">Room: {SESSION_ROOM_ID}</span>
        )}
      </header>

      <main className="app-main">
        {/* Left column */}
        <section className="app-column app-column--primary">
          <ControlBar
            sessionState={sessionState}
            isMuted={isMuted}
            onStart={handleStart}
            onStop={handleStop}
            onToggleMute={handleToggleMute}
          />
          {(errorMsg || botError) && (
            <div className="error-banner" role="alert">
              {errorMsg || botError}
            </div>
          )}
          <SubtitleStream subtitles={subtitles} />
        </section>

        {/* Right column */}
        <StatusPanel
          roomId={isJoined ? SESSION_ROOM_ID : ''}
          userId={isJoined ? SESSION_USER_ID : ''}
          agentState={agentState}
          metrics={metrics}
        />
      </main>
    </div>
  )
}
