import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// Null when the keys aren't set (see .env.example); the leaderboard then
// shows as unavailable and the game still works offline.
const configured = url && key && !url.includes('your-project-ref')
export const supabase = configured ? createClient(url, key) : null

export const LEADERBOARD_SIZE = 50

export async function submitScore({ gameId, mode, username, score, named, timeMs, verdict }) {
  if (!supabase) return
  const { error } = await supabase.from('scores').insert({
    game_id: gameId,
    mode,
    username,
    score,
    named,
    time_ms: Math.round(timeMs),
    verdict,
  })
  // 23505: unique violation, i.e. this game was already submitted.
  if (error && error.code !== '23505') throw error
}

// Best scores in a mode first; ties go to the faster run.
export async function fetchLeaderboard(mode) {
  if (!supabase) throw new Error('Leaderboard not configured')
  const { data, error } = await supabase
    .from('scores')
    .select('game_id, username, score, named, time_ms, verdict, created_at')
    .eq('mode', mode)
    .order('score', { ascending: false })
    .order('time_ms', { ascending: true })
    .limit(LEADERBOARD_SIZE)
  if (error) throw error
  return data
}

// 1-based position a score would have on the mode's full board.
export async function fetchRank(mode, score, timeMs) {
  if (!supabase) return null
  const { count, error } = await supabase
    .from('scores')
    .select('id', { count: 'exact', head: true })
    .eq('mode', mode)
    .or(`score.gt.${score},and(score.eq.${score},time_ms.lt.${Math.round(timeMs)})`)
  if (error) throw error
  return count + 1
}
