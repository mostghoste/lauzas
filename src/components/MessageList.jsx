import { useEffect, useRef } from 'react'

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function getSystemText(content, msgUserId, currentUserId) {
  const isYou = msgUserId === currentUserId
  switch (content) {
    case 'add_wood':      return isYou ? 'Tu įdėjai malką į laužą.' : 'Nepažįstamasis įdėjo malką į laužą.'
    case 'leave':         return isYou ? 'Tu užgesinai laužą.' : 'Nepažįstamasis užgesino laužą.'
    case 'fire_out':      return 'Neprižiūrėtas laužas užgeso.'
    case 'cancel_search': return 'Nustojai ieškoti kito laužo.'
    default:              return content
  }
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
        if (msg.type === 'system') {
          return (
            <div key={msg.id} className="message-row system">
              <span className="system-message">{getSystemText(msg.content, msg.user_id, userId)}</span>
            </div>
          )
        }
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
