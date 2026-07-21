'use strict';

// ---- ユーティリティ ----
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function choice(arr) {
  return arr[randInt(0, arr.length - 1)];
}
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

// ---- 難易度定義 ----
const DIFFICULTIES = {
  easy: { label: 'かんたん', playerMaxHp: 22, enemyHpMult: 0.9, enemyAtkMult: 0.95 },
  normal: { label: 'ふつう', playerMaxHp: 20, enemyHpMult: 1.0, enemyAtkMult: 1.0 },
  hard: { label: 'むずかしい', playerMaxHp: 16, enemyHpMult: 1.3, enemyAtkMult: 1.3 },
};

// ---- モンスター定義 ----
const MONSTER_TYPES = [
  { name: 'スライム', hpBase: 14, atkBase: 4 },
  { name: 'ゴブリン', hpBase: 20, atkBase: 6 },
  { name: 'オーク', hpBase: 28, atkBase: 8 },
];

function spawnEnemyForFloor(floor) {
  const type = choice(MONSTER_TYPES);
  const diff = DIFFICULTIES[state.difficulty];
  const scale = Math.floor((floor - 1) * 0.3);
  const hp = Math.round((type.hpBase + scale) * diff.enemyHpMult);
  return {
    name: type.name,
    hp,
    maxHp: hp,
    atk: Math.round((type.atkBase + Math.floor((floor - 1) / 8)) * diff.enemyAtkMult),
    alive: true,
  };
}

// ---- カード定義 ----
const CARD_LIBRARY = {
  strike: { id: 'strike', name: 'ストライク', cost: 1, type: 'attack', damage: 6, desc: '6ダメージを与える' },
  defend: { id: 'defend', name: 'ディフェンド', cost: 1, type: 'skill', block: 6, desc: '6ブロックを得る' },
  bash: { id: 'bash', name: 'バッシュ', cost: 2, type: 'attack', damage: 12, desc: '12ダメージを与える' },
  iron_wave: { id: 'iron_wave', name: 'アイアンウェーブ', cost: 2, type: 'attack', damage: 6, block: 8, desc: '6ダメージを与え、8ブロックを得る' },
  double_strike: { id: 'double_strike', name: 'ダブルストライク', cost: 1, type: 'attack', damage: 3, hits: 2, desc: '3ダメージを2回与える' },
  shield_bash: { id: 'shield_bash', name: 'シールドバッシュ', cost: 1, type: 'skill', block: 6, desc: '6ブロックを得る' },
  quick_slash: { id: 'quick_slash', name: 'クイックスラッシュ', cost: 0, type: 'attack', damage: 4, desc: '0コストで4ダメージを与える' },
};

const STARTER_DECK = [
  'strike', 'strike', 'strike', 'strike', 'strike',
  'defend', 'defend', 'defend', 'defend',
  'bash',
];

const REWARD_POOL = ['bash', 'iron_wave', 'double_strike', 'shield_bash', 'quick_slash', 'strike', 'defend'];

const MAX_FLOOR = 100;

// ---- ゲーム状態 ----
const state = {
  floor: 1,
  killCount: 0,
  difficulty: 'normal',
  player: {
    hp: 20, maxHp: 20,
    level: 1,
    deck: [],
  },
  enemy: null,
  battle: null,
  gameOver: false,
  mode: 'battle', // 'battle' | 'reward'
  messages: [],
};

function log(msg) {
  state.messages.push(msg);
  if (state.messages.length > 50) state.messages.shift();
  renderLog();
}

