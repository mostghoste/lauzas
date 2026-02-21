import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'

const ENDED_TAGLINES = [
  'Šiluma išblėso, bet ji buvo tikra.',
  'Iš riaumojančios ugnies liko tik žarijos.',
  'Staiga miškas nutyla. Ar jautiesi jaukiai būdamas vienas?',
  'Pelenų krūva skaudžiai primena, kad viskas yra laikina.',
  'Susidūrusios sielos vėl išeina savais keliais.',
  'Stovyklavietėje įsivyrauja tyla. Metas tęsti kelionę.',
  'Ugnis iškosėja paskutinį dūmų kamuolį.',
  'Be laužo šviesos, tamsa staiga atrodo dar tamsesnė.'
]

function sielaForm(n) {
  const last = n % 10
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 19) return 'sielų'
  if (last === 1) return 'siela'
  if (last === 0) return 'sielų'
  return 'sielos'
}
import Bonfire from './Bonfire'
import MessageList from './MessageList'
import MessageInput from './MessageInput'

export default function ChatRoom({ room, userId, appState, onRoomUpdate, onFireOut, onLeave, onSearchAgain }) {
  const [messages, setMessages] = useState([])
  const [leaveConfirm, setLeaveConfirm] = useState(false)
  const [onlineCount, setOnlineCount] = useState(null)
  const [endedTagline, setEndedTagline] = useState('')
  const channelsRef = useRef([])
  // Always keep a fresh reference so subscription callbacks never use a stale closure
  const onRoomUpdateRef = useRef(onRoomUpdate)
  useEffect(() => { onRoomUpdateRef.current = onRoomUpdate })

  const onSearchAgainRef = useRef(onSearchAgain)
  useEffect(() => { onSearchAgainRef.current = onSearchAgain })

  const isEnded = appState === 'ended'
  const isWaiting = appState === 'waiting'
  const isChatting = appState === 'chatting'

  // Pick a fresh tagline each time the chat ends
  useEffect(() => {
    if (!isEnded) return
    setEndedTagline(ENDED_TAGLINES[Math.floor(Math.random() * ENDED_TAGLINES.length)])
  }, [isEnded])

  // While waiting, actively try to join another compatible waiting room every 3s
  useEffect(() => {
    if (!isWaiting || !room?.id) return
    const tryRematch = async () => {
      const { data: newRoomId } = await supabase.rpc('try_rematch', { p_current_room_id: room.id })
      if (!newRoomId) return
      const { data: newRoom } = await supabase.from('rooms').select('*').eq('id', newRoomId).single()
      if (newRoom) onRoomUpdateRef.current(newRoom)
    }
    const interval = setInterval(tryRematch, 3000)
    return () => clearInterval(interval)
  }, [isWaiting, room?.id])

  // Poll online count while waiting
  useEffect(() => {
    if (!isWaiting) return
    const fetch = async () => {
      const { data } = await supabase.rpc('get_online_count')
      if (data !== null) setOnlineCount(data)
    }
    fetch()
    const interval = setInterval(fetch, 10000)
    return () => clearInterval(interval)
  }, [isWaiting])

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

  // Waiting room timeout — fire when waiting_expires_at passes
  useEffect(() => {
    if (!isWaiting || !room?.waiting_expires_at) return
    const msLeft = new Date(room.waiting_expires_at) - Date.now()
    if (msLeft <= 0) { handleWaitingTimeout(); return }
    const t = setTimeout(handleWaitingTimeout, msLeft)
    return () => clearTimeout(t)
  }, [isWaiting, room?.waiting_expires_at])

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

  async function handleWaitingTimeout() {
    if (room?.id) await supabase.rpc('leave_room', { p_room_id: room.id })
    setMessages([{
      id: 'local-timeout',
      type: 'system',
      content: 'waiting_timeout',
      user_id: null,
      created_at: new Date().toISOString(),
    }])
    onFireOut()
  }

  async function handleLeave() {
    if (room?.id && !isEnded) {
      if (isChatting) {
        await supabase.rpc('insert_system_message', { p_room_id: room.id, p_content: 'leave' })
      }
      await supabase.rpc('leave_room', { p_room_id: room.id })
    }
    if (isWaiting) {
      // Replace any stale messages from a previous chat with a single local notice
      setMessages([{
        id: 'local-cancel',
        type: 'system',
        content: 'cancel_search',
        user_id: null,
        created_at: new Date().toISOString(),
      }])
    }
    onFireOut() // Always land on ended screen (waiting or chatting)
  }

  function handleLeaveClick() {
    if (isEnded) { onLeave(); return }
    if (isWaiting) { handleLeave(); return }
    if (leaveConfirm) { handleLeave(); return }
    setLeaveConfirm(true)
  }

  async function handleSend(content) {
    if (leaveConfirm) setLeaveConfirm(false)
    await supabase.from('messages').insert({
      room_id: room.id,
      user_id: userId,
      content,
    })
  }

  return (
    <div className="chat-room">
      {!isEnded && (
        <button
          className={`btn-leave${leaveConfirm ? ' btn-leave-confirm' : ''}`}
          onClick={handleLeaveClick}
        >
          {isChatting && leaveConfirm ? 'Ar tikrai nori išeiti?' : 'išeiti'}
        </button>
      )}

      {(isChatting || (isEnded && room?.fire_expires_at)) && (
        <Bonfire
          room={room}
          userId={userId}
          onFireOut={onFireOut}
        />
      )}

      {isWaiting && (
        <div className="waiting-overlay">
          <span>laukiama nepažįstamojo<span className="searching-dots" /></span>
          {onlineCount !== null && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
              {onlineCount === 0
                ? 'Miškas šiuo metu tuščias'
                : `Miške šiuo metu klaidžioja ${onlineCount} ${sielaForm(onlineCount)}`}
            </span>
          )}
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
            <p className="ended-sub">{endedTagline}</p>
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
