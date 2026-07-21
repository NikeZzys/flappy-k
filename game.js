/* eslint-disable */
'use strict';
/* ============================================================
   game.js — core mechanics: physics, pipes, coins, skills, input, update loop

   OWNS (defined here, used elsewhere):
     canvas/ctx, resize(), save + loadSave()/persist(), ownsSkill,
     sounds (snd*), S, state, all run-state vars, mode/curLevel/levelHits,
     reset()/spawnPipe(), skills, tryBuyOrEquip(), flap(), die(), update()
   USES (defined in other files, resolved at runtime):
     GAME_W/GAME_H, constants, SHOP_*, LEVELS (data.js);
     pushProfile()/submitScore()/syncChip()/authOverlay (auth.js);
     drawLevels()… only via ui.js at render time
   Load order (index.html): data.js → auth.js → game.js → ui.js
   All top-level declarations are shared globals (no bundler).
   ============================================================ */

// ---------- Canvas setup ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let scale = 1;

function resize() {
  const maxW = window.innerWidth;
  const maxH = window.innerHeight;
  scale = Math.min(maxW / GAME_W, maxH / GAME_H, 2.2);
  canvas.width = GAME_W * scale * devicePixelRatio;
  canvas.height = GAME_H * scale * devicePixelRatio;
  canvas.style.width = GAME_W * scale + 'px';
  canvas.style.height = GAME_H * scale + 'px';
  ctx.setTransform(scale * devicePixelRatio, 0, 0, scale * devicePixelRatio, 0, 0);
}
window.addEventListener('resize', resize);
resize();

// ---------- Fullscreen toggle ----------
const fsBtn = document.getElementById('fs-btn');
const fsTarget = document.documentElement;
const fsSupported = !!(fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen);
if (!fsSupported) fsBtn.hidden = true; // e.g. iPhone Safari has no Fullscreen API
const fsActive = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
fsBtn.addEventListener('click', e => {
  e.stopPropagation();
  try {
    if (!fsActive()) (fsTarget.requestFullscreen || fsTarget.webkitRequestFullscreen).call(fsTarget);
    else (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  } catch (err) {}
});
function fsChanged() {
  fsBtn.textContent = fsActive() ? '⤡' : '⛶';
  fsBtn.setAttribute('aria-label', fsActive() ? 'Exit fullscreen' : 'Fullscreen');
  setTimeout(resize, 120);
}
document.addEventListener('fullscreenchange', fsChanged);
document.addEventListener('webkitfullscreenchange', fsChanged);

// Mobile: nudge the address bar to collapse on load (for users who don't tap ⛶)
function collapseAddressBar() {
  if (!('ontouchstart' in window) || fsActive()) return;
  const de = document.documentElement;
  de.style.overflow = 'auto';
  document.body.style.overflow = 'auto';
  de.style.height = (window.innerHeight + 80) + 'px';
  window.scrollTo(0, 1);
  setTimeout(() => {
    de.style.overflow = '';
    document.body.style.overflow = '';
    de.style.height = '';
    window.scrollTo(0, 0);
    resize();
  }, 350);
}
window.addEventListener('load', collapseAddressBar);
window.addEventListener('orientationchange', () => setTimeout(collapseAddressBar, 250));

// ---------- Persistent save (localStorage) ----------
const SAVE_KEY = 'flappyKari.save.v2';
const OLD_KEY = 'flappyBledi.save.v1';
const SKIN_MIGRATE = { photo: 'bledi', gold: 'bruni', shadow: 'miri' };
const save = {
  best: 0,
  coins: 0,
  skins: ['classic'],
  skills: [],
  skin: 'classic',
  level: 0            // highest completed level (0 = none yet)
};
let storageOk = true;
function loadSave() {
  try {
    let raw = localStorage.getItem(SAVE_KEY);
    if (!raw) raw = localStorage.getItem(OLD_KEY);   // migrate old saves
    if (raw) {
      const d = JSON.parse(raw);
      if (typeof d.best === 'number') save.best = d.best;
      if (typeof d.coins === 'number') save.coins = d.coins;
      if (Array.isArray(d.skins)) save.skins = d.skins.map(s => SKIN_MIGRATE[s] || s);
      if (Array.isArray(d.skills)) save.skills = d.skills;
      if (typeof d.skin === 'string') save.skin = SKIN_MIGRATE[d.skin] || d.skin;
      if (typeof d.level === 'number') save.level = d.level;
    }
  } catch (e) { storageOk = false; }
  if (!save.skins.includes('classic')) save.skins.push('classic');
  if (!save.skins.includes(save.skin)) save.skin = 'classic';
}
// Wipe progress back to defaults — used when going guest / logging out,
// so one player's data never leaks into another session.
function resetSave() {
  save.best = 0;
  save.coins = 0;
  save.skins = ['classic'];
  save.skills = [];
  save.skin = 'classic';
  save.level = 0;
}
function persist() {
  // GUESTS SAVE NOTHING: no localStorage, no server. Progress lives only in
  // memory for the current session and disappears on refresh.
  if (typeof player === 'undefined' || !player) return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); }
  catch (e) { storageOk = false; }
  pushProfile(); // owned by auth.js — syncs the account copy
}
loadSave();

