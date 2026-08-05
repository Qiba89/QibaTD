// Kern des Singleplayer/Endlos-Modus: State, Türme/Wellen/Kampf-Logik, Effekte,
// Tech-Tree, Update-Loop und Rendering. Diese Teile teilen sich intensiv
// veränderlichen Modul-State (gold, towers, enemies, tech, ...) und wurden
// deshalb bewusst NICHT weiter in einzelne Dateien aufgesplittet (siehe
// [[qibatd-refactoring.md]] im Projektgedächtnis für die Begründung, analog
// zur mpCore.js-Entscheidung) - reine Verschiebung aus dem SP-Inline-<script>-
// Block (der ursprünglichen IIFE), keine Verhaltensänderung. Die IIFE-Hülle
// bleibt unverändert erhalten (harmlos redundant, da das Modul selbst schon
// einen eigenen Scope hat) - reine Vorsichtsmaßnahme, um an dieser Stelle
// nichts umzustrukturieren.
import { canvas, ctx, CELL, VSCALE, COLS, ROWS, ASSET_FILES, TOWER_SPRITE_STAGE, TOWER_SPRITE_PREFIX, ENEMY_WALK_TYPES, SPR, drawSpr, drawSprExact, drawSprCover, drawWalkAnim, cellRandom } from './spAssets.js';
import { pathCells, waypoints, pathSet, DIR_ORDER, WAY_TILE_VARIANTS, computeWaySockets, waySocketKey, ROAD_TILE_INFO } from './spGeometry.js';
import { openBuildWheel } from '../shared/buildWheel.js';

// Icons fürs Bau-Wheel (die Bauen-Panel-Liste nutzt stattdessen einen Farb-Swatch,
// im runden Wheel ist ein Symbol pro Turmtyp aber besser erkennbar) - analog zu
// MP_TOWER_WHEEL_ICON in mpCore.js.
const SP_TOWER_WHEEL_ICON = {
  arrow: '🏹', frost: '❄️', booster: '⚙️', titan: '🗿',
};
// Nachtrag (auf Nutzeranfrage): Kanone zeigt statt eines Emojis das echte Turm-Sprite
// (sieht dadurch aus wie eine tatsächliche Kanone statt einer Bombe). Tesla bekommt ein
// kleines Inline-SVG ("mini Tesla-Turm": Spule + Blitz), da es dafür kein echtes Sprite
// gibt - analog zu MP_TOWER_WHEEL_ICON_HTML in mpCore.js.
const SP_TOWER_WHEEL_ICON_HTML = {
  cannon: '<img src="assets/tower_cannon_L1.png" style="width:100%;height:100%;object-fit:contain;image-rendering:pixelated;">',
  tesla: `<svg viewBox="0 0 24 24" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
    <rect x="10" y="14" width="4" height="7" fill="#22d3ee"/>
    <ellipse cx="12" cy="14" rx="6" ry="2" fill="none" stroke="#22d3ee" stroke-width="1.5"/>
    <ellipse cx="12" cy="10" rx="4" ry="1.5" fill="none" stroke="#22d3ee" stroke-width="1.5"/>
    <circle cx="12" cy="6" r="2" fill="#22d3ee"/>
    <path d="M12 8 L10 12 L14 12 L11 17" stroke="#fff" stroke-width="1.3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`,
};

