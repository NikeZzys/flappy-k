/* eslint-disable */
'use strict';
/* ============================================================
   ui.js — all canvas drawing + main loop + boot

   OWNS (defined here, used elsewhere):
     roundRect/textOutline, world & bird drawing, drawHUD, drawMenu,
     drawBoard, drawLevels, drawUI, draw(), loop(), boot sequence
   USES (defined in other files, resolved at runtime):
     everything above — this file loads LAST and starts the game
   Load order (index.html): data.js → auth.js → game.js → ui.js
   All top-level declarations are shared globals (no bundler).
   ============================================================ */

// ---------- Drawing helpers ----------
function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function textOutline(txt, x, y, size, fill = '#fff', align = 'center', maxW) {
  ctx.font = `bold ${size}px 'Segoe UI', Arial, sans-serif`;
  ctx.textAlign = align;
  ctx.lineWidth = Math.max(3, size / 9);
  ctx.strokeStyle = 'rgba(40,50,60,.9)';
  if (maxW) ctx.strokeText(txt, x, y, maxW); else ctx.strokeText(txt, x, y);
  ctx.fillStyle = fill;
  if (maxW) ctx.fillText(txt, x, y, maxW); else ctx.fillText(txt, x, y);
}

// ---------- World drawing ----------
function drawSky() {
  const g = ctx.createLinearGradient(0, 0, 0, GAME_H);
  g.addColorStop(0, '#69c8f2');
  g.addColorStop(0.7, '#a8e2f7');
  g.addColorStop(1, '#d8f3fb');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, GAME_W, GAME_H);
}

function drawCloud(x, y, s) {
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.beginPath();
  ctx.arc(x, y, 18 * s, 0, 7);
  ctx.arc(x + 20 * s, y - 8 * s, 14 * s, 0, 7);
  ctx.arc(x + 38 * s, y, 16 * s, 0, 7);
  ctx.fill();
}

function drawClouds() {
  const spots = [[60, 110, 1], [230, 70, 0.8], [340, 160, 1.1], [140, 210, 0.7]];
  for (const [bx, by, s] of spots) {
    let x = ((bx + cloudX) % (GAME_W + 90));
    if (x < -90) x += GAME_W + 90;
    drawCloud(x, by, s);
  }
}

function drawPipe(p) {
  const topH = p.gapY;
  const botY = p.gapY + p.gap;
  const drawBody = (x, y, w, h) => {
    const g = ctx.createLinearGradient(x, 0, x + w, 0);
    g.addColorStop(0, '#4f9d2f');
    g.addColorStop(0.35, '#8bd44a');
    g.addColorStop(0.7, '#5cae35');
    g.addColorStop(1, '#3d7d23');
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
  };
  drawBody(p.x, 0, PIPE_W, topH - 24);
  drawBody(p.x - 5, topH - 26, PIPE_W + 10, 26);
  ctx.strokeStyle = 'rgba(0,60,0,.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(p.x - 5, topH - 26, PIPE_W + 10, 26);
  drawBody(p.x, botY + 24, PIPE_W, GAME_H - GROUND_H - botY - 24);
  drawBody(p.x - 5, botY, PIPE_W + 10, 26);
  ctx.strokeRect(p.x - 5, botY, PIPE_W + 10, 26);
}

function drawGround() {
  const y = GAME_H - GROUND_H;
  ctx.fillStyle = '#d9c26a';
  ctx.fillRect(0, y, GAME_W, GROUND_H);
  ctx.fillStyle = '#7ec850';
  ctx.fillRect(0, y, GAME_W, 16);
  ctx.fillStyle = '#5aa838';
  for (let x = groundX; x < GAME_W + 48; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, y + 16);
    ctx.lineTo(x + 24, y + 4);
    ctx.lineTo(x + 48, y + 16);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(160,120,40,.25)';
  for (let x = groundX; x < GAME_W + 48; x += 48) {
    ctx.fillRect(x, y + 30, 26, 8);
    ctx.fillRect(x + 20, y + 55, 26, 8);
  }
}

