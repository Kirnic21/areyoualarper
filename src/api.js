const ENDPOINT = 'https://graphql.anilist.co'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// When AniList last asked us to back off; suggestions pause until then so
// they don't eat into the budget for actual answers.
let rateLimitedUntil = 0

// AniList is rate limited (30–90 req/min depending on load); 429s are retried
// after Retry-After.
async function anilist(query, variables, signal, retries = 3) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal,
  })
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After')) || 2
    rateLimitedUntil = Date.now() + retryAfter * 1000
    if (retries > 0) {
      await sleep(retryAfter * 1000)
      return anilist(query, variables, signal, retries - 1)
    }
  }
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.errors) {
    const err = new Error(json.errors?.[0]?.message || `Request failed (${res.status})`)
    err.rateLimited = res.status === 429
    throw err
  }
  return json.data
}

const MEDIA_FIELDS = `
  id
  title { romaji english }
  coverImage { medium }
  format
  seasonYear
  startDate { year }
  popularity
  siteUrl
  relations { edges { relationType node { id type popularity title { romaji english } } } }
`

// AniList's search gives up on any misspelled word and only prefix-matches a
// word on its own, so one request runs several searches (as aliases): the raw
// text, a de-pluralized version, the longest words on their own (so one
// misspelled word doesn't sink the rest) and the longest word cut down to a
// prefix (so a typo near its end doesn't either). The best match is then
// picked locally, with typo tolerance.
export function searchVariants(name) {
  const words = normalize(name).split(' ')
  const longest = words.filter((w) => w.length >= 4).sort((a, b) => b.length - a.length)
  const alone = words.length > 1 ? longest.slice(0, 2) : []
  const prefix = longest[0] && longest[0].slice(0, Math.max(4, Math.ceil(longest[0].length * 0.6)))
  // Spaces left out ("hunterxhunter") leave one long word; a short prefix of
  // it still finds the title.
  const short = words.length === 1 && words[0].length >= 8 ? words[0].slice(0, 5) : null
  return [...new Set([name, words.join(' '), ...alone, prefix, short].filter(Boolean))]
}

function searchQuery(count, perPage = 20) {
  const vars = Array.from({ length: count }, (_, i) => `$q${i}: String`).join(', ')
  const pages = Array.from(
    { length: count },
    (_, i) => `
      p${i}: Page(perPage: ${perPage}) {
        media(search: $q${i}, type: ANIME, isAdult: false, sort: SEARCH_MATCH) { ...M }
      }`,
  ).join('')
  return `
    fragment M on Media {
      ${MEDIA_FIELDS}
      title { native }
      synonyms
    }
    query (${vars}) { ${pages} }
  `
}

// Lowercase, strip accents, apostrophes and punctuation, and drop a trailing
// "s" from words (possessives and plurals), so "JoJo's", "Jojos" and "jojo"
// all compare equal. Applied to both the player's text and the titles.
export function normalize(s) {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .map((w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))
    .join(' ')
}

export const compact = (s) => s.replace(/ /g, '')

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return Infinity
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

// The names a media node goes by, normalized: `titles` (its real titles, and
// their main part before any subtitle) and `synonyms` (user-submitted, so
// less trustworthy: one Steins;Gate special is also listed as "Steins").
function acceptedNames(media) {
  const { english, romaji, native } = media.title
  const titles = [english, romaji, native]
  // Also accept the main title before a subtitle, e.g. "Re:Zero" for
  // "Re:ZERO -Starting Life in Another World-".
  for (const title of [english, romaji]) {
    const main = title?.split(/\s[-–:]|:\s|\s-/)[0]
    if (main && main !== title) titles.push(main)
  }
  const clean = (names) =>
    names
      .filter(Boolean)
      // Ignore qualifiers like "(TV)" or "(2000)".
      .map((n) => normalize(n.replace(/\s*\([^)]*\)\s*$/, '')))
      .filter((n) => n.length > 0)
  return { titles: clean(titles), synonyms: clean(media.synonyms ?? []) }
}

