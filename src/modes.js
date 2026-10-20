import { tmdbConfigured } from './tmdb.js'

// What to name, and where answers come from (see sources.js). Movies needs a
// TMDB key, so it's left out without one.
export const CATEGORIES = [
  { id: 'anime', label: 'Anime', noun: 'anime', source: 'anilist' },
  { id: 'movies', label: 'Movies', noun: 'movies', source: 'tmdb' },
].filter((c) => c.source !== 'tmdb' || tmdbConfigured)

export const DIFFICULTIES = [
  { id: 'normal', label: 'Normal' },
  { id: 'hard', label: 'Hard' },
]

// Game modes: a category at a difficulty, with how many to name and how long
// there is to do it. Each has its own leaderboard (the `mode` column in
// supabase/schema.sql); the anime ids predate categories.
const RULES = [
  { id: 'normal', category: 'anime', difficulty: 'normal', goal: 50, minutes: 10 },
  { id: 'hard', category: 'anime', difficulty: 'hard', goal: 100, minutes: 15 },
  { id: 'movies', category: 'movies', difficulty: 'normal', goal: 25, minutes: 10 },
  { id: 'movies-hard', category: 'movies', difficulty: 'hard', goal: 50, minutes: 15 },
]

export const MODES = RULES.flatMap((rules) => {
  const category = CATEGORIES.find((c) => c.id === rules.category)
  if (!category) return []
  const difficulty = DIFFICULTIES.find((d) => d.id === rules.difficulty)
  return [{ ...rules, noun: category.noun, source: category.source, label: `${category.label} · ${difficulty.label}` }]
})

export function findMode(category, difficulty) {
  return MODES.find((m) => m.category === category && m.difficulty === difficulty)
}

export const DEFAULT_MODE = 'normal'

// Games saved before modes existed were all 100 anime in 15 minutes.
export const LEGACY_MODE = 'hard'

// Unknown ids (or a mode that isn't available here) fall back to the legacy
// mode.
export function modeFor(id) {
  return MODES.find((m) => m.id === id) ?? MODES.find((m) => m.id === LEGACY_MODE)
}

export const LONGEST_TIME_MS = Math.max(...MODES.map((m) => m.minutes)) * 60_000
