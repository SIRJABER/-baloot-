import React, { useState, useMemo, useRef, useEffect } from "react";

const FONT_IMPORT = '';

/* ============================================================
   RULES + DISPLAY CONVERSION — لم تُلمَس، مطابقة لـ 55/55 اختبار
   ============================================================ */
const RULES = {
  cardValues: {
    sun: { A: 11, "10": 10, K: 4, Q: 3, J: 2, "9": 0, "8": 0, "7": 0 },
    hakamTrump: { A: 11, "10": 10, K: 4, Q: 3, J: 20, "9": 14, "8": 0, "7": 0 },
    hakamOther: { A: 11, "10": 10, K: 4, Q: 3, J: 2, "9": 0, "8": 0, "7": 0 },
  },
  groundBonus: 10,
  roundTotals: { sun: 130, hakam: 162 },
  projectValues: {
    sun: { sera: 4, khamsin: 10, meya: 20, arbaMeya: 40 },
    hakam: { sera: 2, khamsin: 5, meya: 10, bloat: 2 },
  },
  projectRepeatLimits: { sun: { sera: 4, khamsin: 4, meya: 4 }, hakam: { sera: 4, khamsin: 4, meya: 2 } }, // مطابق لـ multiProjectAdapter.js (72/72)
  nithara: {
    sun: { none: { threshold: 66, tieAt: 65 }, sera: { threshold: 56, tieAt: null }, khamsin: { threshold: 41, tieAt: 40 }, meya: { threshold: 16, tieAt: 15 } },
    hakam: { none: { threshold: 82, tieAt: 81 }, sera: { threshold: 72, tieAt: null, requiresNoBloatDeclared: true }, khamsin: { threshold: 56, tieAt: null, requiresNoBloatDeclared: true }, meya: { threshold: 32, tieAt: null, requiresNoBloatDeclared: true } },
  },
  matchTarget: 152,
  displayDivisor: { sun: 5, hakam: 10 },
  kabootBonus: { sun: 44, hakam: 25 }, // بونص ثابت للكبوت (بدون دبل أيضًا) — تحديث صريح من المستخدم
};

const RANK_ORDER = ["7", "8", "9", "10", "J", "Q", "K", "A"];
const SUITS = ["h", "d", "c", "s"];
const RANK_LABEL = { "7": "7", "8": "8", "9": "9", "10": "10", J: "ولد", Q: "بنت", K: "شايب", A: "إكة" };
const SUIT_SYMBOL = { h: "♥", d: "♦", c: "♣", s: "♠" };
const SUIT_RED = { h: true, d: true, c: false, s: false };

function fullDeck() {
  const deck = [];
  for (const suit of SUITS) for (const rank of RANK_ORDER) deck.push({ rank, suit, id: `${rank}-${suit}` });
  return deck;
}
function bant(card, gameType, hakamSuit) {
  if (gameType === "sun") return RULES.cardValues.sun[card.rank];
  if (card.suit === hakamSuit) return RULES.cardValues.hakamTrump[card.rank];
  return RULES.cardValues.hakamOther[card.rank];
}
function sumBant(cards, gameType, hakamSuit) {
  return cards.reduce((s, c) => s + bant(c, gameType, hakamSuit), 0);
}
/* --- Raw Score → Display Score: دالة معزولة واحدة فقط --- */
function toDisplay(raw, gameType) {
  return Math.round(raw / RULES.displayDivisor[gameType]);
}
function nitharaCategory(project) {
  if (!project) return "none";
  if (project.type === "sera") return "sera";
  if (project.type === "khamsin") return "khamsin";
  return "meya";
}
/** يجمع عدادات مشاريع فريق واحد -> {value, category} — بلا أي مقارنة بالفريق الآخر (مطابق لـ multiProjectAdapter.js المختبر) */
function aggregateProjects(gameType, counts) {
  const v = RULES.projectValues[gameType];
  const lim = RULES.projectRepeatLimits[gameType];
  const sera = Math.min(counts.sera || 0, lim.sera);
  const khamsin = Math.min(counts.khamsin || 0, lim.khamsin);
  const meya = Math.min(counts.meya || 0, lim.meya);
  const arbaMeya = gameType === "sun" && !!counts.arbaMeya;
  const bloatOn = gameType === "hakam" && !!counts.bloat;

  let total = sera * v.sera + khamsin * v.khamsin + meya * v.meya;
  if (arbaMeya) total += v.arbaMeya;

  let category = null;
  if (arbaMeya || meya > 0) category = arbaMeya ? "arbaMeya" : "meya";
  else if (khamsin > 0) category = "khamsin";
  else if (sera > 0) category = "sera";

  return {
    sequentialValue: total,
    sequentialType: category,
    bloatValue: bloatOn ? v.bloat : 0,
  };
}

function resolveRound({ gameType, hakamSuit, buyerSide, ourCards, lastTrickWinner, ourProjectCounts, theirProjectCounts, escalationLevel = "normal", escalatingSide = null }) {
  const deck = fullDeck();
  const ourIds = new Set(ourCards.map((c) => c.id));
  const theirCards = deck.filter((c) => !ourIds.has(c.id));

  let ourAbnat = sumBant(ourCards, gameType, hakamSuit);
  let theirAbnat = sumBant(theirCards, gameType, hakamSuit);
  if (lastTrickWinner === "ours") ourAbnat += RULES.groundBonus; else theirAbnat += RULES.groundBonus;

  // القسم 5-4/5-5 من اللائحة: دبل يضاعف قيمة المشاريع التسلسلية (ليس بلوت)، ثري/فور لا يضاعفانها
  const ourAgg = aggregateProjects(gameType, ourProjectCounts);
  const theirAgg = aggregateProjects(gameType, theirProjectCounts);
  if (escalationLevel === "dabl") {
    ourAgg.sequentialValue *= 2;
    theirAgg.sequentialValue *= 2;
  }
  const ourProjectPoints = ourAgg.sequentialValue + ourAgg.bloatValue;
  const theirProjectPoints = theirAgg.sequentialValue + theirAgg.bloatValue;

  // القسم 4-10: دبل تحديدًا -> المدبل هو "المشتري" لغرض عتبة النظارة. ثري/فور/قهوة -> يبقى المشتري الأصلي (تبسيط موثّق).
  const effectiveBuyer = escalationLevel === "dabl" && escalatingSide ? escalatingSide : buyerSide;
  const nonBuyerSide = effectiveBuyer === "ours" ? "theirs" : "ours";
  const nonBuyerAgg = nonBuyerSide === "ours" ? ourAgg : theirAgg;
  const buyerHasBloat = effectiveBuyer === "ours" ? ourAgg.bloatValue > 0 : theirAgg.bloatValue > 0;
  const nonBuyerAbnat = nonBuyerSide === "ours" ? ourAbnat : theirAbnat;

  const category = nitharaCategory(nonBuyerAgg.sequentialType ? { type: nonBuyerAgg.sequentialType } : null);
  const rule = RULES.nithara[gameType][category];
  const effective = rule.requiresNoBloatDeclared && buyerHasBloat ? RULES.nithara[gameType]["none"] : rule;

  let outcome;
  let winnerSide = null;
  if (effective.tieAt != null && nonBuyerAbnat === effective.tieAt) {
    // القسم 7-6: تعادل مع أي تصعيد فعّال -> المدبل يخسر الجولة، وليس تعادلًا عاديًا
    if (escalationLevel !== "normal" && escalatingSide) {
      outcome = "buyerFails";
      winnerSide = escalatingSide === "ours" ? "theirs" : "ours";
    } else {
      outcome = "tie";
    }
  } else if (nonBuyerAbnat >= effective.threshold) {
    outcome = "buyerFails";
    winnerSide = nonBuyerSide;
  } else {
    outcome = "buyerSuccess";
  }

  const isKabootOurs = ourCards.length === 32;
  const isKabootTheirs = theirCards.length === 32;

  const displayCardsOurs = isKabootOurs ? RULES.kabootBonus[gameType] : toDisplay(ourAbnat, gameType);
  const displayCardsTheirs = isKabootTheirs ? RULES.kabootBonus[gameType] : toDisplay(theirAbnat, gameType);
  let displayTotalOurs, displayTotalTheirs;
  if (outcome === "buyerFails") {
    const all = displayCardsOurs + displayCardsTheirs + ourProjectPoints + theirProjectPoints;
    displayTotalOurs = winnerSide === "ours" ? all : 0;
    displayTotalTheirs = winnerSide === "theirs" ? all : 0;
  } else {
    displayTotalOurs = displayCardsOurs + ourProjectPoints;
    displayTotalTheirs = displayCardsTheirs + theirProjectPoints;
  }

  // القسم 7-4: مضاعفة نتيجة الجولة الكاملة بمعامل التصعيد (دبل×2 / ثري×3 / فور×4)
  const mult = { normal: 1, dabl: 2, three: 3, four: 4, gahwa: 1 }[escalationLevel] ?? 1;
  displayTotalOurs *= mult;
  displayTotalTheirs *= mult;

  // قهوة: الفائز بهذه الجولة يفوز بالصكة فورًا بصرف النظر عن 152
  const gahwaWinner = escalationLevel === "gahwa" ? (displayTotalOurs > displayTotalTheirs ? "ours" : "theirs") : null;

  return {
    outcome, isKabootOurs, isKabootTheirs,
    rawOurs: ourAbnat, rawTheirs: theirAbnat,
    displayCardsOurs, displayCardsTheirs,
    displayProjectsOurs: ourProjectPoints, displayProjectsTheirs: theirProjectPoints,
    displayTotalOurs, displayTotalTheirs,
    escalationLevel, escalatingSide, multiplier: mult, gahwaWinner,
  };
}

