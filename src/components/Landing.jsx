import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import FireLeaderboard from './FireLeaderboard'

function sielaForm(n) {
  const last = n % 10
  const lastTwo = n % 100
  if (lastTwo >= 11 && lastTwo <= 19) return 'sielų'
  if (last === 1) return 'siela'
  if (last === 0) return 'sielų'
  return 'sielos'
}

const WARNINGS = [
  { icon: 'fa-solid fa-lock', text: 'Moderavimo tikslais, tavo pokalbis gali būti saugomas.' },
  { icon: 'fa-solid fa-eye', text: 'Išlik budrus, neatskleisk asmeninių duomenų.' },
  { icon: 'fa-solid fa-handshake', text: 'Kitoje pusėje ekrano žmogus - išlik draugiškas.' },
]

export default function Landing({ onFindFire, searching, error, soundEnabled, onToggleSound }) {
  const [onlineCount, setOnlineCount] = useState(null)
  const [showWarning, setShowWarning] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)

  useEffect(() => {
    fetchCount()
    const interval = setInterval(fetchCount, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    document.title = searching ? 'Klaidžiojama... | Laužas' : 'Laužas - užeik į mišką'
  }, [searching])

  useEffect(() => {
    if (onlineCount === null) return
    const base = 'Ženk į mišką. Užmegzk pokalbį su nepažįstamu. Kalbėk, iki kol laužas užges.'
    const tail = onlineCount === 0
      ? 'Miškas šiuo metu tuščias.'
      : `Šiuo metu miške klaidžioja ${onlineCount} ${sielaForm(onlineCount)}.`
    const meta = document.querySelector('meta[name="description"]')
    if (meta) meta.setAttribute('content', `${base} ${tail}`)
  }, [onlineCount])

  async function fetchCount() {
    const { data } = await supabase.rpc('get_online_count')
    if (data !== null) setOnlineCount(data)
  }

  function handleFindFire() {
    setShowWarning(true)
  }

  function handleConfirm() {
    setShowWarning(false)
    onFindFire()
  }

  return (
    <div className="landing">
      {showLeaderboard && <FireLeaderboard onClose={() => setShowLeaderboard(false)} />}

      <button
        className="btn-sound"
        onClick={onToggleSound}
        title={soundEnabled ? 'Išjungti garsą' : 'Įjungti garsą'}
        aria-label={soundEnabled ? 'Išjungti garsą' : 'Įjungti garsą'}
      >
        <i className={soundEnabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark'} />
      </button>

      <button
        className="btn-hamburger"
        onClick={() => setShowLeaderboard(true)}
        title="Ilgiausiai degantys laužai"
        aria-label="Atidaryti lyderių lentelę"
      >
        <i className="fa-solid fa-bars" />
      </button>

      {showWarning && (
        <div className="warning-overlay" onClick={() => setShowWarning(false)}>
          <div className="warning-modal" onClick={e => e.stopPropagation()}>
            <p className="warning-title">Prieš žengiant į mišką, atsimink:</p>
            <ul className="warning-list">
              {WARNINGS.map((w, i) => (
                <li key={i}><i className={`warning-icon ${w.icon}`} />{w.text}</li>
              ))}
            </ul>
            <button className="btn-primary" onClick={handleConfirm}>Sutinku</button>
          </div>
        </div>
      )}

      <div>
        <h1 className="landing-title">laužas</h1>
        <p className="landing-sub">
          Ženk į mišką. Užmegzk pokalbį su nepažįstamu. Kalbėk, iki kol laužas užges.
        </p>
      </div>

      <button
        className="btn-primary"
        onClick={handleFindFire}
        disabled={searching}
      >
        {searching
          ? <span>ieškoma laužo<span className="searching-dots" /></span>
          : 'rasti laužą'}
      </button>

      {onlineCount !== null && (
        <p className="online-count">
          {onlineCount === 0
            ? 'Miškas šiuo metu tuščias'
            : `Miške šiuo metu klaidžioja ${onlineCount} ${sielaForm(onlineCount)}`}
        </p>
      )}

      {error && <p className="error-msg">{error}</p>}
    </div>
  )
}
