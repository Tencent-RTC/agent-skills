interface LEDIndicatorProps {
  active: boolean
  color: string          // CSS color value
  label: string
  tooltip?: string
}

export function LEDIndicator({ active, color, label, tooltip }: LEDIndicatorProps) {
  return (
    <div className="led-indicator" title={tooltip}>
      <span
        className="led-dot"
        style={{
          background: active ? color : 'var(--color-led-off)',
          boxShadow: active ? `0 0 6px ${color}` : 'none',
        }}
      />
      <span className="led-label">{label}</span>
    </div>
  )
}
