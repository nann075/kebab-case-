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

// ---- ゲーム状態 ----
const state = {
  floor: 1,
  dungeon: null,
  enemies: [],
  player: {
    x: 0, y: 0,
    hp: 20, maxHp: 20,
    atk: 4, def: 1,
    level: 1,
  },
  gameOver: false,
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
  state.player.atk = 4;
  state.player.def = 1;
  state.player.level = 1;
  state.gameOver = false;
  state.messages = [];
  document.getElementById('overlay').style.display = 'none';
  startFloor(1, false);
}

// ---- 戦闘 ----
function attack(attacker, defenderHpObj, atkStat, defStat, defenderName) {
  const variance = randInt(-1, 2);
  const dmg = Math.max(1, atkStat - defStat + variance);
  defenderHpObj.hp -= dmg;
  return dmg;
}

function playerAttackEnemy(enemy) {
  const dmg = Math.max(1, state.player.atk - 0 + randInt(-1, 2));
  enemy.hp -= dmg;
  log(`あなたは${enemy.name}に${dmg}のダメージ！`);
  if (enemy.hp <= 0) {
    enemy.alive = false;
    log(`${enemy.name}を倒した！`);
    maybeLevelUp();
  } else {
    const edmg = Math.max(1, enemy.atk - state.player.def + randInt(-1, 1));
    state.player.hp -= edmg;
    log(`${enemy.name}の反撃！ ${edmg}のダメージを受けた`);
  }
}

function maybeLevelUp() {
  const killed = state.enemies.filter((e) => !e.alive).length;
  if (killed > 0 && killed % 3 === 0) {
    state.player.level++;
    state.player.maxHp += 5;
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + 5);
    state.player.atk += 1;
    log(`レベルアップ！ Lv${state.player.level}になった`);
  }
}

// ---- 敵AI ----
function enemyTurn() {
  for (const enemy of state.enemies) {
    if (!enemy.alive) continue;
    const dx = state.player.x - enemy.x;
    const dy = state.player.y - enemy.y;
    const dist = Math.abs(dx) + Math.abs(dy);

    if (dist === 1) {
      const dmg = Math.max(1, enemy.atk - state.player.def + randInt(-1, 1));
      state.player.hp -= dmg;
      log(`${enemy.name}の攻撃！ ${dmg}のダメージを受けた`);
      continue;
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

  if (state.player.hp <= 0) {
    endGame(false);
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
  if (state.gameOver) return;

  const nx = state.player.x + dx;
  const ny = state.player.y + dy;

  if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) return;
  if (state.dungeon.map[ny][nx] === TILE.WALL) return;

  const target = state.enemies.find((en) => en.alive && en.x === nx && en.y === ny);
  if (target) {
    playerAttackEnemy(target);
  } else {
    state.player.x = nx;
    state.player.y = ny;
    if (state.dungeon.map[ny][nx] === TILE.STAIRS) {
      startFloor(state.floor + 1, true);
      return;
    }
  }

  if (state.player.hp <= 0) {
    endGame(false);
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
    `攻撃力: <span>${p.atk}</span> / 防御力: <span>${p.def}</span><br>` +
    `レベル: <span>${p.level}</span>`;
}

function renderLog() {
  const logEl = document.getElementById('log');
  logEl.innerHTML = state.messages.map((m) => `<div>${m}</div>`).join('');
  logEl.scrollTop = logEl.scrollHeight;
}

// ---- 開始 ----
newGame();
