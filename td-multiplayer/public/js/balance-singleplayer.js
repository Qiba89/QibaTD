// ── Balancing-Werte: Singleplayer / Endlos-Modus ───────────────────────────
// Ausgelagert aus index.html (war vorher inline im zweiten <script>-Block,
// innerhalb der IIFE). Geteilte Tier-Skalierung (Türme) steht in
// balance-shared.js. Siehe docs/balancing.md für Tabellen & Design-Begründung.
//
// Hinweis: SP_TOWER_TYPES ist ABSICHTLICH ein eigenes Objekt, nicht identisch
// mit TOWER_TYPES aus balance-multiplayer.js:
//  - kein groundOnly bei der Kanone (im Endlos-Modus gibt es keine fliegenden
//    Gegner, der Flag wäre wirkungslos)
//  - projSpeed steht in anderen Einheiten als im Multiplayer-Objekt (dort
//    px/s bei kontinuierlicher Simulation, hier px/Frame) — siehe
//    docs/balancing.md, Abschnitt "Bekannte Unterschiede MP/SP".
const SP_TOWER_TYPES = {
  arrow:  { name: 'Pfeilturm', cost: 50,  range: 110, damage: 8,  fireRate: 500,  color: '#4fd1c5', projSpeed: 6 },
  cannon: { name: 'Kanone',    cost: 100, range: 90,  damage: 25, fireRate: 1100, color: '#ff9f43', projSpeed: 4, splash: 45 },
  frost:  { name: 'Frostturm', cost: 80,  range: 100, damage: 4,  fireRate: 700,  color: '#63b3ed', projSpeed: 7, slow: 0.5, slowDuration: 1500 },
  // Mine: seit dem Endlos-Modus-Feature-Port auch hier verfügbar, aber (anders als im Multiplayer,
  // wo sie von Anfang an baubar ist) hinter Wirtschaft-Tech-Tier-1 verriegelt (`requiresTech`) -
  // siehe SP_TECH_LABELS unten und docs/balancing.md für die Begründung. Kosten/Ertrag/Tier-
  // Skalierung/Deckel/Anzahl-Limit identisch zum Multiplayer (mineIncome()/MINE_MAX_COUNT in
  // balance-shared.js, gilt jetzt für beide Modi) - eine Mine im Endlos-Modus ist also exakt so
  // stark wie im Multiplayer, keine separate Balance-Kurve nötig.
  mine:   { name: 'Mine', cost: 100, color: '#ffd166', requiresTech: { branch: 'economy', tier: 1 } },
  // Titan-Turm: Endlos-Modus-Entsprechung des Multiplayer-Titans (Elite-Einheit, dort erst mit
  // Angriffs-Tech Tier 4 freigeschaltet). Da der Endlos-Modus keine sendbaren Einheiten kennt, wird
  // aus "Elite-Einheit freigeschaltet" hier "Elite-TURM freigeschaltet" - bleibt hinter derselben
  // Tech-Stufe (`requiresTech: {branch:'attack', tier:4}`) verriegelt. Bewusst reiner Einzelziel-
  // Hochschaden-Turm statt Fläche (Kanone deckt Fläche schon ab): Kosten 250 (5× Pfeilturm),
  // Grund-DPS 60/0.9s ≈ 66.7 vs. Pfeilturm 8/0.5s = 16 (≈×4.2) - ein spürbarer Endgame-Powerspike,
  // der die volle Investition in den Angriffs-Zweig belohnt.
  titan:  { name: 'Titan-Turm', cost: 250, range: 130, damage: 60, fireRate: 900, color: '#f43f5e', projSpeed: 6, requiresTech: { branch: 'attack', tier: 4 } },
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

// ── Tech-Tree (Endlos-Modus-Port des Multiplayer-Tech-Trees) ───────────────
// Gleiche Struktur wie im Multiplayer (3 Zweige, je 4 Stufen, linear, 1 Punkt/Stufe), aber jede
// PvP-spezifische Stufe wurde für den Endlos-Modus sinnvoll neu interpretiert, da es hier keinen
// Gegner-Spieler und kein Einheiten-Senden gibt. Minen gibt es inzwischen auch im Endlos-Modus
// (siehe SP_TOWER_TYPES.mine oben) - Wirtschaft Tier 1 schaltet sie frei, statt (wie ursprünglich
// vor dem Minen-Nachtrag) nur einen pauschalen Welleneinkommens-Bonus zu geben - spiegelt damit den
// Multiplayer strukturell näher (dort ist Tier 1 ja auch "der Minen-Punkt", nur als Ertrags-Boost
// statt Freischaltung, weil Minen dort von Anfang an baubar sind). Details + Begründung pro Stufe
// in docs/balancing.md, Abschnitt "Tech-Tree (Endlos-Modus)".
const SP_TECH_MAX_TIER = 4;
const SP_TECH_BRANCHES = ['defense', 'economy', 'attack'];
const SP_TECH_LABELS = {
  defense: { name: '🛡️ Verteidigung', tiers: ['Basis-Regeneration (+1 Leben alle 60s)', 'Schild (3 Treffer abfangen, lädt alle 90s)', 'Turm-Reichweite +10%', 'Bollwerk (+5 Max-Leben)'] },
  economy: { name: '💰 Wirtschaft', tiers: ['Minen freigeschaltet (+20% Minen-Ertrag)', 'Kill-Gold +10%', 'Zinsen (zusätzlich +1%/s vom aktuellen Gold, laufend)', 'Perfekte Welle (+50% Welleneinkommen, falls kein Leben verloren)'] },
  attack:  { name: '⚔️ Angriff', tiers: ['Wachtrupp (+1 Leben alle 90s, automatisch)', 'Turm-Feuerrate +10%', 'Turm-Schaden +15%', 'Titan-Turm freigeschaltet (Elite-Turm)'] },
};
function spTechPointCost(tier) { return 1; } // wie im Multiplayer: jede Stufe pauschal 1 Punkt

// Tech-Punkte-Kauf mit Gold: gleiche Fibonacci-Formel wie im Multiplayer, aber Basis ×100 statt
// ×1000 - die Endlos-Wirtschaft bewegt sich in einer deutlich kleineren Größenordnung (Startgold
// 220, Welleneinkommen 20+4×Welle) als die Multiplayer-Wirtschaft (Minen/Zinsen/Steuern erreichen
// dort schnell vier-/fünfstellige Goldbestände) - beim gleichen ×1000-Maßstab wären Tech-Punkte im
// Endlos-Modus praktisch unbezahlbar.
function spTechPointBuyCost(n) {
  let a = 1, b = 2;
  if (n <= 1) return 100 * a;
  for (let i = 2; i < n; i++) { const c = a + b; a = b; b = c; }
  return 100 * b;
}

// Effekt-Konstanten pro Stufe (siehe SP_TECH_LABELS oben für die Beschreibungen):
const SP_LIFE_REGEN_INTERVAL_MS = 60000;      // Verteidigung T1
const SP_SHIELD_CHARGES = 3;                  // Verteidigung T2
const SP_SHIELD_COOLDOWN_MS = 90000;          // Verteidigung T2
const SP_RANGE_BOOST_TIER3 = 0.10;            // Verteidigung T3
const SP_BOLLWERK_BONUS_LIVES = 5;            // Verteidigung T4
const SP_MINE_INCOME_BOOST_TIER1 = 0.20;      // Wirtschaft T1 (identisch zur Multiplayer-Formel, mineIncomeMultFor())
const SP_KILL_GOLD_BOOST_TIER2 = 0.10;        // Wirtschaft T2
const SP_INTEREST_RATE_PER_SEC_TIER3 = 0.01;  // Wirtschaft T3 (zusätzlich zur normalen Wellenend-Verzinsung)
const SP_PERFECT_WAVE_BONUS_TIER4 = 0.50;     // Wirtschaft T4
const SP_LIFE_GEN_INTERVAL_MS = 90000;        // Angriff T1
const SP_FIRERATE_BOOST_TIER2 = 0.10;         // Angriff T2
const SP_DAMAGE_BOOST_TIER3 = 0.15;           // Angriff T3

// ── Automatischer Wellenstart (Nachtrag) ────────────────────────────────────
// Nach der Wellenzusammenfassung startet die nächste Welle jetzt von selbst statt auf einen
// Button-Klick zu warten (Pause-Button in index.html als Gegenstück, um sich trotzdem Zeit zu
// nehmen). 6s statt der ursprünglich vorgeschlagenen 5s: reicht, um die Gold-Abrechnung zu lesen
// und noch 1-2 Klicks zu setzen (z.B. "Alle upgraden" oder eine Mine bauen), ohne die Partie ins
// Stocken zu bringen. Vor Boss-Wellen bewusst länger (9s) - die Vorwarnung ("Nächste Welle ist eine
// BOSS-Welle!") soll auch tatsächlich nutzbar sein, um gezielt nachzurüsten, nicht nur gelesen werden.
const SP_AUTO_NEXT_WAVE_DELAY_MS = 6000;
const SP_AUTO_NEXT_WAVE_DELAY_BOSS_MS = 9000;
