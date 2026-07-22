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

// ---- ヒット演出 (画面フラッシュ/シェイク + 効果音) ----
let audioCtx = null;
function getAudioCtx() {
  // ブラウザの自動再生制限を避けるため、初回のユーザー操作後に遅延生成する
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playBeep(freq, duration, type) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type || 'square';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.15, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration);
}

function playHitSound(lethal) {
  if (lethal) {
    playBeep(160, 0.35, 'sawtooth');
  } else {
    playBeep(440, 0.1, 'square');
  }
}

// 勝利/死亡時の締めのサウンド: 勝利は上昇する矩形波トリプルビープ、
// 死亡は下降するのこぎり波トリプルビープ (既存の致命ヒット音の波形を流用)。
let endGameStingTimers = [];
function clearEndGameSting() {
  // 直前のゲーム終了で予約されたビープが、新しいゲームの開始/終了後に
  // 鳴ってしまわないよう、保留中のタイマーを破棄する。
  endGameStingTimers.forEach((id) => clearTimeout(id));
  endGameStingTimers = [];
}
function playEndGameSting(won) {
  clearEndGameSting();
  // 致命打の効果音(0.35秒かけて減衰するのこぎり波)が鳴り終わってから締めの音が
  // 始まるよう、最初のビープも含めて全体を遅らせる。同時に鳴らすと濁ってしまう。
  const startDelay = 220;
  if (won) {
    endGameStingTimers.push(setTimeout(() => playBeep(440, 0.12, 'square'), startDelay));
    endGameStingTimers.push(setTimeout(() => playBeep(587, 0.12, 'square'), startDelay + 140));
    endGameStingTimers.push(setTimeout(() => playBeep(880, 0.25, 'square'), startDelay + 280));
  } else {
    endGameStingTimers.push(setTimeout(() => playBeep(220, 0.18, 'sawtooth'), startDelay));
    endGameStingTimers.push(setTimeout(() => playBeep(160, 0.18, 'sawtooth'), startDelay + 160));
    endGameStingTimers.push(setTimeout(() => playBeep(100, 0.35, 'sawtooth'), startDelay + 320));
  }
}

const hitFlashTimers = {};
function flashHit(elementId, lethal) {
  const el = document.getElementById(elementId);
  if (!el) return;
  // 直前のヒットの片付けタイマーが今回のフラッシュを早期に消してしまわないよう、
  // 要素ごとに最新のタイマーだけを有効にする。
  if (hitFlashTimers[elementId]) clearTimeout(hitFlashTimers[elementId]);
  el.classList.remove('hitFlash');
  // 強制リフロー: アニメーションを連続ヒット時にも再トリガーできるようにする
  void el.offsetWidth;
  el.classList.add('hitFlash');
  hitFlashTimers[elementId] = setTimeout(() => {
    el.classList.remove('hitFlash');
    hitFlashTimers[elementId] = null;
  }, 300);
  playHitSound(lethal);
}