const ownsSkill = id => save.skills.includes(id);

// ---------- Difficulty scaling (never stops getting harder) ----------
function pipeSpeed() {
  // ×0.75 of previous speed: base 150 → 112.5, cap 330 → 247.5
  return (Math.min(150 + score * 2.4, 330) + Math.max(0, score - 75) * 0.15) * 0.75;
}
function gapForScore() {
  // ×1.15 of previous gap: base 158 → 181.7, floor 112 → 128.8
  return Math.max(112, 158 - score * 0.8) * 1.15;
}
function movingPipeChance() {
  return 0; // pipes are static now (was up to 65% after score 20)
}
function moveAmp() {
  return Math.min(42, 10 + (score - 20) * 0.6);
}

// ---------- Sound (WebAudio, no files) ----------
let audioCtx = null, muted = false;
const muteBtn = document.getElementById('mute-btn');
muteBtn.addEventListener('click', e => {
  e.stopPropagation();
  muted = !muted;
  muteBtn.textContent = muted ? '🔇' : '🔊';
});
function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}
function beep(freq, dur, type = 'square', vol = 0.15, slideTo = null) {
  if (muted || !audioCtx) return;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, audioCtx.currentTime);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, audioCtx.currentTime + dur);
  g.gain.setValueAtTime(vol, audioCtx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
  o.connect(g).connect(audioCtx.destination);
  o.start();
  o.stop(audioCtx.currentTime + dur);
}
const sndFlap  = () => beep(500, 0.09, 'square', 0.10, 780);
const sndPoint = () => { beep(880, 0.08, 'sine', 0.18); setTimeout(() => beep(1320, 0.10, 'sine', 0.16), 70); };
const sndCrash = () => beep(260, 0.35, 'sawtooth', 0.22, 60);
const sndPick  = () => beep(660, 0.07, 'sine', 0.15, 990);
const sndDeny  = () => beep(220, 0.15, 'square', 0.12, 140);
const sndCoin  = () => { beep(1200, 0.06, 'square', 0.12, 1600); setTimeout(() => beep(1600, 0.08, 'square', 0.1, 2000), 50); };
const sndBuy   = () => { beep(700, 0.1, 'triangle', 0.2, 900); setTimeout(() => beep(1100, 0.15, 'triangle', 0.2, 1400), 100); };
const sndReady = () => { beep(520, 0.1, 'triangle', 0.2, 1040); setTimeout(() => beep(1040, 0.15, 'triangle', 0.18, 1560), 90); };
const sndShield = () => beep(400, 0.35, 'sine', 0.18, 1200);
const sndRevive = () => { beep(300, 0.15, 'triangle', 0.2, 600); setTimeout(() => beep(600, 0.2, 'triangle', 0.2, 1200), 130); setTimeout(() => beep(1200, 0.25, 'triangle', 0.18, 1800), 280); };
const sndBoom  = () => {
  beep(120, 0.4, 'sawtooth', 0.28, 40);
  beep(1800, 0.15, 'square', 0.12, 300);
  setTimeout(() => beep(90, 0.3, 'sawtooth', 0.2, 30), 60);
};

// ---------- Game state ----------
const S = { START: 0, PLAYING: 1, DEAD: 2, MENU: 3, BOARD: 4, LEVELS: 5, WIN: 6 };
let state = S.START;
let menuTab = 'skins';
let menuHits = [];
let shopMsg = '', shopMsgT = 0;

