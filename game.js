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

// ---- タイマー管理ユーティリティ ----
// setTimeoutで予約したCSSクラスの片付けや連続ビープの2音目を、キーごとに
// 「同じ目的の予約は最新のものだけが有効」になるよう管理する共通ヘルパー。
// この手のタイマーを機能ごとに個別実装すると、内側のタイマーだけ追跡を
// 忘れる/newGame・backToMenuのリセットに配線し忘れる、といった同種のバグが
// 繰り返し起きたため、一元化した。
const namedTimers = {};
function scheduleTimer(key, fn, delay) {
  if (namedTimers[key]) clearTimeout(namedTimers[key]);
  namedTimers[key] = setTimeout(() => {
    namedTimers[key] = null;
    fn();
  }, delay);
}
function clearTimersByPrefix(prefix) {
  Object.keys(namedTimers).forEach((key) => {
    if (key === prefix || key.startsWith(prefix + ':')) {
      if (namedTimers[key]) clearTimeout(namedTimers[key]);
      namedTimers[key] = null;
    }
  });
}

// ---- 誤タップ防止(オーバーレイ表示直後の入力ガード) ----
// 報酬/バフ/イベントの各オーバーレイはposition:fixedで画面中央に独立配置
// されており、直前の戦闘画面(#hand内のカード)のレイアウトとは無関係に
// カード位置が決まる。そのため「最後の1枚で敵を倒す」→即座に次の
// オーバーレイが表示される、という遷移が起きた瞬間、敵を倒したタップの
// 座標にたまたま新しいカードが重なることがある。ここで素早い二度タップ
// (ダブルタップ)をすると、プレイヤーが選ぶ意図のなかったカードを
// そのまま確定させてしまう。オーバーレイ表示直後の短い間だけ入力を
// 無視することで、これを防ぐ。
// 呼び出し側でevent.isTrustedがtrueの場合(実ユーザー入力/実OS発のタップ)
// のみガードを適用する。dispatchEvent()で生成した合成イベント(isTrusted:
// false。tools/playtest.jsのヘッドレスbotなど)は対象外とし、遅延なく即座に
// 処理する。時間ベースのガードは、間隔を置かずポーリング的に再試行する
// 呼び出し元(botのタイトなループ等)からは「常に250ms未満の再試行」にしか
// 見えず、無限に足止めされかねないため。
const OVERLAY_INPUT_GUARD_MS = 250;
let overlayInputGuardUntil = 0;
function armOverlayInputGuard() {
  overlayInputGuardUntil = Date.now() + OVERLAY_INPUT_GUARD_MS;
}
function isOverlayInputGuarded() {
  return Date.now() < overlayInputGuardUntil;
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

function playHitSound(severity) {
  if (severity === 'lethal') {
    playBeep(160, 0.35, 'sawtooth');
  } else if (severity === 'nearLethal') {
    // 致死(160Hzのこぎり波)と通常(440Hz矩形波)の中間: 「あと少しで死んでいた」
    // という緊張感を出すため、少し歪んだ質感の矩形波をやや長めに鳴らす。
    playBeep(280, 0.2, 'square');
  } else {
    playBeep(440, 0.1, 'square');
  }
}

// 勝利/死亡時の締めのサウンド: 勝利は上昇する矩形波トリプルビープ、
// 死亡は下降するのこぎり波トリプルビープ (既存の致命ヒット音の波形を流用)。
function clearEndGameSting() {
  // 直前のゲーム終了で予約されたビープが、新しいゲームの開始/終了後に
  // 鳴ってしまわないよう、保留中のタイマーを破棄する。
  clearTimersByPrefix('endGameSting');
}
function playEndGameSting(won) {
  clearEndGameSting();
  clearIntentAlert();
  // 致命打の効果音(0.35秒かけて減衰するのこぎり波)が鳴り終わってから締めの音が
  // 始まるよう、最初のビープも含めて全体を遅らせる。同時に鳴らすと濁ってしまう。
  const startDelay = 220;
  const tones = won
    ? [[440, 0.12, 'square'], [587, 0.12, 'square'], [880, 0.25, 'square']]
    : [[220, 0.18, 'sawtooth'], [160, 0.18, 'sawtooth'], [100, 0.35, 'sawtooth']];
  const gaps = [0, won ? 140 : 160, won ? 280 : 320];
  tones.forEach(([freq, dur, type], i) => {
    scheduleTimer(`endGameSting:${i}`, () => playBeep(freq, dur, type), startDelay + gaps[i]);
  });
}

// severity: 'lethal' | 'nearLethal' | 'normal'(省略時)。
// lethal/nearLethalは通常のチップダメージより強いシェイク/フラッシュ(hitFlash--heavy)
// と専用の効果音、対応端末でのバイブレーションで「重い一撃」を強調する。
function flashHit(elementId, severity) {
  const el = document.getElementById(elementId);
  if (!el) return;
  const heavy = severity === 'lethal' || severity === 'nearLethal';
  el.classList.remove('hitFlash', 'hitFlash--heavy');
  // 強制リフロー: アニメーションを連続ヒット時にも再トリガーできるようにする
  void el.offsetWidth;
  el.classList.add('hitFlash');
  if (heavy) el.classList.add('hitFlash--heavy');
  scheduleTimer(`hitFlash:${elementId}`, () => el.classList.remove('hitFlash', 'hitFlash--heavy'), 300);
  playHitSound(severity);
  if (heavy && navigator.vibrate) {
    navigator.vibrate(severity === 'lethal' ? [30, 40, 60] : [40]);
  }
}

// プレイヤーがダメージを受けた直後のflashHit重症度を判定する。
// 0以下ならlethal、生存しているが最大HPの20%未満ならnearLethal
// (「あと少しで死んでいた」を演出面で強調する)、それ以外はnormal。
function playerHitSeverity() {
  if (state.player.hp <= 0) return 'lethal';
  if (state.player.hp / state.player.maxHp < 0.2) return 'nearLethal';
  return 'normal';
}

// ---- ボスの予告(intent)演出 ----
// ダメージ演出(hitFlash/playHitSound)とは異なる、「通知」として読める
// 二音ビープ + 控えめな色フラッシュ。actionTypeごとに音色/色を変え、
// 溜め(charge=本当に痛い/警戒)と防御(guard=無傷/安心)を聞き分け・
// 見分けられるようにする。attackは既存の中立トーンのまま据え置き。
const INTENT_ALERT_CLASSES = ['intentAlert', 'intentAlert--danger', 'intentAlert--safe'];
function clearIntentAlert() {
  // newGame/backToMenuでのリセット時に、保留中の予告ビープ/パルスが
  // メニューやタイトル画面に戻った後で鳴ってしまわないよう破棄する
  // (clearEndGameStingと同じ方針)。
  clearTimersByPrefix('intentAlert');
  const el = document.getElementById('battleEnemyIntent');
  if (el) el.classList.remove(...INTENT_ALERT_CLASSES, ...INTENT_TIER_CLASSES);
}
function playIntentAlertSound(actionType) {
  if (actionType === 'charge') {
    // 溜め(次は2倍ダメージ): 鋭く高い矩形波の二音で警戒を煽る
    playBeep(660, 0.07, 'square');
    scheduleTimer('intentAlert:sound2', () => playBeep(880, 0.1, 'square'), 70);
  } else if (actionType === 'guard') {
    // 防御(与ダメージ65%減): 低く落ち着いたサイン波の下降二音
    playBeep(262, 0.12, 'sine');
    scheduleTimer('intentAlert:sound2', () => playBeep(196, 0.16, 'sine'), 110);
  } else {
    // 攻撃: これまでどおりの中立トーン
    playBeep(330, 0.08, 'sine');
    scheduleTimer('intentAlert:sound2', () => playBeep(494, 0.12, 'sine'), 90);
  }
}
function announceIntent(actionType) {
  const el = document.getElementById('battleEnemyIntent');
  if (!el) return;
  el.classList.remove(...INTENT_ALERT_CLASSES);
  // 強制リフロー: アニメーションを連続予告時にも再トリガーできるようにする
  void el.offsetWidth;
  el.classList.add('intentAlert');
  if (actionType === 'charge') el.classList.add('intentAlert--danger');
  else if (actionType === 'guard') el.classList.add('intentAlert--safe');
  scheduleTimer('intentAlert:pulse', () => el.classList.remove(...INTENT_ALERT_CLASSES), 400);
  // ボスの攻撃ターンではflashHitのヒット音(0.1秒)が同じ瞬間に鳴るため、
  // それが鳴り終わってから予告音を鳴らして音が濁らないようにする。
  scheduleTimer('intentAlert:soundStart', () => playIntentAlertSound(actionType), 120);
}

// ---- 難易度定義 ----
const DIFFICULTIES = {
  easy: { label: 'かんたん', playerMaxHp: 36, enemyHpMult: 0.865, enemyAtkMult: 0.865 },
  normal: { label: 'ふつう', playerMaxHp: 33, enemyHpMult: 0.97, enemyAtkMult: 0.97 },
  hard: { label: 'むずかしい', playerMaxHp: 29, enemyHpMult: 1.16, enemyAtkMult: 1.12 },
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
  // 序盤(1〜数階)は星3の強力カードがまだ引けていない前提で、敵の成長開始を
  // 少し遅らせて猶予を作る。猶予後の伸び率は据え置きなので終盤の歯応えは変わらない。
  const HP_SCALE_GRACE = 10;
  const ATK_SCALE_GRACE = 7;
  // 猶予後の伸び率は据え置き0.3ではなく0.34に少し上げ、猶予で軽くした分だけ
  // 終盤(80〜100階)がその場しのぎで際限なく押し切れてしまわないようにする。
  const scale = Math.floor(Math.max(0, floor - 1 - HP_SCALE_GRACE) * 0.34);
  let hp = Math.round((type.hpBase + scale) * diff.enemyHpMult);
  let atk = Math.round((type.atkBase + Math.floor(Math.max(0, floor - 1 - ATK_SCALE_GRACE) / 11)) * diff.enemyAtkMult);
  let name = type.name;
  if (isBossFloor) {
    hp = Math.round(hp * 1.35);
    atk = Math.round(atk * 1.18);
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
// starはカードの強さの目安(1〜3)。数値が高いほど強力で、報酬画面での
// 出現率も低くなる(pickWeightedRewardCards参照)。
const CARD_LIBRARY = {
  strike: { id: 'strike', name: 'ストライク', cost: 1, type: 'attack', damage: 6, star: 1, desc: '6ダメージを与える' },
  defend: { id: 'defend', name: 'ディフェンド', cost: 1, type: 'skill', block: 6, star: 1, desc: '6ブロックを得る' },
  bash: { id: 'bash', name: 'バッシュ', cost: 2, type: 'attack', damage: 12, star: 3, desc: '12ダメージを与える' },
  iron_wave: { id: 'iron_wave', name: 'アイアンウェーブ', cost: 2, type: 'attack', damage: 6, block: 8, star: 3, desc: '6ダメージを与え、8ブロックを得る' },
  double_strike: { id: 'double_strike', name: 'ダブルストライク', cost: 1, type: 'attack', damage: 3, hits: 2, block: 3, star: 3, desc: '3ダメージを2回与え、3ブロックを得る' },
  shield_bash: { id: 'shield_bash', name: 'シールドバッシュ', cost: 1, type: 'attack', damage: 3, block: 4, star: 1, desc: '3ダメージを与え、4ブロックを得る' },
  quick_slash: { id: 'quick_slash', name: 'クイックスラッシュ', cost: 0, type: 'attack', damage: 3, star: 3, desc: '3ダメージを与える' },
  flame_slash: { id: 'flame_slash', name: 'フレイムスラッシュ', cost: 1, type: 'attack', damage: 8, star: 3, desc: '8ダメージを与える' },
  guard_up: { id: 'guard_up', name: 'ガードアップ', cost: 2, type: 'skill', block: 14, star: 2, desc: '14ブロックを得る' },
  triple_jab: { id: 'triple_jab', name: 'トリプルジャブ', cost: 2, type: 'attack', damage: 3, hits: 3, star: 1, desc: '3ダメージを3回与える' },
  brace: { id: 'brace', name: 'ブレイス', cost: 1, type: 'skill', block: 9, star: 3, desc: '9ブロックを得る' },
  finishing_blow: { id: 'finishing_blow', name: 'フィニッシングブロー', cost: 2, type: 'attack', damage: 10, star: 2, desc: '10ダメージを与える' },
  step_back: { id: 'step_back', name: 'ステップバック', cost: 0, type: 'skill', block: 3, star: 2, desc: '3ブロックを得る' },
  riposte: { id: 'riposte', name: 'リポスト', cost: 1, type: 'attack', damage: 4, block: 3, star: 2, desc: '4ダメージを与え、3ブロックを得る' },
  tower_shield: { id: 'tower_shield', name: 'タワーシールド', cost: 2, type: 'skill', block: 12, star: 1, desc: '12ブロックを得る' },
  critical_sword: { id: 'critical_sword', name: 'クリティカルソード', cost: 2, type: 'attack', damage: 10, block: 3, star: 3, desc: '10ダメージを与え、3ブロックを得る' },
  twin_greatsword: { id: 'twin_greatsword', name: '双大剣', cost: 2, type: 'attack', damage: 6, hits: 2, star: 3, desc: '6ダメージを2回与える' },
  ultimate_slash: { id: 'ultimate_slash', name: 'アルティメットスラッシュ', cost: 3, type: 'attack', damage: 21, star: 3, desc: '21ダメージを与える' },
  fortress: { id: 'fortress', name: 'フォートレス', cost: 3, type: 'skill', block: 26, star: 3, desc: '26ブロックを得る' },
  mist_cut: { id: 'mist_cut', name: 'かすみ斬り', cost: 1, type: 'attack', damage: 3, hits: 2, block: 1, star: 2, desc: '3ダメージを2回与え、1ブロックを得る' },
};

const STARTER_DECK = [
  'strike', 'strike', 'strike', 'strike', 'strike',
  'defend', 'defend', 'defend', 'defend',
  'bash',
];

const REWARD_POOL = [
  'bash', 'iron_wave', 'double_strike', 'shield_bash', 'quick_slash', 'strike', 'defend',
  'flame_slash', 'guard_up', 'triple_jab', 'brace', 'finishing_blow',
  'step_back', 'riposte', 'tower_shield', 'critical_sword', 'twin_greatsword',
  'ultimate_slash', 'fortress', 'mist_cut',
];

// 報酬画面での星ランク別の抽選重み。星3(強力なカード)はだいぶ出にくくする。
const REWARD_STAR_WEIGHTS = { 1: 0.55, 2: 0.35, 3: 0.10 };

// 終盤(REWARD_PURE_STAT_CUTOFF_FLOOR以降)ではriposte/iron_wave/mist_cut等の
// ハイブリッドstar1カードが出揃い、strike/defend/tower_shieldのような
// 純ステータス型star1カードは常に下位互換になってしまう。報酬画面3枚の
// 実質的な選択肢を削るため、当該階以降はこれらを候補から除外する。
const REWARD_PURE_STAT_CUTOFF_FLOOR = 15;
const REWARD_PURE_STAT_CARD_IDS = ['strike', 'defend', 'tower_shield'];
function pickWeightedRewardCards(pool, n) {
  const chosen = [];
  const usedIds = new Set();
  let guard = 0;
  while (chosen.length < n && guard++ < 200) {
    const r = Math.random();
    let star;
    if (r < REWARD_STAR_WEIGHTS[1]) star = 1;
    else if (r < REWARD_STAR_WEIGHTS[1] + REWARD_STAR_WEIGHTS[2]) star = 2;
    else star = 3;
    let candidates = pool.filter((id) => CARD_LIBRARY[id].star === star && !usedIds.has(id));
    // 対象starの候補が尽きた場合(floor15以降、star1の純ステータス型を
    // 除外した影響でstar1候補が2枚しかなくなり得る)、完全にランダムな
    // 再抽選に戻すとstar3の実出現率まで意図せず底上げされてしまう
    // (55/35/10のはずが49.3/39.3/11.3になっていた不具合)。
    // 不足分は必ずstar2側に寄せ、star3の出現率は据え置く。
    if (candidates.length === 0) {
      const fallbackOrder = star === 1 ? [2, 3] : star === 3 ? [2, 1] : [1, 3];
      for (const fb of fallbackOrder) {
        candidates = pool.filter((id) => CARD_LIBRARY[id].star === fb && !usedIds.has(id));
        if (candidates.length > 0) break;
      }
    }
    if (candidates.length === 0) continue;
    const pick = choice(candidates);
    chosen.push(pick);
    usedIds.add(pick);
  }
  // 星の巡り合わせが悪く既定回数で埋まらなかった場合、残りの候補から均等に補充する。
  if (chosen.length < n) {
    const remaining = shuffleArray(pool.filter((id) => !usedIds.has(id)));
    while (chosen.length < n && remaining.length > 0) chosen.push(remaining.shift());
  }
  return chosen;
}

// カード報酬選択の後、次の階に進む前に低確率でランダムイベント
// (カード除去 or カード複製)を挟む。毎回発生すると強すぎる/邪魔なため
// 低確率にしている。
const RANDOM_EVENT_CHANCE = 0.25;
// ランダムイベント内での内訳: 除去82% / 複製18%。
// 複製は星3など高スコアのカードをそのまま増殖できてしまい、デッキの
// 期待火力を底上げする効果が除去よりも強いため、除去よりだいぶ低い頻度にする。
const EVENT_REMOVE_CHANCE = 0.82;

const MAX_FLOOR = 100;
const BUFF_FLOOR_INTERVAL = 10;

// ---- バフアイテム定義 ----
// 毎ターン/毎戦闘に累積して効く常時強化は、残り階層数(最大90階分)にわたって
// 掛け算的に効きすぎてバランスを崩壊させるため採用しない。ここでの効果は
// すべて「その場限り」の一回性のものに限定する。
const BUFF_LIBRARY = {
  vigor: {
    id: 'vigor', name: '活力の心得', desc: '最大HP+20',
    apply: () => {
      state.player.maxHp += 20;
    },
  },
  renewal: {
    id: 'renewal', name: '再生の心得', desc: '最大HPの52%(端数切上)を回復する',
    apply: () => {
      const amt = Math.ceil(state.player.maxHp * 0.52);
      state.player.hp = Math.min(state.player.maxHp, state.player.hp + amt);
    },
  },
  insight: {
    id: 'insight', name: '見切りの心得', desc: 'ターン開始時のドロー枚数+1(永続)',
    apply: () => {
      state.player.bonusDraw = (state.player.bonusDraw || 0) + 1;
    },
  },
  might: {
    id: 'might', name: '剛力の心得', desc: '攻撃カードのダメージが永続的に+1される',
    apply: () => {
      state.player.strength = (state.player.strength || 0) + 1;
    },
  },
  ward: {
    id: 'ward', name: '守りの心得', desc: '毎戦闘開始時に永続的に2ブロックを得た状態で始まる',
    apply: () => {
      state.player.startingBlock = (state.player.startingBlock || 0) + 2;
    },
  },
};
const BUFF_POOL = ['vigor', 'renewal', 'insight', 'might', 'ward'];

// ---- ゲーム状態 ----
const state = {
  floor: 1,
  killCount: 0,
  difficulty: 'normal',
  player: {
    hp: 20, maxHp: 20,
    level: 1,
    deck: [],
    strength: 0,
    startingBlock: 0,
    bonusDraw: 0,
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
  state.player.strength = 0;
  state.player.startingBlock = 0;
  state.player.bonusDraw = 0;
  state.killCount = 0;
  state.gameOver = false;
  state.messages = [];
  clearEndGameSting();
  clearIntentAlert();
  clearTimersByPrefix('hitSeq');
  const overlay = document.getElementById('overlay');
  overlay.style.display = 'none';
  overlay.classList.remove('show');
  document.getElementById('rewardOverlay').style.display = 'none';
  document.getElementById('buffOverlay').style.display = 'none';
  document.getElementById('eventOverlay').style.display = 'none';
  document.getElementById('menuOverlay').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  startFloor(1);
}

function backToMenu() {
  clearEndGameSting();
  clearIntentAlert();
  clearTimersByPrefix('hitSeq');
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
    // 旧値+11は敵atkのmaxHp比を終盤4%未満まで薄め、easy/normalの勝率を
    // 健全域(easy 5-16%/normal 0-2.5%)から大きく外していた。+7は
    // 実測でその帯に収まる値(50-80走の複数バッチで確認済み)。
    state.player.maxHp += 7;
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
    firstTurn: true,
  };
  log(`${state.enemy.name}が現れた！`);
  startPlayerTurn();
}

function startPlayerTurn() {
  const b = state.battle;
  // 「守りの心得」の恒久ブロックは戦闘開始時(最初のターンのみ)に付与する。
  b.block = b.firstTurn ? (state.player.startingBlock || 0) : 0;
  b.firstTurn = false;
  b.energy = b.maxEnergy;
  drawCards(5 + (state.player.bonusDraw || 0));
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
    let dmg = card.damage * hits + (state.player.strength || 0);
    if (state.enemy.isBoss && state.enemy.actionType === 'guard') {
      dmg = Math.max(0, Math.round(dmg * 0.35));
    }
    // HP減算・勝敗判定はここで即座に(同期的に)確定させる。連続ヒットの
    // 「見た目」だけをscheduleTimerで少しずつずらして表現する。もし勝敗判定
    // 自体を演出タイマー側に持たせてしまうと、その反映が終わるより前に
    // (ヘッドレスプレイテストのbotのような)同期的な連続操作が「まだ敵は
    // 倒れていない」ものとして処理を続けてしまい、winBattle()の多重呼び出し
    // や次の敵への誤爆につながる。そのためロジックは必ず同期のまま、
    // flashHitの発火タイミングだけを後ろにずらす。
    state.enemy.hp -= dmg;
    const lethal = state.enemy.hp <= 0;
    if (hits >= 2) {
      log(`${card.name}で${state.enemy.name}に${dmg}ダメージ！(${hits}連撃)`);
      clearTimersByPrefix('hitSeq');
      for (let h = 0; h < hits; h++) {
        const isLast = h === hits - 1;
        scheduleTimer(`hitSeq:${h}`, () => {
          flashHit('battleEnemy', isLast && lethal ? 'lethal' : 'normal');
        }, h * 120);
      }
    } else {
      log(`${card.name}で${state.enemy.name}に${dmg}ダメージ！`);
      flashHit('battleEnemy', lethal ? 'lethal' : 'normal');
    }
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
    flashHit('battlePlayer', playerHitSeverity());
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
      flashHit('battlePlayer', playerHitSeverity());
    }
    // 次ターンの行動をここで抽選し、次に見せるintentと実際の解決を一致させる
    rollBossAction(enemy);
    // プレイヤーがこの攻撃で倒れた場合、次のintentを予告する意味がないので鳴らさない
    if (state.player.hp > 0) announceIntent(enemy.actionType);
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
  const stars = '★'.repeat(card.star) + '☆'.repeat(3 - card.star);
  div.innerHTML =
    `<div class="cost">${card.cost}</div>` +
    `<div class="cardStars">${stars}</div>` +
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

// ボスの現在の意図(actionType)に応じて#battleEnemyIntentの常時色を返す。
// パルス演出(intentAlert系クラス、400msで消える)とは独立して、意図が
// 有効な間ずっと保持される。溜め中/次が2倍ダメージ攻撃は危険(赤)、
// 防御態勢は安全(青)、それ以外(素の攻撃)は基準色のまま(クラスなし)。
const INTENT_TIER_CLASSES = ['intentTier--danger', 'intentTier--safe'];
function getEnemyIntentTierClass(enemy) {
  if (!enemy.isBoss) return null;
  if (enemy.actionType === 'charge') return 'intentTier--danger';
  if (enemy.actionType === 'guard') return 'intentTier--safe';
  if (enemy.actionType === 'attack' && enemy.chargeBonus) return 'intentTier--danger';
  return null;
}

function renderBattle() {
  const b = state.battle;
  if (!b) return;

  document.getElementById('battleEnemyName').textContent = state.enemy.name;
  document.getElementById('battleEnemyHpText').textContent = `${Math.max(0, state.enemy.hp)} / ${state.enemy.maxHp}`;
  document.getElementById('battleEnemyHpBar').style.width = `${Math.max(0, state.enemy.hp) / state.enemy.maxHp * 100}%`;
  const intentEl = document.getElementById('battleEnemyIntent');
  intentEl.textContent = getEnemyIntentText(state.enemy);
  intentEl.classList.remove(...INTENT_TIER_CLASSES);
  const intentTier = getEnemyIntentTierClass(state.enemy);
  if (intentTier) intentEl.classList.add(intentTier);
  document.getElementById('battlePlayerHp').textContent = `${Math.max(0, state.player.hp)} / ${state.player.maxHp}`;
  const playerHpPct = Math.max(0, state.player.hp) / state.player.maxHp * 100;
  const playerHpBar = document.getElementById('battlePlayerHpBar');
  playerHpBar.style.width = `${playerHpPct}%`;
  playerHpBar.classList.remove('hpTier--warning', 'hpTier--danger');
  if (playerHpPct < 25) {
    playerHpBar.classList.add('hpTier--danger');
  } else if (playerHpPct <= 50) {
    playerHpBar.classList.add('hpTier--warning');
  }
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
  armOverlayInputGuard();
}

function renderRewardPicks() {
  const container = document.getElementById('rewardCards');
  container.innerHTML = '';
  const rewardPool = state.floor >= REWARD_PURE_STAT_CUTOFF_FLOOR
    ? REWARD_POOL.filter((id) => !REWARD_PURE_STAT_CARD_IDS.includes(id))
    : REWARD_POOL;
  const picks = pickWeightedRewardCards(rewardPool, 3);
  picks.forEach((cardId) => {
    const div = buildCardElement(cardId);
    div.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if ((e.isTrusted && isOverlayInputGuarded()) || state.mode !== 'reward' || div.dataset.used) return;
      div.dataset.used = '1';
      state.player.deck.push(cardId);
      log(`デッキに「${CARD_LIBRARY[cardId].name}」を加えた`);
      closeReward();
    });
    container.appendChild(div);
  });
}

function closeReward() {
  if (state.mode !== 'reward') return;
  document.getElementById('rewardOverlay').style.display = 'none';

  if (Math.random() < RANDOM_EVENT_CHANCE) {
    state.mode = 'event';
    showRandomEvent();
    return;
  }

  state.mode = 'battle';
  startFloor(state.floor + 1);
}

function showRandomEvent() {
  // 除去はデッキが2枚以上ないと山札が空になり得るため成立しない。
  // その場合は複製イベントに差し替える。
  const canRemove = state.player.deck.length > 1;
  const isRemove = canRemove && Math.random() < EVENT_REMOVE_CHANCE;

  const overlay = document.getElementById('eventOverlay');
  const title = document.getElementById('eventTitle');
  const container = document.getElementById('eventCards');
  container.innerHTML = '';

  if (isRemove) {
    title.textContent = '怪しい祭壇を見つけた… カードを1枚捧げて除去できる';
    state.player.deck.forEach((cardId, idx) => {
      const div = buildCardElement(cardId);
      div.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if ((e.isTrusted && isOverlayInputGuarded()) || state.mode !== 'event' || div.dataset.used) return;
        div.dataset.used = '1';
        const removedId = state.player.deck.splice(idx, 1)[0];
        log(`デッキから「${CARD_LIBRARY[removedId].name}」を除去した`);
        closeEvent();
      });
      container.appendChild(div);
    });
  } else {
    title.textContent = '不思議な鏡を見つけた… カードを1枚選んで複製できる';
    state.player.deck.forEach((cardId) => {
      const div = buildCardElement(cardId);
      div.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if ((e.isTrusted && isOverlayInputGuarded()) || state.mode !== 'event' || div.dataset.used) return;
        div.dataset.used = '1';
        state.player.deck.push(cardId);
        log(`「${CARD_LIBRARY[cardId].name}」を複製してデッキに加えた`);
        closeEvent();
      });
      container.appendChild(div);
    });
  }

  overlay.style.display = 'flex';
  armOverlayInputGuard();
}

function closeEvent() {
  if (state.mode !== 'event') return;
  state.mode = 'battle';
  document.getElementById('eventOverlay').style.display = 'none';
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
      if ((e.isTrusted && isOverlayInputGuarded()) || state.mode !== 'buff' || div.dataset.used) return;
      div.dataset.used = '1';
      BUFF_LIBRARY[buffId].apply();
      log(`「${BUFF_LIBRARY[buffId].name}」を獲得した！`);
      closeBuff();
    });
    container.appendChild(div);
  });
  overlay.style.display = 'flex';
  armOverlayInputGuard();
}

function closeBuff() {
  if (state.mode !== 'buff') return;
  state.mode = 'battle';
  document.getElementById('buffOverlay').style.display = 'none';
  renderStats();
  startFloor(state.floor + 1);
}

document.getElementById('skipRewardBtn').addEventListener('click', closeReward);
document.getElementById('skipBuffBtn').addEventListener('click', closeBuff);
document.getElementById('skipEventBtn').addEventListener('click', closeEvent);
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