(function(){

let walkAnimAccum = 0;
let walkAnimFrame = 0;

// Nachtrag (Balance-Fix, auf Nutzeranfrage, analog zum Multiplayer-Pendant): der Kettenblitz sprang
// bisher nur innerhalb einer festen Sprungreichweite zum nächsten fliegenden Ziel - jetzt uneinge-
// schränkt zum jeweils nächstgelegenen noch nicht getroffenen fliegenden Ziel, egal wie weit entfernt
// (siehe die Kettenblitz-Schleife weiter unten). Einzige verbleibende Grenze: Sprunganzahl
// (`teslaChainJumps()`) und dass jedes Ziel nur einmal pro Schuss getroffen wird.

let gold = 220;
let lives = 20;
let maxLives = 20; // Bollwerk (Verteidigung T4) erhöht das
let wave = 1;
let towers = [];
let enemies = [];
let projectiles = [];
// Nachtrag (visuelle Aufwertung, auf Nutzeranfrage "Kriegen wir das Spiel irgendwie ähnlich visuell
// ansprechend hin?", Endlos-Modus): "Juice"-Effekte, die rein optisch sind und keine
// Balance-Werte verändern - fliegende Schadenszahlen (floatingTexts), Treffer-/Todes-Partikel
// (particles) und ein kurzer Screen-Shake bei Flächenschaden. Laufen über updateEffects(), das mit
// dem echten Frame-dt läuft (nicht mit dem ggf. vervielfachten Spielgeschwindigkeits-dt aus update()),
// damit Effekte bei 5x/10x Spieltempo nicht unlesbar schnell durchrauschen.
let particles = [];
let floatingTexts = [];
let screenShake = { time: 0, mag: 0 };
let selectedTowerType = null;
let waveActive = false;
let gameOver = false;
let lastTime = 0;
let spawnQueue = [];
let spawnTimer = 0;
let selectedTower = null; // currently selected placed tower (for upgrade/sell panel)
let paused = false;         // Pause-Button: friert update(dt) komplett ein (siehe update() unten)
let autoNextPending = false; // true zwischen Wellenzusammenfassung und automatischem Start der nächsten Welle
let autoNextTimer = 0;      // ms bis zum automatischen Start (siehe SP_AUTO_NEXT_WAVE_DELAY_MS/_BOSS_MS)
// Nachtrag (Popup-Entfernung): statischer Teil des #spWaveSub-Texts (Gold-Abrechnung + Vorschau
// auf den nächsten Wellentyp), einmalig in showWaveSummary() gesetzt. Der Countdown in update()
// hängt pro Tick nur noch die Restsekunden an, statt das komplette Banner/Popup zu ersetzen.
let waveSummaryText = '';

// ── Tech-Tree-Zustand (Port aus dem Multiplayer, siehe balance-singleplayer.js
// für SP_TECH_LABELS/SP_TECH_BRANCHES und docs/balancing.md für die Begründung
// jeder einzelnen Stufen-Anpassung) ─────────────────────────────────────────
let techPoints = 0;
let techPointsBought = 0;
let tech = { defense: 0, economy: 0, attack: 0 };
let shieldCharges = 0;
let shieldAccum = 0;       // ms seit letztem Schild-Ladezyklus (Verteidigung T2)
let lifeRegenAccum = 0;    // ms seit letzter Basis-Regeneration (Verteidigung T1)
let lifeGenAccum = 0;      // ms seit letztem automatischem Extra-Leben (Angriff T1)
let livesAtWaveStart = 20; // für die "Perfekte Welle"-Prüfung (Wirtschaft T4)
// Nachtrag (Spielgeschwindigkeit, auf Nutzeranfrage): 1/2/5/10 - loop() ruft update(dt) entsprechend
// oft pro echtem Animationsframe auf (siehe loop() unten), statt dt selbst zu skalieren, damit auch
// die frame-basierte Gegner-/Projektil-Bewegung (siehe docs/balancing.md, "Bekannte Unterschiede
// MP/SP") gleichmäßig mitbeschleunigt wird, nicht nur die dt-basierten Timer.
let gameSpeedMultiplier = 1;

function hasSpTech(branch, tier) { return tech[branch] >= tier; }
// Effektive Werte inkl. Tech-Boni, on top von den geteilten Tier-Skalierungs-Formeln
// (effectiveRange/effectiveDamage/effectiveFireRate aus balance-shared.js).
// Nachtrag (Balance-Fix "Turm-Upgrades geben jetzt nur noch Schaden", siehe balance-singleplayer.js
// Abschnitt bei spTowerDamageMult() für die volle Herleitung): Reichweite wächst bei kämpfenden
// Türmen (`kind !== 'aura'`) nicht mehr mit dem Tier - nur noch Auren (Frost/Booster, deren `range`
// ihr Wirkungsradius ist) nutzen weiterhin die geteilte effectiveRange()-Tier-Skalierung. Kämpfende
// Türme bleiben bei ihrer Basis-Reichweite, nur noch per Verteidigung-Tech-Tier-3 (+10%) steigerbar.
function spEffectiveRange(t) {
  const base = SP_TOWER_TYPES[t.type].kind === 'aura' ? effectiveRange(t) : t.baseRange;
  return base * (hasSpTech('defense', 3) ? (1 + SP_RANGE_BOOST_TIER3) : 1);
}
// Booster-Buff (Nachtrag, "Booster ... erhöht von umliegend türmen im Radius 1 Feld, schaden und
// schnelligkeit"): summiert die Boni ALLER Booster-Türme in Reichweite von `t` - mehrere Booster
// stapeln sich additiv, kein Multiplikator-Schneeball. Boostet nie andere Auren (auch nicht sich
// selbst), nur kämpfende Türme (`kind !== 'aura'`), siehe SP_TOWER_TYPES.
function boosterBuffFor(t) {
  if (SP_TOWER_TYPES[t.type].kind === 'aura') return { dmg: 0, fireRate: 0 };
  let dmg = 0, fireRate = 0;
  towers.forEach(b => {
    if (b.type !== 'booster' || b === t) return;
    if (Math.hypot(b.x - t.x, b.y - t.y) > spEffectiveRange(b)) return;
    dmg += boosterDamageBuff(b.tier);
    fireRate += boosterFireRateBuff(b.tier);
  });
  return { dmg, fireRate };
}
// Nachtrag (Balance-Fix "Turm-Upgrades geben jetzt nur noch Schaden"): Schaden nutzt jetzt die
// eigene SP-Kurve `spTowerDamageMult()` (balance-singleplayer.js, +120% bei Stern 1, siehe dort für
// die volle Herleitung) statt der geteilten `effectiveDamage()` - die bleibt unverändert für
// Multiplayer-Türme in Benutzung. Feuerrate wächst nicht mehr mit dem Tier - kämpfende Türme bleiben
// bei ihrer Basis-Feuerrate, nur noch per Angriffs-Tech-Tier-2 und Booster-Buff steigerbar.
function spEffectiveDamage(t) { return t.baseDamage * spTowerDamageMult(t) * (hasSpTech('attack', 3) ? (1 + SP_DAMAGE_BOOST_TIER3) : 1) * (1 + boosterBuffFor(t).dmg); }
function spEffectiveFireRate(t) { return t.baseFireRate / ((hasSpTech('attack', 2) ? (1 + SP_FIRERATE_BOOST_TIER2) : 1) * (1 + boosterBuffFor(t).fireRate)); }

// Balancing-Werte (SP_TOWER_TYPES, Wellen-Skalierung, Wirtschaft, Tech-Tree) stecken
// jetzt in js/balance-singleplayer.js (siehe <script>-Tag oben) statt
// inline hier — siehe docs/balancing.md. Geteilte Tier-Skalierung (Türme)
// steht in js/balance-shared.js.

function cellFromPixel(x, y) {
  return { c: Math.floor(x / CELL), r: Math.floor(y / CELL) };
}
// Nachtrag (Titan-Turm-Baufeld): Türme können jetzt mehr als eine Zelle belegen (`footprint`, siehe
// SP_TOWER_TYPES.titan in balance-singleplayer.js - "footprint: 2" = 2×2 = 4 Zellen). `t.c`/`t.r`
// bleiben die obere linke Zelle des belegten Blocks; towerCells() liefert alle belegten Zellen.
function towerCells(t) {
  const n = t.footprint || 1;
  const cells = [];
  for (let dc = 0; dc < n; dc++) for (let dr = 0; dr < n; dr++) cells.push([t.c + dc, t.r + dr]);
  return cells;
}
function findTowerAt(c, r) {
  return towers.find(t => towerCells(t).some(([cc, rr]) => cc === c && rr === r));
}
function isBuildable(c, r) {
  if (c < 0 || r < 0 || c >= COLS || r >= ROWS) return false;
  if (pathSet.has(`${c},${r}`)) return false;
  return !towers.some(t => towerCells(t).some(([cc, rr]) => cc === c && rr === r));
}
// isBuildableFootprint(): wie isBuildable(), aber für ein n×n-Baufeld ab (c,r) - alle n² Zellen
// müssen einzeln frei/bebaubar sein, sonst gilt der ganze Block als nicht bebaubar.
function isBuildableFootprint(c, r, size) {
  for (let dc = 0; dc < size; dc++) for (let dr = 0; dr < size; dr++) {
    if (!isBuildable(c + dc, r + dr)) return false;
  }
  return true;
}

// UI: tower buttons — je Turm-Typ ein Bau-Button + ein "⬆ Alle"-Upgrade-Button daneben (Port aus
// dem Multiplayer, siehe buildPalette() im ersten <script>-Block). Türme mit requiresTech (aktuell
// nur der Titan-Turm, siehe balance-singleplayer.js) starten versteckt (.sp-tower-locked) und werden
// erst sichtbar, sobald die passende Tech-Stufe freigeschaltet ist (siehe refreshSpTechUI()).
const towerButtonsDiv = document.getElementById('spTowerButtons');
Object.entries(SP_TOWER_TYPES).forEach(([key, t]) => {
  const row = document.createElement('div');
  row.className = 'build-row sp-build-row';
  row.id = 'sp-build-row-' + key;
  if (t.requiresTech) row.classList.add('sp-tower-locked');

  const btn = document.createElement('button');
  btn.className = 'sp-tower-btn';
  btn.id = 'btn-' + key;
  // Nachtrag (auf Nutzeranfrage): Ziel-Icons (Boden/Luft) neben dem Namen, siehe
  // towerTargetIconsHtml() in balance-shared.js. Keine Mine mehr im Endlos-Modus (siehe Nachtrag
  // "Mine entfernt" oben) - jeder verbleibende Turmtyp feuert, die Funktion ist also immer anwendbar.
  btn.innerHTML = `<div class="swatch" style="background:${t.color}"></div>
    <div class="info"><div class="name">${t.name} ${towerTargetIconsHtml(t)}</div><div class="cost">${t.cost} Gold</div></div>`;
  btn.onclick = () => selectTower(key);
  row.appendChild(btn);

  const upgAllBtn = document.createElement('button');
  upgAllBtn.className = 'upgrade-all-btn';
  upgAllBtn.title = `Alle ${t.name}-Türme um eine Stufe upgraden (soweit Gold reicht)`;
  upgAllBtn.textContent = '⬆ Alle';
  upgAllBtn.onclick = () => upgradeAllOfType(key);
  row.appendChild(upgAllBtn);

  towerButtonsDiv.appendChild(row);
});

function selectTower(key) {
  const type = SP_TOWER_TYPES[key];
  if (type.requiresTech && !hasSpTech(type.requiresTech.branch, type.requiresTech.tier)) return;
  if (gold < type.cost) {
    setMessage(`Nicht genug Gold für ${type.name}.`);
    return;
  }
  deselectTower();
  // Nachtrag (Bugfix): NICHT mehr abwählen, wenn der bereits ausgewählte Typ erneut angeklickt wird.
  // Vorher toggelte ein zweiter Klick auf denselben Button die Auswahl auf null - beim naheliegenden
  // Muster "vor jedem Turmbau nochmal auf den Button klicken" führte das dazu, dass der Klick auf die
  // Karte danach ins Leere lief (kein Turm wird gebaut) und der Nutzer nur "nichts passiert" sah.
  selectedTowerType = key;
  document.querySelectorAll('.sp-tower-btn').forEach(b => b.classList.remove('sp-selected'));
  if (selectedTowerType) document.getElementById('btn-' + key).classList.add('sp-selected');
}

function sellAllTowers() {
  if (gameOver || !towers.length) return;
  deselectTower();
  const refund = towers.reduce((sum, t) => sum + Math.floor(t.cost * 0.6), 0);
  gold += refund;
  towers = [];
  setMessage(`Alle Türme verkauft für ${refund} Gold.`);
  updateStats();
}

function upgradeAllOfType(buildType) {
  if (gameOver) return;
  // Günstigste Upgrades zuerst (niedrigste aktuelle Stufe zuerst), damit das Gold möglichst viele
  // Türme dieses Typs anhebt statt nur einen einzelnen bis ans Limit zu pumpen (wie im Multiplayer).
  const candidates = towers.filter(t => t.type === buildType && t.tier < TOWER_MAX_TIER).sort((a, b) => a.tier - b.tier);
  let upgraded = 0;
  for (const t of candidates) {
    const cost = spTierUpgradeCost(t.type, t.tier + 1);
    if (gold < cost) break;
    gold -= cost;
    t.tier++;
    upgraded++;
  }
  if (upgraded > 0) setMessage(`${upgraded}× ${SP_TOWER_TYPES[buildType].name} upgegradet.`);
  updateStats();
}

function setMessage(msg) {
  document.getElementById('spMessage').textContent = msg;
}

// Prüft Weg/Footprint/Tech/Gold wie bisher und baut dann - gemeinsam genutzt vom alten
// Panel-Flow (erst Typ auswählen, dann Feld anklicken) und vom neuen Bau-Wheel (Feld
// anklicken, dann Typ im Wheel wählen). Reine Extraktion, keine Verhaltensänderung am
// bisherigen Panel-Flow.
function trySpBuildAt(key, c, r) {
  const type = SP_TOWER_TYPES[key];
  const footprint = type.footprint || 1;
  if (footprint > 1) {
    if (!isBuildableFootprint(c, r, footprint)) { setMessage(`Hier passt kein ${footprint}×${footprint}-Feld-Turm hin (Weg, Rand oder schon belegt).`); return; }
  } else if (!isBuildable(c, r)) { setMessage('Hier kann kein Turm gebaut werden.'); return; }
  if (type.requiresTech && !hasSpTech(type.requiresTech.branch, type.requiresTech.tier)) { deselectTower(); return; } // Sicherheitsnetz, Button/Wheel-Segment ist ohnehin versteckt/gesperrt
  if (gold < type.cost) { setMessage('Nicht genug Gold.'); return; }
  gold -= type.cost;
  // Nachtrag (Aura-Türme: Frost-Aura + Booster-Turm, `kind: 'aura''): bekommen keine Kampfwerte
  // (baseDamage/baseFireRate/baseSplash/projSpeed) - sie feuern nie, effectiveDamage/-FireRate
  // würden mit undefined-Basiswerten sonst NaN liefern. baseRange bleibt für BEIDE Turmarten
  // erhalten, da er jetzt universell "Wirkungsradius" bedeutet (Angriffsreichweite bei kämpfenden
  // Türmen, Aura-Radius bei Frost/Booster) und über dieselbe effectiveRange()-Tier-Skalierung wächst.
  const isAura = type.kind === 'aura';
  towers.push({
    // (c,r) ist bei footprint>1 die obere linke Zelle des belegten Blocks (siehe towerCells()
    // oben); x/y liegen entsprechend in der Mitte des GESAMTEN Blocks, nicht nur einer Zelle.
    c, r, footprint, x: c*CELL + (footprint*CELL)/2, y: r*CELL + (footprint*CELL)/2,
    type: key, color: type.color, cost: type.cost, tier: 0, cooldown: 0,
    groundOnly: !!type.groundOnly, airOnly: !!type.airOnly,
    baseRange: type.range,
    ...(isAura ? { slow: type.slow } : {
      baseDamage: type.damage, baseFireRate: type.fireRate, baseSplash: type.splash || 0,
      projSpeed: type.projSpeed, slow: type.slow, slowDuration: type.slowDuration,
      priority: 'first',
    }),
  });
  deselectTower();
  updateStats();
}

canvas.addEventListener('click', (e) => {
  if (gameOver) return;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  const { c, r } = cellFromPixel(x, y);

  // Select existing tower to open upgrade/sell panel
  const existing = findTowerAt(c, r);
  if (existing) {
    selectedTowerType = null;
    document.querySelectorAll('.sp-tower-btn').forEach(b => b.classList.remove('sp-selected'));
    selectTowerObject(existing);
    return;
  }

  if (selectedTowerType) {
    trySpBuildAt(selectedTowerType, c, r);
    return;
  }

  // Kein Turmtyp im Panel vorgewählt: Bau-Wheel direkt am Klickpunkt öffnen, analog zum
  // Multiplayer (js/shared/buildWheel.js). Gesperrte Türme (requiresTech, z.B. Titan)
  // erscheinen ausgegraut mit Schloss-Symbol statt komplett zu fehlen.
  if (!isBuildable(c, r)) { setMessage('Hier kann kein Turm gebaut werden.'); return; }
  const towerOptions = Object.entries(SP_TOWER_TYPES).map(([key, t]) => {
    const locked = !!(t.requiresTech && !hasSpTech(t.requiresTech.branch, t.requiresTech.tier));
    return { key, name: t.name, color: t.color, icon: SP_TOWER_WHEEL_ICON[key] || '🔘', iconHtml: SP_TOWER_WHEEL_ICON_HTML[key], cost: t.cost, locked, affordable: gold >= t.cost };
  });
  openBuildWheel(e.clientX, e.clientY, towerOptions).then(key => {
    if (key) trySpBuildAt(key, c, r);
  });
});

// Doppelklick auf einen bestehenden Turm: direkt upgraden, ohne erst das Panel zu öffnen
// (Port aus dem Multiplayer, siehe dblclick-Handler auf #myCanvas im ersten <script>-Block).
canvas.addEventListener('dblclick', (e) => {
  if (gameOver) return;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  const { c, r } = cellFromPixel(x, y);
  const existing = findTowerAt(c, r);
  if (existing) {
    selectedTowerType = null;
    document.querySelectorAll('.sp-tower-btn').forEach(b => b.classList.remove('sp-selected'));
    selectTowerObject(existing);
    upgradeSelectedTower();
  }
});

function updateStats() {
  document.getElementById('spGoldVal').textContent = Math.floor(gold);
  document.getElementById('spLivesVal').textContent = lives;
  document.getElementById('spWaveVal').textContent = wave;
  document.getElementById('spTechPointsVal').textContent = techPoints;
  document.getElementById('spShieldIndicator').textContent = shieldCharges > 0 ? '●'.repeat(shieldCharges) : '—';
  document.querySelectorAll('.sp-tower-btn').forEach(btn => {
    const key = btn.id.replace('btn-', '');
    btn.style.opacity = gold < SP_TOWER_TYPES[key].cost ? '0.5' : '1';
  });
  // Türme mit Tech-Voraussetzung (aktuell nur Titan-Turm ab Angriff T4) erst nach Freischaltung
  // anzeigen.
  Object.entries(SP_TOWER_TYPES).forEach(([key, t]) => {
    if (!t.requiresTech) return;
    const row = document.getElementById('sp-build-row-' + key);
    row.classList.toggle('sp-tower-locked', !hasSpTech(t.requiresTech.branch, t.requiresTech.tier));
  });
  document.getElementById('spSellAllBtn').style.opacity = towers.length ? '1' : '0.5';
  document.getElementById('spSellAllBtn').disabled = towers.length === 0;
  updateTowerInfoPanel();
  updateSpTechUI();
}

// Nachtrag (Gegner-Schild ab Welle 25, "fast"-Flag für die Frost-Aura-Immunität): pushEnemy() nimmt
// jetzt ein Options-Objekt statt einer langen Positions-Parameterliste (war bei 8 Feldern schon an
// der Grenze der Lesbarkeit) - `shieldHits` wird einmal pro Welle in makeWaveEnemies() berechnet und
// hier an jeden Gegner der Welle durchgereicht, `maxShieldHits` bleibt zur Referenz erhalten (aktuell
// nicht fürs Zeichnen gebraucht, da der Schild-Rahmen nur an/aus ist, aber für spätere Abstufungen
// nützlich). `fast: true` markiert Schwarm-/Flieger-Gegner (siehe makeWaveEnemies()) als Ziel der
// Frost-Aura-Immunität ab SP_FAST_ENEMY_SLOW_IMMUNITY_WAVE.
// Nachtrag (visuelle Aufwertung, eigene Nutzer-Sprites): `visualKind` wählt rein die Optik eines
// normalen (Nicht-Boss-)Gegners (siehe ENEMY_SPRITE_FOR_KIND unten, 'guard' als neutraler Default -
// betrifft NUR das Aussehen, keine Balance-Werte). `bossIndex` (nur für isBoss) wählt analog, welcher
// der 10 Boss-Charaktere gezeichnet wird - siehe makeWaveEnemies() für die Herleitung aus der Welle.
function pushEnemy(list, opts) {
  const { hp, speed, radius, color, reward, isBoss = false, flying = false, fast = false, shieldHits = 0, visualKind = 'guard', bossIndex = 0, visualLevel = 1 } = opts;
  list.push({
    hp, maxHp: hp, speed, baseSpeed: speed, radius, color, reward,
    isBoss: !!isBoss, flying: !!flying, fast: !!fast, shieldHits, maxShieldHits: shieldHits, visualKind, bossIndex, visualLevel,
    wpIndex: 0, x: waypoints[0].x, y: waypoints[0].y, slowUntil: 0,
  });
}

function makeWaveEnemies(w) {
  const type = waveType(w);
  const hp0 = baseHp(w);
  // Nachtrag (Teil 8, "Spiel doppelt so groß"): px/Frame-Tempo mit VSCALE hochskaliert, damit Gegner
  // bei CELL=80 genauso viele Frames für dieselbe Feld-Strecke brauchen wie zuvor bei CELL=40 (sonst
  // würden sie sich effektiv doppelt so schnell bewegen, weil jedes Feld jetzt doppelt so breit ist).
  const speed = (1 + Math.min(w * 0.03, 1)) * VSCALE;
  const kg = killGoldBase(w);
  const list = [];
  // Nachtrag (auf Nutzeranfrage "Ab runde 25 bekommen die gegner einen schild der einen Hit abhält
  // ... ab runde 45 hält der schild 2 Hits aus"): einmal pro Welle berechnet, gilt für ALLE
  // Gegnertypen dieser Welle gleichermaßen (auch den Boss selbst), siehe enemyShieldHitsForWave() in
  // balance-singleplayer.js.
  const shieldHits = enemyShieldHitsForWave(w);
  // Nachtrag (auf Nutzeranfrage "mit Bewegungsanimation einbinden"): der Nutzer hat für jeden der 4
  // Gegnertypen 10 Stärke-Stufen als animierte Lauf-Sprites geliefert (siehe ENEMY_WALK_TYPES oben) -
  // Stufe 10 ist sichtbar schwerer gepanzert/bedrohlicher als Stufe 1 (gleiche Figur, andere Rüstung).
  // visualLevel wächst mit der Wellenzahl (alle 5 Wellen +1, wie beim Boss-Wechsel) und deckelt bei
  // 10 - rein kosmetisch, betrifft keine der tatsächlichen Balance-Werte (HP/Speed/etc. skalieren
  // weiterhin stufenlos über baseHp(w) usw.).
  const visualLevel = Math.min(10, Math.ceil(w / 5));

  if (type === 'swarm') {
    const cnt = Math.round(baseCount(w) * SWARM_COUNT_MULT);
    const hp = hp0 * SWARM_HP_MULT;
    for (let i = 0; i < cnt; i++) {
      pushEnemy(list, { hp, speed: speed * 1.15, radius: 8 * VSCALE, color: '#ffd166', reward: Math.round(kg * SWARM_HP_MULT), fast: true, shieldHits, visualKind: 'sprinter', visualLevel });
    }
  } else if (type === 'relief') {
    const cnt = baseCount(w);
    const hp = hp0 * POST_BOSS_RELIEF_MULT;
    for (let i = 0; i < cnt; i++) {
      pushEnemy(list, { hp, speed, radius: 10 * VSCALE, color: '#7cd992', reward: Math.round(kg), shieldHits, visualKind: 'brecher', visualLevel });
    }
  } else if (type === 'boss') {
    const cnt = Math.round(baseCount(w) * 0.7);
    const escortHp = hp0 * BOSS_ESCORT_HP_MULT;
    for (let i = 0; i < cnt; i++) {
      pushEnemy(list, { hp: escortHp, speed, radius: 10 * VSCALE, color: '#ff5e5e', reward: Math.round(kg * BOSS_ESCORT_HP_MULT), shieldHits, visualKind: 'brecher', visualLevel });
    }
    // Boss spawns last -> arrives at the end of the wave
    // Nachtrag (Steampunk-Carnival-Sprites): bossIndex zyklisch 1-10 ueber die Boss-Wellen (w%5===0),
    // damit jede 5. Welle eine der 10 verfuegbaren Boss-Charaktere zeigt (jetzt alle animiert, siehe
    // drawWalkAnim() oben) - anders als visualLevel oben ist das KEINE Stärke-Eskalation derselben
    // Figur, sondern 10 verschiedene Charaktere (Affe, Hund, Eule, Kanonenwagen, ...).
    const bIdx = ((Math.floor(w / 5) - 1) % 10) + 1;
    const bHp = Math.round(hp0 * bossMult(w));
    pushEnemy(list, { hp: bHp, speed: speed * 0.4, radius: 24 * VSCALE, color: '#e63946', reward: Math.round(kg * bossMult(w)), isBoss: true, shieldHits, bossIndex: bIdx });
  } else if (type === 'flying') {
    // Flieger-Welle (Nachtrag): ab Welle 12, alle 10 Wellen (siehe waveType() in
    // balance-singleplayer.js). Boden-Türme (Pfeil/Kanone/Titan) können diese Gegner nur zum
    // Teil treffen - die Kanone (groundOnly) gar nicht, siehe SP_TOWER_TYPES - der Tesla-Turm
    // (airOnly) ist der einzige, der NUR sie anvisiert (die Frost-Aura wirkt auf Boden UND Luft,
    // siehe Aura-Türme-Nachtrag). Etwas weniger HP, aber etwas schneller und mit Bonus-Belohnung
    // als Ausgleich dafür, dass ein Teil der bestehenden Verteidigung sie nicht aufhalten kann.
    // Gleiche Anzahl wie eine normale Welle (baseCount(w)).
    const cnt = baseCount(w);
    for (let i = 0; i < cnt; i++) {
      pushEnemy(list, { hp: hp0 * 0.8, speed: speed * 1.1, radius: 9 * VSCALE, color: '#38bdf8', reward: Math.round(kg * 1.1), flying: true, fast: true, shieldHits, visualKind: 'flugeinheit', visualLevel });
    }
  } else { // normal
    const cnt = baseCount(w);
    for (let i = 0; i < cnt; i++) {
      pushEnemy(list, { hp: hp0, speed, radius: 10 * VSCALE, color: '#ff5e5e', reward: Math.round(kg), shieldHits, visualKind: 'guard', visualLevel });
    }
  }

  return list;
}

// startWave(): spawnt die aktuelle `wave` — genutzt sowohl vom allerersten automatischen Start
// (Spielbeginn, siehe startSingleplayerMode(), wave noch nicht erhöht) als auch von
// advanceToNextWave() (nachdem wave dort schon hochgezählt wurde). Seit dem Popup-Entfernungs-
// Nachtrag gibt es dafür keinen manuellen Klick mehr - siehe docs/balancing.md, Abschnitt
// "Automatischer Wellenstart" / "Popup-Entfernung, zero-click Wellenfluss".
function startWave() {
  spawnQueue = makeWaveEnemies(wave);
  spawnTimer = 0;
  waveActive = true;
  livesAtWaveStart = lives; // für "Perfekte Welle" (Wirtschaft T4) — kein Lebensverlust während der Welle
  waveSummaryText = '';
  document.getElementById('spWaveSub').textContent = '';
  const labels = { boss: ' 💀 BOSS-WELLE!', swarm: ' 🐝 Schwarm-Welle', relief: ' 😮‍💨 Verschnaufpause', flying: ' 🦅 Flieger-Welle (Kanone trifft sie nicht, Tesla ist der Spezialist)', normal: '' };
  setMessage(`Welle ${wave} gestartet!${labels[waveType(wave)]}`);
  updateSkipBtnState();
}

// skipBossGate() (Nachtrag): der Skip-Button darf eine Boss-Welle weder überspringen noch vorzeitig
// herbeirufen - "das soll immer nur bis zur nächsten Boss-Runde möglich sein" (Nutzeranfrage). Prüft
// sowohl die AKTUELLE Welle (Boss noch nicht besiegt -> nicht vorzeitig weiterspringen) als auch die
// NÄCHSTE Welle (Boss steht unmittelbar bevor -> nicht in ihn hinein-skippen). Erst wenn advanceToNextWave()
// die Wellenzahl über den Boss hinaus erhöht hat (nach der normalen 9s-Pause), ist er wieder erlaubt.
function skipBossGate() {
  return waveType(wave) === 'boss' || waveType(wave + 1) === 'boss';
}

// updateSkipBtnState() (Nachtrag): hält den "Nächste Welle sofort"-Button in Sync mit
// waveActive/autoNextPending/paused/gameOver UND der Boss-Sperre - klickbar sowohl während der Pause
// zwischen zwei Wellen als auch während eine Welle noch aktiv läuft (siehe callNextWaveEarly()
// unten), außer unmittelbar vor/während einer Boss-Welle.
function updateSkipBtnState() {
  const btn = document.getElementById('spSkipBtn');
  if (!btn) return;
  const bossBlocked = skipBossGate();
  btn.disabled = !((autoNextPending || waveActive) && !paused && !gameOver) || bossBlocked;
  btn.title = bossBlocked
    ? 'Vor/während einer Boss-Welle gesperrt - die muss regulär gespielt werden.'
    : 'Nächste Welle sofort dazu-rufen (auch während die aktuelle noch läuft) - vor Boss-Wellen gesperrt';
}

document.getElementById('spPauseBtn').addEventListener('click', () => {
  if (gameOver) return;
  paused = !paused;
  const btn = document.getElementById('spPauseBtn');
  btn.textContent = paused ? '▶ Fortsetzen' : '⏸ Pause';
  btn.title = paused ? 'Fortsetzen' : 'Spiel pausieren';
  if (paused) setMessage('Pausiert.');
  updateSkipBtnState();
});

// callNextWaveEarly() (Nachtrag): auf Nutzeranfrage - der Skip-Button soll die nächste Welle SOFORT
// starten können, "obwohl die aktuelle noch nicht beendet ist". Anders als advanceToNextWave() (das
// eine BEREITS abgeschlossene Welle voraussetzt und startWave() aufruft, was die spawnQueue komplett
// ERSETZEN würde) wird hier die neue Welle nur an die bestehende spawnQueue ANGEHÄNGT - übrige
// Spawns und schon aktive Gegner der alten Welle bleiben erhalten und laufen gemeinsam mit der neuen
// Welle weiter (bewusste Überlappung, macht das Vorspulen riskanter/schwerer). Die Wellen-Abrechnung
// (showWaveSummary()) feuert wie gewohnt erst, wenn spawnQueue UND enemies wieder leer sind - dann für
// die inzwischen höhere `wave`-Nummer.
function callNextWaveEarly() {
  if (gameOver || paused || skipBossGate()) return;
  wave++;
  spawnQueue = spawnQueue.concat(makeWaveEnemies(wave));
  waveActive = true;
  pulseWaveBig();
  const labels = { boss: ' 💀 BOSS-WELLE!', swarm: ' 🐝 Schwarm-Welle', relief: ' 😮‍💨 Verschnaufpause', flying: ' 🦅 Flieger-Welle (Kanone trifft sie nicht, Tesla ist der Spezialist)', normal: '' };
  setMessage(`Welle ${wave} vorzeitig dazu-gerufen!${labels[waveType(wave)]}`);
  updateStats();
  updateSkipBtnState();
}

// Nachtrag (Skip-Button, überarbeitet auf Nutzeranfrage): jetzt in zwei Situationen aktiv - während
// der Pause ZWISCHEN zwei Wellen (autoNextPending) überspringt er wie bisher nur die restliche 6s/9s-
// Wartezeit (advanceToNextWave()); während eine Welle noch AKTIV läuft ruft er stattdessen die
// nächste Welle sofort dazu (callNextWaveEarly()), ohne auf das Ende der aktuellen zu warten. Beides
// gesperrt unmittelbar vor/während einer Boss-Welle (skipBossGate()).
document.getElementById('spSkipBtn').addEventListener('click', () => {
  if (gameOver || paused || skipBossGate()) return;
  if (autoNextPending) advanceToNextWave();
  else if (waveActive) callNextWaveEarly();
});

// Nachtrag (Spielgeschwindigkeit, auf Nutzeranfrage): 1x/2x/5x/10x-Buttons setzen gameSpeedMultiplier
// (siehe loop() weiter unten, wo update() entsprechend oft pro Frame aufgerufen wird) und markieren
// sich gegenseitig als aktiv/inaktiv.
document.querySelectorAll('#spSpeedRow .sp-speed-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    gameSpeedMultiplier = Number(btn.dataset.speed);
    document.querySelectorAll('#spSpeedRow .sp-speed-btn').forEach(b => b.classList.toggle('sp-speed-active', b === btn));
  });
});

