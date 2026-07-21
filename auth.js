/* eslint-disable */
'use strict';
/* ============================================================
   auth.js — Supabase client, accounts, profile sync, leaderboard data

   OWNS (defined here, used elsewhere):
     sb, ONLINE, player, guest, submitAuth, initAuth, syncChip,
     submitScore, syncProfile/pushProfile/mergeRemoteProfile,
     board, boardTab, boardHits, openBoard, fetchBoard
   USES (defined in other files, resolved at runtime):
     S, state, mode (game.js) — read inside handlers at runtime;
     save, score, persist() (game.js); fetch happens post-load only
   Load order (index.html): data.js → auth.js → game.js → ui.js
   All top-level declarations are shared globals (no bundler).
   ============================================================ */

// ==================================================================
//  ONLINE: Supabase (accounts + leaderboard)
//  1) Paste your project's values below
//     (Supabase dashboard → Project Settings → API):
// ==================================================================
const SUPABASE_URL = 'https://cprgkndxzkpwmoiutkei.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_tFV7QtDbO714RZ5fRjqIZQ_NYSWcxJX'; // the sb_publishable_... key

// Usernames are mapped to fake emails internally, since Supabase auth is email-based.
const AUTH_EMAIL_DOMAIN = '@flappykari.app';

const ONLINE = /^https:\/\/.+\.supabase\.co/.test(SUPABASE_URL)
  && SUPABASE_ANON_KEY.length > 40
  && !!window.supabase;
const sb = ONLINE ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let player = null;   // { id, name } when signed in
let guest = false;

const authOverlay = document.getElementById('auth-overlay');
const authUser = document.getElementById('auth-user');
const authPass = document.getElementById('auth-pass');
const authMsgEl = document.getElementById('auth-msg');
const authBtn = document.getElementById('auth-btn');
const authGuestBtn = document.getElementById('auth-guest');
const chipEl = document.getElementById('user-chip');
const chipName = document.getElementById('chip-name');
const chipLogout = document.getElementById('chip-logout');

function authMsg(text, ok = false) {
  authMsgEl.textContent = text;
  authMsgEl.className = ok ? 'ok' : '';
}

let chipShown = null;
function syncChip() {
  const want = !!player && state !== S.PLAYING && authOverlay.hidden;
  if (want !== chipShown) {
    chipShown = want;
    chipEl.hidden = !want;
    if (want) chipName.textContent = '👤 ' + player.name;
  }
}

async function submitAuth() {
  const name = authUser.value.trim();
  const pass = authPass.value;
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) { authMsg('Emri: 3–16 shkronja, numra ose _'); return; }
  if (pass.length < 6) { authMsg('Fjalëkalimi: të paktën 6 karaktere'); return; }
  const email = name.toLowerCase() + AUTH_EMAIL_DOMAIN;
  authBtn.disabled = true;
  authMsg('Duke u lidhur…', true);
  try {
    let session = null;
    const login = await sb.auth.signInWithPassword({ email, password: pass });
    if (!login.error) {
      session = login.data.session;
    } else {
      // Username unknown (or wrong password) → try creating the account
      const reg = await sb.auth.signUp({
        email,
        password: pass,
        options: { data: { username: name } }
      });
      if (reg.error) {
        authMsg(/already|exists/i.test(reg.error.message)
          ? 'Fjalëkalim i gabuar për këtë emër'
          : reg.error.message);
        authBtn.disabled = false;
        return;
      }
      if (!reg.data.session) {
        authMsg('Te Supabase → Authentication çaktivizo "Confirm email"');
        authBtn.disabled = false;
        return;
      }
      session = reg.data.session;
    }
    const u = session.user;
    player = { id: u.id, name: (u.user_metadata && u.user_metadata.username) || name };
    guest = false;
    authPass.value = '';
    authMsg('');
    authOverlay.hidden = true;
    // Anything earned as a guest is discarded: reload this device's saved copy,
    // then merge with the account stored on the server.
    resetSave();
    loadSave();
    syncProfile();
    if (state === S.BOARD) fetchBoard(boardTab);
  } catch (e) {
    authMsg("S'u lidh dot me serverin — provo prapë");
  }
  authBtn.disabled = false;
}

