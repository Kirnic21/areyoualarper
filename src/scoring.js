// Obscurity tiers by AniList popularity (users with it on their list), most popular first.
export const TIERS = [
  { min: 500_000, label: 'Mainstream', points: 1, color: '#8ba0b2' },
  { min: 200_000, label: 'Popular', points: 2, color: '#3db4f2' },
  { min: 75_000, label: 'Known', points: 4, color: '#7bd555' },
  { min: 20_000, label: 'Niche', points: 7, color: '#f7bf63' },
  { min: 3_000, label: 'Obscure', points: 12, color: '#e85d75' },
  { min: 0, label: 'Deep cut', points: 20, color: '#9256f3' },
]

export function tierFor(popularity) {
  return TIERS.find((t) => popularity >= t.min)
}

// The highest possible average: every pick a deep cut.
export const MAX_AVERAGE = Math.max(...TIERS.map((t) => t.points))

// Verdict by average points per anime named, as a share of MAX_AVERAGE,
// highest first.
export const VERDICTS = [
  {
    min: MAX_AVERAGE * 0.9,
    title: 'Chud',
    color: '#9256f3',
    blurb: 'You have seen things no one should have seen. Go outside.',
  },
  { min: MAX_AVERAGE * 0.5, title: 'Weeb', color: '#3db4f2', blurb: 'You actually watch anime. Respect.' },
  { min: 0, title: 'LARPer', color: '#8ba0b2', blurb: 'You have watched three anime and a lot of TikTok edits.' },
]

export function averagePoints(list) {
  return list.length === 0 ? 0 : totalPoints(list) / list.length
}

export function verdictFor(list) {
  if (list.length === 0) return null
  const avg = averagePoints(list)
  return VERDICTS.find((v) => avg >= v.min)
}

export function totalPoints(list) {
  return list.reduce((sum, a) => sum + tierFor(a.popularity).points, 0)
}

export function formatCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}
