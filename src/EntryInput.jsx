import { useEffect, useRef, useState } from 'react'

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

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

function EntryInput({ onSubmit, pending, disabled }) {
  const [value, setValue] = useState('')
  const [ghost, setGhost] = useState(null) // { id, text } of the last added name
  const ghostId = useRef(0)
  const formRef = useRef(null)
  const inputRef = useRef(null)

  // The input is disabled while an answer is checked; refocus afterwards.
  useEffect(() => {
    if (!pending && !disabled) inputRef.current?.focus()
  }, [pending, disabled])

  async function handleSubmit(e) {
    e.preventDefault()
    const name = value.trim()
    if (!name || pending) return
    const result = await onSubmit(name)
    const kind = result === 'added' ? 'ok' : 'bad'
    if (!reducedMotion()) {
      const { keyframes, options } = EFFECTS[kind]
      formRef.current?.animate(keyframes, options)
    }
    if (kind === 'ok') setGhost({ id: ++ghostId.current, text: name })
    if (result === 'added' || result === 'duplicate') setValue('')
  }

  return (
    <form ref={formRef} className={`entry${pending ? ' checking' : ''}`} onSubmit={handleSubmit}>
      <input
        ref={inputRef}
        type="text"
        placeholder={disabled ? 'All 100 named!' : 'Type an anime and press Enter…'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={disabled || pending}
        autoFocus
        autoComplete="off"
        spellCheck="false"
        aria-label="Anime name"
      />
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