function projectFields(gameType) {
  return gameType === "sun"
    ? [{ key: "sera", label: "سرا" }, { key: "khamsin", label: "خمسين" }, { key: "meya", label: "مية" }]
    : [{ key: "sera", label: "سرا" }, { key: "khamsin", label: "خمسين" }, { key: "meya", label: "مية" }];
}

/* ============================================================
   قافط المشاريع — تحقق اختياري من صدق مشروع المشتري (مقفول افتراضيًا، يُفعَّل من الإعدادات)
   يحتاج يد المشتري الفعلية (لاعبَين × 8 أوراق) لأن التسلسل يجب أن يكون بيد لاعب واحد لا فريق مجتمع
   ============================================================ */
const SEQ_RANK_ORDER = ["7", "8", "9", "10", "J", "Q", "K", "A"];
function longestSeqInSuit(cards) {
  const ranks = new Set(cards.map((c) => c.rank));
  let best = [], cur = [];
  for (const r of SEQ_RANK_ORDER) {
    if (ranks.has(r)) { cur.push(r); if (cur.length > best.length) best = [...cur]; }
    else cur = [];
  }
  return best;
}
/** يكتشف المشاريع المثلى ليد كاملة (أي عدد أوراق)، مع حل تعارض الأوراق المشتركة بين احتمالي التسلسل والتشابه
 * (مثال: شايب الهاص قد يكون جزءًا من تسلسل 10-و-ب-ش-إ أو جزءًا من "أربع شياب"، لكن ليس الاثنين معًا).
 * يجرّب كل التوزيعات الممكنة للأوراق المتنازع عليها (أربعات الرتب + بلوت-مقابل-تسلسل بيت الحكم) ويختار الأعلى قيمة إجمالية. */
/** يتحقق: هل تصريح المستخدم بعينه (declared) قابل للتحقق فعليًا من هذه الأوراق، بأي توزيعة صادقة ممكنة؟
 * لا يفرض التوزيعة الأعلى قيمة — فقط يبحث: هل يوجد تفسير صادق للأوراق يثبت بالضبط ما صرّح به اللاعب؟ */
function isDeclarationAchievable(hand, gameType, hakamSuit, declared) {
  const bySuit = {};
  for (const c of hand) { bySuit[c.suit] = bySuit[c.suit] || []; bySuit[c.suit].push(c); }
  const byRank = {};
  for (const c of hand) { byRank[c.rank] = byRank[c.rank] || []; byRank[c.rank].push(c); }

  const quadCandidates = ["A", "K", "Q", "J", "10"].filter((r) => (byRank[r] || []).length === 4);
  const bloatCandidate = gameType === "hakam" && hakamSuit &&
    (bySuit[hakamSuit] || []).some((c) => c.rank === "K") && (bySuit[hakamSuit] || []).some((c) => c.rank === "Q");
  const toggles = [...quadCandidates.map((r) => ({ type: "quad", rank: r })), ...(bloatCandidate ? [{ type: "bloat" }] : [])];
  const n = toggles.length;

  for (let mask = 0; mask < (1 << n); mask++) {
    const reservedRanks = new Set();
    let useBloat = false;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        if (toggles[i].type === "quad") reservedRanks.add(toggles[i].rank);
        else useBloat = true;
      }
    }
    if (declared.bloat && !useBloat) continue; // هذا التوزيع لا يوفّر بلوت المطلوب، جرّب توزيعًا آخر
    const arbaAvailable = gameType === "sun" && reservedRanks.has("A");
    if (declared.arbaMeya && !arbaAvailable) continue;
    const quadMeyaAvailable = [...reservedRanks].filter((r) => !(r === "A" && gameType === "sun")).length;

    const remaining = hand.filter((c) => {
      if (reservedRanks.has(c.rank)) return false;
      if (useBloat && c.suit === hakamSuit && (c.rank === "K" || c.rank === "Q")) return false;
      return true;
    });
    const remainingBySuit = {};
    for (const c of remaining) { remainingBySuit[c.suit] = remainingBySuit[c.suit] || []; remainingBySuit[c.suit].push(c); }
    const lengths = Object.values(remainingBySuit).map((cards) => longestSeqInSuit(cards).length).filter((l) => l >= 3).sort((a, b) => b - a);

    // تحقق قابلية تلبية العدادات المصرَّح بها من أطوال التسلسلات المتاحة + مية التشابه، بترتيب الأصعب أولاً (مية ثم خمسين ثم سرا)
    let needMeya = declared.meya;
    let meyaFromQuad = Math.min(needMeya, quadMeyaAvailable);
    needMeya -= meyaFromQuad;
    const used = new Array(lengths.length).fill(false);
    for (let i = 0; i < lengths.length && needMeya > 0; i++) { if (lengths[i] >= 5) { used[i] = true; needMeya--; } }
    if (needMeya > 0) continue;

    let needKhamsin = declared.khamsin;
    for (let i = 0; i < lengths.length && needKhamsin > 0; i++) { if (!used[i] && lengths[i] >= 4) { used[i] = true; needKhamsin--; } }
    if (needKhamsin > 0) continue;

    let needSera = declared.sera;
    for (let i = 0; i < lengths.length && needSera > 0; i++) { if (!used[i] && lengths[i] >= 3) { used[i] = true; needSera--; } }
    if (needSera > 0) continue;

    return true; // وُجدت توزيعة صادقة تحقق بالضبط كل ما صرّح به اللاعب
  }
  return false;
}

/** يكتشف المشاريع المثلى (أعلى قيمة) — يُستخدم فقط كمرجع للتصحيح عند إثبات أن التصريح غير قابل للتحقق إطلاقًا */
function detectHandCounts(hand, gameType, hakamSuit) {
  const v = RULES.projectValues[gameType];
  const bySuit = {};
  for (const c of hand) { bySuit[c.suit] = bySuit[c.suit] || []; bySuit[c.suit].push(c); }
  const byRank = {};
  for (const c of hand) { byRank[c.rank] = byRank[c.rank] || []; byRank[c.rank].push(c); }

  // الرتب المرشَّحة لتشابه (وجود الأربعة أشكال كاملة في اليد)
  const quadCandidates = ["A", "K", "Q", "J", "10"].filter((r) => (byRank[r] || []).length === 4);
  // هل بيت الحكم فيه K و Q معًا (مرشَّح لبلوت، قد يتعارض مع تسلسل نفس البيت)؟
  const bloatCandidate = gameType === "hakam" && hakamSuit &&
    (bySuit[hakamSuit] || []).some((c) => c.rank === "K") && (bySuit[hakamSuit] || []).some((c) => c.rank === "Q");

  const toggles = [...quadCandidates.map((r) => ({ type: "quad", rank: r })), ...(bloatCandidate ? [{ type: "bloat" }] : [])];
  const n = toggles.length;
  let best = null;

  for (let mask = 0; mask < (1 << n); mask++) {
    const reservedRanks = new Set(); // رتب محجوزة للتشابه (تُستبعد من حساب التسلسل)
    let useBloat = false;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) {
        if (toggles[i].type === "quad") reservedRanks.add(toggles[i].rank);
        else useBloat = true;
      }
    }
    // الأوراق المتبقية لحساب التسلسل: نستبعد رتب التشابه المحجوزة، ونستبعد K/Q لبيت الحكم إن حُجزا لبلوت
    const remaining = hand.filter((c) => {
      if (reservedRanks.has(c.rank)) return false;
      if (useBloat && c.suit === hakamSuit && (c.rank === "K" || c.rank === "Q")) return false;
      return true;
    });
    const remainingBySuit = {};
    for (const c of remaining) { remainingBySuit[c.suit] = remainingBySuit[c.suit] || []; remainingBySuit[c.suit].push(c); }

    let sera = 0, khamsin = 0, meyaSeq = 0;
    for (const suit of Object.keys(remainingBySuit)) {
      const seq = longestSeqInSuit(remainingBySuit[suit]);
      if (seq.length >= 5) meyaSeq++;
      else if (seq.length === 4) khamsin++;
      else if (seq.length === 3) sera++;
    }

    let meyaMatch = 0, arbaMeya = false;
    for (const r of reservedRanks) {
      if (r === "A" && gameType === "sun") arbaMeya = true;
      else meyaMatch++;
    }
    const meya = meyaSeq + meyaMatch;

    const value = sera * v.sera + khamsin * v.khamsin + meya * v.meya + (arbaMeya ? v.arbaMeya : 0) + (useBloat ? v.bloat : 0);
    if (!best || value > best.value) {
      best = { sera, khamsin, meya, arbaMeya, bloat: useBloat, value };
    }
  }
  return best || { sera: 0, khamsin: 0, meya: 0, arbaMeya: false, bloat: false, value: 0 };
}

