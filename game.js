'use strict';

// ---- 定数 ----
const TILE_SIZE = 20;
const MAP_W = 36;
const MAP_H = 24;
const ROOM_ATTEMPTS = 14;

const TILE = { WALL: 0, FLOOR: 1, STAIRS: 2 };

const COLORS = {
  wall: '#2a2a2a',
  floor: '#4a4a4a',
  stairs: '#e8c547',
  player: '#4fc3f7',
  enemy: '#e05555',
  playerText: '#e8f9ff',
};

// ---- ユーティリティ ----
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function choice(arr) {
  return arr[randInt(0, arr.length - 1)];
}

// ---- ダンジョン生成 ----
function rectsOverlap(a, b, pad) {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}

function carveRoom(map, room) {
  for (let y = room.y; y < room.y + room.h; y++) {
    for (let x = room.x; x < room.x + room.w; x++) {
      map[y][x] = TILE.FLOOR;
    }
  }
}

function carveCorridor(map, x1, y1, x2, y2) {
  let x = x1, y = y1;
  const horizontalFirst = Math.random() < 0.5;
  if (horizontalFirst) {
    while (x !== x2) { map[y][x] = TILE.FLOOR; x += x < x2 ? 1 : -1; }
    while (y !== y2) { map[y][x] = TILE.FLOOR; y += y < y2 ? 1 : -1; }
  } else {
    while (y !== y2) { map[y][x] = TILE.FLOOR; y += y < y2 ? 1 : -1; }
    while (x !== x2) { map[y][x] = TILE.FLOOR; x += x < x2 ? 1 : -1; }
  }
  map[y][x] = TILE.FLOOR;
}

function roomCenter(room) {
  return {
    x: Math.floor(room.x + room.w / 2),
    y: Math.floor(room.y + room.h / 2),
  };
}

function generateDungeon() {
  const map = [];
  for (let y = 0; y < MAP_H; y++) {
    map.push(new Array(MAP_W).fill(TILE.WALL));
  }

  const rooms = [];
  for (let i = 0; i < ROOM_ATTEMPTS; i++) {
    const w = randInt(4, 8);
    const h = randInt(3, 6);
    const x = randInt(1, MAP_W - w - 2);
    const y = randInt(1, MAP_H - h - 2);
    const newRoom = { x, y, w, h };

    if (rooms.some((r) => rectsOverlap(r, newRoom, 1))) continue;

    carveRoom(map, newRoom);
    if (rooms.length > 0) {
      const prevCenter = roomCenter(rooms[rooms.length - 1]);
      const newCenter = roomCenter(newRoom);
      carveCorridor(map, prevCenter.x, prevCenter.y, newCenter.x, newCenter.y);
    }
    rooms.push(newRoom);
  }

  // 万一部屋が1つ以下の場合は再生成
  if (rooms.length < 2) return generateDungeon();

  const startRoom = rooms[0];
  const stairsRoom = rooms[rooms.length - 1];
  const start = roomCenter(startRoom);
  const stairs = roomCenter(stairsRoom);
  map[stairs.y][stairs.x] = TILE.STAIRS;

  return { map, rooms, start, stairs };
}

// ---- モンスター定義 ----
const MONSTER_TYPES = [
  { name: 'スライム', symbol: 's', hpBase: 4, atkBase: 1, color: '#66bb6a' },
  { name: 'ゴブリン', symbol: 'g', hpBase: 6, atkBase: 2, color: '#e05555' },
  { name: 'オーク', symbol: 'o', hpBase: 10, atkBase: 3, color: '#ab47bc' },
];

function spawnEnemies(dungeon, floor, playerStart) {
  const enemies = [];
  const enemyCount = Math.min(3 + Math.floor(floor / 2), 10);
  const rooms = dungeon.rooms.slice(1); // 開始部屋には出さない

  for (let i = 0; i < enemyCount && rooms.length > 0; i++) {
    const room = choice(rooms);
    const x = randInt(room.x, room.x + room.w - 1);
    const y = randInt(room.y, room.y + room.h - 1);

    if (dungeon.map[y][x] !== TILE.FLOOR) continue;
    if (x === playerStart.x && y === playerStart.y) continue;
    if (enemies.some((e) => e.x === x && e.y === y)) continue;

    const type = choice(MONSTER_TYPES);
    const scale = 1 + Math.floor((floor - 1) * 0.5);
    enemies.push({
      x, y,
      name: type.name,
      color: type.color,
      hp: type.hpBase + scale * 2,
      maxHp: type.hpBase + scale * 2,
      atk: type.atkBase + Math.floor((floor - 1) / 2),
      alive: true,
    });
  }
  return enemies;
}

