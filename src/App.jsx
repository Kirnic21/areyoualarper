import { useEffect, useMemo, useRef, useState } from 'react'
import EntryInput from './EntryInput.jsx'
import TitleScreen from './TitleScreen.jsx'
import VerdictMeter from './VerdictMeter.jsx'
import { useDialog } from './Dialog.jsx'
import Leaderboard from './Leaderboard.jsx'
import { repeatMessage } from './repeats.js'
import { fetchRank, submitScore, supabase } from './supabase.js'
import { TIERS, formatCount, tierFor, totalPoints, verdictFor } from './scoring.js'
import { DEFAULT_MODE, MODES, LEGACY_MODE, LONGEST_TIME_MS, modeFor } from './modes.js'
import { SOURCES } from './sources.js'

const STORAGE_KEY = 'areyoualarper:anilist'
const USERNAME_KEY = 'areyoualarper:username'
const ELAPSED_KEY = 'areyoualarper:elapsed'
const MODE_KEY = 'areyoualarper:mode'

const GAME_KEY = 'areyoualarper:game'
const MY_GAMES_KEY = 'areyoualarper:my-games'

// The current game's id, mode and leaderboard status: { id, mode, submitted, rank }.
function newGameState(mode) {
  return { id: crypto.randomUUID(), mode, submitted: false, rank: null }
}

function loadGame() {
  const saved = loadJSON(GAME_KEY, null)
  return saved ? { mode: LEGACY_MODE, ...saved } : newGameState(DEFAULT_MODE)
}

function loadJSON(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback
  } catch {
    return fallback
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Storage unavailable; this only lasts for the visit.
  }
}

function loadElapsed() {
  try {
    return Math.min(LONGEST_TIME_MS, Number(localStorage.getItem(ELAPSED_KEY)) || 0)
  } catch {
    return 0
  }
}

function formatTime(ms) {
  const total = Math.ceil(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function loadUsername() {
  try {
    return localStorage.getItem(USERNAME_KEY) || ''
  } catch {
    return ''
  }
}

function loadList() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []
    // A lookup interrupted by a reload won't resume; keep what was known.
    return list.map((a) => ({ ...a, resolving: false }))
  } catch {
    return []
  }
}

