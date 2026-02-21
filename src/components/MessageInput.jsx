import { useState } from 'react'

export default function MessageInput({ onSend, disabled }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || sending || disabled) return
    setSending(true)
    try {
      await onSend(trimmed)
      setText('')
    } finally {
      setSending(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="message-input-wrapper">
      <textarea
        className="message-input"
        placeholder={disabled ? 'the fire has died…' : 'say something…'}
        value={text}
        onChange={e => setText(e.target.value.slice(0, 500))}
        onKeyDown={handleKeyDown}
        disabled={disabled || sending}
        rows={1}
      />
      <button
        className="btn-send"
        onClick={handleSend}
        disabled={!text.trim() || disabled || sending}
      >
        send
      </button>
    </div>
  )
}