/* ============================================================
   تخزين محلي عبر window.storage
   ============================================================ */
const HISTORY_KEY = "sakkat-history";
const SETTINGS_KEY = "sakkat-settings";
const INPROGRESS_KEY = "sakkat-inprogress";

async function loadHistory() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]'); } catch { return []; } }
async function saveHistory(list) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch {} }
async function loadSettings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null') || { sound: false, vibration: false, motion: true, judge: false }; } catch { return { sound: false, vibration: false, motion: true, judge: false }; } }
async function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} }
async function loadInProgress() { try { return JSON.parse(localStorage.getItem(INPROGRESS_KEY) || 'null'); } catch { return null; } }
async function saveInProgress(state) { try { localStorage.setItem(INPROGRESS_KEY, JSON.stringify(state)); } catch {} }
async function clearInProgress() { try { localStorage.removeItem(INPROGRESS_KEY); } catch {} }

/* ============================================================
   خلفية رموز متحركة — أنيميشن محسّن: مسارات متنوعة + تنفّس حجم + ظهور/اختفاء تدريجي
   ============================================================ */
const FLOAT_STYLE = `
@keyframes suitFloatA {
  0%   { transform: translate(0,0) rotate(0deg) scale(1); opacity: 0; }
  12%  { opacity: 0.07; }
  50%  { transform: translate(10px,-26px) rotate(10deg) scale(1.08); opacity: 0.09; }
  88%  { opacity: 0.07; }
  100% { transform: translate(0,0) rotate(0deg) scale(1); opacity: 0; }
}
@keyframes suitFloatB {
  0%   { transform: translate(0,0) rotate(0deg) scale(1); opacity: 0; }
  12%  { opacity: 0.06; }
  50%  { transform: translate(-14px,-18px) rotate(-8deg) scale(0.94); opacity: 0.08; }
  88%  { opacity: 0.06; }
  100% { transform: translate(0,0) rotate(0deg) scale(1); opacity: 0; }
}
.suit-float { animation-timing-function: ease-in-out; animation-iteration-count: infinite; }
.suit-float.paused { animation: none !important; opacity: 0.035; }
`;

function FloatingSuits({ enabled }) {
  const symbols = useMemo(() => {
    const arr = [];
    const syms = ["♠", "♥", "♦", "♣"];
    for (let i = 0; i < 16; i++) {
      arr.push({
        s: syms[i % 4], left: (i * 31 + 7) % 100, top: (i * 47 + 11) % 100,
        size: 20 + (i % 5) * 10, dur: 15 + (i % 7) * 4, delay: (i % 9) * -2.4,
        variant: i % 2 === 0 ? "suitFloatA" : "suitFloatB",
        red: syms[i % 4] === "♥" || syms[i % 4] === "♦",
      });
    }
    return arr;
  }, []);
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none select-none" aria-hidden="true">
      <style>{FLOAT_STYLE}</style>
      {symbols.map((sym, i) => (
        <span key={i} className={`suit-float ${enabled ? "" : "paused"} absolute font-bold ${sym.red ? "text-red-500" : "text-neutral-400"}`}
          style={{ left: `${sym.left}%`, top: `${sym.top}%`, fontSize: sym.size, animationName: sym.variant, animationDuration: `${sym.dur}s`, animationDelay: `${sym.delay}s` }}>
          {sym.s}
        </span>
      ))}
    </div>
  );
}

function Logo({ size = 56 }) {
  const mini = [{ s: "♠", r: false }, { s: "♥", r: true }, { s: "♦", r: true }, { s: "♣", r: false }];
  return (
    <div className="flex justify-center gap-1 mb-3" style={{ height: size }}>
      {mini.map((m, i) => (
        <div key={i} className="bg-neutral-50 rounded-md flex items-center justify-center shadow-lg"
          style={{ width: size * 0.62, height: size, transform: `rotate(${(i - 1.5) * 8}deg) translateY(${Math.abs(i - 1.5) * 4}px)` }}>
          <span className={`text-xl font-bold ${m.r ? "text-red-600" : "text-neutral-900"}`}>{m.s}</span>
        </div>
      ))}
    </div>
  );
}

function PlayCard({ card, onClick, disabled, selected, size = "normal" }) {
  const red = SUIT_RED[card.suit];
  const dims = size === "small" ? "w-9 h-12 text-[11px] sm:w-12 sm:h-16 sm:text-sm lg:w-14 lg:h-[4.75rem] lg:text-base" : "w-16 h-22 text-sm";
  return (
    <button onClick={onClick} disabled={disabled}
      className={`${dims} rounded-lg flex flex-col items-center justify-center font-bold transition-all duration-150 touch-manipulation
        ${disabled ? "bg-neutral-800 opacity-20 cursor-not-allowed" : selected ? "bg-amber-100 ring-2 ring-amber-400 -translate-y-1 shadow-lg" : "bg-neutral-50 hover:brightness-95 active:scale-90 shadow-md"}
        ${red ? "text-red-600" : "text-neutral-900"}`}>
      <span className="leading-none">{RANK_LABEL[card.rank]}</span>
      <span className="text-base leading-none mt-0.5">{SUIT_SYMBOL[card.suit]}</span>
    </button>
  );
}

function BackBtn({ onClick }) {
  return <button onClick={onClick} className="text-neutral-500 text-sm px-2 py-1 hover:text-neutral-300">→ رجوع</button>;
}
const gold = "text-amber-400";

/* ============================================================
   حاسبة البلوت — رقم يُضغط فيتحول لحقل إدخال مباشر (لا لوحة، لا أزرار زائدة)
   ============================================================ */
function EditableScore({ value, onChange, onEnter }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const inputRef = useRef(null);

  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
  useEffect(() => { if (!editing) setDraft(String(value)); }, [value, editing]);

  function commit() {
    const n = parseInt(draft, 10);
    onChange(Number.isFinite(n) && n >= 0 ? n : 0);
    setEditing(false);
  }
  function commitAndEnter() {
    const n = parseInt(draft, 10);
    const val = Number.isFinite(n) && n >= 0 ? n : 0;
    onChange(val);
    setEditing(false);
    if (onEnter) onEnter(val); // نمرر القيمة مباشرة (لا ننتظر تحديث الحالة) لتفادي قيمة قديمة عند التسجيل الفوري
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="tel"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") commitAndEnter(); }}
        className="text-5xl font-extrabold text-amber-400 leading-none w-full text-center bg-transparent outline-none border-b-2 border-amber-400/50"
      />
    );
  }
  return (
    <button onClick={() => { setDraft(String(value)); setEditing(true); }} className="text-5xl font-extrabold text-amber-400 leading-none block w-full">
      {value}
    </button>
  );
}