// ---- ボスの予告(intent)演出 ----
// ダメージ演出(hitFlash/playHitSound)とは異なる、「通知」として読める
// サイン波の二音ビープ + 控えめな色フラッシュ。攻撃/溜め/防御の種別は
// 問わず共通の合図とする(種別ごとの音色分けは将来の拡張課題)。
let intentAlertTimer = null;
let intentAlertSoundStartTimer = null;
let intentAlertSoundTimer = null;
function playIntentAlertSound() {
  // 2音目のタイマーも追跡し、連続予告時に前回の音色を打ち切ってから
  // 今回の2音目だけを鳴らす(flashHit/playEndGameStingと同じ方針)。
  if (intentAlertSoundTimer) clearTimeout(intentAlertSoundTimer);
  playBeep(330, 0.08, 'sine');
  intentAlertSoundTimer = setTimeout(() => {
    playBeep(494, 0.12, 'sine');
    intentAlertSoundTimer = null;
  }, 90);
}
function announceIntent() {
  const el = document.getElementById('battleEnemyIntent');
  if (!el) return;
  // 連続するボスのターンで前回の片付けタイマーが今回のアニメーションを
  // 早期に打ち切らないよう、専用のタイマーIDだけを有効にする。
  if (intentAlertTimer) clearTimeout(intentAlertTimer);
  el.classList.remove('intentAlert');
  // 強制リフロー: アニメーションを連続予告時にも再トリガーできるようにする
  void el.offsetWidth;
  el.classList.add('intentAlert');
  intentAlertTimer = setTimeout(() => {
    el.classList.remove('intentAlert');
    intentAlertTimer = null;
  }, 400);
  // ボスの攻撃ターンではflashHitのヒット音(0.1秒)が同じ瞬間に鳴るため、
  // それが鳴り終わってから予告音を鳴らして音が濁らないようにする。
  // この開始遅延自体も、連続予告時に前回の分が今回の音をつぶさないよう追跡する。
  if (intentAlertSoundStartTimer) clearTimeout(intentAlertSoundStartTimer);
  intentAlertSoundStartTimer = setTimeout(() => {
    intentAlertSoundStartTimer = null;
    playIntentAlertSound();
  }, 120);
}

// ---- 難易度定義 ----
const DIFFICULTIES = {
  easy: { label: 'かんたん', playerMaxHp: 30, enemyHpMult: 0.9, enemyAtkMult: 0.9 },
  normal: { label: 'ふつう', playerMaxHp: 26, enemyHpMult: 0.95, enemyAtkMult: 0.92 },
  hard: { label: 'むずかしい', playerMaxHp: 25, enemyHpMult: 1.15, enemyAtkMult: 1.02 },
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
  const isBossFloor = floor % BUFF_FLOOR_INTERVAL === 0;
  const scale = Math.floor((floor - 1) * 0.3);
  let hp = Math.round((type.hpBase + scale) * diff.enemyHpMult);
  let atk = Math.round((type.atkBase + Math.floor((floor - 1) / 12)) * diff.enemyAtkMult);
  let name = type.name;
  if (isBossFloor) {
    hp = Math.round(hp * 1.25);
    atk = Math.round(atk * 1.12);
    name = `ボス${name}`;
  }
  const enemy = {
    name, hp, maxHp: hp, atk, alive: true,
    isBoss: isBossFloor,
    actionType: 'attack', // 'attack' | 'charge' | 'guard' -- only randomized for bosses
    chargeBonus: false,
  };
  if (isBossFloor) rollBossAction(enemy);
  return enemy;
}

// ボスのみ、次ターンの行動を「攻撃50% / 溜め20% / 防御30%」の重みで抽選する。
// 通常敵は常に'attack'のまま(挙動は今までと完全に同じ)。
function rollBossAction(enemy) {
  const r = Math.random();
  if (r < 0.5) enemy.actionType = 'attack';
  else if (r < 0.7) enemy.actionType = 'charge';
  else enemy.actionType = 'guard';
}