let bird, pipes, coinsArr, score, groundX, cloudX, time, deathFlash, puffs, newBest;
let skillCh, debris, banner, shake, beam, readyPop, shieldT, runCoins;

// ---------- Levels: run state & flow (definitions live in data.js) ----------
let mode = 'std';                // 'std' (endless) | 'level'
let curLevel = 1;
let levelHits = [];
const levelTarget = () => LEVELS[curLevel - 1].target;

function openLevels() {
  state = S.LEVELS;
}

function startLevel(n) {
  curLevel = n;
  mode = 'level';
  reset();
  state = S.START;
  sndPick();
}

function winLevel() {
  state = S.WIN;
  time = 0;
  sndReady();
  if (curLevel > save.level) {
    save.level = curLevel;
    persist(); // saves locally + syncs level to the account
  }
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 90 + Math.random() * 150;
    puffs.push({ x: BIRD_X, y: bird.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 50, life: 0.6 + Math.random() * 0.4, r: 4 + Math.random() * 6 });
  }
}


function reset() {
  bird = { y: GAME_H / 2 - 40, vy: 0, rot: 0, wing: 0 };
  pipes = [];
  coinsArr = [];
  score = 0;
  groundX = 0;
  cloudX = 0;
  time = 0;
  deathFlash = 0;
  newBest = false;
  puffs = [];
  // one use per run for each owned skill
  skillCh = {
    blast:  ownsSkill('blast')  ? 1 : 0,
    shield: ownsSkill('shield') ? 1 : 0,
    revive: ownsSkill('revive') ? 1 : 0
  };
  debris = [];
  banner = { text: '', t: 0 };
  shake = 0;
  beam = 0;
  readyPop = { text: '', t: 0 };
  shieldT = 0;
  runCoins = 0;
  for (let i = 0; i < 3; i++) spawnPipe(GAME_W + 140 + i * PIPE_SPACING);
}

function spawnPipe(x) {
  const gap = gapForScore();
  const margin = 70;
  const room = GAME_H - GROUND_H - margin * 2 - gap;
  const baseGapY = margin + Math.random() * Math.max(20, room);
  const moving = Math.random() < movingPipeChance();
  pipes.push({
    x,
    gap,
    baseGapY,
    gapY: baseGapY,
    passed: false,
    prevX: x,
    amp: moving ? moveAmp() : 0,
    oscSpd: 1 + Math.random() * 1.4,
    phase: Math.random() * Math.PI * 2
  });

  // Risk-reward coins
  const roll = Math.random();
  if (roll < 0.7) {
    const big = Math.random() < 0.15;
    let cy;
    const spot = Math.random();
    if (spot < 0.4) cy = baseGapY + 20;
    else if (spot < 0.8) cy = baseGapY + gap - 20;
    else cy = baseGapY + gap / 2;
    coinsArr.push({ x: x + PIPE_W / 2, y: cy, big, spin: Math.random() * 6 });
  }
  if (Math.random() < 0.35) {
    const high = Math.random() < 0.5;
    const cy = high ? 45 + Math.random() * 50 : GAME_H - GROUND_H - 45 - Math.random() * 50;
    coinsArr.push({ x: x - PIPE_SPACING / 2, y: cy, big: Math.random() < 0.25, spin: Math.random() * 6 });
  }
}


// ---------- Auto-activating skills ----------
function doBlast(target) {
  skillCh.blast--;
  sndBoom();
  banner = { text: 'Cpim pidhi', t: 1.4 };
  shake = 0.35;
  beam = 0.25;

  for (let i = 0; i < 26; i++) {
    const topHalf = Math.random() < 0.5;
    const y = topHalf
      ? Math.random() * target.gapY
      : target.gapY + target.gap + Math.random() * Math.max(20, GAME_H - GROUND_H - target.gapY - target.gap);
    debris.push({
      x: target.x + Math.random() * PIPE_W,
      y,
      vx: 80 + Math.random() * 220,
      vy: -180 + Math.random() * 360,
      w: 6 + Math.random() * 12,
      h: 6 + Math.random() * 12,
      rot: Math.random() * Math.PI,
      vr: -6 + Math.random() * 12,
      life: 0.7 + Math.random() * 0.5,
      col: ['#4f9d2f', '#8bd44a', '#5cae35', '#3d7d23'][i % 4]
    });
  }
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 80 + Math.random() * 160;
    puffs.push({ x: target.x + PIPE_W / 2, y: target.gapY + target.gap / 2, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.4 + Math.random() * 0.3, r: 5 + Math.random() * 6 });
  }

  pipes.splice(pipes.indexOf(target), 1);
  spawnPipe(pipes[pipes.length - 1].x + PIPE_SPACING);
}