function ManualCalculator({ onExit }) {
  const [draftOurs, setDraftOurs] = useState(0);
  const [draftTheirs, setDraftTheirs] = useState(0);
  const [totalOurs, setTotalOurs] = useState(0);
  const [totalTheirs, setTotalTheirs] = useState(0);
  const [history, setHistory] = useState([]); // للتراجع: لقطة كاملة قبل كل جولة مُسجَّلة
  const [roundsLog, setRoundsLog] = useState([]); // سجل الجولات — يظهر دائمًا وجوبًا

  function commitRound(overrides = {}) {
    const finalOurs = overrides.ours ?? draftOurs;
    const finalTheirs = overrides.theirs ?? draftTheirs;
    setHistory((h) => [...h, { totalOurs, totalTheirs, roundsLog }]);
    setTotalOurs((t) => t + finalOurs);
    setTotalTheirs((t) => t + finalTheirs);
    setRoundsLog((r) => [...r, { n: r.length + 1, ours: finalOurs, theirs: finalTheirs }]);
    setDraftOurs(0);
    setDraftTheirs(0);
  }
  function undo() {
    setHistory((h) => {
      if (!h.length) return h;
      const last = h[h.length - 1];
      setTotalOurs(last.totalOurs); setTotalTheirs(last.totalTheirs); setRoundsLog(last.roundsLog);
      return h.slice(0, -1);
    });
  }
  function reset() {
    setHistory([]); setRoundsLog([]);
    setTotalOurs(0); setTotalTheirs(0);
    setDraftOurs(0); setDraftTheirs(0);
  }

  return (
    <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto p-4 sm:p-6 relative z-10">
      <BackBtn onClick={onExit} />
      <h2 className={`text-xl font-extrabold ${gold} text-center my-4`}>حاسبة البلوت</h2>

      <p className="text-center text-neutral-500 text-xs mb-2">أدخل نتيجة الجولة، ثم "تسجيل الجولة" — يُصفَّر الحقلان تلقائيًا للجولة التالية</p>
      <div className="grid grid-cols-2 gap-3 mb-2">
        <div className="bg-neutral-900/70 rounded-2xl p-5 text-center border border-neutral-800">
          <p className="text-neutral-400 font-bold mb-2 text-sm">لنا</p>
          <EditableScore value={draftOurs} onChange={setDraftOurs} onEnter={(v) => commitRound({ ours: v })} />
        </div>
        <div className="bg-neutral-900/70 rounded-2xl p-5 text-center border border-neutral-800">
          <p className="text-neutral-400 font-bold mb-2 text-sm">لهم</p>
          <EditableScore value={draftTheirs} onChange={setDraftTheirs} onEnter={(v) => commitRound({ theirs: v })} />
        </div>
      </div>
      <button onClick={commitRound} className="w-full bg-amber-400 text-neutral-950 font-extrabold py-2.5 rounded-xl mb-4">تسجيل الجولة</button>

      <div className="border-t border-neutral-800 pt-3 text-center mb-4">
        <p className="text-neutral-500 text-xs mb-1">المجموع التراكمي</p>
        <p className={`text-2xl font-extrabold ${gold}`}>{totalOurs} — {totalTheirs}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div>
          <p className="text-center text-neutral-500 text-xs mb-1.5 font-bold">لنا</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {[...roundsLog].reverse().map((r) => (
              <div key={r.n} className="flex justify-between text-sm bg-neutral-900/50 rounded-lg px-2.5 py-1.5 border border-neutral-800/60">
                <span className="text-neutral-600 text-xs">ج{r.n}</span>
                <span className="text-amber-400 font-bold">{r.ours}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-center text-neutral-500 text-xs mb-1.5 font-bold">لهم</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {[...roundsLog].reverse().map((r) => (
              <div key={r.n} className="flex justify-between text-sm bg-neutral-900/50 rounded-lg px-2.5 py-1.5 border border-neutral-800/60">
                <span className="text-neutral-600 text-xs">ج{r.n}</span>
                <span className="text-neutral-200 font-bold">{r.theirs}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button onClick={undo} disabled={!history.length} className="flex-1 bg-neutral-800 text-neutral-200 font-bold py-3 rounded-xl disabled:opacity-30">↩ تراجع</button>
        <button onClick={reset} className="flex-1 bg-neutral-900 text-neutral-400 font-bold py-3 rounded-xl border border-neutral-800">بدء من جديد</button>
      </div>
    </div>
  );
}

/* ============================================================
   حاسبة الصكة الاحترافية — الصكة = عدة جولات، كل جولة تُعاد إعدادها من الصفر
   ============================================================ */
function ProCalculator({ onExit, onFinishMatch, judgeEnabled }) {
  const [screen, setScreen] = useState("checkingResume"); // checkingResume -> (resumePrompt | matchSetup) -> roundSetup -> cards -> projects -> result
  const [teamOurs, setTeamOurs] = useState("لنا");
  const [teamTheirs, setTeamTheirs] = useState("لهم");

  // إعدادات خاصة بالجولة الحالية فقط — تُصفَّر كل جولة
  const [buyerSide, setBuyerSide] = useState(null);
  const [gameType, setGameType] = useState(null);
  const [hakamSuit, setHakamSuit] = useState("h");
  const [escalationLevel, setEscalationLevel] = useState("normal");
  const [escalatingSide, setEscalatingSide] = useState(null);
  const [matchWinnerOverride, setMatchWinnerOverride] = useState(null); // قهوة: يفوز بالصكة فورًا

  const [rounds, setRounds] = useState([]);
  const [ourCards, setOurCards] = useState([]);
  const [cardHistory, setCardHistory] = useState([]);
  const [lastTrickWinner, setLastTrickWinner] = useState(null);
  const [ourProjects, setOurProjects] = useState({ sera: 0, khamsin: 0, meya: 0, arbaMeya: false, bloat: false });
  const [theirProjects, setTheirProjects] = useState({ sera: 0, khamsin: 0, meya: 0, arbaMeya: false, bloat: false });
  const [lastResult, setLastResult] = useState(null);

  // عند فتح الحاسبة الاحترافية: تحقق من وجود صكة غير مكتملة محفوظة
  useEffect(() => {
    (async () => {
      const saved = await loadInProgress();
      if (saved && saved.rounds && saved.rounds.length > 0) setScreen("resumePrompt");
      else setScreen("matchSetup");
    })();
  }, []);

  // حفظ تلقائي لتقدم الصكة بعد كل جولة (يمكّن الاستئناف لو خرج بالغلط)
  useEffect(() => {
    if (rounds.length > 0 && !isFinishedFlag(rounds, matchWinnerOverride)) {
      saveInProgress({ teamOurs, teamTheirs, rounds, matchWinnerOverride });
    }
  }, [rounds]);

  function isFinishedFlag(rlist, override) {
    const tOurs = rlist.reduce((s, r) => s + r.displayTotalOurs, 0);
    const tTheirs = rlist.reduce((s, r) => s + r.displayTotalTheirs, 0);
    return !!override || tOurs >= RULES.matchTarget || tTheirs >= RULES.matchTarget;
  }

  async function resumeMatch() {
    const saved = await loadInProgress();
    if (saved) {
      setTeamOurs(saved.teamOurs); setTeamTheirs(saved.teamTheirs);
      setRounds(saved.rounds); setMatchWinnerOverride(saved.matchWinnerOverride || null);
    }
    goToRoundSetup();
  }
  async function startFreshMatch() {
    await clearInProgress();
    setScreen("matchSetup");
  }
  async function handleExit() {
    if (rounds.length === 0) await clearInProgress(); // لا تقدّم فعليًا لحفظه
    onExit();
  }

  const deck = useMemo(() => fullDeck(), []);
  const ourIds = useMemo(() => new Set(ourCards.map((c) => c.id)), [ourCards]);

  const totalOurs = rounds.reduce((s, r) => s + r.displayTotalOurs, 0);
  const totalTheirs = rounds.reduce((s, r) => s + r.displayTotalTheirs, 0);
  const isFinished = !!matchWinnerOverride || totalOurs >= RULES.matchTarget || totalTheirs >= RULES.matchTarget;

  /** القسم 7-2: يجوز للفريق طلب دبل بالصن فقط إذا كان مجموعه التراكمي ≤100 بينما تجاوز الخصم 100 */
  function dablQualifies(side) {
    const mine = side === "ours" ? totalOurs : totalTheirs;
    const other = side === "ours" ? totalTheirs : totalOurs;
    return mine <= 100 && other > 100;
  }

  /** تُستدعى في بداية كل جولة (الأولى وكل التاليات) — تصفّر كل شيء خاص بالجولة */
  function resetRoundState() {
    setBuyerSide(null); setGameType(null); setHakamSuit("h"); setEscalationLevel("normal"); setEscalatingSide(null);
    setOurCards([]); setCardHistory([]); setLastTrickWinner(null);
    setOurProjects({ sera: 0, khamsin: 0, meya: 0, arbaMeya: false, bloat: false });
    setTheirProjects({ sera: 0, khamsin: 0, meya: 0, arbaMeya: false, bloat: false });
  }
  function goToRoundSetup() { resetRoundState(); setScreen("roundSetup"); }
  function startCards() {
    // تصفير اختيار الأوراق فقط (وليس المشتري/نوع اللعب) — يمنع بقاء أثر "كبوت" سابق يقفل كل الأوراق
    setOurCards([]); setCardHistory([]); setLastTrickWinner(null);
    setScreen("cards");
  }
  /** كبوت: فريق واحد أخذ كل الأوراق الـ32 — تخطّي شاشة الأوراق بالكامل والانتقال مباشرة للمشاريع */
  function declareKaboot(side) {
    if (side === "ours") { setOurCards(deck); }
    else { setOurCards([]); }
    setLastTrickWinner(side);
    setScreen("projects");
  }

  /** ضغطة على الورقة تُبدّل حالتها: تُضاف إن لم تكن مُختارة، تُزال إن كانت مُختارة — يسمح بالمراجعة والتعديل الحر */
  function tapCard(card) {
    setCardHistory((h) => [...h, ourCards]);
    if (ourIds.has(card.id)) setOurCards((c) => c.filter((x) => x.id !== card.id));
    else setOurCards((c) => [...c, card]);
  }
  function undoCard() {
    setCardHistory((h) => {
      if (!h.length) return h;
      setOurCards(h[h.length - 1]);
      return h.slice(0, -1);
    });
  }
  function undoLastRound() {
    setRounds((r) => r.slice(0, -1));
    setMatchWinnerOverride(null); // إن كانت قهوة، نُلغي الفوز الفوري لأننا نعيد النظر بالجولة
    setScreen("cards"); // لا نصفّر ourCards/ourProjects/theirProjects — تبقى كما كانت ليعدّل عليها المستخدم بحرية
  }
  function computeResult(overrideOurs, overrideTheirs, flags) {
    const oProj = overrideOurs || ourProjects;
    const tProj = overrideTheirs || theirProjects;
    const result = resolveRound({
      gameType, hakamSuit, buyerSide, ourCards, lastTrickWinner: lastTrickWinner || "ours",
      ourProjectCounts: oProj, theirProjectCounts: tProj, escalationLevel, escalatingSide,
    });
    const roundEntry = { ...result, roundNumber: rounds.length + 1, gameType, buyerName: buyerSide === "ours" ? teamOurs : teamTheirs, judgeFlags: flags || [] };
    setLastResult(roundEntry);
    setRounds((r) => [...r, roundEntry]);
    if (result.gahwaWinner) {
      setMatchWinnerOverride(result.gahwaWinner === "ours" ? teamOurs : teamTheirs);
    }
    setScreen("result");
  }
  function proceedFromProjects() {
    const deck = fullDeck();
    const ourIds = new Set(ourCards.map((c) => c.id));
    const theirCards = deck.filter((c) => !ourIds.has(c.id));
    const isKaboot = ourCards.length === 32 || ourCards.length === 0;

    // استثناء الكبوت: فريق بلا أوراق (0) أو بكل الأوراق (32) — الفحص يفقد معناه هنا، نتخطاه كليًا
    if (!judgeEnabled || isKaboot) { computeResult(); return; }

    // قافط المشاريع: "يتحقق، ولا يتنبأ" — يتحقق فقط من التصريح الذي اختاره اللاعب بعينه، ولا يفرض عليه
    // تفسيرًا آخر (كالتوزيعة الأعلى قيمة) ولا يضيف مشروعًا لم يصرّح به مهما كانت الأوراق تسمح به.
    // ملاحظة صادقة: هذه الأوراق هي ما حصده الفريق أثناء اللعب، وليست بالضرورة يده الابتدائية تمامًا،
    // لذا الفحص تقريبي وليس دقيقًا 100% نظريًا — لكنه أفضل تقريب ممكن دون إدخال إضافي، بطلبك صراحة.
    function checkSide(declared, cards, label) {
      // أولًا: هل تصريحه بعينه ممكن فعليًا بأي توزيعة صادقة؟ إن كان كذلك، لا نغيّر شيئًا إطلاقًا.
      if (isDeclarationAchievable(cards, gameType, hakamSuit, declared)) {
        return { corrected: declared, flags: [] };
      }
      // غير ممكن مطلقًا بأي توزيعة -> نصحّح للأقرب الصادق (توزيعة القيمة القصوى كمرجع تصحيح فقط، وليست فرضًا لتفسير جديد)
      const actual = detectHandCounts(cards, gameType, hakamSuit);
      const corrected = { ...declared };
      const flags = [];
      const projectLabel = { sera: "سرا", khamsin: "خمسين", meya: "مية" };
      for (const key of ["sera", "khamsin", "meya"]) {
        if (declared[key] > actual[key]) {
          if (actual[key] === 0) {
            flags.push(`تمت إزالة مشروع "${projectLabel[key]}" من نتيجة ${label} — غير قابل للتحقق من الأوراق المُختارة.`);
          } else {
            flags.push(`تم تخفيض عدد "${projectLabel[key]}" لدى ${label} من ${declared[key]} إلى ${actual[key]} — هذا أقصى عدد يمكن التحقق منه معًا.`);
          }
          corrected[key] = actual[key];
        }
      }
      if (declared.bloat && !actual.bloat) { flags.push(`تمت إزالة مشروع "بلوت" من نتيجة ${label} — غير قابل للتحقق مع بقية تصريحه معًا.`); corrected.bloat = false; }
      if (declared.arbaMeya && !actual.arbaMeya) { flags.push(`تمت إزالة مشروع "400" من نتيجة ${label} — غير قابل للتحقق مع بقية تصريحه معًا.`); corrected.arbaMeya = false; }
      return { corrected, flags };
    }

    const ourCheck = checkSide(ourProjects, ourCards, teamOurs);
    const theirCheck = checkSide(theirProjects, theirCards, teamTheirs);
    const allFlags = [...ourCheck.flags, ...theirCheck.flags];
    setOurProjects(ourCheck.corrected);
    setTheirProjects(theirCheck.corrected);
    computeResult(ourCheck.corrected, theirCheck.corrected, allFlags);
  }
  function finishAndSave() {
    const winner = matchWinnerOverride || (totalOurs > totalTheirs ? teamOurs : teamTheirs);
    onFinishMatch({ teamOurs, teamTheirs, totalOurs, totalTheirs, winner, rounds, date: new Date().toISOString() });
    clearInProgress();
    onExit();
  }

  if (screen === "checkingResume") return null;

  if (screen === "resumePrompt") {
    return (
      <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto p-4 sm:p-6 relative z-10 text-center">
        <p className={`text-xl font-extrabold ${gold} mb-3`}>عندك صكة لم تكتمل</p>
        <p className="text-neutral-400 text-sm mb-8">هل تكمل نفس الصكة أم تبدأ صكة جديدة؟</p>
        <div className="space-y-3">
          <button onClick={resumeMatch} className="w-full bg-amber-400 text-neutral-950 font-extrabold py-3.5 rounded-xl text-lg shadow-lg">نكمل الصكة</button>
          <button onClick={startFreshMatch} className="w-full bg-neutral-900 text-neutral-300 font-bold py-3.5 rounded-xl border border-neutral-800">صكة جديدة</button>
        </div>
      </div>
    );
  }

  if (screen === "matchSetup") {
    return (
      <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto p-4 sm:p-6 relative z-10">
        <BackBtn onClick={handleExit} />
        <h2 className={`text-xl font-extrabold ${gold} text-center my-4`}>حاسبة الصكة</h2>
        <p className="text-center text-neutral-500 text-sm mb-4">أسماء الفرق (اختياري)</p>
        <div className="grid grid-cols-2 gap-3 mb-8">
          <input value={teamOurs} onChange={(e) => setTeamOurs(e.target.value)} className="rounded-xl p-3 text-center bg-neutral-900 text-neutral-100 font-bold border border-neutral-800" />
          <input value={teamTheirs} onChange={(e) => setTeamTheirs(e.target.value)} className="rounded-xl p-3 text-center bg-neutral-900 text-neutral-100 font-bold border border-neutral-800" />
        </div>
        <button onClick={goToRoundSetup} className="w-full bg-amber-400 text-neutral-950 font-extrabold py-3.5 rounded-xl text-lg shadow-lg">ابدأ الصكة</button>
      </div>
    );
  }

  if (screen === "roundSetup") {
    const dablSunInvalid = gameType === "sun" && escalationLevel === "dabl" && escalatingSide && !dablQualifies(escalatingSide);
    const canProceed = buyerSide && gameType && (escalationLevel === "normal" || escalatingSide) && !dablSunInvalid;
    return (
      <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto p-4 sm:p-6 relative z-10">
        <BackBtn onClick={handleExit} />
        <p className="text-center text-neutral-500 text-sm mb-1">الجولة {rounds.length + 1}</p>
        <p className={`text-center text-lg font-extrabold ${gold} mb-4`}>{totalOurs} — {totalTheirs}</p>

        <p className="text-neutral-500 text-sm mb-2">المشتري</p>
        <div className="flex gap-2 mb-4">
          {["ours", "theirs"].map((s) => (
            <button key={s} onClick={() => setBuyerSide(s)} className={`flex-1 py-3 rounded-xl font-bold ${buyerSide === s ? "bg-amber-400 text-neutral-950" : "bg-neutral-900 text-neutral-300 border border-neutral-800"}`}>
              {s === "ours" ? teamOurs : teamTheirs}
            </button>
          ))}
        </div>

        <p className="text-neutral-500 text-sm mb-2">نوع اللعب</p>
        <div className="flex gap-2 mb-4">
          {["sun", "hakam"].map((t) => (
            <button key={t} onClick={() => { setGameType(t); if (t === "sun" && !["normal", "dabl"].includes(escalationLevel)) { setEscalationLevel("normal"); setEscalatingSide(null); } }} className={`flex-1 py-3 rounded-xl font-bold text-lg ${gameType === t ? "bg-amber-400 text-neutral-950" : "bg-neutral-900 text-neutral-300 border border-neutral-800"}`}>
              {t === "sun" ? "صن" : "حكم"}
            </button>
          ))}
        </div>

        {gameType === "hakam" && (
          <>
            <p className="text-neutral-500 text-sm mb-2">بيت الحكم</p>
            <div className="flex gap-2 mb-4">
              {SUITS.map((s) => (
                <button key={s} onClick={() => setHakamSuit(s)} className={`flex-1 py-3 rounded-xl text-xl ${hakamSuit === s ? "bg-amber-400" : "bg-neutral-900 border border-neutral-800"} ${SUIT_RED[s] ? "text-red-500" : "text-neutral-200"}`}>
                  {SUIT_SYMBOL[s]}
                </button>
              ))}
            </div>
          </>
        )}

        <p className="text-neutral-500 text-sm mb-2">حالة المشتري</p>
        <div className="grid grid-cols-5 gap-1.5 mb-4">
          {[
            { key: "normal", label: "عادي", enabled: true },
            { key: "dabl", label: "دبل", enabled: gameType === "hakam" || (gameType === "sun" && (dablQualifies("ours") || dablQualifies("theirs"))) },
            { key: "three", label: "ثري", enabled: gameType === "hakam" },
            { key: "four", label: "فور", enabled: gameType === "hakam" },
            { key: "gahwa", label: "قهوة", enabled: gameType === "hakam" },
          ].map((o) => (
            <button key={o.key} disabled={!o.enabled} onClick={() => { setEscalationLevel(o.key); if (o.key === "normal") setEscalatingSide(null); }}
              className={`py-2.5 rounded-xl font-bold text-xs ${escalationLevel === o.key ? "bg-amber-400 text-neutral-950" : "bg-neutral-900 text-neutral-600 border border-neutral-800"} ${!o.enabled ? "opacity-30" : ""}`}>
              {o.label}
            </button>
          ))}
        </div>
        {gameType === "sun" && (
          <p className="text-neutral-600 text-xs mb-4">
            الصن يسمح بـ"دبل" فقط (7-1)، ويشترط أن يكون مجموع الفريق الطالب ≤100 بينما تجاوز الخصم 100 (7-2).
            {!dablQualifies("ours") && !dablQualifies("theirs") && " — لا أحد يستوفي هذا الشرط حاليًا."}
          </p>
        )}

        {escalationLevel !== "normal" && (
          <>
            <p className="text-neutral-500 text-sm mb-2">من صعّد (المدبل)؟</p>
            <div className="flex gap-2 mb-6">
              {["ours", "theirs"].map((s) => {
                const restricted = escalationLevel === "dabl" && gameType === "sun";
                const allowed = !restricted || dablQualifies(s);
                return (
                  <button key={s} disabled={!allowed} onClick={() => setEscalatingSide(s)}
                    className={`flex-1 py-3 rounded-xl font-bold ${escalatingSide === s ? "bg-amber-400 text-neutral-950" : "bg-neutral-900 text-neutral-300 border border-neutral-800"} ${!allowed ? "opacity-30" : ""}`}>
                    {s === "ours" ? teamOurs : teamTheirs}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <p className="text-neutral-500 text-sm mb-2">كبوت؟ (يتخطى اختيار الأوراق وينتقل للمشاريع مباشرة)</p>
        <div className="flex gap-2 mb-6">
          {["ours", "theirs"].map((s) => (
            <button key={s} onClick={() => declareKaboot(s)} disabled={!canProceed}
              className="flex-1 py-3 rounded-xl font-bold bg-neutral-900 text-neutral-300 border border-amber-400/30 disabled:opacity-40">
              كبوت {s === "ours" ? teamOurs : teamTheirs}
            </button>
          ))}
        </div>

        <button onClick={startCards} disabled={!canProceed} className="w-full bg-amber-400 text-neutral-950 font-extrabold py-3.5 rounded-xl text-lg shadow-lg disabled:opacity-40">التالي — الأوراق</button>
      </div>
    );
  }

  if (screen === "cards") {
    return (
      <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto p-4 sm:p-6 relative z-10">
        <div className="flex items-center justify-between mb-3">
          <BackBtn onClick={() => setScreen("roundSetup")} />
          <button onClick={undoCard} disabled={!cardHistory.length} className="px-4 py-2 rounded-lg bg-neutral-900 text-neutral-300 font-bold text-sm border border-neutral-800 disabled:opacity-30">↩ تراجع</button>
        </div>
        <p className="text-center text-neutral-400 mb-3 text-sm">اختر أوراق فريق <span className={gold}>{teamOurs}</span> — اضغط الورقة مرة أخرى لإلغائها</p>
        <div className="grid grid-cols-8 sm:grid-cols-8 gap-1.5 sm:gap-2.5 bg-neutral-900/50 rounded-xl p-3 sm:p-4 mb-4 border border-neutral-800/60">
          {deck.map((card) => (
            <PlayCard key={card.id} card={card} selected={ourIds.has(card.id)} onClick={() => tapCard(card)} size="small" />
          ))}
        </div>
        <div className="bg-neutral-900/50 rounded-xl p-3 mb-4 text-center border border-neutral-800/60">
          <p className="text-neutral-400 text-sm mb-2">من أخذ آخر أكلة؟</p>
          <div className="flex gap-2">
            {["ours", "theirs"].map((s) => (
              <button key={s} onClick={() => setLastTrickWinner(s)} className={`flex-1 py-2 rounded-lg font-bold text-sm ${lastTrickWinner === s ? "bg-amber-400 text-neutral-950" : "bg-neutral-800 text-neutral-300"}`}>
                {s === "ours" ? teamOurs : teamTheirs}
              </button>
            ))}
          </div>
        </div>
        <button onClick={() => setScreen("projects")} disabled={!lastTrickWinner} className="w-full bg-amber-400 text-neutral-950 font-extrabold py-3.5 rounded-xl text-lg shadow-lg disabled:opacity-40">التالي — المشاريع</button>
      </div>
    );
  }

  if (screen === "projects") {
    const teamSum = (p) => p.sera * RULES.projectValues[gameType].sera + p.khamsin * RULES.projectValues[gameType].khamsin + p.meya * RULES.projectValues[gameType].meya
      + (p.arbaMeya ? RULES.projectValues.sun.arbaMeya : 0) + (p.bloat ? RULES.projectValues.hakam.bloat : 0);

    const Stepper = ({ label, value, onChange, max }) => (
      <div className="flex items-center justify-between bg-neutral-900/60 rounded-xl px-3 py-2.5 border border-neutral-800">
        <span className="text-neutral-200 font-bold text-sm sm:text-base">{label}</span>
        <div className="flex items-center gap-3">
          <button onClick={() => onChange(Math.max(0, value - 1))} disabled={value === 0}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-neutral-800 text-neutral-200 text-xl font-bold disabled:opacity-30">−</button>
          <span className="w-5 text-center font-extrabold text-amber-400 text-lg">{value}</span>
          <button onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max}
            className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-amber-400 text-neutral-950 text-xl font-bold disabled:opacity-30">+</button>
        </div>
      </div>
    );
    const Toggle = ({ label, value, onChange }) => (
      <button onClick={() => onChange(!value)} className="w-full flex items-center justify-between bg-neutral-900/60 rounded-xl px-3 py-2.5 border border-neutral-800">
        <span className="text-neutral-200 font-bold text-sm sm:text-base">{label}</span>
        <span className={`w-6 h-6 rounded-full border-2 ${value ? "bg-amber-400 border-amber-400" : "border-neutral-600"}`} />
      </button>
    );

    return (
      <div className="max-w-md sm:max-w-xl lg:max-w-4xl mx-auto p-4 sm:p-6 relative z-10">
        <BackBtn onClick={() => setScreen("cards")} />
        <h3 className={`text-lg font-extrabold ${gold} text-center my-3`}>المشاريع</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-8">
          {["ours", "theirs"].map((side) => {
            const name = side === "ours" ? teamOurs : teamTheirs;
            const p = side === "ours" ? ourProjects : theirProjects;
            const setP = side === "ours" ? setOurProjects : setTheirProjects;
            const update = (key, val) => setP({ ...p, [key]: val });
            return (
              <div key={side}>
                <div className="flex items-baseline justify-between mb-2">
                  <p className="text-neutral-300 font-bold">{name}</p>
                  <p className="text-neutral-500 text-xs">المشاريع: <span className="text-amber-400 font-bold">{teamSum(p)}</span></p>
                </div>
                <div className="space-y-2">
                  <Stepper label="سرا" value={p.sera} onChange={(v) => update("sera", v)} max={RULES.projectRepeatLimits[gameType].sera} />
                  <Stepper label="خمسين" value={p.khamsin} onChange={(v) => update("khamsin", v)} max={RULES.projectRepeatLimits[gameType].khamsin} />
                  <Stepper label="مية" value={p.meya} onChange={(v) => update("meya", v)} max={RULES.projectRepeatLimits[gameType].meya} />
                  {gameType === "sun" && <Toggle label="400" value={p.arbaMeya} onChange={(v) => update("arbaMeya", v)} />}
                  {gameType === "hakam" && <Toggle label="بلوت" value={p.bloat} onChange={(v) => update("bloat", v)} />}
                </div>
              </div>
            );
          })}
        </div>
        <button onClick={proceedFromProjects} className="w-full bg-amber-400 text-neutral-950 font-extrabold py-3.5 rounded-xl text-lg shadow-lg mt-6">تطلع الصكة</button>
      </div>
    );
  }


  if (screen === "result" && lastResult) {
    const r = lastResult;
    return (
      <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto p-4 sm:p-6 relative z-10">
        <div className="bg-neutral-900/70 rounded-2xl p-5 border border-neutral-800">
          {r.judgeFlags && r.judgeFlags.length > 0 && (
            <div className="bg-red-950/40 border border-red-900/50 rounded-xl p-3 mb-4">
              <p className="text-red-400 font-bold text-sm mb-1.5">⚠️ قافط المشاريع</p>
              {r.judgeFlags.map((f, i) => <p key={i} className="text-red-300 text-xs leading-relaxed mb-0.5">{f}</p>)}
            </div>
          )}
          <p className="text-center text-neutral-500 text-xs mb-2">
            الجولة {r.roundNumber}{r.escalationLevel !== "normal" && ` · ${{ dabl: "دبل", three: "ثري", four: "فور", gahwa: "قهوة" }[r.escalationLevel]} ×${r.multiplier}`}
          </p>
          <div className="flex items-center justify-center gap-4 mb-1">
            <div className="text-center">
              <p className="text-neutral-400 text-sm mb-1">{teamOurs}</p>
              <p className="text-5xl font-extrabold text-amber-400">{r.displayTotalOurs}</p>
            </div>
            <span className="text-neutral-700 text-2xl">—</span>
            <div className="text-center">
              <p className="text-neutral-400 text-sm mb-1">{teamTheirs}</p>
              <p className="text-5xl font-extrabold text-amber-400">{r.displayTotalTheirs}</p>
            </div>
          </div>

          {(r.isKabootOurs || r.isKabootTheirs) && <p className="text-center text-amber-300 font-bold text-sm mt-2">كبوت</p>}
          {r.outcome === "buyerFails" && <p className="text-center text-red-400 font-bold text-sm mt-2">نظارة — خسر المشتري الجولة</p>}
          {r.outcome === "tie" && <p className={`text-center ${gold} font-bold text-sm mt-2`}>تعادل</p>}

          <p className="text-center text-neutral-600 text-xs mt-3">الأبناط {r.rawOurs} — {r.rawTheirs} · المشتري: {r.buyerName}</p>

          <div className="border-t border-neutral-800 mt-4 pt-3 text-center">
            <p className="text-neutral-500 text-xs mb-1">مجموع الصكة</p>
            <p className={`text-2xl font-extrabold ${gold}`}>{totalOurs} — {totalTheirs}</p>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p className="text-center text-neutral-500 text-xs mb-1.5 font-bold">{teamOurs}</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {rounds.map((rd) => (
                  <div key={rd.roundNumber} className="flex justify-between text-sm bg-neutral-950/50 rounded-lg px-2.5 py-1.5">
                    <span className="text-neutral-600 text-xs">ج{rd.roundNumber}</span>
                    <span className="text-amber-400 font-bold">{rd.displayTotalOurs}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <p className="text-center text-neutral-500 text-xs mb-1.5 font-bold">{teamTheirs}</p>
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {rounds.map((rd) => (
                  <div key={rd.roundNumber} className="flex justify-between text-sm bg-neutral-950/50 rounded-lg px-2.5 py-1.5">
                    <span className="text-neutral-600 text-xs">ج{rd.roundNumber}</span>
                    <span className="text-neutral-200 font-bold">{rd.displayTotalTheirs}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button onClick={undoLastRound} className="w-full text-neutral-500 text-sm py-2 mt-1 underline">↩ تراجع — تعديل هذه الجولة</button>

          {isFinished ? (
            <div className="mt-2 text-center">
              <p className={`text-lg font-extrabold ${gold} mb-3`}>🏆 {matchWinnerOverride || (totalOurs > totalTheirs ? teamOurs : teamTheirs)} يفوز بالصكة{matchWinnerOverride ? " (قهوة)" : ""}</p>
              <button onClick={finishAndSave} className="w-full bg-amber-400 text-neutral-950 font-extrabold py-3 rounded-xl">حفظ والخروج</button>
            </div>
          ) : (
            <button onClick={goToRoundSetup} className="w-full bg-amber-400 text-neutral-950 font-extrabold py-3 rounded-xl mt-2">الجولة التالية</button>
          )}
        </div>
      </div>
    );
  }
  return null;
}

/* ============================================================
   صكّاتنا
   ============================================================ */
function OurSakkat({ history, onExit }) {
  const [openMatch, setOpenMatch] = useState(null);
  const winsOurs = history.filter((m) => m.winner === m.teamOurs).length;
  const lossesOurs = history.length - winsOurs;

  function timeAgo(iso) {
    const d = new Date(iso);
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days === 0) return "اليوم";
    if (days === 1) return "أمس";
    return `قبل ${days} يوم`;
  }

  if (openMatch !== null) {
    const m = history[openMatch];
    return (
      <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto p-4 sm:p-6 relative z-10">
        <BackBtn onClick={() => setOpenMatch(null)} />
        <h3 className={`text-lg font-extrabold ${gold} text-center my-3`}>{m.teamOurs} — {m.teamTheirs}</h3>
        <p className="text-center text-neutral-500 text-sm mb-4">{timeAgo(m.date)}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-center text-neutral-500 text-xs mb-1.5 font-bold">{m.teamOurs}</p>
            <div className="space-y-1.5">
              {m.rounds.map((rd) => (
                <div key={rd.roundNumber} className="flex justify-between text-sm bg-neutral-900/60 rounded-lg px-2.5 py-1.5 border border-neutral-800">
                  <span className="text-neutral-600 text-xs">ج{rd.roundNumber}</span>
                  <span className="text-amber-400 font-bold">{rd.displayTotalOurs}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-center text-neutral-500 text-xs mb-1.5 font-bold">{m.teamTheirs}</p>
            <div className="space-y-1.5">
              {m.rounds.map((rd) => (
                <div key={rd.roundNumber} className="flex justify-between text-sm bg-neutral-900/60 rounded-lg px-2.5 py-1.5 border border-neutral-800">
                  <span className="text-neutral-600 text-xs">ج{rd.roundNumber}</span>
                  <span className="text-neutral-200 font-bold">{rd.displayTotalTheirs}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 text-center border-t border-neutral-800 pt-3">
          <p className={`text-2xl font-extrabold ${gold}`}>{m.totalOurs} — {m.totalTheirs}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto p-4 sm:p-6 relative z-10">
      <BackBtn onClick={onExit} />
      <h2 className={`text-xl font-extrabold ${gold} text-center my-4`}>صكّاتنا</h2>
      <p className="text-center text-neutral-300 mb-4">{history.length} صكة</p>
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-neutral-900/60 rounded-xl p-4 text-center border border-neutral-800">
          <p className="text-neutral-500 text-sm mb-1">فوز</p>
          <p className="text-3xl font-extrabold text-amber-400">{winsOurs}</p>
        </div>
        <div className="bg-neutral-900/60 rounded-xl p-4 text-center border border-neutral-800">
          <p className="text-neutral-500 text-sm mb-1">خسارة</p>
          <p className="text-3xl font-extrabold text-neutral-400">{lossesOurs}</p>
        </div>
      </div>
      {history.length === 0 ? (
        <p className="text-center text-neutral-600 text-sm mt-10">لا توجد صكات محفوظة بعد</p>
      ) : (
        <div className="space-y-2">
          {[...history].reverse().map((m, idx) => (
            <button key={idx} onClick={() => setOpenMatch(history.length - 1 - idx)} className="w-full flex justify-between items-center bg-neutral-900/60 rounded-xl px-4 py-3 border border-neutral-800 text-right">
              <span className="text-neutral-500 text-xs">{timeAgo(m.date)}</span>
              <span className="font-bold text-neutral-100">{m.teamOurs} {m.totalOurs} — {m.totalTheirs} {m.teamTheirs}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Settings({ settings, onChange, onExit }) {
  const toggle = (key) => onChange({ ...settings, [key]: !settings[key] });
  const Row = ({ label, k }) => (
    <div className="flex items-center justify-between bg-neutral-900/60 rounded-xl px-4 py-3.5 border border-neutral-800 mb-2">
      <span className="text-neutral-200 font-bold">{label}</span>
      <button onClick={() => toggle(k)} className={`w-12 h-7 rounded-full transition-colors ${settings[k] ? "bg-amber-400" : "bg-neutral-700"}`}>
        <span className={`block w-5 h-5 bg-white rounded-full transition-transform ${settings[k] ? "translate-x-[-26px]" : "translate-x-[-2px]"}`} />
      </button>
    </div>
  );
  return (
    <div className="max-w-md sm:max-w-xl lg:max-w-3xl mx-auto p-4 sm:p-6 relative z-10">
      <BackBtn onClick={onExit} />
      <h2 className={`text-xl font-extrabold ${gold} text-center my-4`}>الإعدادات</h2>
      <div className="bg-neutral-900/60 rounded-xl px-4 py-3.5 border border-neutral-800 mb-2 flex justify-between">
        <span className="text-neutral-200 font-bold">المظهر</span>
        <span className="text-neutral-500">داكن</span>
      </div>
      <Row label="الصوت" k="sound" />
      <Row label="الاهتزاز" k="vibration" />
      <Row label="الحركة" k="motion" />
      <div className="mt-4">
        <Row label="قافط المشاريع" k="judge" />
        <p className="text-neutral-600 text-xs px-1 -mt-1">
          يتحقق من مشاريع الفريقين بمقارنتها بالأوراق التي اختارها كل فريق فعليًا، ويُلغي أي مشروع غير موجود ضمنها.
        </p>
      </div>
    </div>
  );
}

function HowItWorks({ onClose }) {
  const steps = [{ n: "01", t: "اختر أوراق فريقك" }, { n: "02", t: "اختر مشاريعك" }, { n: "03", t: "تطلع الصكة تلقائيًا" }];
  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-30 p-4" onClick={onClose}>
      <div className="bg-neutral-900 rounded-2xl p-6 max-w-sm w-full border border-neutral-800" onClick={(e) => e.stopPropagation()}>
        <p className="text-center text-neutral-400 mb-5">تحسبها عنك</p>
        <div className="space-y-4 mb-5">
          {steps.map((s) => (
            <div key={s.n} className="flex items-center gap-3">
              <span className="text-2xl font-extrabold text-amber-400 w-9">{s.n}</span>
              <span className="text-neutral-200 font-bold">{s.t}</span>
            </div>
          ))}
        </div>
        <button onClick={onClose} className="w-full bg-amber-400 text-neutral-950 font-extrabold py-3 rounded-xl">تمام</button>
      </div>
    </div>
  );
}

export default function SakkatBaloot() {
  const [mode, setMode] = useState(null);
  const [history, setHistory] = useState([]);
  const [settings, setSettings] = useState({ sound: false, vibration: false, motion: true, judge: false });
  const [howItWorks, setHowItWorks] = useState(false);

  useEffect(() => {
    (async () => {
      const [h, s] = await Promise.all([loadHistory(), loadSettings()]);
      setHistory(h); setSettings(s);
    })();
  }, []);

  function handleSettingsChange(s) { setSettings(s); saveSettings(s); }
  function handleFinishMatch(match) {
    const next = [...history, match];
    setHistory(next);
    saveHistory(next);
  }

  return (
    <div dir="rtl" className="min-h-screen bg-neutral-950 relative overflow-hidden"
      style={{
        fontFamily: "'IBM Plex Sans Arabic', sans-serif",
        paddingTop: "env(safe-area-inset-top)",
        paddingBottom: "env(safe-area-inset-bottom)",
        paddingLeft: "env(safe-area-inset-left)",
        paddingRight: "env(safe-area-inset-right)",
      }}>
      <style>{FONT_IMPORT}</style>
      <style>{`html, body { overflow-x: hidden; }`}</style>
      <FloatingSuits enabled={settings.motion} />

      {mode === "pro" && <ProCalculator onExit={() => setMode(null)} onFinishMatch={handleFinishMatch} judgeEnabled={settings.judge} />}
      {mode === "manual" && <ManualCalculator onExit={() => setMode(null)} />}
      {mode === "history" && <OurSakkat history={history} onExit={() => setMode(null)} />}
      {mode === "settings" && <Settings settings={settings} onChange={handleSettingsChange} onExit={() => setMode(null)} />}
      {howItWorks && <HowItWorks onClose={() => setHowItWorks(false)} />}

      {!mode && (
        <div className="max-w-md mx-auto p-6 pt-14 relative z-10">
          <Logo />
          <h1 className="text-3xl font-extrabold text-neutral-50 text-center mb-8">صكّة بلوت</h1>
          <div className="space-y-3">
            <button onClick={() => setMode("pro")} className="w-full bg-neutral-900 border-2 border-amber-400/40 rounded-3xl py-6 px-5 text-right">
              <span className="text-xl font-extrabold text-neutral-50 block">حاسبة الصكة الاحترافية</span>
              <span className="text-neutral-500 text-sm">احسب الصكة من الأوراق</span>
            </button>
            <button onClick={() => setMode("manual")} className="w-full bg-neutral-900/70 border border-neutral-800 rounded-2xl py-5 px-5 text-right">
              <span className="text-lg font-bold text-neutral-200 block">حاسبة البلوت</span>
              <span className="text-neutral-600 text-xs">سجّل النقاط يدويًا</span>
            </button>
            <button onClick={() => setMode("history")} className="w-full bg-neutral-900/70 border border-neutral-800 rounded-2xl py-5 px-5 text-right">
              <span className="text-lg font-bold text-neutral-200 block">صكّاتنا</span>
              <span className="text-neutral-600 text-xs">إحصائيات مبارياتك السابقة</span>
            </button>
          </div>
          <div className="flex justify-center gap-4 mt-8">
            <button onClick={() => setHowItWorks(true)} className="text-neutral-500 text-sm underline">كيف تعمل؟</button>
            <button onClick={() => setMode("settings")} className="text-neutral-500 text-sm underline">الإعدادات</button>
          </div>
        </div>
      )}
    </div>
  );
}