// ---- カード定義 ----
const CARD_LIBRARY = {
  strike: { id: 'strike', name: 'ストライク', cost: 1, type: 'attack', damage: 6, desc: '6ダメージを与える' },
  defend: { id: 'defend', name: 'ディフェンド', cost: 1, type: 'skill', block: 6, desc: '6ブロックを得る' },
  bash: { id: 'bash', name: 'バッシュ', cost: 2, type: 'attack', damage: 12, desc: '12ダメージを与える' },
  iron_wave: { id: 'iron_wave', name: 'アイアンウェーブ', cost: 2, type: 'attack', damage: 6, block: 8, desc: '6ダメージを与え、8ブロックを得る' },
  double_strike: { id: 'double_strike', name: 'ダブルストライク', cost: 1, type: 'attack', damage: 3, hits: 2, desc: '3ダメージを2回与える' },
  shield_bash: { id: 'shield_bash', name: 'シールドバッシュ', cost: 1, type: 'skill', block: 6, desc: '6ブロックを得る' },
  quick_slash: { id: 'quick_slash', name: 'クイックスラッシュ', cost: 0, type: 'attack', damage: 5, desc: '0コストで5ダメージを与える' },
  flame_slash: { id: 'flame_slash', name: 'フレイムスラッシュ', cost: 1, type: 'attack', damage: 7, desc: '7ダメージを与える' },
  guard_up: { id: 'guard_up', name: 'ガードアップ', cost: 2, type: 'skill', block: 14, desc: '14ブロックを得る' },
  triple_jab: { id: 'triple_jab', name: 'トリプルジャブ', cost: 2, type: 'attack', damage: 3, hits: 3, desc: '3ダメージを3回与える' },
  brace: { id: 'brace', name: 'ブレイス', cost: 1, type: 'skill', block: 8, desc: '8ブロックを得る' },
  finishing_blow: { id: 'finishing_blow', name: 'フィニッシングブロー', cost: 3, type: 'attack', damage: 10, desc: '10ダメージを与える' },
};

const STARTER_DECK = [
  'strike', 'strike', 'strike', 'strike', 'strike',
  'defend', 'defend', 'defend', 'defend',
  'bash',
];

const REWARD_POOL = [
  'bash', 'iron_wave', 'double_strike', 'shield_bash', 'quick_slash', 'strike', 'defend',
  'flame_slash', 'guard_up', 'triple_jab', 'brace', 'finishing_blow',
];

const MAX_FLOOR = 100;
const BUFF_FLOOR_INTERVAL = 10;

// ---- バフアイテム定義 ----
// 毎ターン/毎戦闘に累積して効く常時強化は、残り階層数(最大90階分)にわたって
// 掛け算的に効きすぎてバランスを崩壊させるため採用しない。ここでの効果は
// すべて「その場限り」の一回性のものに限定する。
const BUFF_LIBRARY = {
  vigor: {
    id: 'vigor', name: '活力の心得', desc: '最大HP+15、HPを最大まで全回復',
    apply: () => {
      state.player.maxHp += 15;
      state.player.hp = state.player.maxHp;
    },
  },
  renewal: {
    id: 'renewal', name: '再生の心得', desc: '最大HPの50%(端数切上)を回復する',
    apply: () => {
      const amt = Math.ceil(state.player.maxHp * 0.5);
      state.player.hp = Math.min(state.player.maxHp, state.player.hp + amt);
    },
  },
  cleanse: {
    id: 'cleanse', name: '浄化の心得', desc: 'デッキから最も弱いカードを1枚取り除く',
    apply: () => {
      const deck = state.player.deck;
      if (deck.length === 0) return;
      let worstIdx = 0, worstScore = Infinity;
      deck.forEach((cardId, i) => {
        const c = CARD_LIBRARY[cardId];
        const score = (c.damage || 0) * (c.hits || 1) * 2 + (c.block || 0) * 1.5 - c.cost;
        if (score < worstScore) { worstScore = score; worstIdx = i; }
      });
      deck.splice(worstIdx, 1);
    },
  },
};
const BUFF_POOL = ['vigor', 'renewal', 'cleanse'];

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
  mode: 'battle', // 'battle' | 'reward' | 'buff'
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
  clearEndGameSting();
  const overlay = document.getElementById('overlay');
  overlay.style.display = 'none';
  overlay.classList.remove('show');
  document.getElementById('rewardOverlay').style.display = 'none';
  document.getElementById('buffOverlay').style.display = 'none';
  document.getElementById('menuOverlay').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  startFloor(1);
}

