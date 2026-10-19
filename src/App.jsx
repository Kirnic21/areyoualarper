import { useEffect, useRef, useState } from 'react'
import EntryInput from './EntryInput.jsx'
import TitleScreen from './TitleScreen.jsx'
import VerdictMeter from './VerdictMeter.jsx'
import { useDialog } from './Dialog.jsx'
import Leaderboard from './Leaderboard.jsx'
import { repeatMessage } from './repeats.js'
import { fetchRank, submitScore, supabase } from './supabase.js'
import { findAnime, relatedIds, resolveFranchise } from './api.js'
import { TIERS, formatCount, tierFor, totalPoints, verdictFor } from './scoring.js'

const GOAL = 100
const STORAGE_KEY = 'areyoualarper:anilist'
const USERNAME_KEY = 'areyoualarper:username'
const ELAPSED_KEY = 'areyoualarper:elapsed'
const TIME_LIMIT_MS = 15 * 60 * 1000

const GAME_KEY = 'areyoualarper:game'
const MY_GAMES_KEY = 'areyoualarper:my-games'

// The current game's id and leaderboard status: { id, submitted, rank }.
function newGameState() {
  return { id: crypto.randomUUID(), submitted: false, rank: null }
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
    return Math.min(TIME_LIMIT_MS, Number(localStorage.getItem(ELAPSED_KEY)) || 0)
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
  const [game, setGame] = useState(() => loadJSON(GAME_KEY, null) ?? newGameState())
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
  const score = totalPoints(scored)
  const shownScore = useCountUp(score)
  const verdict = verdictFor(scored)

  // Floating "+N" effects over the score.
  const [pops, setPops] = useState([])
  const popId = useRef(0)
  function popScore(popularity) {
    const tier = tierFor(popularity)
    const id = ++popId.current
    setPops((prev) => [...prev, { id, tier }])
    setTimeout(() => setPops((prev) => prev.filter((p) => p.id !== id)), 1400)
  }
  const done = list.length >= GOAL

  // Countdown. Only time spent on the game screen counts; it is saved so a
  // continued game resumes where it left off.
  const [elapsed, setElapsed] = useState(loadElapsed)
  const elapsedRef = useRef(elapsed)
  const remaining = TIME_LIMIT_MS - elapsed
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
      setElapsedNow(Math.min(TIME_LIMIT_MS, base + Date.now() - startedAt))
    }, 250)
    return () => clearInterval(timer)
  }, [screen, finished])

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
        username,
        score,
        named: list.length,
        timeMs: elapsed,
        verdict: verdict.title,
      })
      const rank = await fetchRank(score, elapsed).catch(() => null)
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

  // Verifies a typed name and adds it. Resolves to 'added', 'duplicate',
  // 'missing' or 'error' (the input clears on the first two).
  async function add(name) {
    setPending(true)
    setNotice(null)
    try {
      const found = await findAnime(name)
      if (!found) {
        setNotice({ kind: 'error', text: `No anime called “${name}”.` })
        return 'missing'
      }
      const { anime, media } = found

      // Earlier franchises must be fully known before checking this one.
      await Promise.allSettled(resolving.current.values())
      const claimed = claimedBy(listRef.current)
      const clash = [anime.id, ...relatedIds(media)].find((id) => claimed.has(id))
      if (clash) {
        setNotice({ kind: 'repeat', text: repeatMessage(anime.title, claimed.get(clash)) })
        return 'duplicate'
      }
      if (listRef.current.length >= GOAL) return 'duplicate'

      const entry = { ...anime, franchiseIds: [anime.id, ...relatedIds(media)], resolving: true }
      updateList((prev) => [entry, ...prev])
      setNotice({ kind: 'ok', text: `Added ${anime.title}.` })
      checkFranchise(anime, media)
      return 'added'
    } catch {
      setNotice({ kind: 'error', text: `Couldn't reach AniList. Try again in a moment.` })
      return 'error'
    } finally {
      setPending(false)
    }
  }

  // Walks the rest of the franchise in the background, then either scores the
  // entry by its most popular relative or drops it if it overlaps another.
  function checkFranchise(anime, media) {
    const job = resolveFranchise(media)
      .then(({ ids, top }) => {
        const others = claimedBy(listRef.current.filter((a) => a.id !== anime.id))
        const clash = ids.find((id) => others.has(id))
        if (clash) {
          updateList((prev) => prev.filter((a) => a.id !== anime.id))
          setNotice({ kind: 'repeat', text: `Removed: ${repeatMessage(anime.title, others.get(clash))}` })
          return
        }
        updateList((prev) =>
          prev.map((a) =>
            a.id === anime.id
              ? { ...a, popularity: top.popularity, franchiseIds: ids, franchiseTitle: top.title, resolving: false }
              : a,
          ),
        )
        popScore(top.popularity)
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
      message: `Your ${list.length} named anime and ${score} points will be cleared.`,
      confirmLabel: 'Start over',
      danger: true,
    })
    if (ok) {
      updateList(() => [])
      setGame(newGameState())
      setSubmitError(false)
      setElapsedNow(0)
      setNotice(null)
    }
  }

  async function newGame() {
    if (list.length > 0) {
      const ok = await ask({
        title: 'Start a new game?',
        message: `Your current list (${list.length}/${GOAL}, ${score} points) will be cleared.`,
        confirmLabel: 'New game',
        danger: true,
      })
      if (!ok) return
    }
    updateList(() => [])
    setGame(newGameState())
    setSubmitError(false)
    setElapsedNow(0)
    setNotice(null)
    setScreen('game')
  }

  async function share() {
    const counts = TIERS.map((t) => [t, list.filter((a) => tierFor(a.popularity) === t).length])
      .filter(([, n]) => n > 0)
      .map(([t, n]) => `${t.label}: ${n}`)
      .join(' · ')
    const time = done ? ` in ${formatTime(elapsed)}` : ''
    const text = `Are You a LARPer? ${username} named ${list.length}/${GOAL} anime${time} for ${score} points — verdict: ${verdict?.title ?? 'none'}.\n${counts}`
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
    return <Leaderboard myGameIds={myGameIds} onBack={() => setScreen('title')} />
  }

  if (screen === 'title') {
    return (
      <>
        {dialog}
        <TitleScreen
          goal={GOAL}
          minutes={TIME_LIMIT_MS / 60_000}
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
          Playing as <b>{username}</b>
        </span>
        <button className="ghost small" onClick={() => setScreen('title')}>
          Menu
        </button>
      </header>

      <section className="scoreboard">
        <div className="stat">
          <span className="stat-value">
            {list.length}
            <small>/{GOAL}</small>
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
        <VerdictMeter list={scored} />
      </section>

      <div className="progress" aria-hidden="true">
        <div style={{ width: `${(list.length / GOAL) * 100}%` }} />
      </div>

      <EntryInput onSubmit={add} pending={pending} disabled={finished} timeUp={timeUp} />
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
              ? `All ${GOAL} named with ${formatTime(remaining)} to spare.`
              : `Time's up! You named ${list.length} anime.`}{' '}
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
              const tier = tierFor(a.popularity)
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
                        a.franchiseIds.length > 1
                          ? `Combined popularity of ${a.franchiseIds.length} related entries; biggest is ${a.franchiseTitle ?? a.title}`
                          : undefined
                      }
                    >
                      {[
                        a.type,
                        a.year,
                        `${formatCount(a.popularity)} ${a.franchiseIds.length > 1 && !a.resolving ? 'franchise' : 'users'}`,
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
        Data from <a href="https://anilist.co">AniList</a>.
      </footer>
    </div>
  )
}

export default App