function drawCoin(c) {
  const squish = Math.abs(Math.cos(c.spin));
  const r = c.big ? COIN_R + 3 : COIN_R;
  ctx.save();
  ctx.translate(c.x, c.y + Math.sin(c.spin * 0.7) * 2);
  ctx.scale(Math.max(0.15, squish), 1);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, 7);
  ctx.fillStyle = c.big ? '#ffcf33' : '#ffe066';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = c.big ? '#b8860b' : '#d4a017';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r - 5, 0, 7);
  ctx.strokeStyle = 'rgba(180,130,10,.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  if (c.big) {
    ctx.fillStyle = '#8a6508';
    ctx.font = 'bold 12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('5', 0, 4);
  }
  ctx.restore();
}

// ---------- Bird skins ----------
function drawColoredBird(pal) {
  ctx.fillStyle = pal.body;
  ctx.beginPath();
  ctx.ellipse(0, 0, 18, 14, 0, 0, 7);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,40,50,.45)';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = pal.belly;
  ctx.beginPath();
  ctx.ellipse(-2, 6, 10, 7, 0, 0, 7);
  ctx.fill();

  const wingLift = bird.wing;
  const wingAngle = -0.9 * wingLift + 0.35 * (1 - wingLift);
  ctx.save();
  ctx.translate(-4, 0);
  ctx.rotate(wingAngle);
  ctx.fillStyle = pal.wing;
  ctx.beginPath();
  ctx.ellipse(-6, 0, 11, 7, 0, 0, 7);
  ctx.fill();
  ctx.strokeStyle = 'rgba(40,40,50,.4)';
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(8, -5, 5.5, 0, 7);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = pal.eye;
  ctx.beginPath();
  ctx.arc(9.5, -5, 2.4, 0, 7);
  ctx.fill();

  ctx.fillStyle = '#ff7b3d';
  ctx.beginPath();
  ctx.moveTo(14, 0);
  ctx.lineTo(26, 3);
  ctx.lineTo(14, 7);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,50,0,.4)';
  ctx.stroke();
}

function drawPhotoHead(img, r) {
  const wingLift = bird.wing;
  const wingAngle = -0.9 * wingLift + 0.35 * (1 - wingLift);
  ctx.save();
  ctx.translate(-r + 2, 2);
  ctx.rotate(wingAngle);
  ctx.fillStyle = '#f5a623';
  ctx.beginPath();
  ctx.ellipse(-8, 0, 12, 7, 0, 0, 7);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,80,0,.4)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, 7);
  ctx.clip();
  if (img && img.ready) ctx.drawImage(img, -r, -r, r * 2, r * 2);
  else { ctx.fillStyle = '#ffd447'; ctx.fillRect(-r, -r, r * 2, r * 2); }
  ctx.restore();

  ctx.beginPath();
  ctx.arc(0, 0, r, 0, 7);
  ctx.strokeStyle = 'rgba(40,50,60,.75)';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = '#ff7b3d';
  ctx.beginPath();
  ctx.moveTo(r - 3, 2);
  ctx.lineTo(r + 10, 5);
  ctx.lineTo(r - 3, 9);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = 'rgba(150,50,0,.4)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawSkinAt(id) {
  if (photoImgs[id]) drawPhotoHead(photoImgs[id], 19);
  else drawColoredBird(PALETTES.classic);
}

