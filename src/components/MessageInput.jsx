import { useEffect, useRef, useState } from 'react'

export default function MessageInput({ onSend, disabled }) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const textareaRef = useRef(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || sending || disabled) return
    setSending(true)
    try {
      await onSend(trimmed)
      setText('')
    } finally {
      setSending(false)
      // Defer focus until React re-renders the textarea as enabled
      setTimeout(() => textareaRef.current?.focus(), 0)
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
        ref={textareaRef}
        className="message-input"
        placeholder={disabled ? 'laužas užgeso…' : 'parašyk ką nors…'}
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
        siųsti
      </button>
    </div>
  )
}
