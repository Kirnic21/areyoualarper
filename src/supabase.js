import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// Null when the keys aren't set (see .env.example); the leaderboard then
// shows as unavailable and the game still works offline.
const configured = url && key && !url.includes('your-project-ref')
export const supabase = configured ? createClient(url, key) : null

export const LEADERBOARD_SIZE = 50

export async function submitScore({ gameId, username, score, named, timeMs, verdict }) {
  if (!supabase) return
  const { error } = await supabase.from('scores').insert({
    game_id: gameId,
    username,
    score,
    named,
    time_ms: Math.round(timeMs),
    verdict,
  })
  // 23505: unique violation, i.e. this game was already submitted.
  if (error && error.code !== '23505') throw error
}

// Best scores first; ties go to the faster run.
export async function fetchLeaderboard() {
  if (!supabase) throw new Error('Leaderboard not configured')
  const { data, error } = await supabase
    .from('scores')
    .select('game_id, username, score, named, time_ms, verdict, created_at')
    .order('score', { ascending: false })
    .order('time_ms', { ascending: true })
    .limit(LEADERBOARD_SIZE)
  if (error) throw error
  return data
}

// 1-based position a score would have on the full board.
export async function fetchRank(score, timeMs) {
  if (!supabase) return null
  const { count, error } = await supabase
    .from('scores')
    .select('id', { count: 'exact', head: true })
    .or(`score.gt.${score},and(score.eq.${score},time_ms.lt.${Math.round(timeMs)})`)
  if (error) throw error
  return count + 1
}
