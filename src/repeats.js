// Teasing messages for naming something already counted. `a` is what was
// typed (as matched), `b` is the entry already on the list it collides with.

export const ANIME_REPEATS = {
  same: [
    (a) => `You already said ${a}. Repeating yourself won't make you less of a LARPer.`,
    (a) => `${a}? Again? We heard you the first time.`,
    (a) => `${a} is already on your list. Running out of anime already?`,
    (a) => `Déjà vu. ${a} is already counted.`,
    (a) => `Saying ${a} twice doesn't double the points.`,
    (a) => `${a} again. Is that the only anime you've seen?`,
  ],
  franchise: [
    (a, b) => `${a} is just more ${b}. Seasons don't count twice, nice try.`,
    (a, b) => `Nice try. ${a} is part of ${b}, which you already named.`,
    (a, b) => `${a}? That's ${b} wearing a fake mustache.`,
    (a, b) => `Sequels aren't new anime. ${a} belongs to ${b}.`,
    (a, b) => `${b} already covers ${a}. Name something else.`,
    (a, b) => `Padding the list with ${b} spin-offs? ${a} doesn't count.`,
  ],
}

export const MOVIE_REPEATS = {
  same: [
    (a) => `You already said ${a}. Rewatching doesn't count.`,
    (a) => `${a}? Again? We heard you the first time.`,
    (a) => `${a} is already on your list. Running out of movies already?`,
    (a) => `Déjà vu. ${a} is already counted.`,
    (a) => `${a} again. Is that the only movie you've seen?`,
  ],
  franchise: [
    (a, b) => `${a} is the same series as ${b}. Sequels don't count twice.`,
    (a, b) => `Nice try. ${a} is part of the same franchise as ${b}.`,
    (a, b) => `${a}? That's ${b} with a bigger budget.`,
    (a, b) => `Sequels aren't new movies. ${a} belongs with ${b}.`,
    (a, b) => `${b} already covers ${a}. Name something else.`,
  ],
}

let last = null

// Picks a random message from `pools`, never the same one twice in a row.
export function repeatMessage(typed, existing, pools = ANIME_REPEATS) {
  const pool = typed === existing ? pools.same : pools.franchise
  let pick
  do {
    pick = pool[Math.floor(Math.random() * pool.length)]
  } while (pick === last && pool.length > 1)
  last = pick
  return pick(typed, existing)
}
