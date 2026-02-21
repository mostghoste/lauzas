export default function KeyboardHints({ appState }) {
  const isChatting = appState === 'chatting'
  const isEnded    = appState === 'ended'
  const isWaiting  = appState === 'waiting'

  const hints = [
    {
      keys: ['Ctrl', 'Space'],
      label: 'Įdėti malką',
      active: isChatting,
    },
    {
      keys: ['Esc'],
      label: isChatting ? 'Išeiti iš pokalbio' : isWaiting ? 'Atšaukti paiešką' : 'Ieškoti naujo laužo',
      active: isChatting || isEnded || isWaiting,
    },
  ]

  return (
    <div className="keyboard-hints">
      <div className="hints-icon">i</div>
      <div className="hints-popup">
        {hints.map((h, i) => (
          <div key={i} className={`hint-row${h.active ? '' : ' hint-inactive'}`}>
            <span className="hint-keys">
              {h.keys.map((k, j) => (
                <span key={j}><kbd>{k}</kbd>{j < h.keys.length - 1 && '+'}</span>
              ))}
            </span>
            <span className="hint-label">{h.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