authBtn.addEventListener('click', submitAuth);
const enterSubmits = e => { if (e.key === 'Enter') submitAuth(); };
authUser.addEventListener('keydown', enterSubmits);
authPass.addEventListener('keydown', enterSubmits);
authGuestBtn.addEventListener('click', () => {
  guest = true;
  resetSave();          // guests start clean and save nothing (game.js)
  authOverlay.hidden = true;
});
chipLogout.addEventListener('click', async () => {
  if (sb) { try { await sb.auth.signOut(); } catch (e) {} }
  player = null;
  guest = false;
  resetSave();          // don't leave this account's progress on screen
  if (state === S.PLAYING) state = S.START;
  authOverlay.hidden = false;
});

async function initAuth() {
  if (!ONLINE) return; // keys not filled in yet → game runs fully offline, like before
  try {
    const { data } = await sb.auth.getSession();
    if (data && data.session) {
      const u = data.session.user;
      player = { id: u.id, name: (u.user_metadata && u.user_metadata.username) || 'lojtar' };
      syncProfile();
    } else {
      authOverlay.hidden = false;
    }
  } catch (e) { /* can't reach server → let them play offline */ }
}

function submitScore() {
  if (!sb || !player || score <= 0) return;
  if (mode !== 'std') return; // leaderboard tracks endless (Standard) runs only
  sb.from('scores')
    .insert({ user_id: player.id, username: player.name, score, level: save.level })
    .then(() => {}, () => {});
}

// ---------- Profile sync (skins, skills, coins, level) ----------
function mergeRemoteProfile(p) {
  if (!p) return;
  if (Array.isArray(p.skins))  for (const s of p.skins)  if (!save.skins.includes(s))  save.skins.push(s);
  if (Array.isArray(p.skills)) for (const s of p.skills) if (!save.skills.includes(s)) save.skills.push(s);
  if (typeof p.coins === 'number') save.coins = Math.max(save.coins, p.coins);
  if (typeof p.level === 'number') save.level = Math.max(save.level, p.level);
}

async function syncProfile() {
  if (!sb || !player) return;
  try {
    const { data, error } = await sb.from('profiles')
      .select('skins,skills,coins,level')
      .eq('user_id', player.id)
      .maybeSingle();
    if (error) throw error;
    mergeRemoteProfile(data);
    persist(); // saves merged result locally AND pushes it back up
  } catch (e) { /* unreachable server → local save keeps working as before */ }
}

let pushT = null;
function pushProfile() {
  if (!sb || !player) return; // guests / offline: local-only, same as before
  clearTimeout(pushT);
  pushT = setTimeout(() => {
    sb.from('profiles').upsert({
      user_id: player.id,
      skins: save.skins,
      skills: save.skills,
      coins: save.coins,
      level: save.level
    }).then(() => {}, () => {});
    // Backfill: stamp the account's current level onto ALL of this player's
    // score rows, so old records show the right level too.
    // (Needs the scores UPDATE policy — see the SQL in the chat.)
    sb.from('scores').update({ level: save.level })
      .eq('user_id', player.id)
      .then(() => {}, () => {});
  }, 800);
}

// ---------- Leaderboard data ----------
let boardTab = 'daily';   // 'daily' | 'life'
let boardHits = [];
const board = {
  daily: { rows: null, status: 'idle' },
  life:  { rows: null, status: 'idle' }
};

function openBoard() {
  state = S.BOARD;
  fetchBoard(boardTab);
}

async function fetchBoard(tab) {
  if (!sb) { board[tab].status = 'offline'; return; }
  board[tab].status = 'loading';
  try {
    let q = sb.from('scores')
      .select('user_id,username,score,level')
      .order('score', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(100);
    if (tab === 'daily') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      q = q.gte('created_at', d.toISOString());
    }
    const { data, error } = await q;
    if (error) throw error;
    // best score per player only
    const seen = new Set(), rows = [];
    for (const r of data) {
      if (seen.has(r.user_id)) continue;
      seen.add(r.user_id);
      rows.push(r);
      if (rows.length >= 10) break;
    }
    // Level shown is the player's CURRENT account level, not the level stored
    // on that old score row — so passing a level updates all their records.
    try {
      const ids = rows.map(r => r.user_id);
      if (ids.length) {
        const { data: lv } = await sb.from('player_levels')
          .select('user_id,level')
          .in('user_id', ids);
        if (lv) {
          const byId = {};
          for (const p of lv) byId[p.user_id] = p.level;
          for (const r of rows) if (byId[r.user_id] != null) r.level = byId[r.user_id];
        }
      }
    } catch (e) { /* falls back to the level stored on the score row */ }
    board[tab].rows = rows;
    board[tab].status = 'ok';
  } catch (e) {
    board[tab].status = 'error';
  }
}
// ================== end online block ==================
