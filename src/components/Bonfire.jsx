import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'

function formatTime(seconds) {
  if (seconds <= 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function Bonfire({ room, userId, onFireOut, isStatic, fireScale: staticScale, timeLeft: staticTime }) {
  const isEternal  = room?.room_type === 'eternal'
  const isObserver = room?.observer_id === userId

  const [timeLeft, setTimeLeft] = useState(staticTime ?? 30)
  const [woodCooldown, setWoodCooldown] = useState(0)
  const [addingWood, setAddingWood] = useState(false)
  const [ugneleCount, setUgneleCount] = useState(0)
  const timerRef = useRef(null)
  const cooldownRef = useRef(null)

  // Fetch ugnele count for eternal rooms
  useEffect(() => {
    if (!isEternal || isStatic) return
    supabase.rpc('get_my_ugneles').then(({ data }) => {
      if (data !== null) setUgneleCount(data)
    })
  }, [isEternal, isStatic])

  // Sync time from room
  useEffect(() => {
    if (isStatic || isEternal || !room?.fire_expires_at) return

    // Other user left — extinguish immediately without firing onFireOut
    if (room?.status === 'ended') {
      clearInterval(timerRef.current)
      setTimeLeft(0)
      return
    }

    const compute = () => Math.max(0, Math.floor((new Date(room.fire_expires_at) - Date.now()) / 1000))
    setTimeLeft(compute())

    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      const t = compute()
      setTimeLeft(t)
      if (t === 0) {
        clearInterval(timerRef.current)
        supabase.rpc('insert_system_message', { p_room_id: room.id, p_content: 'fire_out' })
        supabase.rpc('leave_room', { p_room_id: room.id })
        onFireOut?.()
      }
    }, 1000)

    return () => clearInterval(timerRef.current)
  }, [room?.fire_expires_at, room?.status, isStatic])

  // Ctrl+Space shortcut for add wood
  useEffect(() => {
    if (isStatic || isObserver) return
    function onKeyDown(e) {
      if (e.code === 'Space' && e.ctrlKey) {
        e.preventDefault()
        handleAddWood()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [room, woodCooldown, addingWood])

  // Cooldown ticker
  useEffect(() => {
    if (woodCooldown <= 0) return
    cooldownRef.current = setInterval(() => {
      setWoodCooldown(c => {
        if (c <= 1) {
          clearInterval(cooldownRef.current)
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => clearInterval(cooldownRef.current)
  }, [woodCooldown > 0])

  async function handleAddWood() {
    if (!room || woodCooldown > 0 || addingWood || isObserver) return
    setAddingWood(true)
    try {
      await supabase.rpc('add_wood', { p_room_id: room.id })
      const msgContent = isEternal ? 'earn_ugnele' : 'add_wood'
      await supabase.rpc('insert_system_message', { p_room_id: room.id, p_content: msgContent })
      if (isEternal) setUgneleCount(c => c + 1)
      setWoodCooldown(3)
    } finally {
      setAddingWood(false)
    }
  }

  const effectiveTimeLeft = isStatic ? (staticTime ?? 180) : timeLeft
  const fireScale = isEternal ? 1 : isStatic ? (staticScale ?? 1) : Math.max(0.2, Math.min(1, effectiveTimeLeft / 30))
  const dying = effectiveTimeLeft < 30 && !isStatic && !isEternal

  return (
    <div className="bonfire-wrapper">
      <div className="bonfire-scene">
        <div className="glow-ring" />
        <div className="flame-container" style={{ transform: `scale(${fireScale})`, transformOrigin: 'bottom center' }}>
          <div className="flame flame-outer" />
          <div className="flame flame-mid" />
          <div className="flame flame-inner" />
        </div>
        <div className="logs" />
      </div>

      {!isStatic && isEternal && !isObserver && (
        <div className="bonfire-actions">
          <button
            className="btn-wood"
            onClick={handleAddWood}
            disabled={woodCooldown > 0 || addingWood}
          >
            Įdėti malką
          </button>
          {woodCooldown > 0 && (
            <span className="wood-cooldown">{woodCooldown}s</span>
          )}
          <span className="ugnele-count" title="Tavo Ugnelės">🔥 {ugneleCount}</span>
        </div>
      )}

      {!isStatic && !isEternal && (
        <>
          <div className={`bonfire-timer${dying ? ' dying' : ''}`}>
            {formatTime(effectiveTimeLeft)}
          </div>
          <div className="bonfire-actions">
            {!isObserver && (
              <button
                className="btn-wood"
                onClick={handleAddWood}
                disabled={woodCooldown > 0 || addingWood || effectiveTimeLeft === 0}
              >
                Įdėti malką
              </button>
            )}
            {!isObserver && woodCooldown > 0 && (
              <span className="wood-cooldown">{woodCooldown}s</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
