import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import Bonfire from './Bonfire'
import MessageList from './MessageList'
import MessageInput from './MessageInput'

export default function ChatRoom({ room, userId, appState, onRoomUpdate, onFireOut, onLeave }) {
  const [messages, setMessages] = useState([])
  const channelsRef = useRef([])

  // Load messages when chatting starts
  useEffect(() => {
    if (appState !== 'chatting' || !room?.id) return
    loadMessages()
  }, [appState, room?.id])

  // Set up realtime subscriptions whenever room is available
  useEffect(() => {
    if (!room?.id) return
    setupSubscriptions(room.id)
    return () => teardownSubscriptions()
  }, [room?.id])

  // beforeunload cleanup
  useEffect(() => {
    if (!room?.id) return
    const handler = () => {
      supabase.rpc('leave_room', { p_room_id: room.id })
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [room?.id])

  async function loadMessages() {
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('room_id', room.id)
      .order('created_at', { ascending: true })
    if (data) setMessages(data)
  }

  function setupSubscriptions(roomId) {
    teardownSubscriptions()

    const roomChannel = supabase
      .channel(`room:${roomId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rooms',
        filter: `id=eq.${roomId}`,
      }, payload => {
        onRoomUpdate(payload.new)
      })
      .subscribe()

    const msgsChannel = supabase
      .channel(`msgs:${roomId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `room_id=eq.${roomId}`,
      }, payload => {
        setMessages(prev => {
          if (prev.find(m => m.id === payload.new.id)) return prev
          return [...prev, payload.new]
        })
      })
      .subscribe()

    channelsRef.current = [roomChannel, msgsChannel]
  }

  function teardownSubscriptions() {
    channelsRef.current.forEach(ch => supabase.removeChannel(ch))
    channelsRef.current = []
  }

  async function handleLeave() {
    if (room?.id) {
      await supabase.rpc('leave_room', { p_room_id: room.id })
    }
    onLeave()
  }

  async function handleSend(content) {
    await supabase.from('messages').insert({
      room_id: room.id,
      user_id: userId,
      content,
    })
  }

  const isEnded = appState === 'ended'
  const isWaiting = appState === 'waiting'
  const isChatting = appState === 'chatting'

  return (
    <div className="chat-room">
      <div className="chat-header">
        <span className="chat-header-title">laužas</span>
        <button className="btn-leave" onClick={handleLeave}>leave</button>
      </div>

      {(isChatting || isEnded) && (
        <Bonfire
          room={room}
          userId={userId}
          onFireOut={onFireOut}
        />
      )}

      {isWaiting && (
        <>
          <Bonfire room={room} userId={userId} onFireOut={onFireOut} />
          <div className="waiting-overlay">
            <span>waiting for a stranger<span className="searching-dots" /></span>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              share this vibe — someone will find you
            </span>
          </div>
        </>
      )}

      {isChatting && (
        <>
          <MessageList messages={messages} userId={userId} />
          <MessageInput onSend={handleSend} disabled={false} />
        </>
      )}

      {isEnded && (
        <>
          <MessageList messages={messages} userId={userId} />
          <div className="ended-overlay" style={{ flex: 'none', padding: '1rem', borderTop: '1px solid var(--border)' }}>
            <p className="ended-title">the fire is out</p>
            <p className="ended-sub">the warmth fades, but it was real</p>
            <button className="btn-primary" onClick={handleLeave}>back to the cold</button>
          </div>
        </>
      )}
    </div>
  )
}
