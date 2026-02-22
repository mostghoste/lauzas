import { useEffect, useRef } from 'react'

function formatTime(iso) {
  const d = new Date(iso)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const SUB_MESSAGES = new Set([
  'room_stalked_sub', 'room_triple_sub', 'room_triple_guest_sub', 'room_eternal_sub'
])

function getRoleLabel(uid, room) {
  if (!uid || !room) return 'Nepažįstamasis'
  if (uid === room.user1_id) return 'Nepažįstamasis 1'
  if (uid === room.user2_id) return 'Nepažįstamasis 2'
  if (uid === room.user3_id) return 'Svečias'
  return 'Nepažįstamasis'
}

function getSystemText(content, msgUserId, currentUserId, room) {
  const isYou = msgUserId === currentUserId
  const isMulti = room?.room_type === 'triple' || room?.room_type === 'eternal'
  switch (content) {
    case 'add_wood': {
      if (isYou) return 'Tu įdėjai malką į laužą.'
      return `${getRoleLabel(msgUserId, room)} įdėjo malką į laužą.`
    }
    case 'earn_ugnele': {
      if (isYou) return 'Tu gavai Ugnelę.'
      return `${getRoleLabel(msgUserId, room)} gavo Ugnelę.`
    }
    case 'leave':
      return isYou ? 'Tu užgesinai laužą.' : 'Nepažįstamasis užgesino laužą.'
    case 'leave_1':
      return isYou ? 'Tu išėjai.' : 'Nepažįstamasis 1 išėjo.'
    case 'leave_2':
      return isYou ? 'Tu išėjai.' : 'Nepažįstamasis 2 išėjo.'
    case 'leave_guest':
      return isYou ? 'Tu išėjai.' : 'Svečias išėjo.'
    case 'fire_out':         return 'Neprižiūrėtas laužas užgeso.'
    case 'cancel_search':    return 'Nustojai ieškoti kito laužo.'
    case 'waiting_timeout':  return 'Niekas neatėjo. Laužas nebuvo užkurtas.'
    case 'room_stalked':     return 'Jūsų balsai prie šio laužo sklinda itin toli.'
    case 'room_stalked_sub': return '(Šio laužo pokalbį gali matyti nekviestas nepažįstamasis)'
    // Shown to user1+user2 only (isYou is false for them — user3 inserted these)
    case 'room_triple':      return !isYou ? 'Laužo šviesa pritraukia nekviestą svečią.' : null
    case 'room_triple_sub':  return !isYou ? '(Į pokalbį prisijungia trečias asmuo)' : null
    // Shown to user3 (Svečias) only
    case 'room_triple_guest':     return isYou ? 'Iš toli išgirsti šnabždesius.' : null
    case 'room_triple_guest_sub': return isYou ? '(Įsibrauni į vykstantį pokalbį)' : null
    case 'room_eternal':     return 'Šio laužo šviesa ryškesnė, nei bet kurio kito.'
    case 'room_eternal_sub': return '(Ši ugnis niekada nenustos degti)'
    default:                 return content
  }
}

function getSlotClass(msgUserId, currentUserId, room) {
  if (msgUserId === currentUserId) return 'you'
  // In multi-person rooms, colour each slot distinctly
  if (room?.user3_id || room?.user4_id || room?.user5_id) {
    if (msgUserId === room?.user1_id) return 'stranger'
    if (msgUserId === room?.user2_id) return 'stranger stranger-2'
    if (msgUserId === room?.user3_id) return 'stranger stranger-3'
    if (msgUserId === room?.user4_id) return 'stranger stranger-4'
    if (msgUserId === room?.user5_id) return 'stranger stranger-5'
  }
  return 'stranger'
}

export default function MessageList({ messages, userId, typingUsers = [], room }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, typingUsers])

  if (messages.length === 0 && typingUsers.length === 0) {
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
          const text = getSystemText(msg.content, msg.user_id, userId, room)
          if (text === null) return null
          const isSub = SUB_MESSAGES.has(msg.content)
          return (
            <div key={msg.id} className="message-row system">
              <span className={isSub ? 'system-message-sub' : 'system-message'}>{text}</span>
            </div>
          )
        }
        const senderClass = getSlotClass(msg.user_id, userId, room)
        return (
          <div key={msg.id} className={`message-row ${senderClass}`}>
            <div className="message-bubble">{msg.content}</div>
            <span className="message-time">{formatTime(msg.created_at)}</span>
          </div>
        )
      })}
      {typingUsers.map(tid => (
        <div key={tid} className={`message-row ${getSlotClass(tid, userId, room)}`}>
          <div className="message-bubble typing-dots">
            <span /><span /><span />
          </div>
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  )
}