function drawBird() {
  ctx.save();
  ctx.translate(BIRD_X, bird.y);

  if (shieldT > 0) {
    const blink = shieldT < 1.2 ? (Math.sin(time * 20) > 0 ? 1 : 0.25) : 1;
    ctx.globalAlpha = 0.55 * blink;
    const g = ctx.createRadialGradient(0, 0, 10, 0, 0, 32);
    g.addColorStop(0, 'rgba(120,200,255,.1)');
    g.addColorStop(0.8, 'rgba(120,200,255,.55)');
    g.addColorStop(1, 'rgba(120,200,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, 7);
    ctx.fill();
    ctx.globalAlpha = blink;
    ctx.beginPath();
    ctx.arc(0, 0, 27 + Math.sin(time * 8) * 2, 0, 7);
    ctx.strokeStyle = 'rgba(140,215,255,.9)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  ctx.rotate(bird.rot);
  drawSkinAt(save.skin);
  ctx.restore();
}

function drawPuffs() {
  for (const p of puffs) {
    ctx.globalAlpha = Math.max(0, p.life / 0.8);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, 7);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawDebris() {
  for (const d of debris) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, d.life / 0.4));
    ctx.translate(d.x, d.y);
    ctx.rotate(d.rot);
    ctx.fillStyle = d.col;
    ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
    ctx.strokeStyle = 'rgba(0,60,0,.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-d.w / 2, -d.h / 2, d.w, d.h);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawBeam() {
  if (beam <= 0) return;
  const a = beam / 0.25;
  ctx.save();
  ctx.globalAlpha = a;
  const g = ctx.createLinearGradient(BIRD_X, 0, GAME_W, 0);
  g.addColorStop(0, 'rgba(255,240,120,.95)');
  g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g;
  ctx.fillRect(BIRD_X + 10, bird.y - 8, GAME_W - BIRD_X, 16);
  ctx.fillStyle = 'rgba(255,255,255,.9)';
  ctx.fillRect(BIRD_X + 10, bird.y - 3, GAME_W - BIRD_X, 6);
  ctx.restore();
}

function drawBanner() {
  if (banner.t <= 0) return;
  const t = 1.4 - banner.t;
  const popIn = Math.min(1, Math.max(0, t) / 0.15);
  const fade = banner.t < 0.4 ? banner.t / 0.4 : 1;
  const s = (0.5 + 0.5 * popIn) * (1 + Math.sin(time * 10) * 0.03);
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(GAME_W / 2, 200);
  ctx.rotate(-0.06 + Math.sin(time * 12) * 0.02);
  ctx.scale(s, s);
  ctx.shadowColor = 'rgba(255,200,40,.9)';
  ctx.shadowBlur = 24;
  textOutline(banner.text, 0, 0, 38, '#ffd447', 'center', GAME_W - 40);
  ctx.shadowBlur = 0;
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawCoinIcon(x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 7);
  ctx.fillStyle = '#ffe066';
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = '#d4a017';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, r - 4, 0, 7);
  ctx.strokeStyle = 'rgba(180,130,10,.5)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawCoinCounter(x, y, amount, align = 'left') {
  drawCoinIcon(x, y, 9);
  textOutline(String(amount), align === 'left' ? x + 16 : x - 16, y + 6, 17, '#ffe066', align);
}

// ---------- HUD ----------
function drawHUD() {
  if (state !== S.PLAYING) return;

  drawCoinCounter(22, 26, save.coins);

  // owned skills: icon + charge count (auto-activated, no buttons)
  let sy = 50;
  for (const sk of SHOP_SKILLS) {
    if (!ownsSkill(sk.id)) continue;
    const n = skillCh[sk.id];
    ctx.globalAlpha = n > 0 ? 1 : 0.45;
    ctx.font = '17px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(sk.icon, 14, sy + 6);
    textOutline(`×${n}`, 38, sy + 6, 15, n > 0 ? '#ffd447' : '#fff', 'left');
    ctx.globalAlpha = 1;
    sy += 24;
  }

  if (shieldT > 0) {
    textOutline(`🛡 ${Math.ceil(shieldT)}s`, GAME_W / 2, 118, 18, '#9dd8ff');
  }

  if (readyPop.t > 0) {
    const a = readyPop.t > 0.9 ? (1.2 - readyPop.t) / 0.3 : Math.min(1, readyPop.t / 0.4);
    ctx.globalAlpha = Math.max(0, Math.min(1, a));
    textOutline(readyPop.text, GAME_W / 2, 145, 19, '#ffd447', 'center', GAME_W - 40);
    ctx.globalAlpha = 1;
  }
}

