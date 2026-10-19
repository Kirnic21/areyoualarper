import { TIERS } from './scoring.js'

function TitleScreen({ goal, minutes, named, score, timeLeft, onContinue, onNewGame, onLeaderboard, username, onUsernameChange }) {
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

      <p className="kicker">The anime obscurity test</p>
      <h1 className="title-logo">
        Are You a <span>LARPer?</span>
      </h1>
      <p className="title-sub">Anyone can say they watch anime. Prove it.</p>

      <ol className="rules">
        <li>
          <b>
            Name {goal} anime in {minutes} minutes
          </b> — type a title and press Enter.
        </li>
        <li>
          <b>One per franchise.</b> Seasons, movies and spin-off OVAs don't count twice.
        </li>
        <li>
          <b>The more obscure, the more points.</b> Mainstream hits are worth almost nothing.
        </li>
      </ol>

      <ul className="title-tiers">
        {TIERS.map((t) => (
          <li key={t.label} style={{ '--tier': t.color }}>
            <span>{t.label}</span>
            <b>+{t.points}</b>
          </li>
        ))}
      </ul>

      <form className="title-form" onSubmit={handleSubmit}>
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
                  {named}/{goal} · {score} pts{timeLeft && ` · ${timeLeft} left`}
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
        Popularity data from <a href="https://anilist.co">AniList</a>.
      </p>
    </div>
  )
}

export default TitleScreen
