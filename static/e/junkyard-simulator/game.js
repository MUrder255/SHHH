// Junkyard Simulator — collect scrap, sell it, upgrade, and cause chaos in the city.
(() => {
  'use strict';

  // ---------- Canvas / DOM ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const mini = document.getElementById('minimap');
  const miniCtx = mini.getContext('2d');
  const bigMapCanvas = document.getElementById('bigMapCanvas');
  const bigMapCtx = bigMapCanvas.getContext('2d');

  const el = id => document.getElementById(id);
  const cashPill = el('cashPill'), scrapPill = el('scrapPill');
  const chaosPill = el('chaosPill'), chaosVal = el('chaosVal');
  const vehicleBarWrap = el('vehicleBarWrap'), vehicleBar = el('vehicleBar');
  const promptEl = el('prompt');
  const toastWrap = el('toastWrap');
  const bustedBanner = el('bustedBanner');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    mini.width = mini.clientWidth * devicePixelRatio;
    mini.height = mini.clientHeight * devicePixelRatio;
  }
  window.addEventListener('resize', resize);

  // ---------- RNG ----------
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rng = mulberry32(1337);
  const randRange = (a, b) => a + rng() * (b - a);
  const choice = arr => arr[Math.floor(rng() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (x1, y1, x2, y2) => Math.hypot(x1 - x2, y1 - y2);
  const lerp = (a, b, t) => a + (b - a) * t;
  function angleDiff(a, b) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // ---------- World config ----------
  const WORLD_W = 5200, WORLD_H = 3600;
  const YARD = { x: 0, y: 2450, w: 1550, h: 1150 };
  const BLOCK = 460, ROAD = 140;
  const CELL = BLOCK + ROAD;

  const BUILDING_COLORS = ['#8a5a44', '#6b7280', '#7a6a3f', '#5a6b57', '#6d5a73', '#8a7048', '#556b78'];

  const PROP_TYPES = {
    cone:      { r: 10, hp: 8,  scrap: [1, 2], chaos: 3,  color: '#e2762b' },
    trashcan:  { r: 13, hp: 14, scrap: [1, 3], chaos: 4,  color: '#557a5f' },
    mailbox:   { r: 12, hp: 16, scrap: [2, 3], chaos: 5,  color: '#3f6ea5' },
    fence:     { r: 15, hp: 14, scrap: [1, 2], chaos: 4,  color: '#8f8f7d' },
    bench:     { r: 20, hp: 26, scrap: [3, 5], chaos: 6,  color: '#7a5a3f' },
    barrel:    { r: 14, hp: 20, scrap: [2, 4], chaos: 5,  color: '#b34a3a' },
    streetlight:{ r: 14, hp: 34, scrap: [4, 7], chaos: 8, color: '#9aa0a6' },
    dumpster:  { r: 23, hp: 46, scrap: [5, 9], chaos: 10, color: '#4a5a3f' },
  };
  const PROP_KEYS = Object.keys(PROP_TYPES);

  // ---------- World data ----------
  const buildings = [];   // {x,y,w,h,color,rot}
  const props = [];       // {x,y,type,hp,maxHp,inCity,alive,respawnAt}
  const scrapPiles = [];  // {x,y,r,units,maxUnits,respawnAt}
  const junkCars = [];    // {x,y,r,hp,maxHp,alive,respawnAt}
  const vehicles = [];    // {x,y,angle,vel,type,owned,hp,maxHp,broken}

  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }
  function overlapsYard(rect, pad = 0) {
    return rectsOverlap(rect, { x: YARD.x - pad, y: YARD.y - pad, w: YARD.w + pad * 2, h: YARD.h + pad * 2 });
  }

  function genCity() {
    const cols = Math.ceil(WORLD_W / CELL);
    const rows = Math.ceil(WORLD_H / CELL);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const bx = c * CELL + ROAD / 2;
        const by = r * CELL + ROAD / 2;
        const cell = { x: bx, y: by, w: BLOCK, h: BLOCK };
        if (bx > WORLD_W || by > WORLD_H) continue;
        if (overlapsYard(cell, 40)) continue;

        const isBuildingLot = rng() < 0.68;
        if (isBuildingLot) {
          const margin = randRange(30, 70);
          const bw = BLOCK - margin * 2;
          const bh = BLOCK - margin * 2;
          buildings.push({
            x: bx + margin, y: by + margin, w: bw, h: bh,
            color: choice(BUILDING_COLORS),
          });
          // scatter a few props near the building edge
          const n = Math.floor(randRange(0, 3));
          for (let i = 0; i < n; i++) {
            placePropNear(bx + BLOCK / 2, by + BLOCK / 2, BLOCK / 2 - 10, true);
          }
        } else {
          // open lot: scatter more props
          const n = Math.floor(randRange(2, 6));
          for (let i = 0; i < n; i++) {
            placePropNear(bx + BLOCK / 2, by + BLOCK / 2, BLOCK / 2 - 20, true);
          }
        }
        // streetlight near block corner
        if (rng() < 0.5) {
          props.push(makeProp(bx - ROAD / 2 + 6, by - ROAD / 2 + 6, 'streetlight', true));
        }
      }
    }
  }

  function makeProp(x, y, type, inCity) {
    const def = PROP_TYPES[type];
    return { x, y, type, hp: def.hp, maxHp: def.hp, inCity, alive: true, respawnAt: 0 };
  }

  function placePropNear(cx, cy, radius, inCity) {
    const a = rng() * Math.PI * 2;
    const d = randRange(0, radius);
    const x = cx + Math.cos(a) * d;
    const y = cy + Math.sin(a) * d;
    const type = choice(PROP_KEYS);
    props.push(makeProp(x, y, type, inCity));
  }

  function genYard() {
    // dirt patches drawn at render time procedurally; here place gameplay objects
    const pad = 90;
    for (let i = 0; i < 16; i++) {
      let x, y, tries = 0;
      do {
        x = randRange(YARD.x + pad, YARD.x + YARD.w - pad);
        y = randRange(YARD.y + pad, YARD.y + YARD.h - pad);
        tries++;
      } while (tries < 20 && dist(x, y, SHOP.x, SHOP.y) < 220);
      scrapPiles.push({ x, y, r: 26, units: 8, maxUnits: 8, respawnAt: 0 });
    }
    for (let i = 0; i < 7; i++) {
      const x = randRange(YARD.x + pad, YARD.x + YARD.w - pad);
      const y = randRange(YARD.y + pad, YARD.y + YARD.h - pad);
      junkCars.push({ x, y, r: 30, hp: 70, maxHp: 70, alive: true, respawnAt: 0 });
    }
  }

  const SHOP = { x: 220, y: 2620, w: 160, h: 110 };
  const GARAGE = { x: 220, y: 3350 };
  const CRUSHER = { x: 620, y: 2620, w: 140, h: 120 };

  genCity();
  genYard();

  // starting vehicle
  vehicles.push({
    x: GARAGE.x + 90, y: GARAGE.y, angle: 0, vx: 0, vy: 0, speed: 0,
    type: 'sedan', owned: true, hp: 100, maxHp: 100, broken: false, id: 'sedan',
  });

  const VEHICLE_DEFS = {
    sedan: { maxSpeed: 430, reverse: 210, accel: 560, turn: 3.0, r: 26, w: 46, h: 24, color: '#c0392b', ramMul: 1, hpMul: 1 },
    truck: { maxSpeed: 390, reverse: 190, accel: 480, turn: 2.5, r: 32, w: 58, h: 30, color: '#2e5f8a', ramMul: 1.6, hpMul: 1.5 },
  };

  // ---------- Save / Upgrades ----------
  const SAVE_KEY = 'junkyardSim.save.v1';
  const defaultSave = {
    cash: 0,
    capLvl: 0, speedLvl: 0, magnetLvl: 0, bumperLvl: 0,
    sledgehammer: false, truckOwned: false,
    stats: { totalScrap: 0, totalCash: 0, propsDestroyed: 0, timesBusted: 0 },
  };
  let save = loadSave();
  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return structuredClone(defaultSave);
      const parsed = JSON.parse(raw);
      return Object.assign(structuredClone(defaultSave), parsed, {
        stats: Object.assign(structuredClone(defaultSave.stats), parsed.stats || {}),
      });
    } catch (e) { return structuredClone(defaultSave); }
  }
  function persist() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* storage unavailable */ }
  }

  const CAP_LEVELS = [20, 40, 80, 150];
  const CAP_COSTS = [75, 250, 600];
  const SPEED_LEVELS = [170, 195, 220, 250];
  const SPEED_COSTS = [50, 150, 400];
  const MAGNET_RADII = [0, 80, 140];
  const MAGNET_COSTS = [200, 500];
  const BUMPER_LEVELS = [1, 0.75, 0.55]; // damage-taken multiplier
  const BUMPER_RAM = [1, 1.25, 1.5];     // damage-dealt multiplier
  const BUMPER_COSTS = [300, 700];
  const SLEDGE_COST = 150;
  const TRUCK_COST = 800;
  const SELL_PRICE = 3;
  const CRUSHER_BONUS_PRICE = 3.5;
  const CRUSHER_MIN_BATCH = 10;

  function capacity() { return CAP_LEVELS[save.capLvl]; }
  function footSpeed() { return SPEED_LEVELS[save.speedLvl]; }
  function magnetRadius() { return MAGNET_RADII[save.magnetLvl]; }
  function bumperTakenMul() { return BUMPER_LEVELS[save.bumperLvl]; }
  function bumperDealtMul() { return BUMPER_RAM[save.bumperLvl]; }

  // ---------- Runtime state ----------
  const player = {
    x: GARAGE.x - 40, y: GARAGE.y + 60, angle: 0, speed: 0, r: 14, scrap: 0,
  };
  let inVehicle = null;      // reference to vehicle object player is driving
  let camera = { x: player.x, y: player.y };
  let chaos = 0;
  let lastCityHitAt = -99;
  let dayTime = 0.25;        // 0..1, 0.25 = morning
  const DAY_LENGTH_MS = 5 * 60 * 1000;

  const pickups = []; // {x,y,vx,vy,age,ttl}

  const inspector = { active: false, x: 0, y: 0, angle: 0, speed: 330, giveUpTimer: 0, spawnDelay: 0, pending: false };

  let invulnUntil = 0;
  let paused = false;
  let started = false;

  const input = { up: false, down: false, left: false, right: false, sprint: false, interact: false, interactEdge: false };

  // ---------- Input ----------
  window.addEventListener('keydown', e => {
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight',' '].includes(e.key)) e.preventDefault();
    switch (e.key) {
      case 'w': case 'W': case 'ArrowUp': input.up = true; break;
      case 's': case 'S': case 'ArrowDown': input.down = true; break;
      case 'a': case 'A': case 'ArrowLeft': input.left = true; break;
      case 'd': case 'D': case 'ArrowRight': input.right = true; break;
      case 'Shift': input.sprint = true; break;
      case 'e': case 'E': if (!input.interact) input.interactEdge = true; input.interact = true; break;
      case 'm': case 'M': toggleBigMap(); break;
      case 'p': case 'P': case 'Escape': togglePause(); break;
    }
  });
  window.addEventListener('keyup', e => {
    switch (e.key) {
      case 'w': case 'W': case 'ArrowUp': input.up = false; break;
      case 's': case 'S': case 'ArrowDown': input.down = false; break;
      case 'a': case 'A': case 'ArrowLeft': input.left = false; break;
      case 'd': case 'D': case 'ArrowRight': input.right = false; break;
      case 'Shift': input.sprint = false; break;
      case 'e': case 'E': input.interact = false; break;
    }
  });

  // touch controls
  if ('ontouchstart' in window) document.body.classList.add('touch');
  const joyBase = el('joyBase'), joyStick = el('joyStick');
  let joyActive = false, joyId = null, joyVec = { x: 0, y: 0 };
  function joyStart(e) {
    joyActive = true;
    const t = e.changedTouches ? e.changedTouches[0] : e;
    joyId = t.identifier ?? 'mouse';
  }
  function joyMove(e) {
    if (!joyActive) return;
    const touches = e.changedTouches ? Array.from(e.changedTouches) : [e];
    for (const t of touches) {
      if ((t.identifier ?? 'mouse') !== joyId) continue;
      const rect = joyBase.getBoundingClientRect();
      const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      let dx = t.clientX - cx, dy = t.clientY - cy;
      const max = rect.width / 2;
      const m = Math.hypot(dx, dy);
      if (m > max) { dx = dx / m * max; dy = dy / m * max; }
      joyVec.x = dx / max; joyVec.y = dy / max;
      joyStick.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }
  function joyEnd() { joyActive = false; joyVec.x = 0; joyVec.y = 0; joyStick.style.transform = 'translate(0,0)'; }
  joyBase.addEventListener('touchstart', e => { joyStart(e); joyMove(e); }, { passive: true });
  joyBase.addEventListener('touchmove', joyMove, { passive: true });
  joyBase.addEventListener('touchend', joyEnd);
  joyBase.addEventListener('touchcancel', joyEnd);

  const btnInteract = el('btnInteract'), btnSprint = el('btnSprint');
  btnInteract.addEventListener('touchstart', e => { e.preventDefault(); if (!input.interact) input.interactEdge = true; input.interact = true; });
  btnInteract.addEventListener('touchend', e => { e.preventDefault(); input.interact = false; });
  btnSprint.addEventListener('touchstart', e => { e.preventDefault(); input.sprint = true; });
  btnSprint.addEventListener('touchend', e => { e.preventDefault(); input.sprint = false; });

  // ---------- Sound (tiny WebAudio blips, no assets) ----------
  let actx = null;
  function sound(freq, dur, type = 'square', vol = 0.06, slideTo) {
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(); const g = actx.createGain();
      o.type = type; o.frequency.value = freq;
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, actx.currentTime + dur);
      g.gain.value = vol;
      g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + dur);
      o.connect(g).connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur);
    } catch (e) { /* audio unavailable */ }
  }
  const sfx = {
    pickup: () => sound(520, 0.08, 'square', 0.05, 700),
    sell: () => sound(300, 0.18, 'sawtooth', 0.06, 700),
    buy: () => sound(400, 0.15, 'triangle', 0.07, 250),
    smash: () => sound(120, 0.15, 'square', 0.08, 60),
    enter: () => sound(200, 0.12, 'sine', 0.06, 340),
    crash: () => sound(90, 0.2, 'sawtooth', 0.09, 40),
    busted: () => { sound(700, 0.25, 'sawtooth', 0.09, 200); setTimeout(() => sound(700, 0.25, 'sawtooth', 0.09, 200), 260); },
  };

  // ---------- Toasts ----------
  function toast(msg) {
    const d = document.createElement('div');
    d.className = 'toast'; d.textContent = msg;
    toastWrap.appendChild(d);
    setTimeout(() => d.remove(), 2300);
  }

  // ---------- Collisions ----------
  function circleRectPush(cx, cy, r, rect) {
    const closestX = clamp(cx, rect.x, rect.x + rect.w);
    const closestY = clamp(cy, rect.y, rect.y + rect.h);
    const dx = cx - closestX, dy = cy - closestY;
    const d = Math.hypot(dx, dy);
    if (d < r && d > 0.0001) {
      const push = r - d;
      return { x: (dx / d) * push, y: (dy / d) * push, hit: true };
    }
    if (d === 0) return { x: 0, y: -r, hit: true };
    return { hit: false };
  }

  function resolveBuildingCollisions(entity, radius) {
    for (const b of buildings) {
      const res = circleRectPush(entity.x, entity.y, radius, b);
      if (res.hit) { entity.x += res.x; entity.y += res.y; if (entity.speed !== undefined) entity.speed *= 0.2; return true; }
    }
    return false;
  }

  function worldClamp(entity, radius) {
    entity.x = clamp(entity.x, radius, WORLD_W - radius);
    entity.y = clamp(entity.y, radius, WORLD_H - radius);
  }

  // ---------- Gameplay helpers ----------
  function dropScrap(x, y, count) {
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2;
      const speed = randRange(40, 140);
      pickups.push({
        x: x + randRange(-6, 6), y: y + randRange(-6, 6),
        vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
        age: 0, ttl: 40,
      });
    }
  }

  function addScrap(n) {
    const room = capacity() - player.scrap;
    const add = Math.max(0, Math.min(n, room));
    player.scrap += add;
    save.stats.totalScrap += add;
    return add;
  }

  function addChaos(amount, atCity) {
    if (!atCity) return;
    chaos = clamp(chaos + amount, 0, 100);
    lastCityHitAt = performance.now() / 1000;
  }

  function damageProp(p, dmg, byVehicleType) {
    if (!p.alive) return;
    p.hp -= dmg;
    if (p.hp <= 0) {
      p.alive = false;
      p.respawnAt = performance.now() / 1000 + 45;
      const def = PROP_TYPES[p.type];
      const n = Math.round(randRange(def.scrap[0], def.scrap[1]));
      dropScrap(p.x, p.y, n);
      save.stats.propsDestroyed++;
      addChaos(def.chaos, p.inCity);
      sfx.smash();
    }
  }

  function damageJunkCar(jc, dmg) {
    if (!jc.alive) return;
    jc.hp -= dmg;
    if (jc.hp <= 0) {
      jc.alive = false;
      jc.respawnAt = performance.now() / 1000 + 60;
      dropScrap(jc.x, jc.y, Math.round(randRange(10, 16)));
      sfx.smash();
    }
  }

  function nearestVehicle(range) {
    let best = null, bestD = range;
    for (const v of vehicles) {
      if (v === inVehicle) continue;
      const d = dist(player.x, player.y, v.x, v.y);
      if (d < bestD) { best = v; bestD = d; }
    }
    return best;
  }

  // ---------- Update ----------
  let lastTime = performance.now();
  function update(dt) {
    dayTime = (dayTime + dt / (DAY_LENGTH_MS / 1000)) % 1;

    if (inVehicle) updateVehicleMode(dt);
    else updateFootMode(dt);

    updatePickups(dt);
    updateChaosAndInspector(dt);
    respawnTimers();

    input.interactEdge = false;
  }

  function updateFootMode(dt) {
    const spd = footSpeed() * (input.sprint ? 1.55 : 1);
    let mx = 0, my = 0;
    if (input.up) my -= 1;
    if (input.down) my += 1;
    if (input.left) mx -= 1;
    if (input.right) mx += 1;
    if (joyVec.x || joyVec.y) { mx = joyVec.x; my = joyVec.y; }
    const m = Math.hypot(mx, my);
    if (m > 0) {
      mx /= m; my /= m;
      player.x += mx * spd * dt;
      player.y += my * spd * dt;
      player.angle = Math.atan2(my, mx);
    }
    worldClamp(player, player.r);
    for (const b of buildings) circleRectPush(player.x, player.y, player.r, b).hit &&
      (() => { const r = circleRectPush(player.x, player.y, player.r, b); player.x += r.x; player.y += r.y; })();

    // magnet
    const mr = magnetRadius();
    if (mr > 0) {
      for (const pk of pickups) {
        const d = dist(player.x, player.y, pk.x, pk.y);
        if (d < mr) {
          const a = Math.atan2(player.y - pk.y, player.x - pk.x);
          pk.vx += Math.cos(a) * 260 * dt;
          pk.vy += Math.sin(a) * 260 * dt;
        }
      }
    }

    handleFootInteractions();
  }

  function handleFootInteractions() {
    // pickups auto-collect on touch (always-on, independent of the E-based interactions below)
    for (const pk of pickups) {
      if (dist(player.x, player.y, pk.x, pk.y) < player.r + 8) {
        if (addScrap(1) > 0) { pk.collected = true; sfx.pickup(); }
      }
    }

    // Gather every interactable currently in range, then act on only the nearest one,
    // so overlapping zones (e.g. a parked vehicle next to a scrap pile) don't fight each other.
    const candidates = [];

    let nearestPile = null, pileD = 60;
    for (const s of scrapPiles) {
      if (s.units <= 0) continue;
      const d = dist(player.x, player.y, s.x, s.y);
      if (d < s.r + player.r + 10 && d < pileD) { nearestPile = s; pileD = d; }
    }
    if (nearestPile) {
      candidates.push({
        dist: pileD,
        prompt: player.scrap >= capacity() ? 'Bag full — sell scrap first' : 'Hold E to mine scrap',
        onHold: () => {
          if (player.scrap >= capacity()) return;
          nearestPile._t = (nearestPile._t || 0) + (1 / 60);
          if (nearestPile._t > 0.35) {
            nearestPile._t = 0;
            nearestPile.units--;
            if (addScrap(1) > 0) sfx.pickup();
            if (nearestPile.units <= 0) nearestPile.respawnAt = performance.now() / 1000 + 90;
          }
        },
      });
    }

    let nearestJC = null, jcD = 70;
    for (const jc of junkCars) {
      if (!jc.alive) continue;
      const d = dist(player.x, player.y, jc.x, jc.y);
      if (d < jc.r + player.r + 15 && d < jcD) { nearestJC = jc; jcD = d; }
    }
    if (nearestJC) {
      candidates.push({
        dist: jcD,
        prompt: save.sledgehammer ? 'Hold E to smash wreck' : 'Need a Sledgehammer (Upgrades) or a vehicle to break this down',
        onHold: save.sledgehammer ? () => damageJunkCar(nearestJC, 40 * (1 / 60)) : null,
      });
    }

    if (save.sledgehammer) {
      let nearestProp = null, propD = Infinity;
      for (const p of props) {
        if (!p.alive) continue;
        const d = dist(player.x, player.y, p.x, p.y);
        if (d < PROP_TYPES[p.type].r + player.r + 12 && d < propD) { nearestProp = p; propD = d; }
      }
      if (nearestProp) {
        candidates.push({ dist: propD, prompt: 'Hold E to smash', onHold: () => damageProp(nearestProp, 30 * (1 / 60)) });
      }
    }

    const shopD = dist(player.x, player.y, SHOP.x, SHOP.y);
    if (shopD < 90) candidates.push({ dist: shopD, prompt: 'Press E — Shop & Upgrades', onEdge: openShop });

    const crusherD = dist(player.x, player.y, CRUSHER.x, CRUSHER.y);
    if (crusherD < 90) {
      candidates.push(player.scrap >= CRUSHER_MIN_BATCH
        ? { dist: crusherD, prompt: `Press E — Crush ${player.scrap} scrap for bonus cash`, onEdge: crushSell }
        : { dist: crusherD, prompt: `Bring ${CRUSHER_MIN_BATCH}+ scrap here for a bonus price` });
    }

    const nv = nearestVehicle(90);
    if (nv) {
      candidates.push({
        dist: dist(player.x, player.y, nv.x, nv.y),
        prompt: nv.broken ? 'Vehicle is broken down — repair at Garage' : 'Press E — Enter Vehicle',
        onEdge: nv.broken ? null : () => enterVehicle(nv),
      });
    }

    const garageD = dist(player.x, player.y, GARAGE.x, GARAGE.y);
    if (garageD < 110) {
      const dmgd = vehicles.find(v => v.hp < v.maxHp);
      if (dmgd) {
        const missing = dmgd.maxHp - dmgd.hp;
        const cost = Math.ceil(missing * 0.4);
        candidates.push({
          dist: garageD,
          prompt: `Press E — Repair ${dmgd.type} (${cost} scrap)`,
          onEdge: () => {
            if (player.scrap >= cost) {
              player.scrap -= cost; dmgd.hp = dmgd.maxHp; dmgd.broken = false;
              toast('Vehicle repaired!'); sfx.buy();
            } else toast(`Need ${cost} scrap to repair`);
          },
        });
      }
    }

    candidates.sort((a, b) => a.dist - b.dist);
    const active = candidates[0];
    if (active) {
      showPrompt(active.prompt);
      if (input.interact && active.onHold) active.onHold();
      if (input.interactEdge && active.onEdge) active.onEdge();
    } else {
      showPrompt(null);
    }
  }

  function enterVehicle(v) {
    inVehicle = v;
    player.wasVisible = false;
    sfx.enter();
  }

  function exitVehicleNow() {
    if (!inVehicle) return;
    const a = inVehicle.angle + Math.PI / 2;
    player.x = inVehicle.x + Math.cos(a) * 46;
    player.y = inVehicle.y + Math.sin(a) * 46;
    inVehicle = null;
    sfx.enter();
  }

  function updateVehicleMode(dt) {
    const v = inVehicle;
    const def = VEHICLE_DEFS[v.type];
    if (v.broken) { exitVehicleNow(); return; }

    let throttle = 0;
    if (input.up || joyVec.y < -0.2) throttle = 1;
    if (input.down || joyVec.y > 0.2) throttle = -1;
    let steer = 0;
    if (input.left || joyVec.x < -0.2) steer = -1;
    if (input.right || joyVec.x > 0.2) steer = 1;

    const maxF = def.maxSpeed, maxR = -def.reverse;
    if (throttle > 0) v.speed += def.accel * dt;
    else if (throttle < 0) v.speed -= def.accel * dt;
    else v.speed -= Math.sign(v.speed) * def.accel * 0.6 * dt;
    if (Math.abs(v.speed) < 4 && throttle === 0) v.speed = 0;
    v.speed = clamp(v.speed, maxR, maxF);

    const speedFrac = clamp(Math.abs(v.speed) / def.maxSpeed, 0.15, 1);
    v.angle += steer * def.turn * speedFrac * dt * (v.speed < 0 ? -1 : 1);

    const nx = v.x + Math.cos(v.angle) * v.speed * dt;
    const ny = v.y + Math.sin(v.angle) * v.speed * dt;
    const prevX = v.x, prevY = v.y;
    v.x = nx; v.y = ny;
    worldClamp(v, def.r);

    // buildings
    for (const b of buildings) {
      const res = circleRectPush(v.x, v.y, def.r, b);
      if (res.hit) {
        v.x += res.x; v.y += res.y;
        if (Math.abs(v.speed) > 120) { applyVehicleDamage(v, 14); sfx.crash(); }
        v.speed *= -0.15;
      }
    }
    // other vehicles (simple block)
    for (const ov of vehicles) {
      if (ov === v) continue;
      const d = dist(v.x, v.y, ov.x, ov.y);
      const minD = def.r + (VEHICLE_DEFS[ov.type].r);
      if (d < minD && d > 0) {
        const push = (minD - d) / 2;
        const ang = Math.atan2(v.y - ov.y, v.x - ov.x);
        v.x += Math.cos(ang) * push; v.y += Math.sin(ang) * push;
        ov.x -= Math.cos(ang) * push; ov.y -= Math.sin(ang) * push;
      }
    }
    // destructible props
    const speedAbs = Math.abs(v.speed);
    for (const p of props) {
      if (!p.alive) continue;
      const pr = PROP_TYPES[p.type].r;
      const d = dist(v.x, v.y, p.x, p.y);
      if (d < pr + def.r) {
        if (speedAbs > 60) {
          const dmg = (speedAbs / 40) * def.ramMul * bumperDealtMul();
          damageProp(p, dmg);
          v.speed *= 0.75;
          applyVehicleDamage(v, Math.min(6, speedAbs / 140));
        } else {
          const ang = Math.atan2(v.y - p.y, v.x - p.x);
          v.x += Math.cos(ang) * 2; v.y += Math.sin(ang) * 2;
          v.speed *= 0.5;
        }
      }
    }
    // junk cars
    for (const jc of junkCars) {
      if (!jc.alive) continue;
      const d = dist(v.x, v.y, jc.x, jc.y);
      if (d < jc.r + def.r) {
        if (speedAbs > 70) {
          damageJunkCar(jc, (speedAbs / 30) * def.ramMul);
          v.speed *= 0.6;
          applyVehicleDamage(v, Math.min(8, speedAbs / 120));
        } else {
          const ang = Math.atan2(v.y - jc.y, v.x - jc.x);
          v.x += Math.cos(ang) * 2; v.y += Math.sin(ang) * 2;
          v.speed *= 0.4;
        }
      }
    }

    if (input.interactEdge) exitVehicleNow();

    showPrompt('Press E — Exit Vehicle    (WASD/Arrows to drive)');
  }

  function applyVehicleDamage(v, dmg) {
    v.hp -= dmg * bumperTakenMul();
    if (v.hp <= 0) { v.hp = 0; v.broken = true; toast(`Your ${v.type} broke down!`); }
  }

  function updatePickups(dt) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      if (p.collected) { pickups.splice(i, 1); continue; }
      p.age += dt;
      p.vx *= 0.9; p.vy *= 0.9;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.age > p.ttl) pickups.splice(i, 1);
    }
  }

  function updateChaosAndInspector(dt) {
    const now = performance.now() / 1000;
    if (now - lastCityHitAt > 4 && chaos > 0) chaos = clamp(chaos - 6 * dt, 0, 100);

    if (!inspector.active && !inspector.pending && chaos >= 70) {
      inspector.pending = true;
      inspector.spawnDelay = 2.2;
    }
    if (inspector.pending) {
      inspector.spawnDelay -= dt;
      if (inspector.spawnDelay <= 0) {
        inspector.pending = false;
        inspector.active = true;
        const a = rng() * Math.PI * 2;
        inspector.x = player.x + Math.cos(a) * 700;
        inspector.y = player.y + Math.sin(a) * 700;
        inspector.giveUpTimer = 0;
        toast('🚨 A Junk Inspector is on your tail!');
      }
    }
    if (inspector.active) {
      const targetX = inVehicle ? inVehicle.x : player.x;
      const targetY = inVehicle ? inVehicle.y : player.y;
      const targetAngle = Math.atan2(targetY - inspector.y, targetX - inspector.x);
      inspector.angle += angleDiff(inspector.angle, targetAngle) * clamp(dt * 3, 0, 1);
      inspector.x += Math.cos(inspector.angle) * inspector.speed * dt;
      inspector.y += Math.sin(inspector.angle) * inspector.speed * dt;
      worldClamp(inspector, 26);

      const d = dist(inspector.x, inspector.y, targetX, targetY);
      const now2 = performance.now() / 1000;
      if (d < 46 && now2 > invulnUntil) {
        bustPlayer();
      }
      if (d > 1500) {
        inspector.giveUpTimer += dt;
        if (inspector.giveUpTimer > 6) {
          inspector.active = false;
          chaos = clamp(chaos - 40, 0, 100);
          toast('The Inspector gave up the chase.');
        }
      } else inspector.giveUpTimer = 0;
    }
  }

  function bustPlayer() {
    const lost = Math.ceil(player.scrap * 0.3);
    player.scrap -= lost;
    dropScrap((inVehicle ? inVehicle.x : player.x), (inVehicle ? inVehicle.y : player.y), Math.min(lost, 12));
    chaos = 0;
    inspector.active = false;
    save.stats.timesBusted++;
    invulnUntil = performance.now() / 1000 + 4;
    sfx.busted();
    bustedBanner.hidden = false;
    setTimeout(() => bustedBanner.hidden = true, 1800);
  }

  function respawnTimers() {
    const now = performance.now() / 1000;
    for (const p of props) if (!p.alive && now > p.respawnAt) { p.alive = true; p.hp = p.maxHp; }
    for (const jc of junkCars) if (!jc.alive && now > jc.respawnAt) { jc.alive = true; jc.hp = jc.maxHp; }
    for (const s of scrapPiles) if (s.units <= 0 && now > s.respawnAt) s.units = s.maxUnits;
  }

  function crushSell() {
    const amt = player.scrap;
    const cash = Math.round(amt * CRUSHER_BONUS_PRICE);
    player.scrap = 0;
    save.cash += cash;
    save.stats.totalCash += cash;
    persist();
    toast(`Crushed ${amt} scrap for $${cash}!`);
    sfx.sell();
  }

  function showPrompt(text) {
    if (!text) { promptEl.hidden = true; return; }
    promptEl.hidden = false;
    promptEl.textContent = text;
  }

  // ---------- Rendering ----------
  function worldToScreen(x, y) {
    return { x: x - camera.x + canvas.width / 2, y: y - camera.y + canvas.height / 2 };
  }

  function draw() {
    const cx = inVehicle ? inVehicle.x : player.x;
    const cy = inVehicle ? inVehicle.y : player.y;
    camera.x = lerp(camera.x, cx, 0.15);
    camera.y = lerp(camera.y, cy, 0.15);

    ctx.fillStyle = '#26282b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(canvas.width / 2 - camera.x, canvas.height / 2 - camera.y);

    // road base across visible world
    ctx.fillStyle = '#3a3d42';
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    // lane dashes
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 4;
    ctx.setLineDash([18, 22]);
    const cols = Math.ceil(WORLD_W / CELL), rows = Math.ceil(WORLD_H / CELL);
    for (let c = 1; c < cols; c++) {
      const x = c * CELL;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_H); ctx.stroke();
    }
    for (let r = 1; r < rows; r++) {
      const y = r * CELL;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_W, y); ctx.stroke();
    }
    ctx.setLineDash([]);

    // lots under buildings (subtle)
    for (const b of buildings) {
      ctx.fillStyle = 'rgba(60,64,58,0.5)';
      ctx.fillRect(b.x - 14, b.y - 14, b.w + 28, b.h + 28);
    }

    // junkyard dirt overlay
    ctx.fillStyle = '#5b4a3a';
    ctx.fillRect(YARD.x, YARD.y, YARD.w, YARD.h);
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < 10; i++) {
      const px = YARD.x + (i * 173) % YARD.w;
      const py = YARD.y + (i * 251) % YARD.h;
      ctx.beginPath(); ctx.ellipse(px, py, 60, 34, 0.4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 6;
    ctx.strokeRect(YARD.x, YARD.y, YARD.w, YARD.h);

    // buildings
    for (const b of buildings) {
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(b.x, b.y + b.h - 10, b.w, 10);
      ctx.fillStyle = 'rgba(255,230,150,0.55)';
      const wcols = Math.max(2, Math.floor(b.w / 40));
      const wrows = Math.max(2, Math.floor(b.h / 40));
      for (let i = 0; i < wcols; i++) for (let j = 0; j < wrows; j++) {
        if ((i + j) % 3 === 0) continue;
        ctx.fillRect(b.x + 10 + i * (b.w / wcols), b.y + 10 + j * (b.h / wrows), 8, 8);
      }
    }

    // junkyard landmarks
    drawYardBuildings();

    // scrap piles
    for (const s of scrapPiles) {
      if (s.units <= 0) continue;
      ctx.fillStyle = '#7d6a4a';
      ctx.beginPath(); ctx.ellipse(s.x, s.y, s.r, s.r * 0.75, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#a89468';
      ctx.beginPath(); ctx.ellipse(s.x - 4, s.y - 8, s.r * 0.6, s.r * 0.45, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(s.units, s.x, s.y + 4);
    }

    // junk cars
    for (const jc of junkCars) {
      if (!jc.alive) continue;
      ctx.save();
      ctx.translate(jc.x, jc.y);
      ctx.fillStyle = '#5a5148';
      ctx.fillRect(-28, -16, 56, 32);
      ctx.fillStyle = '#726858';
      ctx.fillRect(-18, -22, 36, 12);
      ctx.restore();
      drawHpBar(jc.x, jc.y - 34, jc.hp / jc.maxHp, 44);
    }

    // props
    for (const p of props) {
      if (!p.alive) continue;
      const def = PROP_TYPES[p.type];
      ctx.fillStyle = def.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, def.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 2; ctx.stroke();
      if (p.hp < p.maxHp) drawHpBar(p.x, p.y - def.r - 10, p.hp / p.maxHp, def.r * 1.6);
    }

    // pickups (scrap bits)
    for (const pk of pickups) {
      ctx.fillStyle = '#d8b45a';
      ctx.beginPath(); ctx.arc(pk.x, pk.y, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#7a5f28'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // vehicles
    for (const v of vehicles) drawVehicle(v);

    // inspector
    if (inspector.active) drawInspectorCar();

    // player (only if on foot)
    if (!inVehicle) drawPlayer();

    ctx.restore();

    // day/night overlay
    drawDayNight();

    drawMinimap();
    updateHud();
  }

  function drawHpBar(x, y, frac, width) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(x - width / 2, y, width, 5);
    ctx.fillStyle = frac > 0.5 ? '#7ed37e' : frac > 0.25 ? '#e6c05a' : '#e05a5a';
    ctx.fillRect(x - width / 2, y, width * clamp(frac, 0, 1), 5);
  }

  function drawYardBuildings() {
    // Shop
    ctx.fillStyle = '#3f5e8a';
    ctx.fillRect(SHOP.x - SHOP.w / 2, SHOP.y - SHOP.h / 2, SHOP.w, SHOP.h);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('SHOP', SHOP.x, SHOP.y - 4);
    ctx.font = '11px sans-serif'; ctx.fillText('sell + upgrades', SHOP.x, SHOP.y + 12);

    // Crusher
    ctx.fillStyle = '#6a4a3a';
    ctx.fillRect(CRUSHER.x - CRUSHER.w / 2, CRUSHER.y - CRUSHER.h / 2, CRUSHER.w, CRUSHER.h);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif';
    ctx.fillText('CRUSHER', CRUSHER.x, CRUSHER.y - 4);
    ctx.font = '11px sans-serif'; ctx.fillText('bulk bonus price', CRUSHER.x, CRUSHER.y + 12);

    // Garage
    ctx.fillStyle = '#555';
    ctx.fillRect(GARAGE.x - 90, GARAGE.y - 60, 180, 120);
    ctx.fillStyle = '#333';
    ctx.fillRect(GARAGE.x - 70, GARAGE.y - 40, 140, 80);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px sans-serif';
    ctx.fillText('GARAGE', GARAGE.x, GARAGE.y - 70);
  }

  function drawVehicle(v) {
    const def = VEHICLE_DEFS[v.type];
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(v.angle);
    ctx.fillStyle = v.broken ? '#555' : def.color;
    ctx.fillRect(-def.w / 2, -def.h / 2, def.w, def.h);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-def.w / 2 + 6, -def.h / 2 + 4, def.w * 0.4, def.h - 8);
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(def.w / 2 - 6, -def.h / 2 + 3, 4, 5);
    ctx.fillRect(def.w / 2 - 6, def.h / 2 - 8, 4, 5);
    ctx.restore();
    if (v.hp < v.maxHp) drawHpBar(v.x, v.y - def.r - 12, v.hp / v.maxHp, def.w);
  }

  function drawInspectorCar() {
    ctx.save();
    ctx.translate(inspector.x, inspector.y);
    ctx.rotate(inspector.angle);
    ctx.fillStyle = '#1c1c1c';
    ctx.fillRect(-26, -14, 52, 28);
    const flash = Math.floor(performance.now() / 200) % 2 === 0;
    ctx.fillStyle = flash ? '#e03030' : '#3050e0';
    ctx.fillRect(-8, -18, 16, 6);
    ctx.restore();
  }

  function drawPlayer() {
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);
    ctx.fillStyle = '#d8b45a';
    ctx.beginPath(); ctx.arc(0, 0, player.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#7a5f28'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#3a2f1a';
    ctx.beginPath(); ctx.arc(6, 0, 3, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawDayNight() {
    const t = dayTime;
    const night = Math.max(0, Math.sin((t - 0.5) * Math.PI)); // peak at t=1 (midnight wrap) approx
    const darkness = clamp(Math.sin(t * Math.PI * 2 - Math.PI / 2) * -1, -1, 1);
    const alpha = clamp((darkness + 1) / 2 * 0.45, 0, 0.45);
    ctx.fillStyle = `rgba(10,15,40,${alpha})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawMinimap() {
    const w = mini.width, h = mini.height;
    miniCtx.clearRect(0, 0, w, h);
    const sx = w / WORLD_W, sy = h / WORLD_H;
    miniCtx.fillStyle = '#3a3d42';
    miniCtx.fillRect(0, 0, w, h);
    miniCtx.fillStyle = '#5b4a3a';
    miniCtx.fillRect(YARD.x * sx, YARD.y * sy, YARD.w * sx, YARD.h * sy);
    miniCtx.fillStyle = '#666';
    for (const b of buildings) miniCtx.fillRect(b.x * sx, b.y * sy, Math.max(1, b.w * sx), Math.max(1, b.h * sy));
    miniCtx.fillStyle = '#4ade4a';
    const px = (inVehicle ? inVehicle.x : player.x) * sx, py = (inVehicle ? inVehicle.y : player.y) * sy;
    miniCtx.beginPath(); miniCtx.arc(px, py, 4, 0, Math.PI * 2); miniCtx.fill();
    if (inspector.active) {
      miniCtx.fillStyle = '#e03030';
      miniCtx.beginPath(); miniCtx.arc(inspector.x * sx, inspector.y * sy, 4, 0, Math.PI * 2); miniCtx.fill();
    }
  }

  function updateHud() {
    cashPill.textContent = `$${save.cash}`;
    scrapPill.textContent = `Scrap ${player.scrap}/${capacity()}`;
    if (chaos > 0) {
      chaosPill.hidden = false;
      chaosVal.textContent = Math.round(chaos);
    } else chaosPill.hidden = true;

    if (inVehicle) {
      vehicleBarWrap.hidden = false;
      const frac = inVehicle.hp / inVehicle.maxHp;
      vehicleBar.style.width = `${frac * 100}%`;
      vehicleBar.style.background = frac > 0.5 ? 'linear-gradient(90deg,#5fd35f,#9ee65f)' : frac > 0.25 ? 'linear-gradient(90deg,#e6c05a,#f0d987)' : 'linear-gradient(90deg,#e05a5a,#f08a8a)';
    } else vehicleBarWrap.hidden = true;
  }

  // ---------- Shop UI ----------
  const shopModal = el('shopModal');
  document.querySelectorAll('.tabBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabBtn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tabPane').forEach(p => p.hidden = true);
      btn.classList.add('active');
      el(`tab-${btn.dataset.tab}`).hidden = false;
      if (btn.dataset.tab === 'upgrades') renderUpgrades();
      if (btn.dataset.tab === 'stats') renderStats();
    });
  });
  function openShop() {
    paused = true;
    shopModal.hidden = false;
    renderSell();
    renderUpgrades();
    renderStats();
  }
  el('closeShop').addEventListener('click', () => { shopModal.hidden = true; paused = false; });
  function renderSell() {
    el('sellCount').textContent = player.scrap;
    el('sellValue').textContent = `$${player.scrap * SELL_PRICE}`;
  }
  el('sellAllBtn').addEventListener('click', () => {
    if (player.scrap <= 0) { toast('No scrap to sell'); return; }
    const cash = player.scrap * SELL_PRICE;
    save.cash += cash;
    save.stats.totalCash += cash;
    player.scrap = 0;
    persist();
    renderSell();
    toast(`Sold for $${cash}`);
    sfx.sell();
  });

  function renderUpgrades() {
    const list = el('upgradeList');
    list.innerHTML = '';
    const rows = [];

    // Work boots
    if (save.speedLvl < SPEED_COSTS.length) {
      const cost = SPEED_COSTS[save.speedLvl];
      rows.push(mkUpgradeRow('Work Boots', `Move faster on foot (Lv.${save.speedLvl + 1}/${SPEED_COSTS.length + 1})`, `$${cost}`, save.cash >= cost, () => {
        save.cash -= cost; save.speedLvl++; persist(); renderUpgrades(); toast('Faster on your feet!'); sfx.buy();
      }));
    } else rows.push(mkUpgradeRow('Work Boots', 'Max level reached', 'MAX', false, null, true));

    // Bag
    if (save.capLvl < CAP_COSTS.length) {
      const cost = CAP_COSTS[save.capLvl];
      rows.push(mkUpgradeRow('Scrap Bag', `Carry more scrap (Lv.${save.capLvl + 1}/${CAP_COSTS.length + 1})`, `$${cost}`, save.cash >= cost, () => {
        save.cash -= cost; save.capLvl++; persist(); renderUpgrades(); toast('Bigger bag equipped!'); sfx.buy();
      }));
    } else rows.push(mkUpgradeRow('Scrap Bag', 'Max level reached', 'MAX', false, null, true));

    // Magnet
    if (save.magnetLvl < MAGNET_COSTS.length) {
      const cost = MAGNET_COSTS[save.magnetLvl];
      rows.push(mkUpgradeRow('Scrap Magnet', `Auto-pull nearby scrap (Lv.${save.magnetLvl + 1}/${MAGNET_COSTS.length})`, `$${cost}`, save.cash >= cost, () => {
        save.cash -= cost; save.magnetLvl++; persist(); renderUpgrades(); toast('Magnet upgraded!'); sfx.buy();
      }));
    } else rows.push(mkUpgradeRow('Scrap Magnet', 'Max level reached', 'MAX', false, null, true));

    // Bumper
    if (save.bumperLvl < BUMPER_COSTS.length) {
      const cost = BUMPER_COSTS[save.bumperLvl];
      rows.push(mkUpgradeRow('Reinforced Bumper', 'Take less crash damage, smash harder', `$${cost}`, save.cash >= cost, () => {
        save.cash -= cost; save.bumperLvl++; persist(); renderUpgrades(); toast('Bumper reinforced!'); sfx.buy();
      }));
    } else rows.push(mkUpgradeRow('Reinforced Bumper', 'Max level reached', 'MAX', false, null, true));

    // Sledgehammer
    if (!save.sledgehammer) {
      rows.push(mkUpgradeRow('Sledgehammer', 'Smash small props & wrecks on foot', `$${SLEDGE_COST}`, save.cash >= SLEDGE_COST, () => {
        save.cash -= SLEDGE_COST; save.sledgehammer = true; persist(); renderUpgrades(); toast('Sledgehammer acquired!'); sfx.buy();
      }));
    } else rows.push(mkUpgradeRow('Sledgehammer', 'Owned', 'OWNED', false, null, true));

    // Truck
    if (!save.truckOwned) {
      rows.push(mkUpgradeRow('Pickup Truck', 'Tougher, harder-hitting second vehicle', `$${TRUCK_COST}`, save.cash >= TRUCK_COST, () => {
        save.cash -= TRUCK_COST; save.truckOwned = true; persist();
        vehicles.push({ x: GARAGE.x - 90, y: GARAGE.y, angle: 0, vx: 0, vy: 0, speed: 0, type: 'truck', owned: true, hp: 150, maxHp: 150, broken: false, id: 'truck' });
        renderUpgrades(); toast('Truck delivered to the Garage!'); sfx.buy();
      }));
    } else rows.push(mkUpgradeRow('Pickup Truck', 'Owned', 'OWNED', false, null, true));

    rows.forEach(r => list.appendChild(r));
  }
  function mkUpgradeRow(name, desc, costLabel, affordable, onBuy, maxed) {
    const row = document.createElement('div');
    row.className = 'upgradeRow';
    row.innerHTML = `<div class="upgradeInfo"><div class="name">${name}</div><div class="desc">${desc}</div></div>`;
    const btn = document.createElement('button');
    btn.className = 'buyBtn' + (maxed ? ' maxed' : '');
    btn.textContent = costLabel;
    btn.disabled = maxed || !affordable;
    if (onBuy) btn.addEventListener('click', onBuy);
    row.appendChild(btn);
    return row;
  }

  function renderStats() {
    const s = save.stats;
    el('statsList').innerHTML = `
      <div>Total scrap collected: <b>${s.totalScrap}</b></div>
      <div>Total cash earned: <b>$${s.totalCash}</b></div>
      <div>Props destroyed: <b>${s.propsDestroyed}</b></div>
      <div>Times busted: <b>${s.timesBusted}</b></div>
    `;
  }
  el('resetSaveBtn').addEventListener('click', () => {
    if (confirm('Reset all progress? This cannot be undone.')) {
      save = structuredClone(defaultSave);
      persist();
      renderUpgrades(); renderStats(); renderSell();
      toast('Save reset.');
    }
  });

  // ---------- Pause / Map ----------
  const pauseModal = el('pauseModal');
  function togglePause() {
    if (!started) return;
    if (!shopModal.hidden || !el('bigMap').hidden) return;
    paused = !paused;
    pauseModal.hidden = !paused;
  }
  el('closePause').addEventListener('click', () => { paused = false; pauseModal.hidden = true; });
  el('resumeBtn').addEventListener('click', () => { paused = false; pauseModal.hidden = true; });

  const bigMapModal = el('bigMap');
  function toggleBigMap() {
    if (!started) return;
    const show = bigMapModal.hidden;
    bigMapModal.hidden = !show;
    paused = show;
    if (show) drawBigMap();
  }
  el('closeBigMap').addEventListener('click', () => { bigMapModal.hidden = true; paused = false; });
  function drawBigMap() {
    const w = Math.min(580, window.innerWidth - 60);
    const h = w * (WORLD_H / WORLD_W);
    bigMapCanvas.width = w; bigMapCanvas.height = h;
    const sx = w / WORLD_W, sy = h / WORLD_H;
    bigMapCtx.fillStyle = '#3a3d42'; bigMapCtx.fillRect(0, 0, w, h);
    bigMapCtx.fillStyle = '#5b4a3a'; bigMapCtx.fillRect(YARD.x * sx, YARD.y * sy, YARD.w * sx, YARD.h * sy);
    bigMapCtx.fillStyle = '#777';
    for (const b of buildings) bigMapCtx.fillRect(b.x * sx, b.y * sy, Math.max(1, b.w * sx), Math.max(1, b.h * sy));
    bigMapCtx.fillStyle = '#3f5e8a'; bigMapCtx.fillRect(SHOP.x * sx - 4, SHOP.y * sy - 4, 8, 8);
    bigMapCtx.fillStyle = '#6a4a3a'; bigMapCtx.fillRect(CRUSHER.x * sx - 4, CRUSHER.y * sy - 4, 8, 8);
    bigMapCtx.fillStyle = '#999'; bigMapCtx.fillRect(GARAGE.x * sx - 4, GARAGE.y * sy - 4, 8, 8);
    bigMapCtx.fillStyle = '#4ade4a';
    const px = (inVehicle ? inVehicle.x : player.x) * sx, py = (inVehicle ? inVehicle.y : player.y) * sy;
    bigMapCtx.beginPath(); bigMapCtx.arc(px, py, 5, 0, Math.PI * 2); bigMapCtx.fill();
  }

  // ---------- Main loop ----------
  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    if (started && !paused) update(dt);
    if (started) draw();
    if (now % 3000 < 20) persist();
    requestAnimationFrame(frame);
  }

  el('startBtn').addEventListener('click', () => {
    el('startScreen').hidden = true;
    started = true;
    resize();
    requestAnimationFrame(t => { lastTime = t; requestAnimationFrame(frame); });
  });

  window.addEventListener('beforeunload', persist);
  resize();
})();
