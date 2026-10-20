import { findAnime, relatedIds, resolveFranchise, suggestAnime } from './api.js'
import { ANIME_REPEATS, MOVIE_REPEATS } from './repeats.js'
import { MOVIE_VERDICTS, SCALES, VERDICTS } from './scoring.js'
import { findMovie, movieRelatedIds, resolveCollection, suggestMovies } from './tmdb.js'

// Where a mode's answers come from. Each source finds and suggests entries as
// { anime, media }, lists the ids a raw `media` is known to share a franchise
// with up front (relatedIds), and walks the full franchise in the background
// (resolve). `scale` and `verdicts` are its scoring (scoring.js); `ownScore`
// scores an entry by its own popularity instead of its franchise's top entry.
export const SOURCES = {
  anilist: {
    find: findAnime,
    suggest: suggestAnime,
    relatedIds,
    resolve: resolveFranchise,
    ownScore: false,
    scale: SCALES.anilist,
    verdicts: VERDICTS,
    what: 'anime',
    unit: 'users',
    repeats: ANIME_REPEATS,
    credit: { name: 'AniList', url: 'https://anilist.co' },
  },
  tmdb: {
    find: findMovie,
    suggest: suggestMovies,
    relatedIds: movieRelatedIds,
    resolve: resolveCollection,
    ownScore: true,
    scale: SCALES.tmdb,
    verdicts: MOVIE_VERDICTS,
    what: 'movie',
    unit: 'votes',
    repeats: MOVIE_REPEATS,
    credit: { name: 'TMDB', url: 'https://www.themoviedb.org' },
  },
}
