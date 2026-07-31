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

// Einheiten-Upgrades: jetzt 10 Stufen (war 3), damit Einheiten mit den (jetzt gedeckelten,
// siehe balance-shared.js) Türmen mithalten und sie am Ende übertreffen können — sonst
// stagniert das Spiel, weil die Verteidigung strukturell immer gewinnt.
// HP wächst weiter exponentiell (x1.35/Tier statt vorher x2/Tier — x2 über 10 Stufen wäre
// x1024 gewesen, klar unsinnig). Bei Tier 10: x20.1 HP. Türme sind bei vollem Tier-10-Ausbau
// auf maximal ~x9.9 Schadens-Durchsatz gedeckelt (Schaden x4.5 * Feuerrate x2.2) — eine voll
// ausgebaute Einheit hat also strukturell mehr HP-Wachstum als der Turm Schaden aufbauen kann,
// damit ein Durchbruch bei genug Investition möglich bleibt.
// Kosten wachsen ebenfalls exponentiell, aber deutlich sanfter (x1.6 statt x5/Tier), sonst
// wäre Tier 10 utopisch teuer (bei x5 kostet allein Tier 10 eines Sprinters ~59.000 Gold).
const UNIT_MAX_TIER = 10;
const UNIT_UPGRADE_COST_BASE = { sprinter: 30, guard: 75, brecher: 180, icecube: 135, titan: 300 };
const UNIT_HP_GROWTH_PER_TIER = 1.35;
const UNIT_COST_GROWTH_PER_TIER = 1.6;

// Sende-Limit: max. 20 Einheiten pro rollierendem 10-Sekunden-Fenster (25 mit Angriffs-Tech T3)
const SEND_LIMIT_COUNT = 20;
const SEND_LIMIT_COUNT_UPGRADED = 25;
const SEND_LIMIT_WINDOW_MS = 10000;

// ── Bosse: bedrohen in festen Abständen BEIDE Seiten gleichzeitig ───────
const BOSS_INTERVAL_MS = 90000; // alle 90s
// BASE_HP von 300 auf 900 angehoben (Begründung + Rechenweg in docs/balancing.md,
// Abschnitt "Boss-HP herleiten"): 300 war zu niedrig gegen die in 90s aufbaubare
// Feuerkraft, Bosse starben zu schnell ("viel zu einfach"). GROWTH unverändert bei 1.3 —
// passt schon recht gut zur geschätzten Feuerkraft-Kurve über mehrere Boss-Runden.
const BOSS_BASE_HP = 900;
const BOSS_HP_GROWTH = 1.3; // pro Boss-Runde
const BOSS_SPEED = 40;
const BOSS_RADIUS = 20;
const BOSS_LEAK_LIVES = 3; // Lebenskosten, falls der Boss durchkommt

// ── Tech-Tree: 3 Zweige, je 4 Stufen, linear (Tier N braucht Tier N-1) ──
const TECH_MAX_TIER = 4;
const TECH_BRANCHES = ['defense', 'economy', 'attack'];
const TECH_LABELS = {
  defense: { name: '🛡️ Verteidigung', tiers: ['Einheiten-Regeneration (+5% Max-HP alle 2s für gesendete Einheiten)', 'Schild (3 Treffer abfangen, lädt alle 90s)', 'Turm-Reichweite +10%', 'Bollwerk (+5 Max-Leben)'] },
  economy: { name: '💰 Wirtschaft', tiers: ['Minen-Ertrag +20%', 'Sende-Einkommensschub +5%', 'Grundeinkommen +1 Gold/s', 'Grundeinkommen nochmal +2 Gold/s'] },
  attack:  { name: '⚔️ Angriff', tiers: ['Lebensklau (+1 eigenes Leben je durchgekommener Einheit)', 'Einheiten-Tempo +10%', 'Sende-Limit 20→25 pro 10s', 'Titan freigeschaltet (Elite-Einheit)'] },
};
function techPointCost(tier) { return 1; } // Jede Stufe kostet pauschal 1 Punkt (vorher: Tier 1 = 1P, Tier 2 = 2P, ... — zu langsam, da Punkte selten sind)

// Defense-Tier-1: die vom Spieler gesendeten Einheiten regenerieren HP, während sie über
// die gegnerische Lane laufen. 5% alle 2s, damit heilt eine Einheit ca. 20% ihrer Max-HP
// in der Zeit, die eine mittelschnelle Einheit (~90px/s) für die 680px-Lane braucht (~8s → 4 Ticks).
const UNIT_REGEN_PCT = 0.05;
const UNIT_REGEN_INTERVAL_MS = 2000;

// Tech-Punkte lassen sich zusätzlich zum Boss-Kill-Einkommen mit Gold kaufen.
// Kosten steigen als Fibonacci-Folge: 1000, 2000, 3000, 5000, 8000, 13000, 21000, ...
// n = wievielter Punktkauf in diesem Match (1-basiert, pro Spieler eigener Zähler).
function techPointBuyCost(n) {
  let a = 1, b = 2;
  if (n <= 1) return 1000 * a;
  for (let i = 2; i < n; i++) { const c = a + b; a = b; b = c; }
  return 1000 * b;
}

function mineIncome(t) { return 6 * Math.pow(1.5, t.tier); } // Basis zahlt sich in ~10s aus (60 Gold Kosten), je Tier x1.5
function mineIncomeTotal(structs) { return structs.filter(s => s.type === 'mine').reduce((s, m) => s + mineIncome(m), 0); }

function unitEffectiveHp(key, tier) { return UNIT_TYPES[key].hp * Math.pow(UNIT_HP_GROWTH_PER_TIER, tier); }
function unitSendCost(key, tier) { return Math.round(UNIT_TYPES[key].cost * Math.pow(UNIT_HP_GROWTH_PER_TIER, tier)); }
function unitUpgradeCost(key, nextTier) { return Math.round(UNIT_UPGRADE_COST_BASE[key] * Math.pow(UNIT_COST_GROWTH_PER_TIER, nextTier - 1)); }