// Every typed word starts a word of `name`, in order, so "mob psycho" matches
// "Mob Psycho 100" and "jojo" matches "JoJo's Bizarre Adventure". Longer typed
// words may have a typo.
function wordsMatch(typed, name) {
  const words = name.split(' ')
  let i = 0
  for (const t of typed) {
    while (i < words.length && !words[i].startsWith(t) && !(t.length >= 5 && editDistance(t, words[i]) <= 1)) i++
    if (i === words.length) return false
    i++
  }
  return true
}

// How well `wanted` (normalized) matches acceptedNames(): 3 exactly a title,
// 2 exactly a synonym or close enough to any name (a typo or two in a longer
// title), 1 a partial name (wordsMatch), 0 no match. With `prefixes`, a name
// that starts with `wanted` (still being typed) also scores 2.
export function matchScore(wanted, { titles, synonyms }, prefixes = false) {
  const target = compact(wanted)
  const names = [...titles, ...synonyms]
  const compacted = names.map(compact)
  if (titles.some((n) => compact(n) === target)) return 3
  if (compacted.includes(target)) return 2
  const allowed = target.length >= 12 ? 2 : target.length >= 8 ? 1 : 0
  if (allowed > 0 && compacted.some((n) => editDistance(target, n) <= allowed)) return 2
  if (prefixes && compacted.some((n) => n.startsWith(target))) return 2
  const typed = wanted.split(' ')
  if (target.length >= 4 && names.some((n) => wordsMatch(typed, n))) return 1
  return 0
}

// Finds the anime the player meant by `name`: exact title matches win over
// near matches and title starts, those over partial titles, and the most
// popular wins among equals. Returns { anime, media } (media is the raw
// AniList node, for resolveFranchise), or null if nothing matches.
export async function findAnime(name, signal) {
  const wanted = normalize(name)
  if (!wanted) return null
  const variants = searchVariants(name)
  const data = await anilist(
    searchQuery(variants.length),
    Object.fromEntries(variants.map((v, i) => [`q${i}`, v])),
    signal,
  )
  let best = null
  let bestScore = 0
  for (const media of Object.values(data).flatMap((page) => page.media)) {
    const score = matchScore(wanted, acceptedNames(media), true)
    if (score > bestScore || (score === bestScore && score > 0 && media.popularity > best.popularity)) {
      best = media
      bestScore = score
    }
  }
  return best && { anime: toAnime(best), media: best }
}

const SUGGESTIONS = 6
const suggestCache = new Map()

// Autocomplete for a partly typed name: up to SUGGESTIONS { anime, media }
// results (the same shape as findAnime), best matches first and the most
// popular first among equals. Results are cached, and nothing is fetched (or
// retried) while AniList is rate limiting.
export async function suggestAnime(text, signal) {
  const wanted = normalize(text)
  if (compact(wanted).length < 2) return []
  if (suggestCache.has(wanted)) return suggestCache.get(wanted)
  if (Date.now() < rateLimitedUntil) return []

  // A short last word is probably still being typed; AniList can miss it.
  const words = wanted.split(' ')
  const variants = searchVariants(text)
  if (words.length > 1 && words.at(-1).length < 3) variants.push(words.slice(0, -1).join(' '))
  const unique = [...new Set(variants)]
  const data = await anilist(
    searchQuery(unique.length, 10),
    Object.fromEntries(unique.map((v, i) => [`q${i}`, v])),
    signal,
    0,
  )

  const seen = new Set()
  const ranked = []
  for (const media of Object.values(data).flatMap((page) => page.media)) {
    if (seen.has(media.id)) continue
    seen.add(media.id)
    const score = matchScore(wanted, acceptedNames(media), true)
    // The extra searches turn up plenty of unrelated shows.
    if (score > 0) ranked.push({ score, media })
  }
  ranked.sort((a, b) => b.score - a.score || b.media.popularity - a.media.popularity)
  const results = ranked.slice(0, SUGGESTIONS).map(({ media }) => ({ anime: toAnime(media), media }))

  if (suggestCache.size > 200) suggestCache.delete(suggestCache.keys().next().value)
  suggestCache.set(wanted, results)
  return results
}

