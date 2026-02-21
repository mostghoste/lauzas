import { useEffect, useRef, useState } from 'react'

export default function MessageInput({ onSend, disabled }) {
  const [text, setText] = useState('')
  const sendingRef = useRef(false)
  const textareaRef = useRef(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  async function handleSend() {
    const trimmed = text.trim()
    if (!trimmed || sendingRef.current || disabled) return
    sendingRef.current = true
    setText('')
    try {
      await onSend(trimmed)
    } finally {
      sendingRef.current = false
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
        disabled={disabled}
        rows={1}
      />
      <button
        className="btn-send"
        onClick={handleSend}
        disabled={!text.trim() || disabled}
      >
        siųsti
      </button>
    </div>
  )
}