// ---------- Shop menu ----------
function drawMenu() {
  menuHits = [];

  ctx.fillStyle = 'rgba(10,20,35,.75)';
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  const pw = 356, ph = 490;
  const px = (GAME_W - pw) / 2, py = 50;
  ctx.fillStyle = '#f7f0d8';
  roundRect(px, py, pw, ph, 18);
  ctx.fill();
  ctx.strokeStyle = '#b89b4e';
  ctx.lineWidth = 4;
  ctx.stroke();

  drawCoinCounter(px + 26, py + 30, save.coins);

  const cb = { x: px + pw - 44, y: py + 12, w: 34, h: 34 };
  ctx.fillStyle = '#e2554f';
  roundRect(cb.x, cb.y, cb.w, cb.h, 10);
  ctx.fill();
  ctx.strokeStyle = '#8a2622';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('✕', cb.x + cb.w / 2, cb.y + 24);
  menuHits.push({ ...cb, action: 'close' });

  const tabs = [
    { id: 'skins', label: '🎨 Skins' },
    { id: 'skills', label: '⚡ Skills' }
  ];
  for (let i = 0; i < 2; i++) {
    const tw = 140, th = 38;
    const tx = px + pw / 2 - tw - 8 + i * (tw + 16), ty = py + 54;
    const active = menuTab === tabs[i].id;
    ctx.fillStyle = active ? '#ffd447' : '#d8cfae';
    roundRect(tx, ty, tw, th, 12);
    ctx.fill();
    ctx.strokeStyle = active ? '#a87d00' : '#a99c72';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = active ? '#5a4300' : '#6b6248';
    ctx.font = 'bold 17px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(tabs[i].label, tx + tw / 2, ty + 25);
    menuHits.push({ x: tx, y: ty, w: tw, h: th, action: 'tab-' + tabs[i].id });
  }

  const items = menuTab === 'skins' ? SHOP_SKINS : SHOP_SKILLS;
  const rowH = 82, rx = px + 12, rw = pw - 24;
  let ry = py + 104;

  for (const it of items) {
    const owned = menuTab === 'skins' ? save.skins.includes(it.id) : save.skills.includes(it.id);
    const equipped = menuTab === 'skins' && save.skin === it.id;

    ctx.fillStyle = equipped ? '#fff3c4' : '#fffdf4';
    roundRect(rx, ry, rw, rowH - 8, 12);
    ctx.fill();
    ctx.strokeStyle = equipped ? '#e0a800' : '#cabf98';
    ctx.lineWidth = equipped ? 3 : 2;
    ctx.stroke();

    // preview
    ctx.save();
    ctx.translate(rx + 36, ry + (rowH - 8) / 2);
    if (menuTab === 'skins') {
      const savedWing = bird.wing;
      bird.wing = (Math.sin(time * 6) + 1) / 2;
      ctx.scale(0.95, 0.95);
      drawSkinAt(it.id);
      bird.wing = savedWing;
    } else {
      ctx.font = '30px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(it.icon, 0, 11);
    }
    ctx.restore();

    // action button (drawn first so we know exactly where text must stop)
    const bw = 74, bh = 32;
    const bx = rx + rw - bw - 8, by = ry + (rowH - 8 - bh) / 2;
    let label, bg, fg;
    if (equipped) { label = 'VESHUR'; bg = '#8bc34a'; fg = '#2c4a10'; }
    else if (owned && menuTab === 'skins') { label = 'VISHE'; bg = '#64b5f6'; fg = '#0d3a66'; }
    else if (owned) { label = 'E BLERE'; bg = '#8bc34a'; fg = '#2c4a10'; }
    else {
      const afford = save.coins >= it.price;
      label = it.price === 0 ? 'FALAS' : `🪙 ${it.price}`;
      bg = afford ? '#ffd447' : '#c9c2ad';
      fg = afford ? '#5a4300' : '#7a745f';
    }
    ctx.fillStyle = bg;
    roundRect(bx, by, bw, bh, 10);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = fg;
    ctx.font = 'bold 13px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(label, bx + bw / 2, by + 21);

    // name + desc, hard-limited so they never run under the button
    const textX = rx + 66;
    const textMaxW = bx - textX - 10;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#4a3d1e';
    ctx.font = 'bold 16px Arial';
    const nameTxt = menuTab === 'skills' ? `${it.name} (1×/lojë)` : it.name;
    ctx.fillText(nameTxt, textX, ry + 26, textMaxW);
    ctx.fillStyle = '#857550';
    ctx.font = '12px Arial';
    ctx.fillText(it.desc, textX, ry + 46, textMaxW);

    menuHits.push({ x: rx, y: ry, w: rw, h: rowH - 8, action: (menuTab === 'skins' ? 'skin:' : 'skill:') + it.id });
    ry += rowH;
  }

  if (menuTab === 'skills') {
    ctx.fillStyle = '#857550';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('Aktivizohen VETË një moment para se të vdesësh.', px + pw / 2, ry + 10);
    ctx.fillText('Vetëm 1 përdorim për çdo lojë.', px + pw / 2, ry + 26);
  }

  if (shopMsgT > 0) {
    ctx.globalAlpha = Math.min(1, shopMsgT / 0.4);
    textOutline(shopMsg, GAME_W / 2, py + ph - 16, 15, '#ffd447', 'center', pw - 30);
    ctx.globalAlpha = 1;
  }
}