function backToMenu() {
  clearEndGameSting();
  const overlay = document.getElementById('overlay');
  overlay.style.display = 'none';
  overlay.classList.remove('show');
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
    let dmg = card.damage * hits;
    if (state.enemy.isBoss && state.enemy.actionType === 'guard') {
      dmg = Math.max(0, Math.round(dmg * 0.35));
    }
    state.enemy.hp -= dmg;
    log(`${card.name}で${state.enemy.name}に${dmg}ダメージ！`);
    flashHit('battleEnemy', state.enemy.hp <= 0);
  }
  if (card.block) {
    b.block += card.block;
    log(`${card.name}でブロック${card.block}を得た`);
  }

  if (state.enemy.hp <= 0) {
    renderBattle();
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
  const enemy = state.enemy;

  if (!enemy.isBoss) {
    // 通常敵: これまでどおり常に攻撃する
    const dmg = Math.max(0, enemy.atk - b.block);
    b.block = Math.max(0, b.block - enemy.atk);
    state.player.hp -= dmg;
    log(`${enemy.name}の攻撃！ ${dmg}ダメージを受けた`);
    flashHit('battlePlayer', state.player.hp <= 0);
  } else {
    // ボス: 事前に予告(intent)していた行動をそのまま解決する
    if (enemy.actionType === 'charge') {
      enemy.chargeBonus = true;
      log(`${enemy.name}は力を溜めている...`);
    } else if (enemy.actionType === 'guard') {
      log(`${enemy.name}は防御の構えを取った(与ダメージ65%減)`);
    } else {
      let atk = enemy.atk;
      if (enemy.chargeBonus) {
        atk *= 2;
        enemy.chargeBonus = false;
      }
      const dmg = Math.max(0, atk - b.block);
      b.block = Math.max(0, b.block - atk);
      state.player.hp -= dmg;
      log(`${enemy.name}の攻撃！ ${dmg}ダメージを受けた`);
      flashHit('battlePlayer', state.player.hp <= 0);
    }
    // 次ターンの行動をここで抽選し、次に見せるintentと実際の解決を一致させる
    rollBossAction(enemy);
    // プレイヤーがこの攻撃で倒れた場合、次のintentを予告する意味がないので鳴らさない
    if (state.player.hp > 0) announceIntent();
  }

  if (state.player.hp <= 0) {
    renderBattle();
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

  if (state.floor % BUFF_FLOOR_INTERVAL === 0) {
    state.mode = 'buff';
    showBuffChoice();
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

function getEnemyIntentText(enemy) {
  if (enemy.isBoss) {
    if (enemy.actionType === 'charge') return '次のターン: 溜めている(次は2倍ダメージ)';
    if (enemy.actionType === 'guard') return '次のターン: 防御態勢(与ダメージ65%減)';
    const atk = enemy.chargeBonus ? enemy.atk * 2 : enemy.atk;
    return `次の攻撃: ${atk}ダメージ`;
  }
  return `次の攻撃: ${enemy.atk}ダメージ`;
}

function renderBattle() {
  const b = state.battle;
  if (!b) return;

  document.getElementById('battleEnemyName').textContent = state.enemy.name;
  document.getElementById('battleEnemyHpText').textContent = `${Math.max(0, state.enemy.hp)} / ${state.enemy.maxHp}`;
  document.getElementById('battleEnemyHpBar').style.width = `${Math.max(0, state.enemy.hp) / state.enemy.maxHp * 100}%`;
  document.getElementById('battleEnemyIntent').textContent = getEnemyIntentText(state.enemy);
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
  renderRewardPicks();
  overlay.style.display = 'flex';
}

function renderRewardPicks() {
  document.getElementById('rewardTitle').style.display = '';
  document.getElementById('rewardCards').style.display = 'flex';
  document.getElementById('rewardActions').style.display = 'flex';
  document.getElementById('removeDeckView').style.display = 'none';

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

  // 1枚を切ってしまうと山札が空になり得るため、除去はデッキが2枚以上の時のみ可能にする。
  const removeBtn = document.getElementById('removeCardBtn');
  removeBtn.style.display = state.player.deck.length > 1 ? '' : 'none';
}

function renderRemoveDeckList() {
  document.getElementById('rewardTitle').style.display = 'none';
  document.getElementById('rewardCards').style.display = 'none';
  document.getElementById('rewardActions').style.display = 'none';
  document.getElementById('removeDeckView').style.display = 'flex';

  const container = document.getElementById('removeDeckCards');
  container.innerHTML = '';
  state.player.deck.forEach((cardId, idx) => {
    const div = buildCardElement(cardId);
    div.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (state.mode !== 'reward' || div.dataset.used) return;
      div.dataset.used = '1';
      const removedId = state.player.deck.splice(idx, 1)[0];
      log(`デッキから「${CARD_LIBRARY[removedId].name}」を除去した`);
      closeReward();
    });
    container.appendChild(div);
  });
}

function closeReward() {
  if (state.mode !== 'reward') return;
  state.mode = 'battle';
  document.getElementById('rewardOverlay').style.display = 'none';
  startFloor(state.floor + 1);
}

function buildBuffElement(buffId) {
  const buff = BUFF_LIBRARY[buffId];
  const div = document.createElement('div');
  div.className = 'card buff';
  div.dataset.buffId = buffId;
  div.innerHTML =
    `<div class="cardName">${buff.name}</div>` +
    `<div class="cardDesc">${buff.desc}</div>`;
  return div;
}

function showBuffChoice() {
  const overlay = document.getElementById('buffOverlay');
  const container = document.getElementById('buffCards');
  container.innerHTML = '';

  const picks = pickRandomUnique(BUFF_POOL, 3);
  picks.forEach((buffId) => {
    const div = buildBuffElement(buffId);
    div.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (state.mode !== 'buff' || div.dataset.used) return;
      div.dataset.used = '1';
      BUFF_LIBRARY[buffId].apply();
      log(`「${BUFF_LIBRARY[buffId].name}」を獲得した！`);
      closeBuff();
    });
    container.appendChild(div);
  });
  overlay.style.display = 'flex';
}

