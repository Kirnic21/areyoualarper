import { CATEGORIES, DIFFICULTIES, findMode } from './modes.js'
import { tmdbConfigured } from './tmdb.js'

// A row of radio options ({ id, label, detail? }) styled as cards.
function Choice({ legend, options, value, onChange }) {
  return (
    <fieldset className="mode-picker">
      <legend>{legend}</legend>
      {options.map((o) => (
        <label key={o.id} className={o.id === value ? 'selected' : undefined}>
          <input
            type="radio"
            name={legend}
            value={o.id}
            checked={o.id === value}
            onChange={() => onChange(o.id)}
          />
          <b>{o.label}</b>
          {o.detail && <small>{o.detail}</small>}
        </label>
      ))}
    </fieldset>
  )
}

// `mode` is the saved game's mode; `nextMode` the one picked for a new game.
function TitleScreen({
  mode,
  nextMode,
  onNextModeChange,
  named,
  score,
  timeLeft,
  onContinue,
  onNewGame,
  onLeaderboard,
  username,
  onUsernameChange,
}) {
  const hasSave = named > 0
  const hasName = username.trim().length > 0

  // Enter in the name field does the main action.
  function handleSubmit(e) {
    e.preventDefault()
    if (!hasName) return
    onUsernameChange(username.trim())
    if (hasSave) onContinue()
    else onNewGame()
  }

  return (
    <div className="title-screen">
      <div className="title-glow" aria-hidden="true" />

      <h1 className="title-logo">
        Are You a <span>LARPer?</span>
      </h1>
      <p className="title-sub">
        Name {nextMode.goal} {nextMode.noun} in {nextMode.minutes} minutes. The more obscure, the more points.
      </p>

      <form className="title-form" onSubmit={handleSubmit}>
        {CATEGORIES.length > 1 && (
          <Choice
            legend="Category"
            options={CATEGORIES.map((c) => ({ id: c.id, label: c.label }))}
            value={nextMode.category}
            onChange={(category) => onNextModeChange(findMode(category, nextMode.difficulty).id)}
          />
        )}
        <Choice
          legend="Difficulty"
          options={DIFFICULTIES.map((d) => {
            const m = findMode(nextMode.category, d.id)
            return { id: d.id, label: d.label, detail: `${m.goal} ${m.noun} · ${m.minutes} min` }
          })}
          value={nextMode.difficulty}
          onChange={(difficulty) => onNextModeChange(findMode(nextMode.category, difficulty).id)}
        />

        <label className="name-field">
          <span>Your name</span>
          <input
            type="text"
            value={username}
            onChange={(e) => onUsernameChange(e.target.value)}
            placeholder="Pick a username"
            maxLength={20}
            autoComplete="nickname"
            spellCheck="false"
            autoFocus={!hasName}
          />
        </label>

        <div className="title-actions">
          {hasSave ? (
            <>
              <button type="submit" className="start" disabled={!hasName} autoFocus={hasName}>
                {timeLeft ? 'Continue' : 'See results'}{' '}
                <small>
                  {mode.label} · {named}/{mode.goal} · {score} pts{timeLeft && ` · ${timeLeft} left`}
                </small>
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  onUsernameChange(username.trim())
                  onNewGame()
                }}
                disabled={!hasName}
              >
                New game
              </button>
            </>
          ) : (
            <button type="submit" className="start" disabled={!hasName} autoFocus={hasName}>
              Start
            </button>
          )}
        </div>
      </form>

      <button type="button" className="link-button" onClick={onLeaderboard}>
        🏆 Leaderboard
      </button>

      <p className="title-foot">
        Popularity data from <a href="https://anilist.co">AniList</a>
        {tmdbConfigured && (
          <>
            {' '}
            and <a href="https://www.themoviedb.org">TMDB</a>. This product uses the TMDB API but is not endorsed or
            certified by TMDB
          </>
        )}
        .
      </p>
    </div>
  )
}

export default TitleScreen