// ---- カード定義 ----
const CARD_LIBRARY = {
  strike: { id: 'strike', name: 'ストライク', cost: 1, type: 'attack', damage: 6, desc: '6ダメージを与える' },
  defend: { id: 'defend', name: 'ディフェンド', cost: 1, type: 'skill', block: 5, desc: '5ブロックを得る' },
  bash: { id: 'bash', name: 'バッシュ', cost: 2, type: 'attack', damage: 10, desc: '10ダメージを与える' },
  iron_wave: { id: 'iron_wave', name: 'アイアンウェーブ', cost: 1, type: 'attack', damage: 5, block: 5, desc: '5ダメージを与え、5ブロックを得る' },
  double_strike: { id: 'double_strike', name: 'ダブルストライク', cost: 1, type: 'attack', damage: 4, hits: 2, desc: '4ダメージを2回与える' },
  shield_bash: { id: 'shield_bash', name: 'シールドバッシュ', cost: 1, type: 'skill', block: 9, desc: '9ブロックを得る' },
  quick_slash: { id: 'quick_slash', name: 'クイックスラッシュ', cost: 0, type: 'attack', damage: 3, desc: '0コストで3ダメージを与える' },
};

const STARTER_DECK = [
  'strike', 'strike', 'strike', 'strike', 'strike',
  'defend', 'defend', 'defend', 'defend',
  'bash',
];

const REWARD_POOL = ['bash', 'iron_wave', 'double_strike', 'shield_bash', 'quick_slash', 'strike', 'defend'];

function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickRandomUnique(pool, n) {
  const copy = [...pool];
  const result = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    result.push(copy.splice(randInt(0, copy.length - 1), 1)[0]);
  }
  return result;
}

// ---- ゲーム状態 ----
const state = {
  floor: 1,
  dungeon: null,
  enemies: [],
  player: {
    x: 0, y: 0,
    hp: 20, maxHp: 20,
    level: 1,
    deck: [],
  },
  gameOver: false,
  mode: 'explore', // 'explore' | 'battle' | 'reward'
  battle: null,
  messages: [],
};

function log(msg) {
  state.messages.push(msg);
  if (state.messages.length > 50) state.messages.shift();
  renderLog();
}

function startFloor(floor, healOnEnter) {
  state.floor = floor;
  state.dungeon = generateDungeon();
  state.player.x = state.dungeon.start.x;
  state.player.y = state.dungeon.start.y;
  state.enemies = spawnEnemies(state.dungeon, floor, state.dungeon.start);
  if (healOnEnter) {
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + 5);
  }
  log(`--- ${floor}階に降り立った ---`);
  renderStats();
  render();
}

function newGame() {
  state.player.hp = 20;
  state.player.maxHp = 20;
  state.player.level = 1;
  state.player.deck = [...STARTER_DECK];
  state.gameOver = false;
  state.mode = 'explore';
  state.battle = null;
  state.messages = [];
  document.getElementById('overlay').style.display = 'none';
  document.getElementById('battleOverlay').style.display = 'none';
  document.getElementById('rewardOverlay').style.display = 'none';
  startFloor(1, false);
}

function maybeLevelUp() {
  const killed = state.enemies.filter((e) => !e.alive).length;
  if (killed > 0 && killed % 3 === 0) {
    state.player.level++;
    state.player.maxHp += 5;
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + 5);
    log(`レベルアップ！ Lv${state.player.level}になった`);
  }
}

// ---- カードバトル ----
function startBattle(enemy) {
  state.mode = 'battle';
  state.battle = {
    enemy,
    draw: shuffleArray([...state.player.deck]),
    hand: [],
    discard: [],
    energy: 3,
    maxEnergy: 3,
    block: 0,
  };
  document.getElementById('battleOverlay').style.display = 'flex';
  log(`${enemy.name}が現れた！ バトル開始`);
  startPlayerTurn();
}

function startPlayerTurn() {
  const b = state.battle;
  b.block = 0;
  b.energy = b.maxEnergy;
  drawCards(5);
  renderBattle();
}

function drawCards(n) {
  const b = state.battle;
  for (let i = 0; i < n; i++) {
    if (b.draw.length === 0) {
      if (b.discard.length === 0) break;
      b.draw = shuffleArray(b.discard);
      b.discard = [];
      log('捨て札をシャッフルして山札に戻した');
    }
    b.hand.push(b.draw.pop());
  }
}