// ── Visuelle "Juice"-Effekte (Nachtrag, rein optisch, keine Balance-Auswirkung) ────────────────────
// spawnParticles(): einfache kurzlebige Funkenpartikel (Treffer/Tod), spawnFloatingText(): fliegende
// Schadenszahl über dem Gegner, triggerShake(): kurzer Kamera-Zittereffekt für spürbare Flächentreffer.
// Alle drei sind bewusst simpel gehalten (keine Bilder, nur Canvas-Primitive) - siehe docs/visuals.md.
function spawnParticles(x, y, color, count, opts) {
  opts = opts || {};
  const spread = opts.spread || 1;
  // Nachtrag (Teil 8, "Spiel doppelt so groß"): * VSCALE, damit Partikel bei CELL=80 optisch genauso
  // weit relativ zur (jetzt größeren) Zelle auseinanderfliegen wie zuvor bei CELL=40.
  const baseSpeed = (opts.speed || 0.09) * VSCALE;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = (baseSpeed * 0.4 + Math.random() * baseSpeed) * spread;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 260 + Math.random() * 220,
      maxLife: 480,
      color,
      size: (1.5 + Math.random() * 2) * VSCALE,
    });
  }
}
function spawnFloatingText(x, y, text, color) {
  floatingTexts.push({ x, y: y - 10 * VSCALE, text, color: color || '#fff', life: 650, maxLife: 650, vy: -0.028 * VSCALE });
}
function triggerShake(mag) {
  screenShake.time = Math.max(screenShake.time, 140);
  screenShake.mag = Math.max(screenShake.mag, mag);
}
// updateEffects(): läuft mit dem ECHTEN Frame-dt (aus loop(), unabhängig von gameSpeedMultiplier),
// damit die Effekte auch bei hohem Spieltempo normal schnell (und damit lesbar) ablaufen.
function updateEffects(dt) {
  if (!dt || dt > 200) return; // Tab-Wechsel/Ruckler: keinen Riesensprung interpolieren
  particles = particles.filter(p => {
    p.life -= dt;
    if (p.life <= 0) return false;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 0.00025 * dt; // leichte "Schwerkraft", damit Funken nicht endlos geradeaus fliegen
    return true;
  });
  floatingTexts = floatingTexts.filter(f => {
    f.life -= dt;
    if (f.life <= 0) return false;
    f.y += f.vy * dt;
    return true;
  });
  if (screenShake.time > 0) {
    screenShake.time -= dt;
    if (screenShake.time <= 0) { screenShake.time = 0; screenShake.mag = 0; }
  }
  // Lauf-Animation aller Gegner/Bosse (meist 4 Frames, boss_L5 hat 6, siehe SPRITE_FRAME_COUNT in
  // spAssets.js) - 150ms pro Frame, mit dem echten Frame-dt statt der Spielgeschwindigkeit. Zähler
  // läuft bis 12 (kgV von 4 und 6, Nachtrag 2026-08-05), der tatsächliche Frame-Index pro Sprite wird
  // in drawWalkAnim() per `% frameCount` daraus abgeleitet.
  walkAnimAccum += dt;
  if (walkAnimAccum >= 150) { walkAnimAccum -= 150; walkAnimFrame = (walkAnimFrame + 1) % 12; }
}

