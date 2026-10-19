import { useEffect, useRef, useState } from 'react'
import EntryInput from './EntryInput.jsx'
import TitleScreen from './TitleScreen.jsx'
import VerdictMeter from './VerdictMeter.jsx'
import { useDialog } from './Dialog.jsx'
import { findAnime, relatedIds, resolveFranchise } from './api.js'
import { TIERS, formatCount, tierFor, totalPoints, verdictFor } from './scoring.js'

const GOAL = 100
const STORAGE_KEY = 'areyoualarper:anilist'

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
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
    } catch {
      // Storage unavailable (private mode etc.); progress just won't persist.
    }
  }, [list])

  const [screen, setScreen] = useState('title') // 'title' | 'game'
  const [dialog, ask] = useDialog()
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState(null) // { kind: 'ok' | 'error', text }

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
        setNotice({ kind: 'error', text: `Already counted — ${anime.title} is part of ${claimed.get(clash)}.` })
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
          setNotice({ kind: 'error', text: `Removed ${anime.title} — it's part of ${others.get(clash)}.` })
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
    if (ok) updateList(() => [])
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
    setNotice(null)
    setScreen('game')
  }

  async function share() {
    const counts = TIERS.map((t) => [t, list.filter((a) => tierFor(a.popularity) === t).length])
      .filter(([, n]) => n > 0)
      .map(([t, n]) => `${t.label}: ${n}`)
      .join(' · ')
    const text = `Are You a LARPer? I named ${list.length}/${GOAL} anime for ${score} points — verdict: ${verdict.title}.\n${counts}`
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

  if (screen === 'title') {
    return (
      <>
        {dialog}
        <TitleScreen
          goal={GOAL}
          named={list.length}
          score={score}
          onContinue={() => setScreen('game')}
          onNewGame={newGame}
        />
      </>
    )
  }

  return (
    <div className="app">
      {dialog}
      <header className="game-header">
        <h1>Are You a LARPer?</h1>
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

      <EntryInput onSubmit={add} pending={pending} disabled={done} />
      {notice && <p className={`notice ${notice.kind}`}>{notice.text}</p>}

      <ul className="legend">
        {TIERS.map((t) => (
          <li key={t.label}>
            <span className="dot" style={{ background: t.color }} />
            {t.label} <small>+{t.points}</small>
          </li>
        ))}
      </ul>

      {done && (
        <section className="finished">
          <h2>All {GOAL} named. You are: {verdict.title}</h2>
          <p>{verdict.blurb}</p>
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
