// ── Balancing-Werte: Multiplayer (PvP über Raum-Code) ──────────────────────
// Ausgelagert aus index.html (war vorher inline im ersten <script>-Block).
// Geteilte Tier-Skalierung (Türme) steht in balance-shared.js.
// Siehe docs/balancing.md für Tabellen & Design-Begründung.

// Türme
const TOWER_TYPES = {
  arrow:  { name: 'Pfeilturm', cost: 50,  range: 110, damage: 9,  fireRate: 500,  color: '#4fd1c5', projSpeed: 500 },
  cannon: { name: 'Kanone',    cost: 100, range: 90,  damage: 25, fireRate: 1100, color: '#ff9f43', projSpeed: 320, splash: 45, groundOnly: true },
  frost:  { name: 'Frostturm', cost: 80,  range: 100, damage: 4,  fireRate: 700,  color: '#63b3ed', projSpeed: 550, slow: 0.5, slowDuration: 1500 },
  mine:   { name: 'Mine',      cost: 60,  color: '#ffd166' },
};
const BUILD_ORDER = ['arrow', 'cannon', 'frost', 'mine'];
const DEFAULT_INCOME_BOOST_RATE = 0.10;

// Einheiten (werden zum Gegner geschickt)
const UNIT_TYPES = {
  sprinter: { name: 'Sprinter', cost: 10, hp: 25,  speed: 140, color: '#4fd1c5', radius: 8 },
  guard:    { name: 'Guard',    cost: 25, hp: 70,  speed: 90,  color: '#ff9f43', radius: 10 },
  brecher:  { name: 'Brecher',  cost: 60, hp: 220, speed: 55,  color: '#c084fc', radius: 14 },
  icecube:  { name: 'Ice Cube', cost: 45, hp: 100, speed: 90,  color: '#a5f3fc', radius: 11, flying: true, incomeBoostRate: 0.05 },
  titan:    { name: 'Titan',    cost: 100, hp: 350, speed: 45, color: '#f43f5e', radius: 16, requiresTech: { branch: 'attack', tier: 4 } },
};

// Einheiten-Upgrades: pro Stufe doppelt so stark (HP), aber 5x so teuer wie die vorige Stufe.
// Gedeckelt bei Tier 3 (macht x8 HP für x125 der Basis-Kosten - alles darüber wird absurd teuer).
const UNIT_MAX_TIER = 3;
const UNIT_UPGRADE_COST_BASE = { sprinter: 30, guard: 75, brecher: 180, icecube: 135, titan: 300 };
const UNIT_HP_GROWTH_PER_TIER = 2;
const UNIT_COST_GROWTH_PER_TIER = 5;

// Sende-Limit: max. 20 Einheiten pro rollierendem 10-Sekunden-Fenster (25 mit Angriffs-Tech T3)
const SEND_LIMIT_COUNT = 20;
const SEND_LIMIT_COUNT_UPGRADED = 25;
const SEND_LIMIT_WINDOW_MS = 10000;

// ── Bosse: bedrohen in festen Abständen BEIDE Seiten gleichzeitig ───────
const BOSS_INTERVAL_MS = 90000; // alle 90s
const BOSS_BASE_HP = 300;
const BOSS_HP_GROWTH = 1.3; // pro Boss-Runde
const BOSS_SPEED = 40;
const BOSS_RADIUS = 20;
const BOSS_LEAK_LIVES = 3; // Lebenskosten, falls der Boss durchkommt

// ── Tech-Tree: 3 Zweige, je 4 Stufen, linear (Tier N braucht Tier N-1) ──
const TECH_MAX_TIER = 4;
const TECH_BRANCHES = ['defense', 'economy', 'attack'];
const TECH_LABELS = {
  defense: { name: '🛡️ Verteidigung', tiers: ['Leben-Regeneration (+1 alle 60s)', 'Schild (3 Treffer abfangen, lädt alle 90s)', 'Turm-Reichweite +10%', 'Bollwerk (+5 Max-Leben)'] },
  economy: { name: '💰 Wirtschaft', tiers: ['Minen-Ertrag +20%', 'Sende-Einkommensschub +5%', 'Grundeinkommen +1 Gold/s', 'Grundeinkommen nochmal +2 Gold/s'] },
  attack:  { name: '⚔️ Angriff', tiers: ['Lebensklau (+1 eigenes Leben je durchgekommener Einheit)', 'Einheiten-Tempo +10%', 'Sende-Limit 20→25 pro 10s', 'Titan freigeschaltet (Elite-Einheit)'] },
};
function techPointCost(tier) { return tier; } // Tier 1 kostet 1 Punkt, Tier 2 kostet 2, usw.

function mineIncome(t) { return 6 * Math.pow(1.5, t.tier); } // Basis zahlt sich in ~10s aus (60 Gold Kosten), je Tier x1.5
function mineIncomeTotal(structs) { return structs.filter(s => s.type === 'mine').reduce((s, m) => s + mineIncome(m), 0); }

function unitEffectiveHp(key, tier) { return UNIT_TYPES[key].hp * Math.pow(UNIT_HP_GROWTH_PER_TIER, tier); }
function unitSendCost(key, tier) { return Math.round(UNIT_TYPES[key].cost * Math.pow(UNIT_HP_GROWTH_PER_TIER, tier)); }
function unitUpgradeCost(key, nextTier) { return Math.round(UNIT_UPGRADE_COST_BASE[key] * Math.pow(UNIT_COST_GROWTH_PER_TIER, nextTier - 1)); }
