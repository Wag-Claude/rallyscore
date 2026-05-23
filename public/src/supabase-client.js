// ============================================================
// RallyScore — Supabase Client + Helpers
// Imported by all HTML pages via <script type="module">
// ============================================================
//
// Setup:
// 1. Replace the two constants below with your real Supabase project values
//    (Settings → API in your Supabase dashboard).
// 2. For Vercel deployment, replace these with build-time env injection
//    or use a serverless route to expose them safely.
//
// The anon key is safe to ship to the browser — it is rate-limited
// and respects Row Level Security. NEVER ship the service_role key.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

// ---- Config ----------------------------------------------------------------
// Replace these with the values from Settings → API in your Supabase project.
// You can also set window.__RALLYSCORE_CONFIG__ before this script loads
// (see the inline boot block in each HTML page).
const CONFIG = window.__RALLYSCORE_CONFIG__ || {
  SUPABASE_URL: 'https://vasmvjhxpgfxitvadndh.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_vZjergeml_5fTODHt-KApA_hMR2-Y6y',
  STRIPE_PUBLISHABLE_KEY: 'YOUR_STRIPE_PUBLISHABLE_KEY_HERE', // optional
  STRIPE_FAMILY_PRICE_ID: 'price_xxx_family_monthly',         // optional
  STRIPE_FAMILY_YEARLY_PRICE_ID: 'price_xxx_family_yearly',   // optional
};

const isConfigured =
  CONFIG.SUPABASE_URL && !CONFIG.SUPABASE_URL.includes('YOUR_') &&
  CONFIG.SUPABASE_ANON_KEY && !CONFIG.SUPABASE_ANON_KEY.includes('YOUR_');

if (!isConfigured) {
  console.warn(
    '%c[RallyScore] Supabase not configured.',
    'background:#FF4D2E;color:white;padding:4px 8px;border-radius:4px;font-weight:bold',
    '\nSet SUPABASE_URL and SUPABASE_ANON_KEY in src/supabase-client.js or via window.__RALLYSCORE_CONFIG__.'
  );
}

export const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true, // handles magic link redirects
    storage: window.localStorage,
  },
  realtime: { params: { eventsPerSecond: 10 } },
});

export const config = CONFIG;
export const isBackendConfigured = isConfigured;

// ---- Auth helpers ----------------------------------------------------------
export async function getUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}

export async function getProfile() {
  const user = await getUser();
  if (!user) return null;
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  return data;
}

export async function signInWithMagicLink(email, redirectTo) {
  return supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirectTo || window.location.href }
  });
}

export async function signOut() {
  await supabase.auth.signOut();
}

export function onAuthChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => callback(session?.user || null, event));
}

// ---- Subscription / paywall helpers ---------------------------------------
export async function getActiveSubscription() {
  const user = await getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', user.id)
    .in('status', ['trialing', 'active'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function hasProAccess() {
  const sub = await getActiveSubscription();
  return !!sub;
}

// ---- Helpers ---------------------------------------------------------------
// Wrap any promise with a hard timeout so the UI never freezes forever if
// Supabase or the network gets stuck. Returns null (or default) on timeout.
function withTimeout(promise, ms = 6000, label = 'query') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`[Supabase] ${label} timed out after ${ms}ms`)), ms)
    )
  ]);
}

// ---- Match helpers ---------------------------------------------------------
export async function getLiveMatches() {
  try {
    const { data } = await withTimeout(
      supabase
        .from('matches')
        .select('*')
        .eq('status', 'live')
        .order('stream_started_at', { ascending: false }),
      6000,
      'getLiveMatches'
    );
    return data || [];
  } catch (e) {
    console.warn(e.message);
    return [];
  }
}

export async function getMatch(matchId) {
  try {
    const { data } = await withTimeout(
      supabase.from('matches').select('*').eq('id', matchId).single(),
      6000,
      'getMatch'
    );
    return data;
  } catch (e) {
    console.warn(e.message);
    return null;
  }
}