// Animates a number towards `value` (ease-out), continuing from wherever the
// previous animation got to.
function useCountUp(value, ms = 600) {
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    const start = performance.now()
    const a = from.current
    let raf
    const step = (t) => {
      const p = Math.min(1, (t - start) / ms)
      const v = Math.round(a + (value - a) * (1 - (1 - p) ** 3))
      from.current = v
      setShown(v)
      if (p < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return shown
}

// AniList id -> title of the named anime whose franchise it belongs to.
function claimedBy(list) {
  const map = new Map()
  for (const a of list) {
    for (const id of a.franchiseIds) map.set(id, a.title)
  }
  return map
}

function App() {
  const [list, setList] = useState(loadList)
  const [username, setUsername] = useState(loadUsername)

  useEffect(() => {
    try {
      localStorage.setItem(USERNAME_KEY, username)
    } catch {
      // Storage unavailable; the name lasts for this visit only.
    }
  }, [username])
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    } catch {
      // Storage unavailable (private mode etc.); progress just won't persist.
    }
  }, [list])

  const [screen, setScreen] = useState('title') // 'title' | 'game' | 'leaderboard'
  const [game, setGame] = useState(loadGame)
  const mode = modeFor(game.mode)
  const source = SOURCES[mode.source]
  const goal = mode.goal
  const timeLimit = mode.minutes * 60_000
  // The mode picked on the title screen, for the next new game.
  const [nextMode, setNextMode] = useState(() => {
    const id = loadJSON(MODE_KEY, DEFAULT_MODE)
    return MODES.some((m) => m.id === id) ? id : DEFAULT_MODE
  })
  useEffect(() => saveJSON(MODE_KEY, nextMode), [nextMode])
  const [myGameIds, setMyGameIds] = useState(() => new Set(loadJSON(MY_GAMES_KEY, [])))
  const [submitError, setSubmitError] = useState(false)
  const submitting = useRef(false)

  useEffect(() => saveJSON(GAME_KEY, game), [game])
  useEffect(() => saveJSON(MY_GAMES_KEY, [...myGameIds]), [myGameIds])
  const [dialog, ask] = useDialog()
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState(null) // { kind: 'ok' | 'error' | 'repeat', text }

  // Mirrors `list` synchronously so async checks always see the latest list.
  const listRef = useRef(list)
  function updateList(fn) {
    listRef.current = fn(listRef.current)
    setList(listRef.current)
  }

  // Franchise lookups still running in the background, by anime id.
  const resolving = useRef(new Map())

  // Entries still being checked aren't scored yet; their points land (with a
  // pop) once the franchise is known.
  const scored = list.filter((a) => !a.resolving)
  const score = totalPoints(scored, source.scale)
  const shownScore = useCountUp(score)
  const verdict = verdictFor(scored, source.scale, source.verdicts)

  // Floating "+N" effects over the score.
  const [pops, setPops] = useState([])
  const popId = useRef(0)
  function popScore(popularity) {
    const tier = tierFor(popularity, source.scale)
    const id = ++popId.current
    setPops((prev) => [...prev, { id, tier }])
    setTimeout(() => setPops((prev) => prev.filter((p) => p.id !== id)), 1400)
  }
  const done = list.length >= goal

  // Countdown. Only time spent on the game screen counts; it is saved so a
  // continued game resumes where it left off.
  const [elapsed, setElapsed] = useState(loadElapsed)
  const elapsedRef = useRef(elapsed)
  const remaining = timeLimit - elapsed
  const timeUp = remaining <= 0
  const finished = done || timeUp

  function setElapsedNow(ms) {
    elapsedRef.current = ms
    setElapsed(ms)
    try {
      localStorage.setItem(ELAPSED_KEY, String(ms))
    } catch {
      // Storage unavailable; the clock resets on reload.
    }
  }

  useEffect(() => {
    if (screen !== 'game' || finished) return
    const base = elapsedRef.current
    const startedAt = Date.now()
    const timer = setInterval(() => {
      setElapsedNow(Math.min(timeLimit, base + Date.now() - startedAt))
    }, 250)
    return () => clearInterval(timer)
  }, [screen, finished, timeLimit])

  // Submit a finished game once, after every pick's franchise check settles
  // so the score is final.
  const settled = list.every((a) => !a.resolving)
  async function submit() {
    if (submitting.current) return
    submitting.current = true
    setSubmitError(false)
    try {
      await submitScore({
        gameId: game.id,
        mode: mode.id,
        username,
        score,
        named: list.length,
        timeMs: elapsed,
        verdict: verdict.title,
      })
      const rank = await fetchRank(mode.id, score, elapsed).catch(() => null)
      setGame((g) => ({ ...g, submitted: true, rank }))
      setMyGameIds((ids) => new Set(ids).add(game.id))
    } catch {
      setSubmitError(true)
    } finally {
      submitting.current = false
    }
  }

  useEffect(() => {
    if (finished && settled && list.length > 0 && !game.submitted && supabase && !submitError) submit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, settled, game.submitted])

  // The title of the listed anime whose franchise a raw media node belongs to,
  // or null. Only direct relations are checked, as add() does up front.
  const claimed = useMemo(() => claimedBy(list), [list])
  function namedAs(media) {
    const clash = [media.id, ...source.relatedIds(media)].find((id) => claimed.has(id))
    return clash ? claimed.get(clash) : null
  }

  // Verifies a typed name (or a suggestion, { anime, media }) and adds
  // it. Resolves to 'added', 'duplicate', 'missing' or 'error' (the input
  // clears on the first two).
  async function add(name, picked) {
    setPending(true)
    setNotice(null)
    try {
      const found = picked ?? (await source.find(name))
      if (!found) {
        setNotice({ kind: 'error', text: `No ${source.what} called “${name}”.` })
        return 'missing'
      }
      const { anime, media } = found

      // Earlier franchises must be fully known before checking this one.
      await Promise.allSettled(resolving.current.values())
      const claimed = claimedBy(listRef.current)
      const clash = [anime.id, ...source.relatedIds(media)].find((id) => claimed.has(id))
      if (clash) {
        setNotice({ kind: 'repeat', text: repeatMessage(anime.title, claimed.get(clash), source.repeats) })
        return 'duplicate'
      }
      if (listRef.current.length >= goal) return 'duplicate'

      const entry = { ...anime, franchiseIds: [anime.id, ...source.relatedIds(media)], resolving: true }
      updateList((prev) => [entry, ...prev])
      setNotice({ kind: 'ok', text: `Added ${anime.title}.` })
      checkFranchise(anime, media)
      return 'added'
    } catch {
      setNotice({ kind: 'error', text: `Couldn't reach ${source.credit.name}. Try again in a moment.` })
      return 'error'
    } finally {
      setPending(false)
    }
  }

  // Walks the rest of the franchise in the background, then either scores the
  // entry by its most popular relative (or by itself, for sources that score
  // that way) or drops it if it overlaps another.
  function checkFranchise(anime, media) {
    const { ownScore } = source
    const job = source.resolve(media)
      .then(({ ids, top }) => {
        const others = claimedBy(listRef.current.filter((a) => a.id !== anime.id))
        const clash = ids.find((id) => others.has(id))
        if (clash) {
          updateList((prev) => prev.filter((a) => a.id !== anime.id))
          setNotice({
            kind: 'repeat',
            text: `Removed: ${repeatMessage(anime.title, others.get(clash), source.repeats)}`,
          })
          return
        }
        const franchise = ownScore ? {} : { popularity: top.popularity, franchiseTitle: top.title }
        updateList((prev) =>
          prev.map((a) => (a.id === anime.id ? { ...a, ...franchise, franchiseIds: ids, resolving: false } : a)),
        )
        popScore(ownScore ? anime.popularity : top.popularity)
      })
      .catch(() => {
        // Keep the entry with just its direct relations.
        updateList((prev) => prev.map((a) => (a.id === anime.id ? { ...a, resolving: false } : a)))
        popScore(anime.popularity)
      })
      .finally(() => resolving.current.delete(anime.id))
    resolving.current.set(anime.id, job)
  }

  function remove(id) {
    updateList((prev) => prev.filter((a) => a.id !== id))
  }

  async function reset() {
    const ok = await ask({
      title: 'Start over?',
      message: `Your ${list.length} named ${mode.noun} and ${score} points will be cleared.`,
      confirmLabel: 'Start over',
      danger: true,
    })
    if (ok) {
      updateList(() => [])
      setGame(newGameState(mode.id))
      setSubmitError(false)
      setElapsedNow(0)
      setNotice(null)
    }
  }

  async function newGame() {
    if (list.length > 0) {
      const ok = await ask({
        title: 'Start a new game?',
        message: `Your current ${mode.label} game (${list.length}/${goal}, ${score} points) will be cleared.`,
        confirmLabel: 'New game',
        danger: true,
      })
      if (!ok) return
    }
    updateList(() => [])
    setGame(newGameState(nextMode))
    setSubmitError(false)
    setElapsedNow(0)
    setNotice(null)
    setScreen('game')
  }

  async function share() {
    const counts = TIERS.map((t) => [t, list.filter((a) => tierFor(a.popularity, source.scale) === t).length])
      .filter(([, n]) => n > 0)
      .map(([t, n]) => `${t.label}: ${n}`)
      .join(' · ')
    const time = done ? ` in ${formatTime(elapsed)}` : ''
    const text = `Are You a LARPer? (${mode.label}) ${username} named ${list.length}/${goal} ${mode.noun}${time} for ${score} points — verdict: ${verdict?.title ?? 'none'}.\n${counts}`
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked (e.g. not a secure context): show it to copy by hand.
      ask({
        title: 'Copy your result',
        children: <textarea className="dialog-text" readOnly value={text} onFocus={(e) => e.target.select()} />,
        confirmLabel: 'Done',
        cancelLabel: null,
      })
    }
  }

  if (screen === 'leaderboard') {
    return <Leaderboard myGameIds={myGameIds} initialMode={game.mode} onBack={() => setScreen('title')} />
  }

  if (screen === 'title') {
    return (
      <>
        {dialog}
        <TitleScreen
          mode={mode}
          nextMode={modeFor(nextMode)}
          onNextModeChange={setNextMode}
          named={list.length}
          score={score}
          timeLeft={timeUp ? null : formatTime(remaining)}
          onContinue={() => setScreen('game')}
          onNewGame={newGame}
          onLeaderboard={() => setScreen('leaderboard')}
          username={username}
          onUsernameChange={setUsername}
        />
      </>
    )
  }

  return (
    <div className="app">
      {dialog}
      <header className="game-header">
        <h1>Are You a LARPer?</h1>
        <span className="player">
          {mode.label} · Playing as <b>{username}</b>
        </span>
        <button className="ghost small" onClick={() => setScreen('title')}>
          Menu
        </button>
      </header>

      <section className="scoreboard">
        <div className="stat">
          <span className="stat-value">
            {list.length}
            <small>/{goal}</small>
          </span>
          <span className="stat-label">named</span>
        </div>
        <div className={`stat timer${remaining <= 60_000 && !finished ? ' urgent' : ''}`}>
          <span className="stat-value">{formatTime(Math.max(0, remaining))}</span>
          <span className="stat-label">{timeUp ? "time's up" : done ? 'to spare' : 'left'}</span>
        </div>
        <div className="stat score">
          <span key={score} className="stat-value bump">
            {shownScore}
          </span>
          <span className="stat-label">points</span>
          {pops.map((p) => (
            <span
              key={p.id}
              className={`pop${p.tier.points >= 12 ? ' big' : ''}`}
              style={{ '--tier': p.tier.color }}
              aria-hidden="true"
            >
              +{p.tier.points}
            </span>
          ))}
        </div>
        <VerdictMeter list={scored} scale={source.scale} verdicts={source.verdicts} />
      </section>

      <div className="progress" aria-hidden="true">
        <div style={{ width: `${(list.length / goal) * 100}%` }} />
      </div>

      <EntryInput
        onSubmit={add}
        pending={pending}
        disabled={finished}
        timeUp={timeUp}
        goal={goal}
        what={source.what}
        suggest={source.suggest}
        namedAs={namedAs}
      />
      {notice && (
        <p key={notice.text} className={`notice ${notice.kind}`}>
          {notice.text}
        </p>
      )}

      <ul className="legend">
        {TIERS.map((t) => (
          <li key={t.label}>
            <span className="dot" style={{ background: t.color }} />
            {t.label} <small>+{t.points}</small>
          </li>
        ))}
      </ul>

      {finished && (
        <section className="finished">
          <h2>
            {done
              ? `All ${goal} named with ${formatTime(remaining)} to spare.`
              : `Time's up! You named ${list.length} ${mode.noun}.`}{' '}
            {verdict && `You are: ${verdict.title}`}
          </h2>
          {verdict && <p>{verdict.blurb}</p>}
          {supabase && list.length > 0 && (
            <div className="submit-status">
              {game.submitted ? (
                <span className="notice ok">
                  {game.rank ? `Submitted — you're #${game.rank} on the leaderboard.` : 'Submitted to the leaderboard.'}
                </span>
              ) : submitError ? (
                <>
                  <span className="notice error">Couldn't submit your score.</span>
                  <button className="small" onClick={submit}>
                    Retry
                  </button>
                </>
              ) : (
                <span className="notice">{settled ? 'Submitting…' : 'Finishing franchise checks…'}</span>
              )}
              <button className="ghost small" onClick={() => setScreen('leaderboard')}>
                View leaderboard
              </button>
            </div>
          )}
        </section>
      )}

      {list.length > 0 && (
        <>
          <div className="actions">
            <button onClick={share}>{copied ? 'Copied!' : 'Copy result'}</button>
            <button className="ghost" onClick={reset}>
              Start over
            </button>
          </div>

          <ol className="rows">
            {list.map((a, i) => {
              const tier = tierFor(a.popularity, source.scale)
              return (
                <li key={a.id} className="row" style={{ '--tier': a.resolving ? 'var(--border)' : tier.color }}>
                  <span className="rank">{list.length - i}</span>
                  <a className="thumb" href={a.url} target="_blank" rel="noreferrer">
                    {a.image && <img src={a.image} alt="" loading="lazy" />}
                  </a>
                  <div className="row-body">
                    <strong title={a.altTitle || a.title}>{a.title}</strong>
                    <small
                      title={
                        a.franchiseTitle && a.franchiseIds.length > 1
                          ? `Combined popularity of ${a.franchiseIds.length} related entries; biggest is ${a.franchiseTitle ?? a.title}`
                          : undefined
                      }
                    >
                      {[
                        a.type,
                        a.year,
                        `${formatCount(a.popularity)} ${a.franchiseTitle && a.franchiseIds.length > 1 ? 'franchise' : source.unit}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </small>
                  </div>
                  {a.resolving ? (
                    <span className="tier-badge checking">Checking…</span>
                  ) : (
                    <span key={tier.label} className="tier-badge">
                      {tier.label} <b>+{tier.points}</b>
                    </span>
                  )}
                  <button className="remove" onClick={() => remove(a.id)} aria-label={`Remove ${a.title}`}>
                    ×
                  </button>
                </li>
              )
            })}
          </ol>
        </>
      )}

      <footer>
        Data from <a href={source.credit.url}>{source.credit.name}</a>.
        {mode.source === 'tmdb' && ' This product uses the TMDB API but is not endorsed or certified by TMDB.'}
      </footer>
    </div>
  )
}

export default App
