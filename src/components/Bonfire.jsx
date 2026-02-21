import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'

function formatTime(seconds) {
  if (seconds <= 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function Bonfire({ room, userId, onFireOut, isStatic, fireScale: staticScale, timeLeft: staticTime }) {
  const [timeLeft, setTimeLeft] = useState(staticTime ?? 180)
  const [woodCooldown, setWoodCooldown] = useState(0)
  const [addingWood, setAddingWood] = useState(false)
  const timerRef = useRef(null)
  const cooldownRef = useRef(null)

  // Sync time from room
  useEffect(() => {
    if (isStatic || !room?.fire_expires_at) return

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
        onFireOut?.()
      }
    }, 1000)

    return () => clearInterval(timerRef.current)
  }, [room?.fire_expires_at, room?.status, isStatic])

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
    if (!room || woodCooldown > 0 || addingWood) return
    setAddingWood(true)
    try {
      await supabase.rpc('add_wood', { p_room_id: room.id })
      await supabase.rpc('insert_system_message', { p_room_id: room.id, p_content: 'add_wood' })
      setWoodCooldown(15)
    } finally {
      setAddingWood(false)
    }
  }

  const effectiveTimeLeft = isStatic ? (staticTime ?? 180) : timeLeft
  const fireScale = isStatic ? (staticScale ?? 1) : Math.max(0.2, Math.min(1, effectiveTimeLeft / 180))
  const dying = effectiveTimeLeft < 30 && !isStatic

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

      {!isStatic && (
        <>
          <div className={`bonfire-timer${dying ? ' dying' : ''}`}>
            {formatTime(effectiveTimeLeft)}
          </div>
          <div className="bonfire-actions">
            <button
              className="btn-wood"
              onClick={handleAddWood}
              disabled={woodCooldown > 0 || addingWood || effectiveTimeLeft === 0}
            >
              Įdėti malką
            </button>
            {woodCooldown > 0 && (
              <span className="wood-cooldown">{woodCooldown}s</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
