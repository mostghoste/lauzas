import { useEffect, useRef } from 'react'

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const SUB_MESSAGES = new Set(['room_stalked_sub', 'room_triple_sub', 'room_eternal_sub'])

function getSystemText(content, msgUserId, currentUserId) {
  const isYou = msgUserId === currentUserId
  switch (content) {
    case 'add_wood':         return isYou ? 'Tu įdėjai malką į laužą.' : 'Nepažįstamasis įdėjo malką į laužą.'
    case 'earn_ugnele':      return isYou ? 'Tu gavai Ugnelę.' : 'Nepažįstamasis gavo Ugnelę.'
    case 'leave':            return isYou ? 'Tu užgesinai laužą.' : 'Nepažįstamasis užgesino laužą.'
    case 'fire_out':         return 'Neprižiūrėtas laužas užgeso.'
    case 'cancel_search':    return 'Nustojai ieškoti kito laužo.'
    case 'waiting_timeout':  return 'Niekas neatėjo. Laužas nebuvo užkurtas.'
    case 'room_stalked':     return 'Jūsų balsai prie šio laužo sklinda itin toli.'
    case 'room_stalked_sub': return '(Šio laužo pokalbį gali matyti nekviestas nepažįstamasis)'
    case 'room_triple':      return 'Laužo šviesa pritraukia nekviestą svečią.'
    case 'room_triple_sub':  return '(Pokalbyje dalyvauja trys žmonės)'
    case 'room_eternal':     return 'Šio laužo šviesa ryškesnė, nei bet kurio kito.'
    case 'room_eternal_sub': return '(Ši ugnis niekada nenustos degti)'
    default:                 return content
  }
}

function getSenderClass(msg, userId, room) {
  if (msg.user_id === userId) return 'you'
  if (room?.user3_id && msg.user_id === room.user3_id) return 'stranger stranger-3'
  if (room?.user4_id && msg.user_id === room.user4_id) return 'stranger stranger-4'
  if (room?.user5_id && msg.user_id === room.user5_id) return 'stranger stranger-5'
  return 'stranger'
}

export default function MessageList({ messages, userId, strangerTyping, room }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, strangerTyping])

  if (messages.length === 0 && !strangerTyping) {
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
          const isSub = SUB_MESSAGES.has(msg.content)
          return (
            <div key={msg.id} className="message-row system">
              <span className={isSub ? 'system-message-sub' : 'system-message'}>
                {getSystemText(msg.content, msg.user_id, userId)}
              </span>
            </div>
          )
        }
        const senderClass = getSenderClass(msg, userId, room)
        return (
          <div key={msg.id} className={`message-row ${senderClass}`}>
            <div className="message-bubble">{msg.content}</div>
            <span className="message-time">{formatTime(msg.created_at)}</span>
          </div>
        )
      })}
      {strangerTyping && (
        <div className="message-row stranger">
          <div className="message-bubble typing-dots">
            <span /><span /><span />
          </div>
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  )
}