export async function getMatchPoints(matchId, limit = 50) {
  const { data } = await supabase
    .from('points')
    .select('*')
    .eq('match_id', matchId)
    .order('scored_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function getMatchSets(matchId) {
  const { data } = await supabase
    .from('match_sets')
    .select('*')
    .eq('match_id', matchId)
    .order('set_number');
  return data || [];
}

export async function scorePoint({ matchId, team, playerId = null, playerName = null, playType = null }) {
  const { data, error } = await supabase.rpc('score_point', {
    p_match_id: matchId,
    p_team: team,
    p_player_id: playerId,
    p_player_name: playerName,
    p_play_type: playType,
  });
  if (error) throw error;
  return data;
}

export async function undoLastPoint(matchId) {
  const { error } = await supabase.rpc('undo_last_point', { p_match_id: matchId });
  if (error) throw error;
}

// ---- Realtime subscriptions -----------------------------------------------
// Subscribe to a single match's live updates (score, points, sets).
// Returns an unsubscribe function.
export function subscribeToMatch(matchId, handlers = {}) {
  const channel = supabase
    .channel(`match:${matchId}`)
    .on('postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'matches', filter: `id=eq.${matchId}` },
      (payload) => handlers.onMatchUpdate?.(payload.new))
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'points', filter: `match_id=eq.${matchId}` },
      (payload) => handlers.onPointScored?.(payload.new))
    .on('postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'points', filter: `match_id=eq.${matchId}` },
      (payload) => handlers.onPointUndone?.(payload.old))
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'match_sets', filter: `match_id=eq.${matchId}` },
      (payload) => handlers.onSetCompleted?.(payload.new))
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `match_id=eq.${matchId}` },
      (payload) => handlers.onChatMessage?.(payload.new))
    .subscribe();

  return () => supabase.removeChannel(channel);
}

// Subscribe to a user's notifications.
export function subscribeToNotifications(userId, onNotification) {
  const channel = supabase
    .channel(`notifs:${userId}`)
    .on('postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => onNotification(payload.new))
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ---- Followed players ------------------------------------------------------
export async function getFollowedPlayers(userId) {
  const { data } = await supabase
    .from('player_follows')
    .select('*, player:players(*, team:teams(*, club:clubs(*)))')
    .eq('user_id', userId);
  return data || [];
}

export async function getPlayerStats(playerId) {
  const { data } = await supabase
    .from('points')
    .select('play_type, scored_at')
    .eq('player_id', playerId)
    .order('scored_at', { ascending: false });
  if (!data) return { points: 0, aces: 0, blocks: 0, attacks: 0 };
  return {
    points: data.length,
    aces: data.filter(p => p.play_type === 'ace').length,
    blocks: data.filter(p => p.play_type === 'block').length,
    attacks: data.filter(p => p.play_type === 'attack' || p.play_type === 'kill').length,
  };
}

// ---- Helpful UX --------------------------------------------------------------
export function showAuthBanner() {
  if (isConfigured) return;
  const banner = document.createElement('div');
  banner.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; z-index: 9999;
    background: #FF4D2E; color: white; padding: 10px 16px;
    font-family: 'Inter', system-ui, sans-serif; font-size: 13px;
    text-align: center; font-weight: 600;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  `;
  banner.innerHTML = `⚠ Backend not configured. Edit <code>src/supabase-client.js</code> with your Supabase URL + anon key. <a href="docs/SETUP.md" style="color:white;text-decoration:underline;margin-left:8px">Setup guide</a>`;
  document.body.appendChild(banner);
}

// Auto-show banner if loaded standalone
if (!isConfigured && document.readyState !== 'loading') {
  showAuthBanner();
} else if (!isConfigured) {
  document.addEventListener('DOMContentLoaded', showAuthBanner);
}