function doShield() {
  skillCh.shield--;
  shieldT = SHIELD_TIME;
  banner = { text: 'Mburoje Bolesh', t: 1.4 };
  sndShield();
}

function doRevive() {
  skillCh.revive--;
  banner = { text: 'Ia hodhe bythes.', t: 1.6 };
  sndRevive();
  // fresh start in the middle of the field, pipes reset like a new game
  bird.y = GAME_H / 2 - 40;
  bird.vy = 0;
  bird.rot = 0;
  pipes = [];
  coinsArr = [];
  for (let i = 0; i < 3; i++) spawnPipe(GAME_W + 140 + i * PIPE_SPACING);
  shake = 0.25;
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    puffs.push({ x: BIRD_X, y: bird.y, vx: Math.cos(a) * 130, vy: Math.sin(a) * 130, life: 0.5, r: 4 + Math.random() * 5 });
  }
}

// Called at the moment of a fatal pipe hit. Returns true if a skill saved you.
// frontal = bird slammed into the pipe's front face (Cpim pidhi works ONLY here;
// clipping the rim from above/below does not count)
function tryRescuePipe(p, frontal) {
  if (frontal && ownsSkill('blast') && skillCh.blast > 0) { doBlast(p); return true; }
  if (ownsSkill('shield') && skillCh.shield > 0) { doShield(); return true; }
  if (ownsSkill('revive') && skillCh.revive > 0) { doRevive(); return true; }
  return false;
}
// Ground/ceiling deaths: only Ruj Sumen can save you
function tryRescueWorld() {
  if (ownsSkill('revive') && skillCh.revive > 0) { doRevive(); return true; }
  return false;
}


// ---------- Shop ----------
function tryBuyOrEquip(kind, item) {
  if (kind === 'skin') {
    if (save.skins.includes(item.id)) {
      save.skin = item.id;
      persist();
      sndPick();
      shopMsg = `${item.name} u vesh!`; shopMsgT = 1.5;
    } else if (save.coins >= item.price) {
      save.coins -= item.price;
      save.skins.push(item.id);
      save.skin = item.id;
      persist();
      sndBuy();
      shopMsg = `${item.name} u ble & u vesh!`; shopMsgT = 1.8;
    } else {
      sndDeny();
      shopMsg = `Duhen edhe ${item.price - save.coins} monedha!`; shopMsgT = 1.5;
    }
  } else {
    if (save.skills.includes(item.id)) {
      shopMsg = `E ke — aktivizohet vetë para vdekjes`; shopMsgT = 1.6;
      sndPick();
    } else if (save.coins >= item.price) {
      save.coins -= item.price;
      save.skills.push(item.id);
      skillCh[item.id] = 1;   // ready for the upcoming run
      persist();
      sndBuy();
      shopMsg = `${item.name} u ble! 1 përdorim çdo lojë`; shopMsgT = 2.2;
    } else {
      sndDeny();
      shopMsg = `Duhen edhe ${item.price - save.coins} monedha!`; shopMsgT = 1.5;
    }
  }
}


// ---------- Input ----------
function flap() {
  ensureAudio();
  if (state === S.START) {
    state = S.PLAYING;
    bird.vy = FLAP_VY;
    sndFlap();
  } else if (state === S.PLAYING) {
    bird.vy = FLAP_VY;
    bird.wing = 1;
    sndFlap();
  } else if (state === S.DEAD && deathFlash <= 0 && time > 0.6) {
    reset();
    state = S.START;
  } else if (state === S.WIN && time > 0.5) {
    mode = 'std';
    reset();
    state = S.LEVELS;
  }
}