// ---------- Leaderboard screen ----------
function drawBoard() {
  boardHits = [];

  ctx.fillStyle = 'rgba(10,20,35,.75)';
  ctx.fillRect(0, 0, GAME_W, GAME_H);

  const pw = 356, ph = 490;
  const px = (GAME_W - pw) / 2, py = 50;
  ctx.fillStyle = '#f7f0d8';
  roundRect(px, py, pw, ph, 18);
  ctx.fill();
  ctx.strokeStyle = '#b89b4e';
  ctx.lineWidth = 4;
  ctx.stroke();

  textOutline('🏆 LEADERBOARD', px + 18, py + 36, 21, '#ffd447', 'left', pw - 120);

  // refresh button
  const rb = { x: px + pw - 86, y: py + 12, w: 34, h: 34 };
  ctx.fillStyle = '#64b5f6';
  roundRect(rb.x, rb.y, rb.w, rb.h, 10);
  ctx.fill();
  ctx.strokeStyle = '#0d3a66';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 19px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('⟳', rb.x + rb.w / 2, rb.y + 24);
  boardHits.push({ ...rb, action: 'refresh' });

  // close button
  const cb = { x: px + pw - 44, y: py + 12, w: 34, h: 34 };
  ctx.fillStyle = '#e2554f';
  roundRect(cb.x, cb.y, cb.w, cb.h, 10);
  ctx.fill();
  ctx.strokeStyle = '#8a2622';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('✕', cb.x + cb.w / 2, cb.y + 24);
  boardHits.push({ ...cb, action: 'close' });

  // tabs: daily / lifetime
  const tabs = [
    { id: 'daily', label: '📅 SOT' },
    { id: 'life',  label: '🏆 GJITHË KOHËS' }
  ];
  const tw = 160, th = 38;
  const tabsX = px + (pw - (tw * 2 + 8)) / 2;
  for (let i = 0; i < 2; i++) {
    const tx = tabsX + i * (tw + 8), ty = py + 54;
    const active = boardTab === tabs[i].id;
    ctx.fillStyle = active ? '#ffd447' : '#d8cfae';
    roundRect(tx, ty, tw, th, 12);
    ctx.fill();
    ctx.strokeStyle = active ? '#a87d00' : '#a99c72';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = active ? '#5a4300' : '#6b6248';
    ctx.font = 'bold 15px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(tabs[i].label, tx + tw / 2, ty + 25, tw - 14);
    boardHits.push({ x: tx, y: ty, w: tw, h: th, action: 'tab-' + tabs[i].id });
  }

  const b = board[boardTab];
  const listX = px + 14, listW = pw - 28;
  let ly = py + 106;

  if (b.status === 'loading' || b.status === 'idle') {
    textOutline('Duke ngarkuar…', px + pw / 2, py + 240, 18, '#ffefb0');
  } else if (b.status === 'error') {
    textOutline("S'u lidh dot me serverin", px + pw / 2, py + 230, 17, '#ffb0b0');
    textOutline('Prek ⟳ për të provuar prapë', px + pw / 2, py + 260, 14, '#ffefb0');
  } else if (b.status === 'offline') {
    textOutline("Leaderboard s'është konfiguruar", px + pw / 2, py + 230, 15, '#ffefb0');
    textOutline('(vendos çelësat e Supabase në kod)', px + pw / 2, py + 258, 13, '#ffefb0');
  } else if (!b.rows || b.rows.length === 0) {
    textOutline(boardTab === 'daily' ? "Askush s'ka luajtur sot!" : 'Ende asnjë rezultat', px + pw / 2, py + 230, 16, '#ffefb0');
    textOutline('Bëhu i pari 🐦', px + pw / 2, py + 260, 15, '#ffd447');
  } else {
    const medals = ['🥇', '🥈', '🥉'];
    const rowH = 34;
    for (let i = 0; i < b.rows.length; i++) {
      const r = b.rows[i];
      const mine = player && r.user_id === player.id;

      ctx.fillStyle = mine ? '#fff3c4' : (i % 2 ? '#fbf6e3' : '#fffdf4');
      roundRect(listX, ly, listW, rowH - 4, 9);
      ctx.fill();
      if (mine) {
        ctx.strokeStyle = '#e0a800';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }

      ctx.textAlign = 'left';
      ctx.fillStyle = '#4a3d1e';
      if (i < 3) {
        ctx.font = '17px Arial';
        ctx.fillText(medals[i], listX + 8, ly + 21);
      } else {
        ctx.font = 'bold 15px Arial';
        ctx.fillText((i + 1) + '.', listX + 10, ly + 21);
      }

      ctx.font = mine ? 'bold 15px Arial' : '15px Arial';
      ctx.fillText(r.username, listX + 42, ly + 21, listW - 150);

      ctx.textAlign = 'right';
      ctx.font = 'bold 12px Arial';
      ctx.fillStyle = '#857550';
      ctx.fillText(`Lv${r.level || 0}`, listX + listW - 58, ly + 21);

      ctx.font = 'bold 16px Arial';
      ctx.fillStyle = '#b8860b';
      ctx.fillText(String(r.score), listX + listW - 12, ly + 21);

      ly += rowH;
    }
  }

  // footer
  ctx.textAlign = 'center';
  ctx.font = 'bold 13px Arial';
  const fy = py + ph - 20;
  if (!player) {
    ctx.fillStyle = '#0d3a66';
    ctx.fillText('👤 Hyr me llogari që të futesh në renditje', px + pw / 2, fy, pw - 30);
    boardHits.push({ x: px + 20, y: fy - 20, w: pw - 40, h: 30, action: 'login' });
  } else {
    ctx.fillStyle = '#857550';
    ctx.fillText('Luan si: ' + player.name, px + pw / 2, fy, pw - 30);
  }
}

