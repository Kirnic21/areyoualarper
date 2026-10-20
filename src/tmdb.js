import { compact, matchScore, normalize, searchVariants } from './api.js'

const KEY = import.meta.env.VITE_TMDB_API_KEY

// The Movies mode is hidden when no key is set (see .env.example).
export const tmdbConfigured = Boolean(KEY) && !KEY.includes('your-')

// Accepts either kind of TMDB credential: a v3 API key (sent as a query
// parameter) or a v4 read access token (a long JWT, sent as a bearer token).
async function tmdb(path, params, signal) {
  const bearer = KEY.length > 40
  const query = new URLSearchParams(bearer ? params : { ...params, api_key: KEY })
  const res = await fetch(`https://api.themoviedb.org/3${path}?${query}`, {
    headers: bearer ? { Authorization: `Bearer ${KEY}` } : {},
    signal,
  })
  if (!res.ok) throw new Error(`TMDB request failed (${res.status})`)
  return res.json()
}

async function search(variants, signal) {
  const pages = await Promise.all(
    variants.map((query) => tmdb('/search/movie', { query, include_adult: 'false' }, signal)),
  )
  const seen = new Set()
  return pages
    .flatMap((page) => page.results)
    .filter((movie) => !seen.has(movie.id) && seen.add(movie.id))
}

const ARTICLE = /^(the|a|an) /

// The names a movie goes by, in the shape matchScore expects: its title and
// original title, and as weaker matches the same without a leading "The" (so
// "the room" means The Room, not Room) and the main part before a subtitle
// ("Dune" for "Dune: Part Two"; many near-empty entries share that with a
// famous film, e.g. "Shawshank: The Redeeming Feature").
function acceptedNames(movie) {
  const full = [movie.title, movie.original_title].filter(Boolean).map(normalize)
  const mains = [movie.title, movie.original_title]
    .map((title) => title?.split(/:\s|\s[-–]\s/)[0])
    .filter((main, i) => main && main !== [movie.title, movie.original_title][i])
    .map(normalize)
  const withoutArticle = (names) => names.map((n) => n.replace(ARTICLE, ''))
  const clean = (names) => [...new Set(names)].filter((n) => n.length > 0)
  return {
    titles: clean(full),
    synonyms: clean([...withoutArticle(full), ...mains, ...withoutArticle(mains)]),
  }
}

// How much a tenfold vote count is worth against one step of match quality:
// TMDB has thousands of near-empty entries whose titles match what people
// type exactly, so "interstelar" should still mean Interstellar.
const VOTES_WEIGHT = 0.5

// Best first; unrelated results (score 0) are dropped.
function rank(wanted, movies) {
  return movies
    .map((movie) => ({ movie, score: matchScore(wanted, acceptedNames(movie), true) }))
    .filter(({ score }) => score > 0)
    .map(({ movie, score }) => ({ movie, weight: score + VOTES_WEIGHT * Math.log10((movie.vote_count ?? 0) + 1) }))
    .sort((a, b) => b.weight - a.weight)
    .map(({ movie }) => ({ anime: toMovie(movie), media: movie }))
}

// Finds the movie the player meant by `name`, the same way (and in the same
// { anime, media } shape) as findAnime.
export async function findMovie(name, signal) {
  const wanted = normalize(name)
  if (!wanted) return null
  return rank(wanted, await search(searchVariants(name), signal))[0] ?? null
}

const SUGGESTIONS = 6
const suggestCache = new Map()

// Autocomplete for a partly typed title, like suggestAnime.
export async function suggestMovies(text, signal) {
  const wanted = normalize(text)
  if (compact(wanted).length < 2) return []
  if (suggestCache.has(wanted)) return suggestCache.get(wanted)

  // A short last word is probably still being typed; TMDB can miss it.
  const words = wanted.split(' ')
  const variants = searchVariants(text)
  if (words.length > 1 && words.at(-1).length < 3) variants.push(words.slice(0, -1).join(' '))
  const results = rank(wanted, await search([...new Set(variants)], signal)).slice(0, SUGGESTIONS)

  if (suggestCache.size > 200) suggestCache.delete(suggestCache.keys().next().value)
  suggestCache.set(wanted, results)
  return results
}

// Ids a movie's franchise is known by without another request: just its own
// (search results don't say which collection a movie is in).
export function movieRelatedIds() {
  return []
}

// A movie's "franchise" is its TMDB collection (e.g. every Harry Potter film),
// which only the details endpoint has. Same result shape as resolveFranchise.
export async function resolveCollection(movie, signal) {
  const details = await tmdb(`/movie/${movie.id}`, {}, signal)
  const collection = details.belongs_to_collection
  return {
    ids: collection ? [movie.id, `collection:${collection.id}`] : [movie.id],
    top: { title: collection?.name ?? movie.title, popularity: movie.vote_count ?? 0 },
  }
}

function toMovie(raw) {
  return {
    id: raw.id,
    title: raw.title,
    altTitle: raw.original_title && raw.original_title !== raw.title ? raw.original_title : null,
    image: raw.poster_path ? `https://image.tmdb.org/t/p/w92${raw.poster_path}` : null,
    type: 'Movie',
    year: Number(raw.release_date?.slice(0, 4)) || null,
    popularity: raw.vote_count ?? 0,
    url: `https://www.themoviedb.org/movie/${raw.id}`,
  }
}