function playCard(index) {
  const b = state.battle;
  const cardId = b.hand[index];
  const card = CARD_LIBRARY[cardId];
  if (card.cost > b.energy) return;

  b.energy -= card.cost;
  b.hand.splice(index, 1);
  b.discard.push(cardId);

  if (card.damage) {
    const hits = card.hits || 1;
    b.enemy.hp -= card.damage * hits;
    log(`${card.name}で${b.enemy.name}に${card.damage * hits}ダメージ！`);
  }
  if (card.block) {
    b.block += card.block;
    log(`${card.name}でブロック${card.block}を得た`);
  }

  if (b.enemy.hp <= 0) {
    winBattle();
    return;
  }
  renderBattle();
}

function endPlayerTurn() {
  const b = state.battle;
  b.discard.push(...b.hand);
  b.hand = [];
  renderBattle();
  enemyBattleAttack();
}

function enemyBattleAttack() {
  const b = state.battle;
  const dmg = Math.max(0, b.enemy.atk - b.block);
  b.block = Math.max(0, b.block - b.enemy.atk);
  state.player.hp -= dmg;
  log(`${b.enemy.name}の攻撃！ ${dmg}ダメージを受けた`);

  if (state.player.hp <= 0) {
    document.getElementById('battleOverlay').style.display = 'none';
    endGame(false);
    return;
  }
  startPlayerTurn();
}

function winBattle() {
  const enemy = state.battle.enemy;
  enemy.alive = false;
  log(`${enemy.name}を倒した！`);
  maybeLevelUp();
  state.mode = 'reward';
  document.getElementById('battleOverlay').style.display = 'none';
  state.battle = null;
  renderStats();
  render();
  showReward();
}

function buildCardElement(cardId) {
  const card = CARD_LIBRARY[cardId];
  const div = document.createElement('div');
  div.className = `card ${card.type}`;
  div.innerHTML =
    `<div class="cost">${card.cost}</div>` +
    `<div class="cardName">${card.name}</div>` +
    `<div class="cardDesc">${card.desc}</div>`;
  return div;
}

function renderBattle() {
  const b = state.battle;
  if (!b) return;

  document.getElementById('battleEnemyName').textContent = b.enemy.name;
  document.getElementById('battleEnemyHpText').textContent = `${Math.max(0, b.enemy.hp)} / ${b.enemy.maxHp}`;
  document.getElementById('battleEnemyHpBar').style.width = `${Math.max(0, b.enemy.hp) / b.enemy.maxHp * 100}%`;
  document.getElementById('battleEnemyIntent').textContent = `次の攻撃: ${b.enemy.atk}ダメージ`;
  document.getElementById('battlePlayerHp').textContent = `${Math.max(0, state.player.hp)} / ${state.player.maxHp}`;
  document.getElementById('battlePlayerBlock').textContent = b.block;
  document.getElementById('battlePlayerEnergy').textContent = `${b.energy} / ${b.maxEnergy}`;

  const handEl = document.getElementById('hand');
  handEl.innerHTML = '';
  b.hand.forEach((cardId, idx) => {
    const card = CARD_LIBRARY[cardId];
    const div = buildCardElement(cardId);
    if (card.cost > b.energy) div.classList.add('disabled');
    div.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      playCard(idx);
    });
    handEl.appendChild(div);
  });
}

function showReward() {
  const overlay = document.getElementById('rewardOverlay');
  const container = document.getElementById('rewardCards');
  container.innerHTML = '';

  const picks = pickRandomUnique(REWARD_POOL, 3);
  picks.forEach((cardId) => {
    const div = buildCardElement(cardId);
    div.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      state.player.deck.push(cardId);
      log(`デッキに「${CARD_LIBRARY[cardId].name}」を加えた`);
      closeReward();
    });
    container.appendChild(div);
  });
  overlay.style.display = 'flex';
}

function closeReward() {
  document.getElementById('rewardOverlay').style.display = 'none';
  state.mode = 'explore';
  renderStats();
}

document.getElementById('skipRewardBtn').addEventListener('click', closeReward);
document.getElementById('endTurnBtn').addEventListener('click', () => {
  if (state.mode === 'battle') endPlayerTurn();
});

