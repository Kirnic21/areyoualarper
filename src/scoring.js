// Obscurity tiers, most popular first.
export const TIERS = [
  { label: 'Mainstream', points: 1, color: '#8ba0b2' },
  { label: 'Popular', points: 2, color: '#3db4f2' },
  { label: 'Known', points: 4, color: '#7bd555' },
  { label: 'Niche', points: 7, color: '#f7bf63' },
  { label: 'Obscure', points: 12, color: '#e85d75' },
  { label: 'Deep cut', points: 20, color: '#9256f3' },
]

// The minimum popularity for each tier: AniList users with an anime on their
// list, or TMDB votes on a movie.
export const SCALES = {
  anilist: [500_000, 200_000, 75_000, 20_000, 3_000, 0],
  tmdb: [15_000, 5_000, 1_500, 300, 30, 0],
}

export function tierFor(popularity, scale = SCALES.anilist) {
  return TIERS[scale.findIndex((min) => popularity >= min)]
}

// The highest possible average: every pick a deep cut.
export const MAX_AVERAGE = Math.max(...TIERS.map((t) => t.points))

// Verdict by average points per entry named, as a share of MAX_AVERAGE,
// highest first: VERDICTS for anime, MOVIE_VERDICTS for movies.
export const VERDICTS = [
  {
    min: MAX_AVERAGE * 0.5,
    title: 'Chud',
    color: '#9256f3',
    blurb: 'You have seen things no one should have seen. Go outside.',
  },
  { min: MAX_AVERAGE * 0.2, title: 'Weeb', color: '#3db4f2', blurb: 'You actually watch anime. Respect.' },
  { min: 0, title: 'LARPer', color: '#8ba0b2', blurb: 'You have watched three anime and a lot of TikTok edits.' },
]

export const MOVIE_VERDICTS = [
  {
    min: MAX_AVERAGE * 0.5,
    title: 'English teacher',
    color: '#9256f3',
    blurb: 'You have strong opinions about Tarkovsky and assign subtitles as homework.',
  },
  { min: MAX_AVERAGE * 0.2, title: 'Unemployed', color: '#3db4f2', blurb: 'Nobody with a job has seen this many movies.' },
  { min: 0, title: 'LARPer', color: '#8ba0b2', blurb: 'You have seen every Marvel movie and called it a personality.' },
]

export function averagePoints(list, scale) {
  return list.length === 0 ? 0 : totalPoints(list, scale) / list.length
}

export function verdictFor(list, scale, verdicts = VERDICTS) {
  if (list.length === 0) return null
  const avg = averagePoints(list, scale)
  return verdicts.find((v) => avg >= v.min)
}

export function totalPoints(list, scale) {
  return list.reduce((sum, a) => sum + tierFor(a.popularity, scale).points, 0)
}

export function formatCount(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${Math.round(n / 1_000)}k`
  return String(n)
}