canvas.addEventListener('pointerdown', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const gx = (e.clientX - rect.left) / scale;
  const gy = (e.clientY - rect.top) / scale;

  if (state === S.MENU) {
    ensureAudio();
    for (const h of menuHits) {
      if (gx >= h.x && gx <= h.x + h.w && gy >= h.y && gy <= h.y + h.h) {
        if (h.action === 'close') { state = S.START; sndPick(); }
        else if (h.action === 'tab-skins') { menuTab = 'skins'; sndPick(); }
        else if (h.action === 'tab-skills') { menuTab = 'skills'; sndPick(); }
        else if (h.action.startsWith('skin:')) {
          tryBuyOrEquip('skin', SHOP_SKINS.find(s => s.id === h.action.slice(5)));
        }
        else if (h.action.startsWith('skill:')) {
          tryBuyOrEquip('skill', SHOP_SKILLS.find(s => s.id === h.action.slice(6)));
        }
        return;
      }
    }
    return;
  }

  if (state === S.BOARD) {
    ensureAudio();
    for (const h of boardHits) {
      if (gx >= h.x && gx <= h.x + h.w && gy >= h.y && gy <= h.y + h.h) {
        if (h.action === 'close') { state = S.START; sndPick(); }
        else if (h.action === 'refresh') { sndPick(); fetchBoard(boardTab); }
        else if (h.action === 'tab-daily') { boardTab = 'daily'; sndPick(); fetchBoard('daily'); }
        else if (h.action === 'tab-life') { boardTab = 'life'; sndPick(); fetchBoard('life'); }
        else if (h.action === 'login') { guest = false; authOverlay.hidden = false; sndPick(); }
        return;
      }
    }
    return;
  }

  if (state === S.LEVELS) {
    ensureAudio();
    for (const h of levelHits) {
      if (gx >= h.x && gx <= h.x + h.w && gy >= h.y && gy <= h.y + h.h) {
        if (h.action === 'close') { state = S.START; mode = 'std'; sndPick(); }
        else if (h.playable) { startLevel(h.n); }
        else { sndDeny(); banner = { text: 'Së shpejti! 🔒', t: 1.1 }; }
        return;
      }
    }
    return;
  }

  if (state === S.START) {
    const lb = LEVELS_BTN;
    if (gx >= lb.x && gx <= lb.x + lb.w && gy >= lb.y && gy <= lb.y + lb.h) {
      ensureAudio();
      openLevels();
      sndPick();
      return;
    }
    for (const b of MENU_BTNS) {
      if (gx >= b.x && gx <= b.x + b.w && gy >= b.y && gy <= b.y + b.h) {
        ensureAudio();
        if (b.id === 'board') {
          openBoard();
        } else {
          menuTab = b.id;
          state = S.MENU;
        }
        sndPick();
        return;
      }
    }
  }

  flap();
});

window.addEventListener('keydown', e => {
  if (!authOverlay.hidden) return;
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON')) return;
  if (e.code === 'Space' || e.code === 'ArrowUp') { e.preventDefault(); flap(); }
  if (e.code === 'Escape') {
    if (state === S.MENU || state === S.BOARD) state = S.START;
    else if (state === S.LEVELS) { state = S.START; mode = 'std'; }
  }
});

// ---------- Update ----------
function die() {
  state = S.DEAD;
  deathFlash = 0.12;
  time = 0;
  sndCrash();
  if (score > save.best) { save.best = score; newBest = true; }
  persist();
  submitScore();
  for (let i = 0; i < 12; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 120;
    puffs.push({ x: BIRD_X, y: bird.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.5 + Math.random() * 0.3, r: 4 + Math.random() * 5 });
  }
}

// (skills no longer recharge with points — one use per run, granted in reset)

