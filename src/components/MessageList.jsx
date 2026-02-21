import { useEffect, useRef } from 'react'

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function MessageList({ messages, userId }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  if (messages.length === 0) {
    return (
      <div className="message-list" style={{ alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
        pasveikink savo nepažįstamąjį
      </div>
    )
  }

  return (
    <div className="message-list">
      {messages.map(msg => {
        const isYou = msg.user_id === userId
        return (
          <div key={msg.id} className={`message-row ${isYou ? 'you' : 'stranger'}`}>
            <div className="message-bubble">{msg.content}</div>
            <span className="message-time">{formatTime(msg.created_at)}</span>
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
