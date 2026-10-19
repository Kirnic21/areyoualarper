// Teasing messages for naming something already counted. `a` is what was
// typed (as matched), `b` is the anime already on the list it collides with.

const SAME = [
  (a) => `You already said ${a}. Repeating yourself won't make you less of a LARPer.`,
  (a) => `${a}? Again? We heard you the first time.`,
  (a) => `${a} is already on your list. Running out of anime already?`,
  (a) => `Déjà vu. ${a} is already counted.`,
  (a) => `Saying ${a} twice doesn't double the points.`,
  (a) => `${a} again. Is that the only anime you've seen?`,
]

const FRANCHISE = [
  (a, b) => `${a} is just more ${b}. Seasons don't count twice, nice try.`,
  (a, b) => `Nice try. ${a} is part of ${b}, which you already named.`,
  (a, b) => `${a}? That's ${b} wearing a fake mustache.`,
  (a, b) => `Sequels aren't new anime. ${a} belongs to ${b}.`,
  (a, b) => `${b} already covers ${a}. Name something else.`,
  (a, b) => `Padding the list with ${b} spin-offs? ${a} doesn't count.`,
]

let last = null

// Picks a random message, never the same one twice in a row.
export function repeatMessage(typed, existing) {
  const pool = typed === existing ? SAME : FRANCHISE
  let pick
  do {
    pick = pool[Math.floor(Math.random() * pool.length)]
  } while (pick === last && pool.length > 1)
  last = pick
  return pick(typed, existing)
}
