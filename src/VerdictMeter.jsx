import { MAX_AVERAGE, VERDICTS, averagePoints, verdictFor } from './scoring.js'

// Verdicts lowest first, each spanning from its threshold to the next one.
const SEGMENTS = [...VERDICTS].reverse().map((v, i, all) => ({
  ...v,
  max: all[i + 1]?.min ?? MAX_AVERAGE,
}))

function VerdictMeter({ list }) {
  const verdict = verdictFor(list)
  const avg = averagePoints(list)
  const next = SEGMENTS.find((s) => s.min > avg)
  const position = Math.min(100, (avg / MAX_AVERAGE) * 100)

  return (
    <div className="stat verdict" style={{ '--verdict': verdict?.color ?? 'var(--muted)' }}>
      <span className="stat-value">{verdict ? verdict.title : '—'}</span>
      <span className="stat-label">{verdict ? verdict.blurb : 'Start naming to get judged.'}</span>

      <div className="meter" aria-hidden="true">
        {SEGMENTS.map((s) => (
          <div
            key={s.title}
            className={`meter-seg${s.title === verdict?.title ? ' current' : ''}`}
            style={{ flexGrow: s.max - s.min, '--seg': s.color }}
            title={`${s.title}: ${s.min}+ avg`}
          />
        ))}
        {verdict && <div className="meter-marker" style={{ left: `${position}%` }} />}
      </div>

      <span className="meter-caption">
        {verdict
          ? `avg ${avg.toFixed(1)} pts${next ? ` · ${(next.min - avg).toFixed(1)} to ${next.title}` : ' · maxed out'}`
          : `avg needed: ${SEGMENTS.slice(1)
              .map((s) => `${s.title} ${s.min}`)
              .join(' · ')}`}
      </span>
    </div>
  )
}

export default VerdictMeter