function damageEnemy(enemy, dmg) {
  // Gegner-Schild (Nachtrag, auf Nutzeranfrage "Ab runde 25 bekommen die gegner einen schild der
  // einen Hit abhält ... ab runde 45 hält der schild 2 Hits aus"): absorbiert einen kompletten
  // Treffer (unabhängig vom Schadenswert) BEVOR überhaupt HP abgezogen wird - jeder damageEnemy()-
  // Aufruf zählt als ein Treffer, egal ob Direkttreffer, Flächenschaden oder ein einzelner
  // Tesla-Kettensprung. Läuft einfach leer, sobald shieldHits auf 0 ist (normales Verhalten danach).
  if (enemy.shieldHits > 0) {
    enemy.shieldHits--;
    spawnParticles(enemy.x, enemy.y, '#60a5fa', 4, { speed: 0.06 }); // blauer Schild-Funke statt Schadenszahl
    return;
  }
  enemy.hp -= dmg;
  // Fliegende Schadenszahl + kleiner Treffer-Funken bei jedem Treffer (rein optisch).
  spawnFloatingText(enemy.x, enemy.y - enemy.radius, Math.round(dmg).toString(), '#fff');
  spawnParticles(enemy.x, enemy.y, enemy.color, 3, { speed: 0.05 });
  if (enemy.hp <= 0) {
    // Kill-Gold-Boni: Wirtschaft T1 (Nachtrag/Balance-Fix, ersetzt die entfernte Mine) gibt einen
    // pauschalen additiven Bonus pro Kill (SP_KILL_GOLD_FLAT_BONUS_TIER1), Wirtschaft T2 (Port aus
    // dem Multiplayer-Tech-Tree) gibt zusätzlich +10% auf die Summe - dadurch wirkt T2 auch auf den
    // T1-Bonus, nicht nur auf den Basis-Reward des Gegners.
    const flatBonus = hasSpTech('economy', 1) ? SP_KILL_GOLD_FLAT_BONUS_TIER1 : 0;
    gold += (enemy.reward + flatBonus) * (hasSpTech('economy', 2) ? (1 + SP_KILL_GOLD_BOOST_TIER2) : 1);
    // Todes-Explosion: deutlich mehr/größere Partikel als ein normaler Treffer, damit Kills spürbar sind.
    spawnParticles(enemy.x, enemy.y, enemy.color, 14, { speed: 0.14, spread: 1.4 });
    enemies = enemies.filter(e => e !== enemy);
    updateStats();
  }
}

