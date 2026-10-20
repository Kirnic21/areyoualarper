import { useEffect, useRef, useState } from 'react'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Wait this long after the last keystroke before asking AniList for
// suggestions, so fast typists don't burn through the rate limit.
const SUGGEST_DELAY_MS = 250

// Played on the form after each submit (Web Animations, so they restart
// cleanly without remounting the input).
const EFFECTS = {
  ok: {
    keyframes: [
      { boxShadow: '0 0 0 0 rgb(123 213 85 / 0.7)' },
      { boxShadow: '0 0 0 10px rgb(123 213 85 / 0)', offset: 0.6 },
      { boxShadow: '0 0 0 0 rgb(123 213 85 / 0)' },
    ],
    options: { duration: 650, easing: 'ease-out' },
  },
  bad: {
    keyframes: [
      { transform: 'translateX(0)', boxShadow: '0 0 0 2px rgb(232 93 117 / 0.8)' },
      { transform: 'translateX(-8px)' },
      { transform: 'translateX(7px)' },
      { transform: 'translateX(-5px)' },
      { transform: 'translateX(3px)' },
      { transform: 'translateX(0)', boxShadow: '0 0 0 0 rgb(232 93 117 / 0)' },
    ],
    options: { duration: 420, easing: 'ease-out' },
  },
}

// `namedAs(media)` returns the title of the listed anime a suggestion's
// franchise is already claimed by, or null.
// `suggest(text, signal)` resolves to likely matches for what's typed, best
// first; `what` names one answer ("anime", "movie").
function EntryInput({ onSubmit, pending, disabled, timeUp, goal, what, suggest, namedAs }) {
  const [value, setValue] = useState('')
  const [ghost, setGhost] = useState(null) // { id, text } of the last added name
  const ghostId = useRef(0)
  const formRef = useRef(null)
  const inputRef = useRef(null)

  // The most likely match for what's typed, shown in the input; Enter adds it
  // (or searches the typed text when there's none, or it was hidden with
  // Escape).
  const [result, setResult] = useState({ text: '', top: null }) // suggestion and what it was for
  const [dismissed, setDismissed] = useState(false)
  // A suggestion for older text (the new one is still loading) only counts
  // while its title still continues what's typed.
  const continues = (s) => s?.anime.title.toLowerCase().startsWith(value.toLowerCase())
  const current = result.text === value.trim() || continues(result.top) ? result.top : null
  const hint = !pending && !dismissed ? current : null

  // The input is disabled while an answer is checked; refocus afterwards.
  useEffect(() => {
    if (!pending && !disabled) inputRef.current?.focus()
  }, [pending, disabled])

  useEffect(() => {
    const text = value.trim()
    if (text.length < 2 || disabled) {
      setResult({ text: '', top: null })
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      suggest(text, controller.signal)
        .then((list) => setResult({ text, top: list[0] ?? null }))
        .catch(() => {
          // Suggestions are optional; typing and pressing Enter still works.
        })
    }, SUGGEST_DELAY_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [value, disabled, suggest])

  async function handleSubmit(e) {
    e.preventDefault()
    const name = hint ? hint.anime.title : value.trim()
    if (!name || pending) return
    const outcome = await onSubmit(name, hint ?? undefined)
    const kind = outcome === 'added' ? 'ok' : 'bad'
    if (!reducedMotion()) {
      const { keyframes, options } = EFFECTS[kind]
      formRef.current?.animate(keyframes, options)
    }
    if (kind === 'ok') setGhost({ id: ++ghostId.current, text: name })
    if (outcome === 'added' || outcome === 'duplicate') {
      setValue('')
      setDismissed(false)
    }
  }

  const inline = hint && continues(hint)
  const claimer = hint && namedAs(hint.media)

  return (
    <form ref={formRef} className={`entry${pending ? ' checking' : ''}`} onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        type="text"
        placeholder={
          timeUp ? "Time's up!" : disabled ? `All ${goal} named!` : `Type ${what === 'anime' ? 'an' : 'a'} ${what} and press Enter…`
        }
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setDismissed(false)
        }}
        onKeyDown={(e) => e.key === 'Escape' && setDismissed(true)}
        disabled={disabled || pending}
        autoFocus
        autoComplete="off"
        spellCheck="false"
        aria-label="Anime name"
      />
      {inline && (
        <span className="entry-hint" aria-hidden="true">
          <span className="entry-hint-typed">{value}</span>
          {hint.anime.title.slice(value.length)}
        </span>
      )}
      {hint && (!inline || claimer) && (
        <span className="entry-aside" aria-live="polite">
          {!inline && (
            <span>
              → <b>{hint.anime.title}</b>
            </span>
          )}
          {claimer && <span className="entry-named">already named as {claimer}</span>}
        </span>
      )}
      {ghost && (
        <span key={ghost.id} className="entry-ghost" aria-hidden="true" onAnimationEnd={() => setGhost(null)}>
          {ghost.text}
        </span>
      )}
      {pending && <span className="entry-status">Checking…</span>}
    </form>
  )
}

export default EntryInput
