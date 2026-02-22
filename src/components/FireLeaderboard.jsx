import { useEffect, useState } from 'react'
import { supabase } from '../supabase'

function formatDuration(seconds) {
  const s = Math.floor(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rem = s % 60
  return rem === 0 ? `${m} min` : `${m} min ${rem}s`
}

export default function FireLeaderboard({ onClose }) {
  const [period, setPeriod] = useState('today')
  const [fires, setFires] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function loadFires() {
      setLoading(true)
      const { data } = await supabase.rpc('get_top_fires', {
        p_period: period,
        p_only_active: false,
      })
      if (!cancelled) {
        setFires(data || [])
        setLoading(false)
      }
    }
    loadFires()
    return () => { cancelled = true }
  }, [period])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="leaderboard-overlay" onClick={onClose}>
      <div className="leaderboard-modal" onClick={e => e.stopPropagation()}>
        <button className="leaderboard-close" onClick={onClose} aria-label="Uždaryti">
          <i className="fa-solid fa-xmark" />
        </button>

        <p className="leaderboard-title">Ilgiausiai degę laužai</p>

        <div className="period-tabs">
          <button
            className={`period-tab${period === 'today' ? ' active' : ''}`}
            onClick={() => setPeriod('today')}
          >Šiandien</button>
          <button
            className={`period-tab${period === 'alltime' ? ' active' : ''}`}
            onClick={() => setPeriod('alltime')}
          >Visų laikų</button>
        </div>

        <div className="leaderboard-list">
          {loading ? (
            <span className="leaderboard-empty">kraunama…</span>
          ) : fires.length === 0 ? (
            <span className="leaderboard-empty">Nėra rezultatų</span>
          ) : fires.map((fire, i) => (
            <div key={i} className="leaderboard-row">
              <span className="lb-rank">{i + 1}</span>
              <span className="lb-duration">{formatDuration(fire.duration_seconds)}</span>
              {fire.is_active ? (
                <span className="lb-fire" title="Degantis"><i className="fa-solid fa-fire" /></span>
              ) : (
                <span className="lb-extinguished" title="Užgesęs"><i className="fa-solid fa-fire-flame-simple" /></span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
