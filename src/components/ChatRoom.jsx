import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import Bonfire from './Bonfire'
import MessageList from './MessageList'
import MessageInput from './MessageInput'

export default function ChatRoom({ room, userId, appState, onRoomUpdate, onFireOut, onLeave, onSearchAgain }) {
  const [messages, setMessages] = useState([])
  const [leaveConfirm, setLeaveConfirm] = useState(false)
  const channelsRef = useRef([])
  // Always keep a fresh reference so subscription callbacks never use a stale closure
  const onRoomUpdateRef = useRef(onRoomUpdate)
  useEffect(() => { onRoomUpdateRef.current = onRoomUpdate })

  const onSearchAgainRef = useRef(onSearchAgain)
  useEffect(() => { onSearchAgainRef.current = onSearchAgain })

  const isEnded = appState === 'ended'
  const isWaiting = appState === 'waiting'
  const isChatting = appState === 'chatting'

  // Load messages when chatting starts
  useEffect(() => {
    if (appState !== 'chatting' || !room?.id) return
    loadMessages()
  }, [appState, room?.id])

  // Set up realtime subscriptions whenever room is available.
  // After subscribing, re-fetch room state to catch updates that arrived
  // between the initial fetch in App.jsx and the subscription being ready.
  useEffect(() => {
    if (!room?.id) return
    setupSubscriptions(room.id)
    supabase.from('rooms').select('*').eq('id', room.id).single().then(({ data }) => {
      if (data && data.status !== room.status) {
        onRoomUpdateRef.current(data)
      }
    })
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

  // Reset leave confirm after 4 seconds of inactivity
  useEffect(() => {
    if (!leaveConfirm) return
    const t = setTimeout(() => setLeaveConfirm(false), 4000)
    return () => clearTimeout(t)
  }, [leaveConfirm])

  // Escape key handler
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== 'Escape') return
      if (isEnded) { onSearchAgainRef.current(); return }
      if (isWaiting) { handleLeave(); return }
      if (isChatting) {
        if (leaveConfirm) handleLeave()
        else setLeaveConfirm(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isEnded, isWaiting, isChatting, leaveConfirm])

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
        onRoomUpdateRef.current(payload.new)
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
    if (room?.id && !isEnded) {
      await supabase.rpc('insert_system_message', { p_room_id: room.id, p_content: 'leave' })
      await supabase.rpc('leave_room', { p_room_id: room.id })
    }
    onLeave()
  }

  function handleLeaveClick() {
    if (isEnded) { onLeave(); return }
    if (isWaiting || leaveConfirm) { handleLeave(); return }
    setLeaveConfirm(true)
  }

  async function handleSend(content) {
    setLeaveConfirm(false)
    await supabase.from('messages').insert({
      room_id: room.id,
      user_id: userId,
      content,
    })
  }

  return (
    <div className="chat-room">
      <div className="chat-header">
        <span className="chat-header-title">laužas</span>
        <button
          className={`btn-leave${leaveConfirm ? ' btn-leave-confirm' : ''}`}
          onClick={handleLeaveClick}
        >
          {isChatting && leaveConfirm ? 'Ar tikrai norite išeiti?' : 'išeiti'}
        </button>
      </div>

      {(isChatting || isEnded) && (
        <Bonfire
          room={room}
          userId={userId}
          onFireOut={onFireOut}
        />
      )}

      {isWaiting && (
        <div className="waiting-overlay">
          <span>laukiama nepažįstamojo<span className="searching-dots" /></span>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            pasidalink — kažkas tave suras
          </span>
        </div>
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
            <p className="ended-title">laužas užgeso</p>
            <p className="ended-sub">šiluma blysta, bet ji buvo tikra</p>
            <div className="ended-actions">
              <button className="btn-primary" onClick={onLeave}>Grįžti į pradžią</button>
              <button className="btn-primary" onClick={onSearchAgain}>Ieškoti kito laužo</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
