(() => {
  'use strict';

  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const now = () => performance.now();

  // ---------- DOM ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

  const hud = document.getElementById('hud');
  const controls = document.getElementById('controls');

  const menuOverlay = document.getElementById('menuOverlay');
  const howOverlay = document.getElementById('howOverlay');
  const pauseOverlay = document.getElementById('pauseOverlay');
  const gameOverOverlay = document.getElementById('gameOverOverlay');

  const scoreEl = document.getElementById('score');
  const bestEl = document.getElementById('best');
  const finalScoreEl = document.getElementById('finalScore');

  const startBtn = document.getElementById('startBtn');
  const howBtn = document.getElementById('howBtn');
  const closeHowBtn = document.getElementById('closeHowBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const resumeBtn = document.getElementById('resumeBtn');
  const restartBtn = document.getElementById('restartBtn');
  const backToMenuBtn = document.getElementById('backToMenuBtn');
  const playAgainBtn = document.getElementById('playAgainBtn');
  const goMenuBtn = document.getElementById('goMenuBtn');

  const leftBtn = document.getElementById('leftBtn');
  const rightBtn = document.getElementById('rightBtn');
  const sfxToggle = document.getElementById('sfxToggle');

  // ---------- Persistent best score ----------
  const BEST_KEY = 'car-racer-iphone:best';
  const getBest = () => Number(localStorage.getItem(BEST_KEY) || '0') || 0;
  const setBest = (v) => localStorage.setItem(BEST_KEY, String(v | 0));
  bestEl.textContent = String(getBest() | 0);

  // ---------- Sound (no assets) ----------
  class Sound {
    constructor() {
      this.enabled = true;
      this.ctx = null;
      this.master = null;
    }
    ensure() {
      if (!this.enabled) return;
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.22;
      this.master.connect(this.ctx.destination);
    }
    setEnabled(on) {
      this.enabled = !!on;
      if (!this.enabled) {
        // keep ctx but silence
        if (this.master) this.master.gain.value = 0;
      } else {
        this.ensure();
        if (this.master) this.master.gain.value = 0.22;
      }
    }
    beep(freq = 440, dur = 0.06, type = 'sine', vol = 1) {
      if (!this.enabled) return;
      this.ensure();
      if (!this.ctx || !this.master) return;
      const t0 = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18 * vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }
    lane() { this.beep(520, 0.05, 'triangle', 0.8); }
    click() { this.beep(660, 0.04, 'square', 0.25); }
    crash() {
      this.beep(120, 0.18, 'sawtooth', 1);
      setTimeout(() => this.beep(90, 0.20, 'sawtooth', 0.9), 60);
    }
  }
  const sound = new Sound();
  sound.setEnabled(sfxToggle.checked);

  // ---------- Game state ----------
  const State = {
    MENU: 'menu',
    HOW: 'how',
    RUNNING: 'running',
    PAUSED: 'paused',
    GAMEOVER: 'gameover'
  };

  let state = State.MENU;

  const game = {
    // virtual world units are in pixels at current canvas size
    w: 0,
    h: 0,
    dpr: 1,

    road: {
      topMargin: 0.12, // fraction of height
      bottomMargin: 0.10,
      widthFrac: 0.78,
      lineScroll: 0,
    },

    lanes: 3,
    laneXs: [0, 0, 0],
    laneW: 0,

    player: {
      lane: 1,
      laneTarget: 1,
      x: 0,
      y: 0,
      w: 44,
      h: 72,
      color: '#4cc2ff',
      hitPad: 6,
    },

    obstacles: [],

    t: 0,
    speed: 320,      // px/s base
    accel: 10,       // px/s^2
    spawnTimer: 0,
    spawnEvery: 0.9, // seconds at start

    score: 0,
    alive: true,

    lastTs: 0,
  };

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    game.w = rect.width;
    game.h = rect.height;
    game.dpr = dpr;

    // Compute road bounds
    const roadW = game.w * game.road.widthFrac;
    game.road.left = (game.w - roadW) * 0.5;
    game.road.right = game.road.left + roadW;

    // Lanes
    game.laneW = roadW / game.lanes;
    for (let i = 0; i < game.lanes; i++) {
      game.laneXs[i] = game.road.left + game.laneW * (i + 0.5);
    }

    // Player size scales a bit with canvas
    const scale = clamp(Math.min(game.w, game.h) / 520, 0.85, 1.15);
    game.player.w = 46 * scale;
    game.player.h = 76 * scale;
    game.player.y = game.h * (1 - game.road.bottomMargin) - game.player.h - 8;
    game.player.x = game.laneXs[game.player.lane];
  }

  window.addEventListener('resize', resize, { passive: true });

  // ---------- Rendering ----------
  function roundRectPath(c, x, y, w, h, r) {
    const rr = Math.min(r, w * 0.5, h * 0.5);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function drawBackground() {
    ctx.fillStyle = '#070a0e';
    ctx.fillRect(0, 0, game.w, game.h);

    // Road
    const topY = game.h * game.road.topMargin;
    const botY = game.h * (1 - game.road.bottomMargin);

    // Asphalt
    ctx.fillStyle = '#0f1620';
    ctx.fillRect(game.road.left, topY, game.road.right - game.road.left, botY - topY);

    // Shoulders
    ctx.fillStyle = '#111a25';
    ctx.fillRect(game.road.left - 16, topY, 16, botY - topY);
    ctx.fillRect(game.road.right, topY, 16, botY - topY);

    // Lane lines
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 2;
    for (let i = 1; i < game.lanes; i++) {
      const x = game.road.left + i * game.laneW;
      ctx.beginPath();
      ctx.moveTo(x, topY);
      ctx.lineTo(x, botY);
      ctx.stroke();
    }

    // Center dashed lines (motion)
    const dashH = 28;
    const gap = 20;
    game.road.lineScroll = (game.road.lineScroll + game.speed * (1/60)) % (dashH + gap);

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    for (let i = 0; i < game.lanes; i++) {
      const x = game.laneXs[i];
      const w = 6;
      for (let y = topY - (dashH + gap); y < botY + (dashH + gap); y += dashH + gap) {
        const yy = y + game.road.lineScroll;
        ctx.fillRect(x - w/2, yy, w, dashH);
      }
    }

    // Subtle vignette
    const g = ctx.createRadialGradient(game.w/2, game.h*0.15, 50, game.w/2, game.h*0.6, Math.max(game.w, game.h));
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = g;
    ctx.fillRect(0,0,game.w,game.h);
  }

  function drawPlayer() {
    const p = game.player;
    const x = p.x - p.w / 2;
    const y = p.y;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    roundRectPath(ctx, x + 3, y + 6, p.w, p.h, 10);
    ctx.fill();

    // body
    const grad = ctx.createLinearGradient(0, y, 0, y + p.h);
    grad.addColorStop(0, '#73d7ff');
    grad.addColorStop(1, '#1c78a8');
    ctx.fillStyle = grad;
    roundRectPath(ctx, x, y, p.w, p.h, 12);
    ctx.fill();

    // windshield
    ctx.fillStyle = 'rgba(234,242,255,0.28)';
    roundRectPath(ctx, x + p.w*0.18, y + p.h*0.12, p.w*0.64, p.h*0.26, 10);
    ctx.fill();

    // stripe
    ctx.fillStyle = 'rgba(255,207,76,0.85)';
    ctx.fillRect(x + p.w*0.46, y + 6, p.w*0.08, p.h - 12);
  }

  function drawObstacle(o) {
    const x = o.x - o.w / 2;
    const y = o.y;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    roundRectPath(ctx, x + 3, y + 6, o.w, o.h, 10);
    ctx.fill();

    if (o.kind === 'car') {
      const grad = ctx.createLinearGradient(0, y, 0, y + o.h);
      grad.addColorStop(0, '#ff8a8a');
      grad.addColorStop(1, '#a42130');
      ctx.fillStyle = grad;
      roundRectPath(ctx, x, y, o.w, o.h, 12);
      ctx.fill();

      ctx.fillStyle = 'rgba(234,242,255,0.24)';
      roundRectPath(ctx, x + o.w*0.18, y + o.h*0.12, o.w*0.64, o.h*0.26, 10);
      ctx.fill();

      // tail lights
      ctx.fillStyle = 'rgba(255,207,76,0.8)';
      ctx.fillRect(x + o.w*0.12, y + o.h*0.78, o.w*0.18, o.h*0.12);
      ctx.fillRect(x + o.w*0.70, y + o.h*0.78, o.w*0.18, o.h*0.12);
    } else {
      // block
      ctx.fillStyle = '#2a3340';
      roundRectPath(ctx, x, y, o.w, o.h, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(76,194,255,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,207,76,0.85)';
      ctx.fillRect(x + 8, y + 10, o.w - 16, 8);
      ctx.fillRect(x + 8, y + o.h - 18, o.w - 16, 8);
    }
  }

  function drawHUDText() {
    scoreEl.textContent = String(game.score | 0);
    bestEl.textContent = String(getBest() | 0);
  }

  // ---------- Gameplay ----------
  function resetRun() {
    game.obstacles.length = 0;
    game.t = 0;
    game.speed = 320;
    game.accel = 16;
    game.spawnTimer = 0;
    game.spawnEvery = 0.95;
    game.score = 0;
    game.alive = true;

    game.player.lane = 1;
    game.player.laneTarget = 1;
    game.player.x = game.laneXs[1];
  }

  function spawnObstacle() {
    // avoid spawning directly on top of another obstacle too close
    const lane = (Math.random() * game.lanes) | 0;
    const topY = game.h * game.road.topMargin;

    const scale = clamp(Math.min(game.w, game.h) / 520, 0.85, 1.2);
    const kind = Math.random() < 0.72 ? 'car' : 'block';
    const w = (kind === 'car' ? 46 : 58) * scale;
    const h = (kind === 'car' ? 76 : 56) * scale;

    // spacing check
    const nearest = game.obstacles
      .filter(o => o.lane === lane)
      .reduce((m, o) => Math.min(m, o.y), Infinity);
    if (nearest < topY + 110) return; // too soon in same lane

    const o = {
      kind,
      lane,
      x: game.laneXs[lane],
      y: topY - h - 20,
      w,
      h,
    };
    game.obstacles.push(o);
  }

  function aabbHit(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function update(dt) {
    if (!game.alive) return;

    game.t += dt;

    // difficulty ramp
    game.speed += game.accel * dt;
    const targetSpawn = lerp(0.95, 0.42, clamp(game.t / 70, 0, 1));
    game.spawnEvery = targetSpawn;

    // scoring: distance-ish
    game.score += (game.speed * dt) * 0.06;

    // player smoothing towards lane center
    const px = game.laneXs[game.player.laneTarget];
    game.player.x = lerp(game.player.x, px, clamp(dt * 14, 0, 1));

    // obstacles move
    for (const o of game.obstacles) {
      o.y += game.speed * dt;
    }

    // despawn
    game.obstacles = game.obstacles.filter(o => o.y < game.h + 120);

    // spawn
    game.spawnTimer += dt;
    while (game.spawnTimer > game.spawnEvery) {
      game.spawnTimer -= game.spawnEvery;
      spawnObstacle();
      // occasional second spawn at higher speeds
      if (game.t > 18 && Math.random() < clamp((game.speed - 420) / 900, 0, 0.35)) {
        spawnObstacle();
      }
    }

    // collision
    const p = game.player;
    const pr = {
      x: p.x - p.w/2 + p.hitPad,
      y: p.y + p.hitPad,
      w: p.w - p.hitPad*2,
      h: p.h - p.hitPad*2
    };

    for (const o of game.obstacles) {
      const or = {
        x: o.x - o.w/2 + 6,
        y: o.y + 6,
        w: o.w - 12,
        h: o.h - 12,
      };
      if (aabbHit(pr.x, pr.y, pr.w, pr.h, or.x, or.y, or.w, or.h)) {
        crash();
        break;
      }
    }
  }

  function crash() {
    game.alive = false;
    sound.crash();

    const s = game.score | 0;
    const best = getBest();
    if (s > best) setBest(s);

    finalScoreEl.textContent = String(s);
    setState(State.GAMEOVER);
  }

  // ---------- Input ----------
  function moveLane(delta) {
    if (state !== State.RUNNING) return;
    const prev = game.player.laneTarget;
    game.player.laneTarget = clamp(game.player.laneTarget + delta, 0, game.lanes - 1);
    if (game.player.laneTarget !== prev) sound.lane();
  }

  function attachHoldButton(btn, dir) {
    let held = false;
    let repeatT = 0;

    const start = (e) => {
      e.preventDefault();
      sound.ensure();
      held = true;
      repeatT = 0;
      moveLane(dir);
    };
    const end = (e) => {
      e.preventDefault();
      held = false;
    };

    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('pointerleave', end);

    return (dt) => {
      if (!held) return;
      repeatT += dt;
      if (repeatT > 0.18) {
        repeatT = 0;
        moveLane(dir);
      }
    };
  }

  const leftRepeat = attachHoldButton(leftBtn, -1);
  const rightRepeat = attachHoldButton(rightBtn, +1);

  // swipe controls (optional)
  let swipeStartX = null;
  let swipeStartY = null;
  canvas.addEventListener('touchstart', (e) => {
    if (state !== State.RUNNING) return;
    if (!e.touches || e.touches.length !== 1) return;
    const t = e.touches[0];
    swipeStartX = t.clientX;
    swipeStartY = t.clientY;
    sound.ensure();
  }, { passive: true });

  canvas.addEventListener('touchend', (e) => {
    if (state !== State.RUNNING) return;
    if (swipeStartX == null) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    const dx = t.clientX - swipeStartX;
    const dy = t.clientY - swipeStartY;
    swipeStartX = swipeStartY = null;

    if (Math.abs(dx) > 42 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      moveLane(dx < 0 ? -1 : +1);
    }
  }, { passive: true });

  // keyboard (desktop testing)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') moveLane(-1);
    if (e.key === 'ArrowRight') moveLane(+1);
    if (e.key === 'p' || e.key === 'P') togglePause();
    if (e.key === 'r' || e.key === 'R') restart();
  });

  // ---------- State / UI ----------
  function show(el, on) {
    el.classList.toggle('hidden', !on);
  }

  function setState(next) {
    state = next;

    const inRun = (state === State.RUNNING);

    hud.setAttribute('aria-hidden', inRun ? 'false' : 'true');
    controls.setAttribute('aria-hidden', inRun ? 'false' : 'true');

    show(menuOverlay, state === State.MENU);
    show(howOverlay, state === State.HOW);
    show(pauseOverlay, state === State.PAUSED);
    show(gameOverOverlay, state === State.GAMEOVER);

    // show HUD + controls only while running
    hud.style.display = inRun ? 'flex' : 'none';
    controls.style.display = inRun ? 'flex' : 'none';

    drawHUDText();
  }

  function start() {
    sound.click();
    resetRun();
    setState(State.RUNNING);
  }

  function restart() {
    sound.click();
    resetRun();
    setState(State.RUNNING);
  }

  function backToMenu() {
    sound.click();
    setState(State.MENU);
  }

  function pause() {
    if (state !== State.RUNNING) return;
    sound.click();
    setState(State.PAUSED);
  }

  function resume() {
    if (state !== State.PAUSED) return;
    sound.click();
    setState(State.RUNNING);
    // prevent giant dt after pause
    game.lastTs = now();
  }

  function togglePause() {
    if (state === State.RUNNING) pause();
    else if (state === State.PAUSED) resume();
  }

  // buttons
  // iOS Safari can drop `click` events when `touchend.preventDefault()` is used.
  // Use pointer events as primary, keep click as fallback.
  startBtn.addEventListener('pointerup', (e) => { e.preventDefault(); start(); });
  startBtn.addEventListener('click', start);

  howBtn.addEventListener('pointerup', (e) => { e.preventDefault(); sound.click(); setState(State.HOW); });
  howBtn.addEventListener('click', () => { sound.click(); setState(State.HOW); });

  closeHowBtn.addEventListener('pointerup', (e) => { e.preventDefault(); sound.click(); setState(State.MENU); });
  closeHowBtn.addEventListener('click', () => { sound.click(); setState(State.MENU); });

  pauseBtn.addEventListener('pointerup', (e) => { e.preventDefault(); pause(); });
  pauseBtn.addEventListener('click', pause);

  resumeBtn.addEventListener('pointerup', (e) => { e.preventDefault(); resume(); });
  resumeBtn.addEventListener('click', resume);

  restartBtn.addEventListener('pointerup', (e) => { e.preventDefault(); restart(); });
  restartBtn.addEventListener('click', restart);

  backToMenuBtn.addEventListener('pointerup', (e) => { e.preventDefault(); backToMenu(); });
  backToMenuBtn.addEventListener('click', backToMenu);

  playAgainBtn.addEventListener('pointerup', (e) => { e.preventDefault(); restart(); });
  playAgainBtn.addEventListener('click', restart);

  goMenuBtn.addEventListener('pointerup', (e) => { e.preventDefault(); backToMenu(); });
  goMenuBtn.addEventListener('click', backToMenu);

  // SFX toggle
  sfxToggle.addEventListener('change', () => {
    sound.setEnabled(sfxToggle.checked);
    sound.click();
  });

  // Auto pause on tab hide
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === State.RUNNING) {
      setState(State.PAUSED);
    }
  });

  // iOS: prevent double-tap zoom gestures on buttons.
  // IMPORTANT: do NOT preventDefault on touchend for menu buttons, it can suppress click.
  for (const el of [leftBtn, rightBtn]) {
    el.addEventListener('touchend', (e) => e.preventDefault(), { passive: false });
  }

  // ---------- Loop ----------
  function frame(ts) {
    requestAnimationFrame(frame);

    if (!game.lastTs) game.lastTs = ts;
    let dt = (ts - game.lastTs) / 1000;
    game.lastTs = ts;

    dt = clamp(dt, 0, 1/20); // avoid big jumps

    // updates
    if (state === State.RUNNING) {
      leftRepeat(dt);
      rightRepeat(dt);
      update(dt);
      drawHUDText();
    }

    // render
    drawBackground();
    for (const o of game.obstacles) drawObstacle(o);
    drawPlayer();

    // overlay hint when not running
    if (state === State.MENU) {
      // subtle animated preview text could go here (kept simple)
    }
  }

  // init
  resize();
  setState(State.MENU);
  requestAnimationFrame(frame);
})();
