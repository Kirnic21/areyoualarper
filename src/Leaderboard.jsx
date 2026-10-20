import { useEffect, useState } from 'react'
import { LEADERBOARD_SIZE, fetchLeaderboard, supabase } from './supabase.js'
import { MOVIE_VERDICTS, VERDICTS } from './scoring.js'
import { CATEGORIES, DIFFICULTIES, findMode, modeFor } from './modes.js'

const verdictColor = (title) => [...VERDICTS, ...MOVIE_VERDICTS].find((v) => v.title === title)?.color ?? 'var(--muted)'

function formatTime(ms) {
  const total = Math.round(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

// A row of tab buttons ({ id, label, detail? }).
function Tabs({ options, value, onChange }) {
  return (
    <div className="mode-tabs" role="tablist">
      {options.map((o) => (
        <button
          key={o.id}
          role="tab"
          aria-selected={o.id === value}
          className={`small${o.id === value ? '' : ' ghost'}`}
          onClick={() => onChange(o.id)}
        >
          {o.label} {o.detail && <small>{o.detail}</small>}
        </button>
      ))}
    </div>
  )
}

function Leaderboard({ myGameIds, initialMode, onBack }) {
  const [mode, setMode] = useState(() => modeFor(initialMode))
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(supabase ? null : 'The leaderboard isn’t set up yet.')

  useEffect(() => {
    if (!supabase) return
    let current = true
    setRows(null)
    setError(null)
    fetchLeaderboard(mode.id)
      .then((data) => current && setRows(data))
      .catch(() => current && setError('Couldn’t load the leaderboard. Try again in a moment.'))
    return () => {
      current = false
    }
  }, [mode])

  return (
    <div className="app leaderboard">
      <header className="game-header">
        <h1>Leaderboard</h1>
        <button className="ghost small" onClick={onBack}>
          Back
        </button>
      </header>

      {CATEGORIES.length > 1 && (
        <Tabs
          options={CATEGORIES}
          value={mode.category}
          onChange={(category) => setMode(findMode(category, mode.difficulty))}
        />
      )}
      <Tabs
        options={DIFFICULTIES.map((d) => {
          const m = findMode(mode.category, d.id)
          return { id: d.id, label: d.label, detail: `${m.goal} in ${m.minutes} min` }
        })}
        value={mode.difficulty}
        onChange={(difficulty) => setMode(findMode(mode.category, difficulty))}
      />

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
                {r.named}/{mode.goal} · {formatTime(r.time_ms)}
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
