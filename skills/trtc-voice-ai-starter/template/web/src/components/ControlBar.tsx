import type { SessionState } from '../types/events.js'

interface ControlBarProps {
  sessionState: SessionState
  isMuted: boolean
  onStart: () => void
  onStop: () => void
  onToggleMute: () => void
}

export function ControlBar({
  sessionState,
  isMuted,
  onStart,
  onStop,
  onToggleMute,
}: ControlBarProps) {
  const isActive = sessionState === 'active'
  const isBusy = sessionState === 'connecting' || sessionState === 'stopping'

  return (
    <div className="control-bar">
      {sessionState === 'idle' ? (
        <button className="btn btn-primary" onClick={onStart} disabled={isBusy}>
          Start
        </button>
      ) : (
        <button className="btn btn-danger" onClick={onStop} disabled={isBusy}>
          {sessionState === 'stopping' ? 'Stopping…' : 'Stop'}
        </button>
      )}

      <button
        className={`btn btn-ghost ${isMuted ? 'btn-active' : ''}`}
        onClick={onToggleMute}
        disabled={!isActive}
        title={isMuted ? 'AI cannot hear you — click to unmute' : 'Click to mute your microphone'}
      >
        {isMuted ? 'Mic Off' : 'Mic On'}
      </button>
    </div>
  )
}