function closeBuff() {
  if (state.mode !== 'buff') return;
  state.mode = 'battle';
  document.getElementById('buffOverlay').style.display = 'none';
  renderStats();
  startFloor(state.floor + 1);
}

document.getElementById('skipRewardBtn').addEventListener('click', closeReward);
document.getElementById('removeCardBtn').addEventListener('click', () => {
  if (state.mode !== 'reward') return;
  renderRemoveDeckList();
});
document.getElementById('cancelRemoveBtn').addEventListener('click', () => {
  if (state.mode !== 'reward') return;
  renderRewardPicks();
});
document.getElementById('skipBuffBtn').addEventListener('click', closeBuff);
document.getElementById('endTurnBtn').addEventListener('click', () => {
  if (state.mode === 'battle') endPlayerTurn();
});

function endGame(won) {
  state.gameOver = true;
  const overlay = document.getElementById('overlay');
  const text = document.getElementById('overlayText');
  text.textContent = won ? `${MAX_FLOOR}階制覇！ ゲームクリア！` : `ゲームオーバー (${state.floor}階で力尽きた)`;
  // フェードイン演出を毎回再トリガーできるよう、クラスを外して強制リフローしてから付け直す。
  // display/クラス変更は同期的なので、ボタンはアニメーション中も即座に押せる。
  overlay.classList.remove('show');
  overlay.style.display = 'flex';
  void overlay.offsetWidth;
  overlay.classList.add('show');
  playEndGameSting(won);
}

document.getElementById('restartBtn').addEventListener('click', () => newGame(state.difficulty));
document.getElementById('titleBtn').addEventListener('click', backToMenu);

document.querySelectorAll('.diffBtn').forEach((btn) => {
  btn.addEventListener('click', () => newGame(btn.dataset.diff));
});
