import { useEffect, useState } from 'react'
import { LEADERBOARD_SIZE, fetchLeaderboard, supabase } from './supabase.js'
import { VERDICTS } from './scoring.js'

const verdictColor = (title) => VERDICTS.find((v) => v.title === title)?.color ?? 'var(--muted)'

function formatTime(ms) {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function Leaderboard({ myGameIds, onBack }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(supabase ? null : 'The leaderboard isn’t set up yet.')

  useEffect(() => {
    if (!supabase) return
    fetchLeaderboard()
      .then(setRows)
      .catch(() => setError('Couldn’t load the leaderboard. Try again in a moment.'))
  }, [])

  return (
    <div className="app leaderboard">
      <header className="game-header">
        <h1>Leaderboard</h1>
        <button className="ghost small" onClick={onBack}>
          Back
        </button>
      </header>

      <p className="tagline">Top {LEADERBOARD_SIZE} finished runs. Ties go to the faster run.</p>

      {error && <p className="notice error">{error}</p>}
      {!error && !rows && <p className="notice">Loading…</p>}
      {rows && rows.length === 0 && <p className="notice">No scores yet. Be the first.</p>}

      {rows && rows.length > 0 && (
        <ol className="board">
          {rows.map((r, i) => (
            <li
              key={r.game_id}
              className={`board-row${myGameIds.has(r.game_id) ? ' mine' : ''}${i < 3 ? ` podium-${i + 1}` : ''}`}
            >
              <span className="board-rank">{i + 1}</span>
              <span className="board-name">{r.username}</span>
              <span className="board-verdict" style={{ color: verdictColor(r.verdict) }}>
                {r.verdict}
              </span>
              <span className="board-meta">
                {r.named}/100 · {formatTime(r.time_ms)}
              </span>
              <span className="board-score">{r.score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export default Leaderboard
