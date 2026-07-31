// ── Balancing-Werte: Singleplayer / Endlos-Modus ───────────────────────────
// Ausgelagert aus index.html (war vorher inline im zweiten <script>-Block,
// innerhalb der IIFE). Geteilte Tier-Skalierung (Türme) steht in
// balance-shared.js. Siehe docs/balancing.md für Tabellen & Design-Begründung.
//
// Hinweis: SP_TOWER_TYPES ist ABSICHTLICH ein eigenes Objekt, nicht identisch
// mit TOWER_TYPES aus balance-multiplayer.js:
//  - keine "Mine" (keine Wirtschafts-Struktur im Endlos-Modus)
//  - kein groundOnly bei der Kanone (im Endlos-Modus gibt es keine fliegenden
//    Gegner, der Flag wäre wirkungslos)
//  - projSpeed steht in anderen Einheiten als im Multiplayer-Objekt (dort
//    px/s bei kontinuierlicher Simulation, hier px/Frame) — siehe
//    docs/balancing.md, Abschnitt "Bekannte Unterschiede MP/SP".
const SP_TOWER_TYPES = {
  arrow:  { name: 'Pfeilturm', cost: 50,  range: 110, damage: 8,  fireRate: 500,  color: '#4fd1c5', projSpeed: 6 },
  cannon: { name: 'Kanone',    cost: 100, range: 90,  damage: 25, fireRate: 1100, color: '#ff9f43', projSpeed: 4, splash: 45 },
  frost:  { name: 'Frostturm', cost: 80,  range: 100, damage: 4,  fireRate: 700,  color: '#63b3ed', projSpeed: 7, slow: 0.5, slowDuration: 1500 },
};

// ── Skalierungs-Spezifikation (tower_defense_skalierung.md) — Endlos-Modus:
// kein Wellen-Limit, das Boss/Schwarm/Verschnaufpause-Muster wiederholt sich für immer.
const SWARM_HP_MULT = 0.6;
const SWARM_COUNT_MULT = 1.8;
const BOSS_ESCORT_HP_MULT = 0.7;
const POST_BOSS_RELIEF_MULT = 0.75;

// Gegner-HP
const HP_BASE = 50;
const HP_GROWTH_PER_WAVE = 0.09;         // g

// Gold-Ökonomie
const INTEREST_RATE = 0.06;
const INTEREST_CAP = 30;

function waveType(w) {
  if (w % 5 === 0) return 'boss';
  if (w % 5 === 3) return 'swarm';
  if (w % 5 === 1 && w > 1) return 'relief';
  return 'normal';
}
function baseHp(w) { return HP_BASE * Math.pow(1 + HP_GROWTH_PER_WAVE, w - 1); }
function bossMult(w) { return 3.0 + 0.3 * ((w / 5) - 1); }
function baseCount(w) { return 6 + w * 2; }
function killGoldBase(w) { return 2 * Math.pow(1.045, w - 1); }
function waveIncome(w) { return 20 + 4 * w; }

// Spawn-Takt: startet entspannter (900ms) und wird bis Welle 12 auf 500ms schneller.
// Grund: bei festem 500ms-Takt ist der Schaden-Durchsatz früher Türme rechnerisch
// nicht ausreichend, um mit dem Nachschub an Gegnern Schritt zu halten (Wellen 1–7
// waren unschaffbar, siehe Kalkulation). Diese Rampe macht den Start spielbar,
// ohne die Ziel-HP-Kurve selbst zu verändern.
function spawnIntervalMs(w) {
  return Math.max(500, 900 - (w - 1) * (400 / 11));
}
