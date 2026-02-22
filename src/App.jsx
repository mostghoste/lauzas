import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import Landing from './components/Landing'
import ChatRoom from './components/ChatRoom'

function playMatchSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const notes = [261.63, 392.00] // C4 G4 — two tones, an octave lower
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.value = freq
      const t = ctx.currentTime + i * 0.13
      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.18, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.55)
      osc.start(t)
      osc.stop(t + 0.55)
    })
    setTimeout(() => ctx.close(), 2500)
  } catch (_) {}
}

// States: loading → idle → searching → waiting → chatting → ended
export default function App() {
  const [appState, setAppState] = useState('loading')
  const [userId, setUserId] = useState(null)
  const [room, setRoom] = useState(null)
  const [error, setError] = useState(null)
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem('soundEnabled') !== 'false' } catch { return true }
  })

  function toggleSound() {
    setSoundEnabled(prev => {
      const next = !prev
      try { localStorage.setItem('soundEnabled', String(next)) } catch {}
      return next
    })
  }

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
        const isEternal = roomData.room_type === 'eternal'
        const fireAlive = isEternal || (roomData.fire_expires_at &&
          new Date(roomData.fire_expires_at) > new Date())
        if (fireAlive) {
          setRoom(roomData)
          setAppState('chatting')
          return
        }
        // Fire already out — clean up and fall through to idle
        await supabase.rpc('leave_room', { p_room_id: roomData.id })
      } else if (roomData?.status === 'waiting') {
        const waitingAlive = roomData.waiting_expires_at &&
          new Date(roomData.waiting_expires_at) > new Date()
        if (waitingAlive) {
          setRoom(roomData)
          setAppState('waiting')
          return
        }
        // Waiting period expired — clean up and go to idle
        await supabase.rpc('leave_room', { p_room_id: roomData.id })
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
        if (soundEnabled) playMatchSound()
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
      if (soundEnabled) playMatchSound()
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
        if (soundEnabled) playMatchSound()
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
        soundEnabled={soundEnabled}
        onToggleSound={toggleSound}
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
