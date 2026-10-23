import type { AgentState, Metrics } from '../types/events.js'
import { AgentStates } from '../types/events.js'
import { LEDIndicator } from './LEDIndicator.js'

interface StatusPanelProps {
  roomId: string
  userId: string
  agentState: AgentState | null
  metrics: Metrics
}

const STATE_LABELS: Record<AgentState, string> = {
  [AgentStates.Listening]: 'Listening',
  [AgentStates.Thinking]: 'Thinking',
  [AgentStates.Speaking]: 'Speaking',
  [AgentStates.Interrupted]: 'Interrupted',
  [AgentStates.Ended]: 'Idle',
}

function fmt(ms: number | null): string {
  return ms === null ? '—' : `${ms} ms`
}

export function StatusPanel({ roomId, userId, agentState, metrics }: StatusPanelProps) {
  return (
    <aside className="status-panel">
      <section className="status-section">
        <h3 className="status-section-title">Room Info</h3>
        <dl className="info-list">
          <div className="info-row">
            <dt>Room</dt>
            <dd title={roomId}>{roomId || '—'}</dd>
          </div>
          <div className="info-row">
            <dt>User</dt>
            <dd title={userId}>{userId || '—'}</dd>
          </div>
        </dl>
      </section>

      <section className="status-section">
        <h3 className="status-section-title">Agent Status</h3>
        <div className="led-group">
          <LEDIndicator
            active={agentState === AgentStates.Listening}
            color="var(--color-led-listening)"
            label="Listening"
          />
          <LEDIndicator
            active={agentState === AgentStates.Thinking}
            color="var(--color-led-thinking)"
            label="Thinking"
          />
          <LEDIndicator
            active={agentState === AgentStates.Speaking}
            color="var(--color-led-speaking)"
            label="Speaking"
          />
        </div>
        <p className="agent-state-label">
          {agentState ? STATE_LABELS[agentState] : 'Idle'}
        </p>
      </section>

      <section className="status-section">
        <h3 className="status-section-title">Latency</h3>
        <dl className="info-list">
          <div className="info-row">
            <dt>STT</dt>
            <dd>{fmt(metrics.sttMs)}</dd>
          </div>
          <div className="info-row">
            <dt>LLM</dt>
            <dd>{fmt(metrics.llmMs)}</dd>
          </div>
          <div className="info-row">
            <dt>TTS</dt>
            <dd>{fmt(metrics.ttsMs)}</dd>
          </div>
        </dl>
      </section>
    </aside>
  )
}