const RELATIONS_QUERY = `
  query ($ids: [Int]) {
    Page(perPage: 50) {
      media(id_in: $ids, type: ANIME) { ${MEDIA_FIELDS} }
    }
  }
`

// Relations that are walked to find the rest of a franchise (seasons, the
// parent of a movie, etc.), and relations that are only marked as belonging to
// it without being walked further (so one show's 30 movies don't fan out).
const WALK = new Set(['SEQUEL', 'PREQUEL', 'PARENT'])
const INCLUDE = new Set([...WALK, 'SIDE_STORY', 'SUMMARY', 'ALTERNATIVE', 'COMPILATION', 'CONTAINS'])
const MAX_LAYERS = 15

// AniList ids directly related to a raw media node (its first franchise layer).
export function relatedIds(media) {
  return media.relations.edges
    .filter(({ relationType, node }) => node.type === 'ANIME' && INCLUDE.has(relationType))
    .map(({ node }) => node.id)
}

// Weight of every entry but the biggest when summing a franchise's
// popularity: their audiences mostly overlap, but a franchise split into many
// entries (JoJo's parts) is still bigger than its largest one.
const EXTRA_ENTRY_WEIGHT = 0.5

// Returns every AniList id in the franchise of the raw media node `seed`, plus
// `top`: the title of its most popular entry and the franchise's combined
// popularity. Fetches one breadth-first layer of the relation graph per
// request; the seed's own relations are already in hand.
export async function resolveFranchise(seed, signal) {
  const popularity = new Map([[seed.id, seed.popularity ?? 0]])
  const titles = new Map()
  const visited = new Set([seed.id])
  let layer = [seed]

  for (let depth = 0; layer.length > 0 && depth < MAX_LAYERS; depth++) {
    const next = []
    for (const media of layer) {
      const anime = toAnime(media)
      popularity.set(anime.id, anime.popularity)
      titles.set(anime.id, anime.title)

      for (const { relationType, node } of media.relations.edges) {
        if (node.type !== 'ANIME' || !INCLUDE.has(relationType)) continue
        if (!popularity.has(node.id)) {
          popularity.set(node.id, node.popularity ?? 0)
          titles.set(node.id, node.title.english || node.title.romaji)
        }
        if (WALK.has(relationType) && !visited.has(node.id)) {
          visited.add(node.id)
          next.push(node.id)
        }
      }
    }
    if (next.length === 0) break
    const data = await anilist(RELATIONS_QUERY, { ids: next.slice(0, 50) }, signal)
    layer = data.Page.media
  }

  const [topId, max] = [...popularity].reduce((a, b) => (b[1] > a[1] ? b : a))
  const sum = [...popularity.values()].reduce((a, b) => a + b, 0)
  return {
    ids: [...popularity.keys()],
    top: { title: titles.get(topId), popularity: Math.round(max + EXTRA_ENTRY_WEIGHT * (sum - max)) },
  }
}

const FORMAT_LABELS = {
  TV: 'TV',
  TV_SHORT: 'TV Short',
  MOVIE: 'Movie',
  SPECIAL: 'Special',
  OVA: 'OVA',
  ONA: 'ONA',
  MUSIC: 'Music',
}

function toAnime(raw) {
  const { english, romaji } = raw.title
  return {
    id: raw.id,
    title: english || romaji,
    altTitle: english && english !== romaji ? romaji : null,
    image: raw.coverImage?.medium,
    type: FORMAT_LABELS[raw.format] ?? raw.format,
    year: raw.seasonYear || raw.startDate?.year || null,
    popularity: raw.popularity ?? 0,
    url: raw.siteUrl,
  }
}
