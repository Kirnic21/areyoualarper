const ENDPOINT = 'https://graphql.anilist.co'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// AniList is rate limited (30–90 req/min depending on load); 429s are retried
// after Retry-After.
async function anilist(query, variables, signal, retries = 3) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal,
  })
  if (res.status === 429 && retries > 0) {
    const retryAfter = Number(res.headers.get('Retry-After')) || 2
    await sleep(retryAfter * 1000)
    return anilist(query, variables, signal, retries - 1)
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
// text, a de-pluralized version, and the longest words cut down to a prefix.
// The best match is then picked locally, with typo tolerance.
function searchVariants(name) {
  const words = normalize(name).split(' ')
  const prefixes = words
    .filter((w) => w.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 3)
    .map((w) => w.slice(0, Math.max(4, Math.ceil(w.length * 0.6))))
  // Spaces left out ("hunterxhunter") leave one long word; a short prefix of
  // it still finds the title.
  if (words.length === 1 && words[0].length >= 8) prefixes.push(words[0].slice(0, 5))
  return [...new Set([name, words.join(' '), ...prefixes])]
}

function searchQuery(count) {
  const vars = Array.from({ length: count }, (_, i) => `$q${i}: String`).join(', ')
  const pages = Array.from(
    { length: count },
    (_, i) => `
      p${i}: Page(perPage: 20) {
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

const compact = (s) => s.replace(/ /g, '')

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

function acceptedNames(media) {
  const { english, romaji, native } = media.title
  const names = [english, romaji, native, ...(media.synonyms ?? [])]
    .filter(Boolean)
    // Ignore qualifiers like "(TV)" or "(2000)".
    .map((n) => n.replace(/\s*\([^)]*\)\s*$/, ''))
  // Also accept the main title before a subtitle, e.g. "Re:Zero" for
  // "Re:ZERO -Starting Life in Another World-".
  for (const title of [english, romaji]) {
    const main = title?.split(/\s[-–:]|:\s|\s-/)[0]
    if (main && main !== title) names.push(main)
  }
  return names.map((n) => compact(normalize(n))).filter((n) => n.length > 0)
}

// How well `wanted` (normalized, compacted) matches a name: 2 exact, 1 close
// enough (a typo or two in a longer title), 0 no match.
function matchScore(wanted, names) {
  if (names.includes(wanted)) return 2
  const allowed = wanted.length >= 16 ? 2 : wanted.length >= 8 ? 1 : 0
  if (allowed > 0 && names.some((n) => editDistance(wanted, n) <= allowed)) return 1
  return 0
}

// Finds the anime the player meant by `name`: exact title matches win over
// near matches, and the most popular wins among equals. Returns
// { anime, media } (media is the raw AniList node, for resolveFranchise), or
// null if nothing matches.
export async function findAnime(name, signal) {
  const wanted = compact(normalize(name))
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
    const score = matchScore(wanted, acceptedNames(media))
    if (score > bestScore || (score === bestScore && score > 0 && media.popularity > best.popularity)) {
      best = media
      bestScore = score
    }
  }
  return best && { anime: toAnime(best), media: best }
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