// ---------- Levels roadmap ----------
function drawLevels() {
  levelHits = [];

  // Background art, scaled to cover the canvas, + 40% black for readability
  if (roadmapBgOk) {
    const s = Math.max(GAME_W / roadmapBg.width, GAME_H / roadmapBg.height);
    const w = roadmapBg.width * s, h = roadmapBg.height * s;
    ctx.drawImage(roadmapBg, (GAME_W - w) / 2, (GAME_H - h) / 2, w, h);
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.fillRect(0, 0, GAME_W, GAME_H);
  } else {
    ctx.fillStyle = 'rgba(10,20,35,.75)';
    ctx.fillRect(0, 0, GAME_W, GAME_H);
  }

  const pw = 356, ph = 490;
  const px = (GAME_W - pw) / 2, py = 50;
  // Panel stays translucent so the background art shows through
  ctx.fillStyle = roadmapBgOk ? 'rgba(20,30,45,.25)' : '#f7f0d8';
  roundRect(px, py, pw, ph, 18);
  ctx.fill();
  ctx.strokeStyle = '#b89b4e';
  ctx.lineWidth = 4;
  ctx.stroke();

  textOutline('🗺 NIVELET', px + 18, py + 36, 22, '#ffd447', 'left', pw - 100);

  const cb = { x: px + pw - 44, y: py + 12, w: 34, h: 34 };
  ctx.fillStyle = '#e2554f';
  roundRect(cb.x, cb.y, cb.w, cb.h, 10);
  ctx.fill();
  ctx.strokeStyle = '#8a2622';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 20px Arial';
  ctx.textAlign = 'center';
  ctx.fillText('✕', cb.x + cb.w / 2, cb.y + 24);
  levelHits.push({ ...cb, action: 'close' });

  textOutline(`Niveli yt: ${save.level}`, px + pw / 2, py + 70, 16, '#ffefb0');

  // winding path, bottom (level 1) → top
  const nodes = [
    { x: px + 92,  y: py + 402 },
    { x: px + 236, y: py + 342 },
    { x: px + 116, y: py + 272 },
    { x: px + 244, y: py + 202 },
    { x: px + 140, y: py + 132 }
  ];
  ctx.setLineDash([7, 9]);
  ctx.strokeStyle = 'rgba(255,235,170,.85)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(nodes[0].x, nodes[0].y);
  for (let i = 1; i < nodes.length && i < LEVELS_SHOWN; i++) ctx.lineTo(nodes[i].x, nodes[i].y);
  ctx.stroke();
  ctx.setLineDash([]);

  for (let i = 0; i < Math.min(LEVELS_SHOWN, nodes.length); i++) {
    const n = i + 1;
    const nd = nodes[i];
    const done = save.level >= n;
    const playable = n <= LEVELS.length && n <= save.level + 1;
    const r = 27;

    if (playable && !done) {
      // pulsing halo on the next level to play
      ctx.globalAlpha = 0.35 + Math.sin(time * 5) * 0.2;
      ctx.beginPath();
      ctx.arc(nd.x, nd.y, r + 8, 0, 7);
      ctx.fillStyle = '#ffd447';
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.beginPath();
    ctx.arc(nd.x, nd.y, r, 0, 7);
    ctx.fillStyle = done ? '#8bc34a' : playable ? '#ffd447' : '#d8cfae';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = done ? '#3e6b1c' : playable ? '#a87d00' : '#a99c72';
    ctx.stroke();

    ctx.textAlign = 'center';
    if (done) {
      ctx.fillStyle = '#1e3a08';
      ctx.font = 'bold 24px Arial';
      ctx.fillText('✔', nd.x, nd.y + 9);
    } else if (playable) {
      ctx.fillStyle = '#5a4300';
      ctx.font = 'bold 24px Arial';
      ctx.fillText(String(n), nd.x, nd.y + 9);
    } else {
      ctx.font = '20px Arial';
      ctx.fillText('🔒', nd.x, nd.y + 8);
    }

    // caption under the playable level
    if (playable) {
      textOutline(done ? 'I kaluar — riluaje' : `Cak: ${LEVELS[n - 1].target} pikë`,
                  nd.x, nd.y + r + 20, 13, '#ffefb0');
    }

    levelHits.push({ x: nd.x - r - 6, y: nd.y - r - 6, w: (r + 6) * 2, h: (r + 6) * 2, n, playable });
  }

  textOutline('Nivele të tjera vijnë së shpejti…', px + pw / 2, py + ph - 16, 13, '#ffefb0');
}

// ---------- Screens ----------
function drawUI() {
  if (state === S.PLAYING) {
    textOutline(String(score), GAME_W / 2, 84, 56);
    if (mode === 'level') textOutline(`Niveli ${curLevel} • cak: ${levelTarget()}`, GAME_W / 2, 112, 15, '#ffefb0');
  }
  drawHUD();
  drawBanner();

  if (state === S.START) {
    textOutline('FLAPPY KARI', GAME_W / 2, 120, 44, '#ffd447');
    drawCoinCounter(GAME_W / 2, 158, save.coins, 'left');
    if (save.best > 0) textOutline(`Best: ${save.best}`, GAME_W / 2, 190, 18, '#ffefb0');
    if (mode === 'level') textOutline(`🗺 Niveli ${curLevel} — arrij ${levelTarget()} pikë`, GAME_W / 2, 218, 16, '#ffd447');
    if (!storageOk) textOutline('⚠ Saving unavailable in this browser', GAME_W / 2, 244, 12, '#ffb0b0');

    const pulse = 0.7 + Math.sin(time * 4) * 0.3;
    ctx.globalAlpha = pulse;
    textOutline(mode === 'level' ? 'Prek për të nisur nivelin' : 'Tap to start', GAME_W / 2, 415, 22);
    ctx.globalAlpha = 1;

    // Levels button
    const lb = LEVELS_BTN;
    ctx.fillStyle = '#8bc34a';
    roundRect(lb.x, lb.y, lb.w, lb.h, 14);
    ctx.fill();
    ctx.strokeStyle = '#3e6b1c';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#1e3a08';
    ctx.font = 'bold 17px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('🗺 NIVELET', lb.x + lb.w / 2, lb.y + 28);

    textOutline('Mblidh monedha • Bli skins & skills poshtë', GAME_W / 2, 512, 13, '#ffefb0');

    for (const b of MENU_BTNS) {
      ctx.fillStyle = '#ffd447';
      roundRect(b.x, b.y, b.w, b.h, 14);
      ctx.fill();
      ctx.strokeStyle = '#a87d00';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#5a4300';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(b.label, b.x + b.w / 2, b.y + 28);
    }
  }

  if (state === S.MENU) {
    drawMenu();
  }

  if (state === S.BOARD) {
    drawBoard();
  }

  if (state === S.LEVELS) {
    drawLevels();
  }

  if (state === S.WIN) {
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(0, 0, GAME_W, GAME_H);

    const pw = 300, ph = 230;
    const px = (GAME_W - pw) / 2, py = 165;
    ctx.fillStyle = '#f7f0d8';
    roundRect(px, py, pw, ph, 16);
    ctx.fill();
    ctx.strokeStyle = '#b89b4e';
    ctx.lineWidth = 4;
    ctx.stroke();

    textOutline(`NIVELI ${curLevel} U KALUA!`, GAME_W / 2, py + 52, 26, '#8bd44a', 'center', pw - 30);
    textOutline('🎉', GAME_W / 2, py + 100, 36);

    drawCoinIcon(GAME_W / 2 - 44, py + 138, 10);
    textOutline(`+${runCoins} monedha`, GAME_W / 2 - 26, py + 144, 17, '#ffe066', 'left');

    const pulse = 0.7 + Math.sin(time * 4) * 0.3;
    ctx.globalAlpha = pulse;
    textOutline('Prek për të vazhduar', GAME_W / 2, py + ph - 20, 18);
    ctx.globalAlpha = 1;
  }

  if (state === S.DEAD) {
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(0, 0, GAME_W, GAME_H);

    const pw = 280, ph = 250;
    const px = (GAME_W - pw) / 2, py = 150;
    ctx.fillStyle = '#f7f0d8';
    roundRect(px, py, pw, ph, 16);
    ctx.fill();
    ctx.strokeStyle = '#b89b4e';
    ctx.lineWidth = 4;
    ctx.stroke();

    textOutline('GAME OVER', GAME_W / 2, py + 46, 32, '#ff7b3d');
    ctx.fillStyle = '#6b5d33';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('SCORE', GAME_W / 2 - 65, py + 92);
    ctx.fillText('BEST', GAME_W / 2 + 65, py + 92);
    textOutline(String(score), GAME_W / 2 - 65, py + 130, 34, '#fff');
    textOutline(String(save.best), GAME_W / 2 + 65, py + 130, 34, newBest ? '#ffd447' : '#fff');
    if (newBest) textOutline('NEW BEST!', GAME_W / 2, py + 158, 16, '#ffd447');

    drawCoinIcon(GAME_W / 2 - 34, py + 186, 10);
    textOutline(`+${runCoins} this run`, GAME_W / 2 - 16, py + 192, 17, '#ffe066', 'left');

    const pulse = 0.7 + Math.sin(time * 4) * 0.3;
    ctx.globalAlpha = pulse;
    textOutline('Tap to continue', GAME_W / 2, py + ph - 18, 18);
    ctx.globalAlpha = 1;
  }

  if (deathFlash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${deathFlash / 0.12 * 0.8})`;
    ctx.fillRect(0, 0, GAME_W, GAME_H);
  }
}

function draw() {
  ctx.save();
  if (shake > 0) {
    const s = shake / 0.35 * 6;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }
  drawSky();
  drawClouds();
  for (const p of pipes) drawPipe(p);
  for (const c of coinsArr) drawCoin(c);
  drawGround();
  drawBeam();
  drawBird();
  drawDebris();
  drawPuffs();
  drawUI();
  ctx.restore();
}

// ---------- Main loop ----------
let last = performance.now();
function loop(now) {
  const dt = Math.min((now - last) / 1000, 0.033);
  last = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
}

// ---------- Boot (runs after all files are loaded) ----------
reset();
initAuth();
requestAnimationFrame(loop);
