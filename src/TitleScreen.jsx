import { TIERS } from './scoring.js'

function TitleScreen({ goal, named, score, onContinue, onNewGame }) {
  const hasSave = named > 0

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
          <b>Name {goal} anime</b> — type a title and press Enter.
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

      <div className="title-actions">
        {hasSave ? (
          <>
            <button className="start" onClick={onContinue} autoFocus>
              Continue <small>{named}/{goal} · {score} pts</small>
            </button>
            <button className="ghost" onClick={onNewGame}>
              New game
            </button>
          </>
        ) : (
          <button className="start" onClick={onNewGame} autoFocus>
            Start
          </button>
        )}
      </div>

      <p className="title-foot">
        Popularity data from <a href="https://anilist.co">AniList</a>.
      </p>
    </div>
  )
}

export default TitleScreen
