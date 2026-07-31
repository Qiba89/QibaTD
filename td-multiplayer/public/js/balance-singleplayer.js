// ── Balancing-Werte: Singleplayer / Endlos-Modus ───────────────────────────
// Ausgelagert aus index.html (war vorher inline im zweiten <script>-Block,
// innerhalb der IIFE). Geteilte Tier-Skalierung (Türme) steht in
// balance-shared.js. Siehe docs/balancing.md für Tabellen & Design-Begründung.
//
// Hinweis: SP_TOWER_TYPES ist ABSICHTLICH ein eigenes Objekt, nicht identisch
// mit TOWER_TYPES aus balance-multiplayer.js:
//  - projSpeed steht in anderen Einheiten als im Multiplayer-Objekt (dort
//    px/s bei kontinuierlicher Simulation, hier px/Frame) — siehe
//    docs/balancing.md, Abschnitt "Bekannte Unterschiede MP/SP".
//  - `groundOnly`/`airOnly` gab es hier lange nicht (keine fliegenden Gegner im Endlos-Modus) -
//    seit dem Flieger-Wellen-Nachtrag (ab Welle 12, siehe waveType()) jetzt doch, exakt nach dem
//    Multiplayer-Vorbild: nur die Kanone kann Flieger NICHT treffen, nur der Tesla-Turm kann NUR
//    Flieger treffen, alle anderen Türme treffen beides.
const SP_TOWER_TYPES = {
  arrow:  { name: 'Pfeilturm', cost: 50,  range: 110, damage: 8,  fireRate: 500,  color: '#4fd1c5', projSpeed: 6 },
  cannon: { name: 'Kanone',    cost: 100, range: 90,  damage: 25, fireRate: 1100, color: '#ff9f43', projSpeed: 4, splash: 45, groundOnly: true },
  frost:  { name: 'Frostturm', cost: 80,  range: 100, damage: 4,  fireRate: 700,  color: '#63b3ed', projSpeed: 7, slow: 0.5, slowDuration: 1500 },
  // Tesla-Turm (Nachtrag): 1:1 aus dem Multiplayer übernommen (siehe TOWER_TYPES.tesla in
  // balance-multiplayer.js für die volle Herleitung von Kosten/Schaden/Kettensprüngen) - reiner
  // Anti-Air-Spezialist (`airOnly`), notwendig geworden seit den Flieger-Wellen ab Welle 12
  // (`waveType()` unten): Boden-Türme können diese Gegner nicht treffen (außer der ohnehin schon
  // `groundOnly`-Kanone, die sie nie treffen konnte). Kettenblitz-Sprünge über `teslaChainJumps()`
  // (aus balance-multiplayer.js, global verfügbar, keine Duplizierung nötig).
  tesla:  { name: 'Tesla-Turm', cost: 100, range: 90, damage: 8, fireRate: 1100, color: '#22d3ee', projSpeed: 8, airOnly: true },
  // Mine: seit dem Endlos-Modus-Feature-Port auch hier verfügbar, aber (anders als im Multiplayer,
  // wo sie von Anfang an baubar ist) hinter Wirtschaft-Tech-Tier-1 verriegelt (`requiresTech`) -
  // siehe SP_TECH_LABELS unten und docs/balancing.md für die Begründung. Kosten/Ertrag/Tier-
  // Skalierung/Deckel/Anzahl-Limit identisch zum Multiplayer (mineIncome()/MINE_MAX_COUNT in
  // balance-shared.js, gilt jetzt für beide Modi) - eine Mine im Endlos-Modus ist also exakt so
  // stark wie im Multiplayer, keine separate Balance-Kurve nötig. Seit dem Wirtschafts-Nachtrag
  // zahlt sie nicht mehr kontinuierlich, sondern alle SP_MINE_PAYOUT_INTERVAL_MS aus (siehe unten).
  mine:   { name: 'Mine', cost: 100, color: '#ffd166', requiresTech: { branch: 'economy', tier: 1 } },
  // Titan-Turm: Endlos-Modus-Entsprechung des Multiplayer-Titans (Elite-Einheit, dort erst mit
  // Angriffs-Tech Tier 4 freigeschaltet). Da der Endlos-Modus keine sendbaren Einheiten kennt, wird
  // aus "Elite-Einheit freigeschaltet" hier "Elite-TURM freigeschaltet" - bleibt hinter derselben
  // Tech-Stufe (`requiresTech: {branch:'attack', tier:4}`) verriegelt, die jetzt 2 statt 1 Tech-Punkt
  // kostet (siehe spTechPointCost() unten) - explizit auf Nutzeranfrage, da der Turm als zu stark
  // eingeschätzt wurde. Bewusst reiner Einzelziel-Hochschaden-Turm statt Fläche (Kanone deckt Fläche
  // schon ab): Kosten 250 (5× Pfeilturm), Grund-DPS 60/0.9s ≈ 66.7 vs. Pfeilturm 8/0.5s = 16 (≈×4.2)
  // - ein spürbarer Endgame-Powerspike, der die volle Investition in den Angriffs-Zweig belohnt.
  // Nachtrag: belegt jetzt ein 2×2-Baufeld (`footprint: 2`, 4 Zellen) statt nur einer Zelle -
  // zusätzlich zum Tech-Punkte-Preis ein zweiter Hebel gegen "zu stark", der den Turm auch räumlich
  // teurer macht (verdrängt effektiv 4 mögliche Pfeilturm-Plätze) und ihn dadurch auf offene, große
  // Baufelder beschränkt statt überall reinzupassen wie die anderen Türme.
  titan:  { name: 'Titan-Turm', cost: 250, range: 130, damage: 60, fireRate: 900, color: '#f43f5e', projSpeed: 6, requiresTech: { branch: 'attack', tier: 4 }, footprint: 2 },
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

// Flieger-Wellen (Nachtrag): ab Welle 12, danach alle 10 Wellen (12, 22, 32, ...) - auf
// Nutzeranfrage ("wir benötigen ab runde 12 alle 10 runden flug einheiten runden"). Praktischer
// Glücksfall: 12, 22, 32, ... liegen alle bei w%5===2, was im bestehenden Schema ohnehin immer
// "normal" ergibt - die Flieger-Welle verdrängt also nie eine Boss-/Schwarm-/Verschnaufpause-Welle,
// deshalb steht die Prüfung hier bewusst VOR den anderen Fällen (auch wenn sie durch den Glücksfall
// nie mit ihnen kollidiert, ist die Prioritätsreihenfolge so unmissverständlich).
function waveType(w) {
  if (w >= 12 && (w - 12) % 10 === 0) return 'flying';
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
  economy: { name: '💰 Wirtschaft', tiers: ['Minen freigeschaltet (+20% Minen-Ertrag)', 'Kill-Gold +10%', 'Zinsen (zusätzlich +4% Wellenend-Verzinsung, einmalig pro Welle)', 'Perfekte Welle (+50% Welleneinkommen, falls kein Leben verloren)'] },
  attack:  { name: '⚔️ Angriff', tiers: ['Wachtrupp (+1 Leben alle 90s, automatisch)', 'Turm-Feuerrate +10%', 'Turm-Schaden +15%', 'Titan-Turm freigeschaltet (Elite-Turm, 2 Punkte)'] },
};
// Nachtrag (Balance): Angriff-Tier-4 (schaltet den als zu stark eingeschätzten Titan-Turm frei)
// kostet jetzt 2 Tech-Punkte statt 1 - explizit auf Nutzeranfrage ("Titanen turm ... sollte 2 Punkte
// kosten"), alle anderen Stufen bleiben bei pauschal 1 Punkt.
function spTechPointCost(tier, branch) { return (branch === 'attack' && tier === 4) ? 2 : 1; }

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
// Wirtschaft T3 "Zinsen" (Nachtrag/Balance-Fix): war ursprünglich +1%/s kontinuierlich, auf
// Nutzeranfrage ("die 1% zinsen sind zu krass") umgebaut zu einer einmaligen Zusatzverzinsung bei
// Wellenabschluss, addiert auf den normalen Wellenend-Zinssatz INTEREST_RATE (siehe oben) und mit
// demselben INTEREST_CAP gedeckelt (siehe showWaveSummary() in index.html) - genau dieser gemeinsame
// Deckel ist der eigentliche Balance-Fix: eine kontinuierliche Verzinsung pro Frame kannte praktisch
// keine Obergrenze (kompoundierte 60×/Sekunde auf den fortlaufend wachsenden Goldbestand), eine
// einmalige Zusatzrate pro Wellenabschluss mit gemeinsamem Deckel dagegen schon.
const SP_INTEREST_RATE_BONUS_TIER3_PER_WAVE = 0.04;
const SP_PERFECT_WAVE_BONUS_TIER4 = 0.50;     // Wirtschaft T4
// Minen-Auszahlungs-Intervall (Nachtrag/Balance-Fix): Minen zahlten bisher kontinuierlich pro Frame
// aus (Bruchteile eines Golds, 60×/Sekunde) - das ließ sie zusammen mit der (jetzt ebenfalls
// gefixten) Zinsen-Tech einen sich selbst verstärkenden Wirtschafts-Schneeball erzeugen, da der
// laufend wachsende Goldbestand die nächste Zinsberechnung sofort mit erhöhte. Jetzt zahlen Minen
// stattdessen alle 5 Sekunden den vollen 5-Sekunden-Ertrag auf einmal aus - gleicher Gesamt-Ertrag
// pro Zeiteinheit (mineIncome() bleibt eine Gold/s-Rate, nur die Auszahlungs-Taktung ändert sich),
// aber spürbar weniger "Treibstoff" für kontinuierliche Zinseszins-Effekte. Auf Nutzeranfrage
// ("die minen sollten nur noch alle 5 sekunden gold produzieren").
const SP_MINE_PAYOUT_INTERVAL_MS = 5000;
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
