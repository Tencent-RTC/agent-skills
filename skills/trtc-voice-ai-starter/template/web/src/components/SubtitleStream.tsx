import { useEffect, useRef } from 'react'
import type { Subtitle } from '../types/events.js'

interface SubtitleStreamProps {
  subtitles: Subtitle[]
}

export function SubtitleStream({ subtitles }: SubtitleStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [subtitles])

  if (subtitles.length === 0) {
    return (
      <div className="subtitle-stream subtitle-stream--empty">
        <p className="subtitle-empty-hint">Subtitles will appear here once the conversation starts.</p>
      </div>
    )
  }

  return (
    <div className="subtitle-stream" role="log" aria-live="polite" aria-label="Conversation subtitles">
      {subtitles.map(sub => (
        <div
          key={sub.id}
          className={`subtitle-entry subtitle-entry--${sub.role} ${sub.isFinal ? '' : 'subtitle-entry--interim'}`}
        >
          <span className="subtitle-role">{sub.role === 'user' ? 'You' : 'Agent'}</span>
          <p className="subtitle-text">{sub.text}</p>
          {sub.translation && (
            <p className="subtitle-translation">{sub.translation}</p>
          )}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