function update(dt) {
  if (gameOver) return;
  if (paused) return; // Pause friert alles ein: Gegnerbewegung, Spawns, Tech-Effekte UND den Auto-Wellenstart-Countdown.

  // Auto-Wellenstart-Countdown (Nachtrag): läuft, während der Spieler zwischen zwei Wellen Zeit hat,
  // sich vorzubereiten. Siehe docs/balancing.md, Abschnitt "Automatischer Wellenstart" für die
  // Begründung der Dauer (6s normal, 9s vor Boss-Wellen) und advanceToNextWave() weiter unten.
  // Popup-Entfernung: statt eines eigenen Countdown-Feldes im (jetzt entfernten) Banner hängt der
  // Countdown pro Tick an den statischen Abrechnungstext (waveSummaryText, siehe showWaveSummary())
  // im ruhigen #spWaveSub-Fließtext unter der Karte an - komplett ohne Interaktion.
  if (autoNextPending) {
    autoNextTimer -= dt;
    const subEl = document.getElementById('spWaveSub');
    if (subEl) subEl.textContent = `${waveSummaryText} Nächste Welle in ${Math.max(0, Math.ceil(autoNextTimer / 1000))}s…`;
    if (autoNextTimer <= 0) advanceToNextWave();
  }

  // ── Tech-Tree-Effekte, die kontinuierlich pro Frame wirken (Port aus dem Multiplayer) ──
  // Verteidigung T1: Basis-Regeneration (+1 Leben alle 60s) — direkte Entsprechung des ursprünglichen
  // Multiplayer-Mechanismus, bevor der dort auf Einheiten-Heilung umgebaut wurde (siehe docs/balancing.md).
  if (hasSpTech('defense', 1)) {
    lifeRegenAccum += dt;
    if (lifeRegenAccum >= SP_LIFE_REGEN_INTERVAL_MS) {
      lifeRegenAccum -= SP_LIFE_REGEN_INTERVAL_MS;
      if (lives < maxLives) { lives++; updateStats(); }
    }
  }
  // Verteidigung T2: Schild lädt alle 90s auf volle 3 Ladungen nach (wie im Multiplayer).
  if (hasSpTech('defense', 2)) {
    shieldAccum += dt;
    if (shieldAccum >= SP_SHIELD_COOLDOWN_MS && shieldCharges < SP_SHIELD_CHARGES) {
      shieldAccum -= SP_SHIELD_COOLDOWN_MS;
      shieldCharges = SP_SHIELD_CHARGES;
    }
  }
  // Angriff T1 "Wachtrupp": automatisch +1 Leben alle 90s, unabhängig vom Kampfgeschehen — Endlos-
  // Modus-Entsprechung von Lebensklau (das im Multiplayer an gesendete, durchgekommene eigene
  // Einheiten geknüpft ist — die gibt es im Endlos-Modus nicht).
  if (hasSpTech('attack', 1)) {
    lifeGenAccum += dt;
    if (lifeGenAccum >= SP_LIFE_GEN_INTERVAL_MS) {
      lifeGenAccum -= SP_LIFE_GEN_INTERVAL_MS;
      if (lives < maxLives) { lives++; updateStats(); }
    }
  }
  // Wirtschaft T3 "Zinsen" (Nachtrag/Balance-Fix): war kontinuierlich +1%/s, das kompoundierte
  // 60×/Sekunde auf den laufend wachsenden Goldbestand und war "zu krass" (Nutzer-Feedback). Jetzt
  // nur noch eine einmalige Zusatzverzinsung bei Wellenabschluss, siehe showWaveSummary() unten -
  // hier passiert dafür nichts mehr pro Frame.

  // Spawn logic
  if (spawnQueue.length > 0) {
    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      enemies.push(spawnQueue.shift());
      spawnTimer = spawnIntervalMs(wave);
    }
  } else if (waveActive && enemies.length === 0) {
    waveActive = false;
    showWaveSummary();
    // Automatischer Wellenstart: Countdown-Dauer hängt vom NÄCHSTEN Wellentyp ab (Boss-Wellen kriegen
    // mehr Vorlauf, siehe SP_AUTO_NEXT_WAVE_DELAY_BOSS_MS oben). Läuft seit dem Popup-Entfernungs-
    // Nachtrag komplett ohne UI-Element, das geklickt werden müsste.
    autoNextPending = true;
    autoNextTimer = waveType(wave + 1) === 'boss' ? SP_AUTO_NEXT_WAVE_DELAY_BOSS_MS : SP_AUTO_NEXT_WAVE_DELAY_MS;
    updateSkipBtnState(); // jetzt klickbar - Nutzer kann die 6s/9s-Pause überspringen
  }

  // Move enemies
  const now = performance.now();
  enemies.forEach(e => {
    let speed = e.baseSpeed;
    if (now < e.slowUntil) speed *= 0.5;
    const target = waypoints[e.wpIndex + 1];
    if (!target) return;
    const dx = target.x - e.x, dy = target.y - e.y;
    const dist = Math.hypot(dx, dy);
    if (dist < speed) {
      e.x = target.x; e.y = target.y;
      e.wpIndex++;
      if (e.wpIndex >= waypoints.length - 1) {
        // Verteidigung T2 Schild: blockt einen kompletten Leak (wie im Multiplayer "3 Treffer
        // abfangen" — ein Treffer = eine Ladung, unabhängig von der eigentlichen Lebenskosten-Höhe).
        if (shieldCharges > 0) { shieldCharges--; }
        else { lives -= (e.isBoss ? 5 : (e.radius > 12 * VSCALE ? 3 : 1)); }
        enemies = enemies.filter(en => en !== e);
        updateStats();
        if (lives <= 0) { endGame(); }
      }
    } else {
      e.x += (dx/dist) * speed;
      e.y += (dy/dist) * speed;
    }
  });

  // Aura-Türme (Nachtrag: Frost-Aura + Booster-Turm, beide "kind: 'aura'" - siehe SP_TOWER_TYPES):
  // wirken kontinuierlich auf alles im Radius, kein Cooldown, kein Ziel, kein Projektil. Die
  // Booster-Buff-Seite braucht hier KEINE eigene Schleife - sie wird reaktiv in spEffectiveDamage()/
  // spEffectiveFireRate() unten berechnet, sobald ein anderer Turm feuert. Die Frost-Aura dagegen
  // muss aktiv pro Frame jeden Gegner im Radius erneut verlangsamen (kontinuierlicher Effekt statt
  // einmaligem Projektil-Treffer).
  towers.forEach(t => {
    if (SP_TOWER_TYPES[t.type].auraTarget !== 'enemies') return; // aktuell nur Frost, generisch über auraTarget statt hartem Typ-Check
    const auraRange = spEffectiveRange(t);
    enemies.forEach(e => {
      // "Schnelle" Gegner (Schwarm/Flieger, `fast: true`) sind ab Welle SP_FAST_ENEMY_SLOW_IMMUNITY_WAVE
      // komplett immun gegen die Frost-Aura (auf Nutzeranfrage).
      if (e.fast && wave >= SP_FAST_ENEMY_SLOW_IMMUNITY_WAVE) return;
      if (Math.hypot(e.x - t.x, e.y - t.y) > auraRange) return;
      // Kleiner Puffer (300ms) statt der alten, für Einzeltreffer gedachten slowDuration: reicht über
      // mehrere Frames hinweg, damit die Verlangsamung bei durchgehendem Aura-Kontakt lückenlos bleibt,
      // läuft aber innerhalb von 300ms nach Verlassen des Radius von selbst wieder ab.
      e.slowUntil = performance.now() + 300;
    });
  });

  // Towers fire (effective stats derived from each tower's own tier + Tech-Tree-Boni)
  towers.forEach(t => {
    if (SP_TOWER_TYPES[t.type].kind === 'aura') return; // Frost-Aura + Booster feuern nie, siehe oben
    t.cooldown -= dt;
    if (t.cooldown > 0) return;
    const effRange = spEffectiveRange(t);
    let target = null, bestScore = -1;
    enemies.forEach(e => {
      // Flieger-Wellen-Nachtrag: Kanone (groundOnly) kann Flieger nicht treffen, Tesla (airOnly)
      // kann NUR Flieger treffen - exakt wie im Multiplayer (fireTowers()), siehe SP_TOWER_TYPES
      // in balance-singleplayer.js für die Begründung.
      if (t.groundOnly && e.flying) return;
      if (t.airOnly && !e.flying) return;
      const d = Math.hypot(e.x - t.x, e.y - t.y);
      if (d > effRange) return;
      const score = t.priority === 'hp' ? e.hp : e.wpIndex;
      if (score > bestScore) { bestScore = score; target = e; }
    });
    if (target) {
      t.cooldown = spEffectiveFireRate(t);
      projectiles.push({
        x: t.x, y: t.y, target, speed: t.projSpeed,
        damage: spEffectiveDamage(t), color: t.color,
        splash: effectiveSplash(t),
        slow: t.slow, slowDuration: t.slowDuration,
        // Tesla-Kettenblitz (Nachtrag): Sprunganzahl nach Tower-Tier, siehe teslaChainJumps() in
        // balance-multiplayer.js (global verfügbar, identisch zum Multiplayer-Turm).
        chainJumps: t.type === 'tesla' ? teslaChainJumps(t.tier) : 0,
      });
    }
  });

  // Move projectiles
  projectiles.forEach(p => {
    if (!enemies.includes(p.target)) { p.dead = true; return; }
    const dx = p.target.x - p.x, dy = p.target.y - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist < p.speed + 5 * VSCALE) {
      if (p.splash) {
        enemies.slice().forEach(e => {
          if (Math.hypot(e.x - p.target.x, e.y - p.target.y) <= p.splash) damageEnemy(e, p.damage);
        });
        // Kleiner Kamera-Zittereffekt bei Flächenschaden (rein optisch) - macht AoE-Treffer spürbarer.
        triggerShake(2.5 * VSCALE);
        spawnParticles(p.target.x, p.target.y, '#ffb347', 8, { speed: 0.11, spread: 1.2 });
      } else if (p.chainJumps) {
        // Tesla-Kettenblitz: erster Treffer beim Primärziel, danach springt der Schaden vom jeweils
        // zuletzt getroffenen Ziel zum nächstgelegenen noch nicht getroffenen FLIEGENDEN Ziel weiter -
        // OHNE Reichweiten-Begrenzung (Nachtrag, auf Nutzeranfrage) -, bis entweder kein weiteres
        // ungetroffenes fliegendes Ziel mehr existiert oder p.chainJumps Sprünge verbraucht sind.
        // Port aus moveProjectiles() im Multiplayer-Script, hier mit echtem 2D-Abstand statt der
        // MP-1D-Lane-Distanz (SP nutzt ein (c,r)-Baufeld).
        const hit = new Set();
        let current = p.target;
        damageEnemy(current, p.damage);
        hit.add(current);
        for (let hop = 0; hop < p.chainJumps; hop++) {
          let next = null, bestDist = Infinity;
          enemies.forEach(e => {
            if (hit.has(e) || !e.flying) return;
            const d = Math.hypot(e.x - current.x, e.y - current.y);
            if (d < bestDist) { bestDist = d; next = e; }
          });
          if (!next) break;
          hit.add(next);
          damageEnemy(next, p.damage);
          current = next;
        }
      } else {
        damageEnemy(p.target, p.damage);
        if (p.slow) p.target.slowUntil = performance.now() + p.slowDuration;
      }
      p.dead = true;
    } else {
      p.x += (dx/dist) * p.speed;
      p.y += (dy/dist) * p.speed;
    }
  });
  projectiles = projectiles.filter(p => !p.dead);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Nachtrag (visuelle Aufwertung): kurzer Kamera-Zittereffekt bei Flächenschaden (triggerShake(),
  // siehe oben) - rein optisch, verschiebt nur den kompletten Zeichenkontext für ein paar Frames.
  ctx.save();
  if (screenShake.time > 0) {
    const amt = screenShake.mag * (screenShake.time / 140);
    ctx.translate((Math.random() - 0.5) * amt * 2, (Math.random() - 0.5) * amt * 2);
  }

  // Nachtrag (Steampunk-Carnival-Sprites, eigene Grafiken des Nutzers): Terrain-/Pfad-Zellen nutzen
  // jetzt, falls geladen, echte Kachel-Grafiken statt der Schachbrett-/Verlauf-Optik - mit
  // vollständigem Fallback auf den bisherigen Look, falls ein Bild (noch) nicht bereit ist. Der
  // Pfad-Set (`pathSet`) wird einmal vorab gebaut (u.a. für die Deko-Streuung unten).
  const pathSet = new Set(pathCells.map(([c,r]) => c + ',' + r));
  // Nachtrag (Teil 7, "auch das Gelände tauschen"): EIN großes Hintergrundbild (`terrain_plaza`)
  // deckt jetzt den kompletten Boden ab, statt pro Zelle eine Kachel zu wiederholen (siehe Teil 5,
  // "nur noch Gras"). Grund: die neue Gelände-Referenzgrafik ist - anders als das Weg-Set aus Teil 6
  // - KEIN Satz frei kombinierbarer Einzelkacheln, sondern EIN zusammenhängendes Motiv (Karussell-
  // Platz mit Medaillon-Mitte über alle 15 Raster-Felder hinweg, siehe docs/tileset.md). Einzelne
  // Ausschnitte davon isoliert zu wiederholen hätte an jeder Kachelgrenze sichtbar kaputte
  // Gear-/Medaillon-Fragmente ergeben. `drawSprCover()` skaliert das Bild wie CSS "background-size:
  // cover" auf die komplette Spielfeld-Fläche (COLS×CELL / ROWS×CELL) - Seitenverhältnis bleibt
  // gewahrt, minimaler Beschnitt links/rechts statt Verzerrung. Pfad-Kacheln (Teil 6) und
  // Deko-Objekte werden wie bisher obendrüber gezeichnet.
  if (!drawSprCover('terrain_plaza', 0, 0, COLS * CELL, ROWS * CELL)) {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.fillStyle = (r+c)%2===0 ? '#232a33' : '#212831';
        ctx.fillRect(c*CELL, r*CELL, CELL, CELL);
      }
    }
  }
  // Deko-Objekte (Zelte/Laterne/Baum) - nur auf freien Terrain-Zellen (kein Pfad, keine Turm-Zelle),
  // deterministisch platziert über cellRandom() statt echtem Zufall, damit sie nicht jeden Frame
  // "flackern". Dünn gestreut (nur ~8% aller Zellen).
  const DECOR_OBJS = ['obj_tree', 'obj_tent1', 'obj_tent2', 'obj_lamppost'];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (pathSet.has(c + ',' + r)) continue;
      const roll = cellRandom(c, r, 2);
      if (roll < 0.08) {
        const key = DECOR_OBJS[Math.floor(cellRandom(c, r, 3) * DECOR_OBJS.length)];
        drawSpr(key, c*CELL + CELL/2, r*CELL + CELL/2, CELL * 0.9);
      }
    }
  }
  // path (Teil 6, "richtige Kurven + Logik fürs Zusammenpassen"): jede Pfad-Zelle zeichnet die zu
  // ihrem Sockel-Muster passende way_*-Kachel aus WAY_TILE_VARIANTS (vorberechnet in ROAD_TILE_INFO,
  // siehe oben) - keine canvas-Rotation mehr nötig, jede Kurvenrichtung hat ihre eigene, per
  // Sichtprüfung bestätigte Bilddatei. Fallback auf den alten Verlauf, falls ein Bild (noch) nicht
  // geladen ist oder (bei künftigen, verzweigten Karten) ein Sockel-Muster mal keine passende Kachel
  // im aktuellen Set findet.
  pathCells.forEach(([c,r]) => {
    const x = c*CELL, y = r*CELL;
    const info = ROAD_TILE_INFO.get(c + ',' + r);
    const drawn = info && info.sprKey && drawSprExact(info.sprKey, x, y, CELL, CELL);
    if (drawn) return;
    const grad = ctx.createLinearGradient(x, y, x, y + CELL);
    grad.addColorStop(0, '#454b54');
    grad.addColorStop(1, '#33383f');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, CELL - 1, CELL - 1);
  });

  // Nachtrag (auf Nutzeranfrage): Reichweiten-Kreis wurde vorher für ALLE Türme dauerhaft gezeichnet -
  // bei vielen Türmen unübersichtlich. Jetzt nur noch für den aktuell ausgewählten Turm, dafür mit
  // einem Rahmen, damit der Kreis trotz der dünnen Füllung gut erkennbar bleibt.
  if (selectedTower) {
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.arc(selectedTower.x, selectedTower.y, spEffectiveRange(selectedTower), 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // towers (Türme mit footprint>1, aktuell nur der Titan-Turm, entsprechend größer gezeichnet,
  // damit das belegte 2×2-Baufeld optisch erkennbar bleibt)
  towers.forEach(t => {
    const radius = (14 + ((t.footprint || 1) - 1) * 10) * VSCALE;
    if ((t.footprint || 1) > 1) {
      // Belegtes Baufeld sichtbar umranden, damit klar ist, welche Nachbarzellen dadurch blockiert sind.
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(t.c * CELL, t.r * CELL, t.footprint * CELL, t.footprint * CELL);
    }
    // Nachtrag (visuelle Aufwertung): weicher Glow-Halo in Turmfarbe hinter dem Turm - Stärke/Größe
    // wächst leicht mit dem Stern-Level, damit hochgestufte Türme optisch spürbar "mächtiger" wirken.
    const glowR = radius * (1.6 + Math.min(t.tier, 10) * 0.04);
    const glow = ctx.createRadialGradient(t.x, t.y, radius * 0.4, t.x, t.y, glowR);
    glow.addColorStop(0, t.color + '55');
    glow.addColorStop(1, t.color + '00');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(t.x, t.y, glowR, 0, Math.PI*2);
    ctx.fill();

    // Nachtrag (Steampunk-Carnival-Sprites, erweitert in Teil 9): jede Turmart mit einem Eintrag in
    // TOWER_SPRITE_PREFIX bekommt eine echte 5-Stufen-Sprite-Evolution (tier 0-10 -> Stage 1-5, siehe
    // TOWER_SPRITE_STAGE() oben) - ursprünglich nur der Pfeilturm (Teil 3), jetzt zusätzlich Kanone,
    // Frostturm und Booster-Turm (Teil 9). Tesla/Titan haben (noch) keinen Sprite-Satz und bleiben
    // bei der bisherigen prozeduralen Kreis-Darstellung, mit demselben Fallback-Mechanismus falls
    // ein Sprite (noch) nicht bereit ist.
    let spriteDrawn = false;
    const spritePrefix = TOWER_SPRITE_PREFIX[t.type];
    if (spritePrefix) {
      const stage = TOWER_SPRITE_STAGE(t.tier);
      spriteDrawn = drawSpr(spritePrefix + '_L' + stage, t.x, t.y, radius * 2.6);
    }
    if (!spriteDrawn) {
      ctx.beginPath();
      ctx.fillStyle = darkenColor(t.color, t.tier);
      ctx.arc(t.x, t.y, radius, 0, Math.PI*2);
      ctx.fill();
      // Dezenter heller Lichtreflex oben links, für einen leichten 3D-/Kugel-Eindruck ohne echte Sprites.
      ctx.beginPath();
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.arc(t.x - radius*0.3, t.y - radius*0.3, radius*0.4, 0, Math.PI*2);
      ctx.fill();
      ctx.strokeStyle = '#10151b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(t.x, t.y, radius, 0, Math.PI*2);
      ctx.stroke();
    }
    drawLevelStars(ctx, t.x, t.y, t.tier);
    if (t === selectedTower) {
      ctx.beginPath();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.arc(t.x, t.y, radius + 4, 0, Math.PI*2);
      ctx.stroke();
    }
  });

  // enemies
  enemies.forEach(e => {
    // Nachtrag (visuelle Aufwertung): weicher Bodenschatten unter jedem Gegner, gibt etwas Tiefe.
    // Bleibt bewusst bei e.y (Boden-/Wegposition), auch für fliegende Einheiten - siehe drawY unten.
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.ellipse(e.x, e.y + e.radius * 0.7, e.radius * 0.9, e.radius * 0.35, 0, 0, Math.PI*2);
    ctx.fill();

    // Nachtrag (User-Feedback "Flugeinheiten sollen ein halbes Feld höher dargestellt werden"):
    // drawY statt e.y für Sprite/Fallback-Kreis/Ringe/Healthbar - e.y selbst bleibt unverändert
    // (Spiellogik/Kollision/Weg-Position), nur die Darstellung wird für fliegende Einheiten um eine
    // halbe Zelle nach oben versetzt (der Bodenschatten oben bleibt bewusst am Boden).
    const drawY = e.y - (e.flying ? CELL / 2 : 0);

    // Nachtrag (auf Nutzeranfrage "mit Bewegungsanimation einbinden"): animiertes Lauf-Sprite statt
    // flachem Kreis, falls geladen - visualKind (siehe pushEnemy()/makeWaveEnemies()) mappt die 5
    // Welle-Generator-Zweige auf die 4 verfügbaren Kreatur-Grafiken; visualLevel (1-10, wächst mit
    // der Wellenzahl, siehe makeWaveEnemies()) wählt die Stärke-Ausbaustufe. Bosse nutzen stattdessen
    // bossIndex (1-10, zyklisch pro Boss-Welle) für 10 unterschiedliche Boss-Charaktere. Fallback auf
    // den bisherigen Kreis, falls das jeweilige Bild (noch) nicht bereit ist.
    // Nachtrag (User-Feedback, 2026-08-03: "Skalierung auf 80% von der aktuellen Größe"): ×0.8 auf
    // die bisherige Zielbreite, analog zum Multiplayer-Pendant.
    // Nachtrag 2 (analog zum MP-Fix "Boss ist nicht auf der Spur"): Boss-Multiplikator 3.4→2.6
    // gesenkt (gleiches Verhältnis wie beim MP-Fix, ~24% weniger) - normale Gegner (2.8) unverändert.
    let spriteDrawn = false;
    if (e.isBoss) {
      spriteDrawn = drawWalkAnim('boss_L' + e.bossIndex + '_walk', e.x, drawY, e.radius * 2.6 * 0.8, walkAnimFrame);
    } else if (e.visualKind) {
      spriteDrawn = drawWalkAnim(e.visualKind + '_L' + e.visualLevel + '_walk', e.x, drawY, e.radius * 2.8 * 0.8, walkAnimFrame);
    }
    if (!spriteDrawn) {
      ctx.beginPath();
      ctx.fillStyle = e.color;
      ctx.arc(e.x, drawY, e.radius, 0, Math.PI*2);
      ctx.fill();
    }
    // Nachtrag (2026-08-05, auf Nutzeranfrage "der Kreis bei fliegenden Einheiten soll weg"): der
    // weiße Flieger-Ring (früher hier, exakt wie im Multiplayer) ist entfernt - fliegende Einheiten
    // sind über ihr Sprite bzw. das u.flying-Feld in der Spiellogik weiterhin eindeutig erkennbar,
    // brauchten aber keine zusätzliche Ring-Markierung mehr. Analoge Entfernung in mpCore.js.
    // Schild-Kennzeichnung (Nachtrag, auf Nutzeranfrage "zeig den schild als Blauen Rahmen, leicht
    // leuchtend"): leicht leuchtender blauer Rahmen, solange shieldHits > 0 - liegt außerhalb des
    // Flieger-Rings (falls beides zutrifft, bleiben beide Ringe einzeln erkennbar).
    if (e.shieldHits > 0) {
      ctx.save();
      ctx.shadowColor = '#3b82f6';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2.5;
      ctx.arc(e.x, drawY, e.radius + (e.flying ? 6 : 3) * VSCALE, 0, Math.PI*2);
      ctx.stroke();
      ctx.restore();
    }
    // hp bar
    const w = e.radius*2;
    ctx.fillStyle = '#000';
    ctx.fillRect(e.x - w/2, drawY - e.radius - 8 * VSCALE, w, 4 * VSCALE);
    ctx.fillStyle = '#7CFC00';
    ctx.fillRect(e.x - w/2, drawY - e.radius - 8 * VSCALE, w * (e.hp/e.maxHp), 4 * VSCALE);
  });

  // projectiles (Nachtrag, visuelle Aufwertung: kurzer verblassender Bewegungs-Trail statt eines
  // reinen Einzelpunkts - p.trailX/p.trailY merken sich die zuletzt gezeichnete Position und werden
  // hier pro echtem Frame nachgeführt, unabhängig von der Anzahl der update()-Aufrufe pro Frame)
  projectiles.forEach(p => {
    if (p.trailX === undefined) { p.trailX = p.x; p.trailY = p.y; }
    ctx.strokeStyle = p.color;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(p.trailX, p.trailY);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
    p.trailX = p.x; p.trailY = p.y;

    ctx.beginPath();
    ctx.fillStyle = p.color;
    ctx.arc(p.x, p.y, 4 * VSCALE, 0, Math.PI*2);
    ctx.fill();
  });

  // Nachtrag (visuelle Aufwertung): Treffer-/Todes-Partikel (spawnParticles(), siehe damageEnemy()).
  particles.forEach(pt => {
    ctx.globalAlpha = Math.max(0, pt.life / pt.maxLife);
    ctx.beginPath();
    ctx.fillStyle = pt.color;
    ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI*2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;

  // Nachtrag (visuelle Aufwertung): fliegende Schadenszahlen (spawnFloatingText(), siehe damageEnemy()).
  floatingTexts.forEach(f => {
    ctx.globalAlpha = Math.max(0, f.life / f.maxLife);
    ctx.font = 'bold ' + (13 * VSCALE) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  });
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';

  ctx.restore(); // Ende Screen-Shake-Translate
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  // Nachtrag (Spielgeschwindigkeit): update() wird gameSpeedMultiplier-mal mit demselben echten
  // Frame-dt aufgerufen, statt dt selbst zu vervielfachen. Grund: Gegner-/Projektil-Bewegung ist in
  // diesem Code frame-basiert (fester Pixel-Schritt pro update()-Aufruf, siehe docs/balancing.md,
  // "Bekannte Unterschiede MP/SP"), reagiert also gar nicht auf einen größeren dt-Wert. Mehrfaches
  // Aufrufen beschleunigt dadurch BEIDES gleichmäßig - die frame-basierte Bewegung UND die dt-
  // basierten Timer (Spawns, Countdown, Regeneration etc.) - um exakt denselben
  // Faktor. Gezeichnet wird bewusst nur einmal pro echtem Frame (reine Performance, keine
  // Balance-Auswirkung).
  for (let i = 0; i < gameSpeedMultiplier && !gameOver; i++) update(dt);
  // Nachtrag (visuelle Aufwertung): Partikel/Schadenszahlen/Screen-Shake laufen mit dem ECHTEN
  // Frame-dt, NICHT mehrfach wie update() oben - sonst würden sie bei 5x/10x Spieltempo unlesbar
  // schnell durchrauschen, obwohl sie rein optisch sind und keine Spiellogik enthalten.
  updateEffects(dt);
  draw();
  // Gold-Anzeige jeden Frame aktualisieren, nicht nur bei diskreten Events — nötig, weil die
  // Zinsen-Tech (Wirtschaft T3) das Gold jetzt auch kontinuierlich zwischen den Events verändert.
  document.getElementById('spGoldVal').textContent = Math.floor(gold);
  if (!gameOver) requestAnimationFrame(loop);
}

function selectTowerObject(tower) {
  selectedTower = tower;
  updateTowerInfoPanel();
}

function deselectTower() {
  selectedTower = null;
  document.getElementById('spTowerInfo').style.display = 'none';
}

function updateTowerInfoPanel() {
  const panel = document.getElementById('spTowerInfo');
  if (!selectedTower) { panel.style.display = 'none'; return; }
  const t = selectedTower;
  const def = SP_TOWER_TYPES[t.type];
  const isAura = def.kind === 'aura';
  const maxed = t.tier >= TOWER_MAX_TIER;
  const footprintTag = (t.footprint || 1) > 1 ? `, ${t.footprint}×${t.footprint} Felder` : '';
  document.getElementById('spTiTitle').textContent = `${def.name} (Feld ${t.c},${t.r}${footprintTag})`;
  document.getElementById('spTiLevel').textContent = `${t.tier} / ${TOWER_MAX_TIER}`;
  // Nachtrag (Aura-Türme: Frost-Aura + Booster-Turm): keine Feuerrate/Ziel-Priorität - Auren feuern
  // nie und wählen kein Einzelziel, sie wirken kontinuierlich auf alles im Radius. Reichweiten-Zeile
  // bleibt für beide Turmarten (zeigt bei Auren den Wirkungsradius statt der Angriffsreichweite).
  document.getElementById('spTiFireRateRow').style.display = isAura ? 'none' : 'flex';
  document.getElementById('spTiRangeRow').style.display = 'flex';
  document.getElementById('spTiPriorityRow').style.display = isAura ? 'none' : 'flex';
  if (isAura && t.type === 'frost') {
    document.getElementById('spTiDamageLabel').textContent = 'Effekt';
    document.getElementById('spTiDamage').textContent = '-50% Tempo (Aura, alle Gegner im Radius)';
  } else if (isAura && t.type === 'booster') {
    document.getElementById('spTiDamageLabel').textContent = 'Effekt';
    document.getElementById('spTiDamage').textContent = `+${Math.round(boosterDamageBuff(t.tier) * 100)}% Schaden, +${Math.round(boosterFireRateBuff(t.tier) * 100)}% Feuerrate (Türme im Radius)`;
  } else {
    document.getElementById('spTiDamageLabel').textContent = 'Schaden';
    document.getElementById('spTiDamage').textContent = spEffectiveDamage(t).toFixed(1);
    document.getElementById('spTiFireRate').textContent = (1000 / spEffectiveFireRate(t)).toFixed(2) + '/s';
    document.getElementById('spPrioFirstBtn').classList.toggle('sp-active', t.priority !== 'hp');
    document.getElementById('spPrioHpBtn').classList.toggle('sp-active', t.priority === 'hp');
  }
  // Nachtrag (Teil 8, "Spiel doppelt so groß"): Anzeige durch VSCALE geteilt, damit die "px"-Zahl im
  // Info-Panel unverändert bleibt (bezieht sich weiterhin auf das ursprüngliche CELL=40-Bezugssystem)
  // - die tatsächliche Feld-Abdeckung ist exakt dieselbe wie vor Teil 8, nur optisch größer gezeichnet.
  document.getElementById('spTiRange').textContent = Math.round(spEffectiveRange(t) / VSCALE) + ' px' + (t.baseSplash ? ` (AoE ${Math.round(effectiveSplash(t) / VSCALE)}px)` : '') + (t.type === 'tesla' ? ` (Kette ×${teslaChainJumps(t.tier)})` : '');
  const upgradeBtn = document.getElementById('spTiUpgradeBtn');
  if (maxed) {
    upgradeBtn.textContent = 'Max. Tier erreicht';
    upgradeBtn.disabled = true;
  } else {
    const cost = spTierUpgradeCost(t.type, t.tier + 1);
    upgradeBtn.textContent = `Upgrade (${cost} Gold)`;
    upgradeBtn.disabled = gold < cost;
  }
  panel.style.display = 'block';
}

function setSelectedTowerPriority(priority) {
  if (!selectedTower) return;
  selectedTower.priority = priority;
  updateTowerInfoPanel();
}

function upgradeSelectedTower() {
  if (!selectedTower) return;
  const t = selectedTower;
  if (t.tier >= TOWER_MAX_TIER) return;
  const cost = spTierUpgradeCost(t.type, t.tier + 1);
  if (gold < cost) { setMessage('Nicht genug Gold für Upgrade.'); return; }
  gold -= cost;
  t.tier++;
  setMessage(`${SP_TOWER_TYPES[t.type].name} auf Tier ${t.tier} verbessert.`);
  updateTowerInfoPanel();
  updateStats();
}

function sellSelectedTower() {
  if (!selectedTower) return;
  const refund = Math.floor(selectedTower.cost * 0.6);
  gold += refund;
  towers = towers.filter(t => t !== selectedTower);
  setMessage(`Turm verkauft für ${refund} Gold.`);
  deselectTower();
  updateStats();
}

function showWaveSummary() {
  // Wirtschaft T1 gibt seit dem Minen-Entfernungs-Nachtrag einen pauschalen Kill-Gold-Bonus
  // (siehe damageEnemy()), betrifft das Welleneinkommen hier also nicht direkt.
  // T4 (Perfekte Welle: +50%, falls seit Wellenstart kein Leben verloren ging) - Port der
  // Multiplayer-Tech-Tree-Stufe 4, siehe balance-singleplayer.js und docs/balancing.md.
  let income = waveIncome(wave);
  const perfectWave = hasSpTech('economy', 4) && lives >= livesAtWaveStart;
  if (perfectWave) income *= (1 + SP_PERFECT_WAVE_BONUS_TIER4);
  income = Math.round(income);
  // Wirtschaft T3 "Zinsen" (Nachtrag/Balance-Fix): war kontinuierlich +1%/s, jetzt stattdessen eine
  // einmalige Zusatzrate hier bei Wellenabschluss, addiert auf den normalen Zinssatz und mit
  // demselben INTEREST_CAP gedeckelt (siehe SP_INTEREST_RATE_BONUS_TIER3_PER_WAVE in
  // balance-singleplayer.js für die volle Begründung).
  const interestRate = INTEREST_RATE + (hasSpTech('economy', 3) ? SP_INTEREST_RATE_BONUS_TIER3_PER_WAVE : 0);
  const interest = Math.min(Math.floor(gold * interestRate), INTEREST_CAP);
  gold += income + interest;

  // Tech-Punkte: +1 pro besiegter Boss-Welle (Endlos-Modus-Entsprechung von "+1 Punkt pro
  // Boss-Kill" im Multiplayer - Boss-Wellen kommen hier alle 5 Wellen statt alle 90s).
  if (waveType(wave) === 'boss') { techPoints++; }

  updateStats();

  // Nachtrag (Popup-Entfernung): keine eigene Overlay-/Banner-Anzeige mehr - die Abrechnung laeuft
  // als ruhiger Fliesstext in #spWaveSub unter der Karte mit (waveSummaryText, wird in update() pro
  // Countdown-Tick um die Restsekunden ergaenzt), komplett ohne Klick oder Sichtblockade.
  const nextType = waveType(wave + 1);
  const nextLabel = { boss: '💀 Nächste Welle ist eine BOSS-Welle!', swarm: '🐝 Nächste Welle ist eine Schwarm-Welle.', relief: '😮\u200d💨 Nächste Welle ist eine Verschnaufpause.', flying: '🦅 Nächste Welle ist eine Flieger-Welle - Tesla bereithalten!', normal: '' }[nextType];
  waveSummaryText = `Welle ${wave} geschafft! 🎉${perfectWave ? ' ✨' : ''} +${income} Gold, +${interest} Zinsen.${nextLabel ? ' ' + nextLabel : ''}`;
  document.getElementById('spWaveSub').textContent = waveSummaryText;
}

// pulseWaveBig(): aktualisiert die große Wellenzahl unter dem Spielfeld und spielt einen kurzen
// Hervorhebungs-Effekt ab (CSS-Animation spWavePulse, siehe <style>). Reflow-Trick (void
// el.offsetWidth) erzwingt einen Neustart der Animation, falls sie noch läuft (z.B. bei ganz
// kurzen Wellen direkt hintereinander).
function pulseWaveBig() {
  const el = document.getElementById('spWaveBig');
  document.getElementById('spWaveBigNum').textContent = wave;
  el.classList.remove('sp-wave-pulse');
  void el.offsetWidth;
  el.classList.add('sp-wave-pulse');
}

// advanceToNextWave(): startet die nächste Welle — automatisch, sobald der Countdown in update()
// abläuft. Seit dem Popup-Entfernungs-Nachtrag gibt es dafür keinen manuellen "Jetzt starten"-Klick
// mehr — siehe docs/balancing.md, Abschnitt "Automatischer Wellenstart" / "Popup-Entfernung".
function advanceToNextWave() {
  if (gameOver) return;
  autoNextPending = false;
  wave++;
  pulseWaveBig();
  updateStats();
  startWave();
}

function endGame() {
  gameOver = true;
  autoNextPending = false;
  document.getElementById('spWaveSub').textContent = '';
  document.getElementById('spOverlay').style.display = 'flex';
  document.getElementById('spOverlayTitle').textContent = '💀 Game Over';
  document.getElementById('spOverlayText').textContent = `Du hast Welle ${wave} erreicht.`;
  updateSkipBtnState();
}

function restartGame() {
  gold = 220; lives = 20; maxLives = 20; wave = 1;
  towers = []; enemies = []; projectiles = [];
  selectedTowerType = null; waveActive = false; gameOver = false; paused = false;
  autoNextPending = false; autoNextTimer = 0; waveSummaryText = '';
  spawnQueue = []; spawnTimer = 0;
  selectedTower = null;
  techPoints = 0; techPointsBought = 0; tech = { defense: 0, economy: 0, attack: 0 };
  shieldCharges = 0; shieldAccum = 0; lifeRegenAccum = 0; lifeGenAccum = 0; livesAtWaveStart = 20;
  document.getElementById('spOverlay').style.display = 'none';
  document.getElementById('spWaveSub').textContent = '';
  document.getElementById('spTowerInfo').style.display = 'none';
  const pauseBtn = document.getElementById('spPauseBtn');
  pauseBtn.textContent = '⏸ Pause';
  pauseBtn.title = 'Spiel pausieren';
  // Nachtrag (Spielgeschwindigkeit): nach einem Neustart wieder auf normales Tempo zurücksetzen,
  // inkl. der Button-Optik - sonst würde ein Neustart mitten in einem 10x-Lauf "unsichtbar" auf
  // hohem Tempo weiterlaufen.
  gameSpeedMultiplier = 1;
  document.querySelectorAll('#spSpeedRow .sp-speed-btn').forEach(b => b.classList.toggle('sp-speed-active', b.dataset.speed === '1'));
  pulseWaveBig();
  updateStats();
  requestAnimationFrame(loop);
  startWave(); // Popup-Entfernung: auch nach Neustart beginnt Welle 1 sofort automatisch, kein Klick nötig.
}

// ── Tech-Tree: Aufbau, Anzeige-Refresh, Freischalten, Punkte kaufen (Port aus dem Multiplayer,
// siehe buildPalette()/updateUIFromState()/unlockTech()/buyTechPoint() im ersten <script>-Block) ──
const spTechDiv = document.getElementById('spTechTree');
SP_TECH_BRANCHES.forEach(branch => {
  const wrap = document.createElement('div');
  wrap.className = 'tech-branch';
  let html = `<div class="tech-branch-title">${SP_TECH_LABELS[branch].name}</div>`;
  for (let tier = 1; tier <= SP_TECH_MAX_TIER; tier++) {
    html += `<div class="tech-node" id="sp-tech-${branch}-${tier}" onclick="unlockSpTech('${branch}')">
      <div class="tech-tier-badge">${tier}</div>
      <div class="tech-desc">${SP_TECH_LABELS[branch].tiers[tier - 1]}</div>
      <div class="tech-cost">${spTechPointCost(tier, branch)}P</div>
    </div>`;
  }
  wrap.innerHTML = html;
  spTechDiv.appendChild(wrap);
});

function updateSpTechUI() {
  document.getElementById('spTechPointsLabel').textContent = techPoints;
  const buyCost = spTechPointBuyCost(techPointsBought + 1);
  const buyBtn = document.getElementById('spBuyTechPointBtn');
  buyBtn.textContent = `+1 Tech-Punkt kaufen (${buyCost} Gold)`;
  buyBtn.disabled = gold < buyCost;

  SP_TECH_BRANCHES.forEach(branch => {
    const currentTier = tech[branch];
    for (let tier = 1; tier <= SP_TECH_MAX_TIER; tier++) {
      const node = document.getElementById(`sp-tech-${branch}-${tier}`);
      const cost = spTechPointCost(tier, branch);
      const unlocked = currentTier >= tier;
      const available = !unlocked && currentTier === tier - 1 && techPoints >= cost;
      node.classList.toggle('unlocked', unlocked);
      node.classList.toggle('available', available);
      node.classList.toggle('locked', !unlocked && !available);
      node.querySelector('.tech-tier-badge').textContent = unlocked ? '✓' : tier;
    }
  });
}

function unlockSpTech(branch) {
  if (gameOver) return;
  const nextTier = tech[branch] + 1;
  if (nextTier > SP_TECH_MAX_TIER) return;
  const cost = spTechPointCost(nextTier, branch);
  if (techPoints < cost) { setMessage('Nicht genug Tech-Punkte. Boss-Wellen besiegen oder Punkte mit Gold kaufen!'); return; }
  techPoints -= cost;
  tech[branch] = nextTier;
  // Verteidigung T4 "Bollwerk": Max-Leben (und aktuelle Leben) einmalig um 5 erhöhen, analog zum
  // Multiplayer-Bollwerk (siehe hostUnlockTech() im ersten <script>-Block).
  if (branch === 'defense' && nextTier === 4) { maxLives += SP_BOLLWERK_BONUS_LIVES; lives += SP_BOLLWERK_BONUS_LIVES; }
  setMessage(`${SP_TECH_LABELS[branch].name} Stufe ${nextTier} freigeschaltet.`);
  updateStats();
}

function buySpTechPoint() {
  if (gameOver) return;
  const cost = spTechPointBuyCost(techPointsBought + 1);
  if (gold < cost) { setMessage(`Nicht genug Gold für einen Tech-Punkt (${cost} Gold).`); return; }
  gold -= cost;
  techPointsBought++;
  techPoints++;
  updateStats();
}

updateStats();

let spStarted = false;
window.startSingleplayerMode = function() {
  if (spStarted) return;
  spStarted = true;
  requestAnimationFrame(loop);
  startWave(); // Popup-Entfernung: Welle 1 beginnt sofort automatisch, kein "Welle starten"-Klick mehr nötig.
};
window.setSelectedTowerPriority = setSelectedTowerPriority;
window.upgradeSelectedTower = upgradeSelectedTower;
window.sellSelectedTower = sellSelectedTower;
window.deselectTower = deselectTower;
window.restartGame = restartGame;
window.advanceToNextWave = advanceToNextWave;
window.sellAllTowers = sellAllTowers;
window.unlockSpTech = unlockSpTech;
window.buySpTechPoint = buySpTechPoint;

})();