function update(dt) {
  time += dt;
  syncChip();
  if (deathFlash > 0) deathFlash -= dt;
  if (banner.t > 0) banner.t -= dt;
  if (shake > 0) shake -= dt;
  if (beam > 0) beam -= dt;
  if (readyPop.t > 0) readyPop.t -= dt;
  if (shopMsgT > 0) shopMsgT -= dt;
  if (shieldT > 0) shieldT -= dt;

  for (const p of puffs) {
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += 300 * dt; p.life -= dt;
  }
  puffs = puffs.filter(p => p.life > 0);

  for (const d of debris) {
    d.x += d.vx * dt; d.y += d.vy * dt;
    d.vy += 900 * dt; d.rot += d.vr * dt;
    d.life -= dt;
  }
  debris = debris.filter(d => d.life > 0);

  if (state === S.START || state === S.MENU || state === S.BOARD || state === S.LEVELS) {
    bird.y = GAME_H / 2 - 40 + Math.sin(time * 3) * 9;
    bird.rot = Math.sin(time * 3) * 0.08;
    bird.wing = (Math.sin(time * 8) + 1) / 2;
    groundX = (groundX - 150 * dt) % 48;
    cloudX = (cloudX - 12 * dt) % GAME_W;
    return;
  }

  if (state === S.WIN) {
    bird.wing = (Math.sin(time * 8) + 1) / 2;
    bird.rot += (0 - bird.rot) * Math.min(1, dt * 5);
    groundX = (groundX - 60 * dt) % 48;
    cloudX = (cloudX - 12 * dt) % GAME_W;
    return;
  }

  if (state === S.PLAYING) {
    const spd = pipeSpeed();
    groundX = (groundX - spd * dt) % 48;
    cloudX = (cloudX - 12 * dt) % GAME_W;

    bird.vy += GRAVITY * dt;
    bird.y += bird.vy * dt;
    bird.wing = Math.max(0, bird.wing - dt * 4);
    const target = bird.vy < 0 ? -0.42 : Math.min(1.35, bird.vy / 420);
    bird.rot += (target - bird.rot) * Math.min(1, dt * 9);

    for (const p of pipes) {
      p.prevX = p.x;
      p.x -= spd * dt;
      // oscillating pipes slide their gap up and down
      if (p.amp > 0) {
        const margin = 60;
        const maxY = GAME_H - GROUND_H - margin - p.gap;
        p.gapY = Math.max(margin, Math.min(maxY, p.baseGapY + Math.sin(time * p.oscSpd + p.phase) * p.amp));
      }
      if (!p.passed && p.x + PIPE_W < BIRD_X - BIRD_R) {
        p.passed = true;
        score++;
        sndPoint();
      }
    }
    // Levels mode: reached the target → level complete
    if (mode === 'level' && score >= levelTarget()) {
      winLevel();
      return;
    }
    if (pipes[0].x < -PIPE_W - 10) {
      pipes.shift();
      spawnPipe(pipes[pipes.length - 1].x + PIPE_SPACING);
    }

    // Coins
    for (const c of coinsArr) {
      c.x -= spd * dt;
      c.spin += dt * 5;
      const dx = c.x - BIRD_X, dy = c.y - bird.y;
      if (dx * dx + dy * dy < (BIRD_R + COIN_R) * (BIRD_R + COIN_R)) {
        c.taken = true;
        const val = c.big ? 5 : 1;
        runCoins += val;
        save.coins += val;
        sndCoin();
        for (let i = 0; i < 6; i++) {
          const a = Math.random() * Math.PI * 2;
          puffs.push({ x: c.x, y: c.y, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, life: 0.3, r: 3 + Math.random() * 3 });
        }
      }
    }
    coinsArr = coinsArr.filter(c => !c.taken && c.x > -30);

    // Ceiling / ground: only Ruj Sumen can rescue
    if (bird.y - BIRD_R <= 0) {
      bird.y = BIRD_R;
      if (!tryRescueWorld()) { die(); }
      return;
    }
    if (bird.y + BIRD_R >= GAME_H - GROUND_H) {
      bird.y = GAME_H - GROUND_H - BIRD_R;
      if (!tryRescueWorld()) { die(); }
      return;
    }

    // Pipe collisions (shield makes you pipe-proof while active)
    if (shieldT <= 0) {
      for (const p of pipes) {
        if (BIRD_X + BIRD_R > p.x && BIRD_X - BIRD_R < p.x + PIPE_W) {
          if (bird.y - BIRD_R < p.gapY || bird.y + BIRD_R > p.gapY + p.gap) {
            // Frontal = last frame we hadn't reached the pipe's front face yet.
            // Rim hit = we were already inside its horizontal span and clipped
            // the gap edge from above/below.
            const frontal = BIRD_X + BIRD_R <= p.prevX + 0.5;
            if (!tryRescuePipe(p, frontal)) { die(); }
            return;
          }
        }
      }
    }
  }

  if (state === S.DEAD) {
    if (bird.y + BIRD_R < GAME_H - GROUND_H) {
      bird.vy += GRAVITY * dt;
      bird.y += bird.vy * dt;
      bird.rot = Math.min(Math.PI / 2, bird.rot + dt * 6);
      if (bird.y + BIRD_R > GAME_H - GROUND_H) bird.y = GAME_H - GROUND_H - BIRD_R;
    }
  }
}