function renderLog() {
  const el = document.getElementById('log');
  el.innerHTML = state.messages.map((m) => `<div>${m}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}

function renderStats() {
  const p = state.player;
  document.getElementById('stats').innerHTML =
    `難易度: <span>${DIFFICULTIES[state.difficulty].label}</span> / 階層: <span>${state.floor}</span><br>` +
    `HP: <span>${Math.max(0, p.hp)} / ${p.maxHp}</span><br>` +
    `レベル: <span>${p.level}</span> / デッキ枚数: <span>${p.deck.length}</span>`;
}

function newGame(difficultyKey) {
  state.difficulty = difficultyKey;
  const diff = DIFFICULTIES[difficultyKey];
  state.player.hp = diff.playerMaxHp;
  state.player.maxHp = diff.playerMaxHp;
  state.player.level = 1;
  state.player.deck = [...STARTER_DECK];
  state.killCount = 0;
  state.gameOver = false;
  state.messages = [];
  document.getElementById('overlay').style.display = 'none';
  document.getElementById('rewardOverlay').style.display = 'none';
  document.getElementById('menuOverlay').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  startFloor(1);
}

function backToMenu() {
  document.getElementById('overlay').style.display = 'none';
  document.getElementById('app').style.display = 'none';
  document.getElementById('menuOverlay').style.display = 'flex';
}

function startFloor(floor) {
  state.floor = floor;
  state.enemy = spawnEnemyForFloor(floor);
  log(`--- ${floor}階 ---`);
  renderStats();
  startBattle();
}

function maybeLevelUp() {
  state.killCount++;
  if (state.killCount % 3 === 0) {
    state.player.level++;
    state.player.maxHp += 11;
    state.player.hp = Math.min(state.player.maxHp, state.player.hp + 11);
    log(`レベルアップ！ Lv${state.player.level}になった`);
  }
}

// ---- カードバトル ----
function startBattle() {
  state.mode = 'battle';
  state.battle = {
    draw: shuffleArray([...state.player.deck]),
    hand: [],
    discard: [],
    energy: 3,
    maxEnergy: 3,
    block: 0,
  };
  log(`${state.enemy.name}が現れた！`);
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
  if (!b || state.mode !== 'battle' || state.gameOver) return;
  const cardId = b.hand[index];
  if (!cardId) return;
  const card = CARD_LIBRARY[cardId];
  if (card.cost > b.energy) return;

  b.energy -= card.cost;
  b.hand.splice(index, 1);
  b.discard.push(cardId);

  if (card.damage) {
    const hits = card.hits || 1;
    state.enemy.hp -= card.damage * hits;
    log(`${card.name}で${state.enemy.name}に${card.damage * hits}ダメージ！`);
  }
  if (card.block) {
    b.block += card.block;
    log(`${card.name}でブロック${card.block}を得た`);
  }

  if (state.enemy.hp <= 0) {
    winBattle();
    return;
  }
  renderBattle();
}

function endPlayerTurn() {
  const b = state.battle;
  b.discard.push(...b.hand);
  b.hand = [];
  log('--- ターン終了 ---');
  renderBattle();
  enemyBattleAttack();
}

function enemyBattleAttack() {
  const b = state.battle;
  const dmg = Math.max(0, state.enemy.atk - b.block);
  b.block = Math.max(0, b.block - state.enemy.atk);
  state.player.hp -= dmg;
  log(`${state.enemy.name}の攻撃！ ${dmg}ダメージを受けた`);

  if (state.player.hp <= 0) {
    endGame(false);
    return;
  }
  startPlayerTurn();
}

function winBattle() {
  state.enemy.alive = false;
  log(`${state.enemy.name}を倒した！`);
  maybeLevelUp();
  renderStats();

  if (state.floor >= MAX_FLOOR) {
    endGame(true);
    return;
  }

  state.mode = 'reward';
  showReward();
}

function buildCardElement(cardId) {
  const card = CARD_LIBRARY[cardId];
  const div = document.createElement('div');
  div.className = `card ${card.type}`;
  div.dataset.cardId = cardId;
  div.innerHTML =
    `<div class="cost">${card.cost}</div>` +
    `<div class="cardName">${card.name}</div>` +
    `<div class="cardDesc">${card.desc}</div>`;
  return div;
}

function renderBattle() {
  const b = state.battle;
  if (!b) return;

  document.getElementById('battleEnemyName').textContent = state.enemy.name;
  document.getElementById('battleEnemyHpText').textContent = `${Math.max(0, state.enemy.hp)} / ${state.enemy.maxHp}`;
  document.getElementById('battleEnemyHpBar').style.width = `${Math.max(0, state.enemy.hp) / state.enemy.maxHp * 100}%`;
  document.getElementById('battleEnemyIntent').textContent = `次の攻撃: ${state.enemy.atk}ダメージ`;
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
      if (div.dataset.used) return;
      div.dataset.used = '1';
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
      if (state.mode !== 'reward' || div.dataset.used) return;
      div.dataset.used = '1';
      state.player.deck.push(cardId);
      log(`デッキに「${CARD_LIBRARY[cardId].name}」を加えた`);
      closeReward();
    });
    container.appendChild(div);
  });
  overlay.style.display = 'flex';
}

function closeReward() {
  if (state.mode !== 'reward') return;
  state.mode = 'battle';
  document.getElementById('rewardOverlay').style.display = 'none';
  state.player.hp = Math.min(state.player.maxHp, state.player.hp + 16);
  startFloor(state.floor + 1);
}

document.getElementById('skipRewardBtn').addEventListener('click', closeReward);
document.getElementById('endTurnBtn').addEventListener('click', () => {
  if (state.mode === 'battle') endPlayerTurn();
});

function endGame(won) {
  state.gameOver = true;
  const overlay = document.getElementById('overlay');
  const text = document.getElementById('overlayText');
  text.textContent = won ? `${MAX_FLOOR}階制覇！ ゲームクリア！` : `ゲームオーバー (${state.floor}階で力尽きた)`;
  overlay.style.display = 'flex';
}

document.getElementById('restartBtn').addEventListener('click', () => newGame(state.difficulty));
document.getElementById('titleBtn').addEventListener('click', backToMenu);

document.querySelectorAll('.diffBtn').forEach((btn) => {
  btn.addEventListener('click', () => newGame(btn.dataset.diff));
});