// ---- 敵AI ----
function enemyTurn() {
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const dx = state.player.x - enemy.x;
    const dy = state.player.y - enemy.y;
    const dist = Math.abs(dx) + Math.abs(dy);

    if (dist === 1) {
      startBattle(enemy);
      return;
    }

    if (dist <= 6) {
      let nx = enemy.x, ny = enemy.y;
      if (Math.abs(dx) > Math.abs(dy)) {
        nx += dx > 0 ? 1 : -1;
      } else {
        ny += dy > 0 ? 1 : -1;
      }
      if (canMoveTo(nx, ny) && !(nx === state.player.x && ny === state.player.y)) {
        enemy.x = nx;
        enemy.y = ny;
      }
    }
  }
}

function canMoveTo(x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  if (state.dungeon.map[y][x] === TILE.WALL) return false;
  if (state.enemies.some((e) => e.alive && e.x === x && e.y === y)) return false;
  return true;
}

// ---- 入力処理 ----
const DIRS = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
  w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
};

function tryMove(dx, dy) {
  if (state.mode !== 'explore' || state.gameOver) return;

  const nx = state.player.x + dx;
  const ny = state.player.y + dy;

  if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) return;
  if (state.dungeon.map[ny][nx] === TILE.WALL) return;

  const target = state.enemies.find((en) => en.alive && en.x === nx && en.y === ny);
  if (target) {
    startBattle(target);
    return;
  }

  state.player.x = nx;
  state.player.y = ny;
  if (state.dungeon.map[ny][nx] === TILE.STAIRS) {
    startFloor(state.floor + 1, true);
    return;
  }

  enemyTurn();
  renderStats();
  render();
}

function handleKey(e) {
  const dir = DIRS[e.key];
  if (!dir) return;
  e.preventDefault();
  tryMove(dir[0], dir[1]);
}

function endGame(won) {
  state.gameOver = true;
  const overlay = document.getElementById('overlay');
  const text = document.getElementById('overlayText');
  text.textContent = won ? 'クリア！' : 'ゲームオーバー';
  overlay.style.display = 'flex';
  render();
}

window.addEventListener('keydown', handleKey);
document.getElementById('restartBtn').addEventListener('click', newGame);

// ---- 画面上の方向ボタン (スマホ向け) ----
const DPAD_DIRS = {
  dpUp: [0, -1], dpDown: [0, 1], dpLeft: [-1, 0], dpRight: [1, 0],
};
for (const id in DPAD_DIRS) {
  const btn = document.getElementById(id);
  const [dx, dy] = DPAD_DIRS[id];
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    tryMove(dx, dy);
  });
}

// ---- 描画 ----
const canvas = document.getElementById('game');
canvas.width = MAP_W * TILE_SIZE;
canvas.height = MAP_H * TILE_SIZE;
const ctx = canvas.getContext('2d');

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const map = state.dungeon.map;

  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const t = map[y][x];
      let color = COLORS.wall;
      if (t === TILE.FLOOR) color = COLORS.floor;
      if (t === TILE.STAIRS) color = COLORS.stairs;
      ctx.fillStyle = color;
      ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE - 1, TILE_SIZE - 1);
    }
  }

  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    ctx.fillStyle = enemy.color;
    ctx.beginPath();
    ctx.arc(
      enemy.x * TILE_SIZE + TILE_SIZE / 2,
      enemy.y * TILE_SIZE + TILE_SIZE / 2,
      TILE_SIZE / 2 - 3, 0, Math.PI * 2
    );
    ctx.fill();
  }

  ctx.fillStyle = COLORS.player;
  ctx.beginPath();
  ctx.arc(
    state.player.x * TILE_SIZE + TILE_SIZE / 2,
    state.player.y * TILE_SIZE + TILE_SIZE / 2,
    TILE_SIZE / 2 - 2, 0, Math.PI * 2
  );
  ctx.fill();
}

function renderStats() {
  const p = state.player;
  document.getElementById('stats').innerHTML =
    `階層: <span>${state.floor}</span><br>` +
    `HP: <span>${Math.max(0, p.hp)} / ${p.maxHp}</span><br>` +
    `レベル: <span>${p.level}</span><br>` +
    `デッキ枚数: <span>${p.deck.length}</span>`;
}

function renderLog() {
  const html = state.messages.map((m) => `<div>${m}</div>`).join('');
  for (const id of ['log', 'battleLog']) {
    const el = document.getElementById(id);
    el.innerHTML = html;
    el.scrollTop = el.scrollHeight;
  }
}

// ---- 開始 ----
newGame();
