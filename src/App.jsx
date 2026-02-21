import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Landing from './components/Landing'
import ChatRoom from './components/ChatRoom'

// States: loading → idle → searching → waiting → chatting → ended
export default function App() {
  const [appState, setAppState] = useState('loading')
  const [userId, setUserId] = useState(null)
  const [room, setRoom] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    initAuth()
  }, [])

  async function initAuth() {
    try {
      // Restore or create anonymous session
      let uid
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        uid = session.user.id
      } else {
        const { data, error } = await supabase.auth.signInAnonymously()
        if (error) throw error
        uid = data.user.id
      }
      setUserId(uid)

      // Check whether this user is already assigned to an open room
      const { data: existing } = await supabase
        .from('rooms')
        .select('*')
        .in('status', ['waiting', 'active'])
        .order('created_at', { ascending: false })
        .limit(1)

      const roomData = existing?.[0] ?? null

      if (roomData?.status === 'active') {
        const fireAlive = roomData.fire_expires_at &&
          new Date(roomData.fire_expires_at) > new Date()
        if (fireAlive) {
          // Restore directly into the ongoing chat
          setRoom(roomData)
          setAppState('chatting')
          return
        }
        // Fire already out — treat as a fresh user, fall through to idle
      } else if (roomData?.status === 'waiting') {
        // Still searching — restore to the waiting screen
        setRoom(roomData)
        setAppState('waiting')
        return
      }

      setAppState('idle')
    } catch (err) {
      setError(err.message)
      setAppState('idle')
    }
  }

  async function handleFindFire() {
    setAppState('searching')
    setError(null)
    try {
      const { data: roomId, error: rpcError } = await supabase.rpc('find_or_create_room')
      if (rpcError) throw rpcError

      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', roomId)
        .single()
      if (roomError) throw roomError

      setRoom(roomData)
      if (roomData.status === 'active') {
        setAppState('chatting')
      } else {
        setAppState('waiting')
      }
    } catch (err) {
      setError(err.message)
      setAppState('idle')
    }
  }

  function handleRoomUpdate(updatedRoom) {
    setRoom(updatedRoom)
    if (updatedRoom.status === 'active' && appState !== 'chatting') {
      setAppState('chatting')
    }
    if (updatedRoom.status === 'ended') {
      setAppState('ended')
    }
  }

  function handleFireOut() {
    setAppState('ended')
  }

  function handleLeave() {
    setRoom(null)
    setAppState('idle')
  }

  async function handleSearchAgain() {
    // Don't set appState to 'searching' — that would flash the Landing screen.
    // Stay in the current state while the RPC runs, then jump straight to waiting/chatting.
    setError(null)
    try {
      const { data: roomId, error: rpcError } = await supabase.rpc('find_or_create_room')
      if (rpcError) throw rpcError

      const { data: roomData, error: roomError } = await supabase
        .from('rooms')
        .select('*')
        .eq('id', roomId)
        .single()
      if (roomError) throw roomError

      setRoom(roomData)
      if (roomData.status === 'active') {
        setAppState('chatting')
      } else {
        setAppState('waiting')
      }
    } catch (err) {
      setError(err.message)
      setAppState('idle')
    }
  }

  if (appState === 'loading') {
    return (
      <div className="app-center">
        <div className="loading-text">kuriamas laužas…</div>
      </div>
    )
  }

  if (appState === 'idle' || appState === 'searching') {
    return (
      <Landing
        onFindFire={handleFindFire}
        searching={appState === 'searching'}
        error={error}
      />
    )
  }

  return (
    <ChatRoom
      room={room}
      userId={userId}
      appState={appState}
      onRoomUpdate={handleRoomUpdate}
      onFireOut={handleFireOut}
      onLeave={handleLeave}
      onSearchAgain={handleSearchAgain}
    />
  )
}
