// Kern der Multiplayer-Engine: Netzwerk, Lobby, State, Client-Aktionen,
// Host-Autorität, Simulation, KI-Gegner und Rendering/UI. Diese Teile teilen
// sich intensiv veränderlichen Modul-State (state, roomCode, ws, myTech, ...)
// und wurden deshalb bewusst NICHT weiter in einzelne Dateien aufgesplittet
// (siehe [[qibatd-refactoring.md]] im Projektgedächtnis für die Begründung) -
// reine Verschiebung aus dem MP-Inline-<script>-Block, keine Verhaltensänderung.
import { CELL, LANE_COLS, LANE_ROWS, PATH_ROW, LANE_W, LANE_H, PATH_Y, VSCALE } from './mpConstants.js';
import { cellFromPixel, cellCenter, isBuildable } from './mpGrid.js';
import {
  sendIncomeBoost, canSend, hasTech, sendLimitFor, incomeRateBonusFor, unitSpeedMultFor,
  baseIncomeFor, mineIncomeMultFor, rangeMultFor, grossIncomeFor, interestIncomeFor, taxIncomeFor
} from './mpEconomy.js';
import {
  mpDrawSprExact, MP_TOWER_SPRITE_PREFIX, mpTowerSpriteStage,
  MP_UNIT_VISUAL_KIND, MP_SPR, mpDrawSpr, mpDrawWalkAnim, mpWalkAnimFrame, mpUpdateWalkAnim
} from './mpAssets.js';
import { initTabsPanel } from '../shared/tabsPanel.js';
import { openBuildWheel } from '../shared/buildWheel.js';

// UI-Layout (auf Nutzeranfrage: Bedienpanels rechts neben dem Spielfeld statt
// darunter, als Tabs statt gescrollter Liste - Variante C). Reine Optik/Interaktion,
// keine Spiellogik - siehe js/shared/tabsPanel.js. Wird einmal beim Laden verdrahtet;
// das ".controls"-Element ist zu diesem Zeitpunkt bereits im DOM (module-scripts
// laufen nach vollständigem HTML-Parse).
initTabsPanel('.controls');

// Nachtrag (Balance-Fix, auf Nutzeranfrage: "das springen soll einfach zum nächsten gegner gehen
// ohne reichweiten beschränkung"): der Kettenblitz sprang bisher nur zu fliegenden Zielen innerhalb
// einer festen Sprungreichweite (früher hier als TESLA_CHAIN_RANGE definiert) - Tesla wurde dadurch
// als zu schwach empfunden, sobald die Ziele nicht dicht genug beieinander standen. Springt jetzt
// uneingeschränkt zum jeweils NÄCHSTGELEGENEN noch nicht getroffenen fliegenden Ziel, egal wie weit
// entfernt (siehe moveProjectiles() unten) - die einzige verbleibende Grenze ist die Sprunganzahl
// (teslaChainJumps()) und dass jedes Ziel nur einmal pro Schuss getroffen wird.

// ── Map-Hintergrund für die Multiplayer-Lane ────────────────────────────
// Nachtrag (Steampunk-Wüsten-Redesign, auf Nutzeranfrage, 2026-08-04): löst das alte
// Kachel-Band-Layout (ground_r1c2/r2c1/r2c2, MP_BAND_GROUPS) ab. Statt mehrerer kleiner,
// wiederholter Terrain-Kacheln wird jetzt EIN einziges, durchgehendes Szenenbild
// (mp_lane_bg, siehe MP_ASSET_FILES in mpAssets.js) über die komplette Lane gezeichnet -
// beim Zuschnitt wurde die Schienen-Reihe im Bild gezielt auf PATH_ROW ausgerichtet (siehe
// drawLane() unten). Die alten Kachel-Assets/Helfer (mpDrawGroundTileBand, MP_BAND_GROUPS,
// MP_GROUND_TILE_SCALE, MP_GROUND_BAND_TILES, mpCellRandom) bleiben ungenutzt in mpAssets.js
// erhalten, falls das Terrain später doch wieder kachelbasiert werden soll.

// ── Rollen & Verbindung ──────────────────────────────────────────────────
let roomCode = null;
let myRole = null; // 'p1' (Host) oder 'p2' (Gast)
let isHost = false;
let state = null; // aktueller Spielzustand (Host: eigene Simulation; Gast: letzter empfangener Snapshot)
let dtGlobal = 16;
let lastTime = 0;
let hostShownEnded = false; // nur Host: verhindert wiederholtes Öffnen des End-Overlays
let countdownAccum = 0; // nur Host: Zähler für die Countdown-Sekunden
let nextEntityId = 1; // nur Host: eindeutige IDs für Einheiten/Projektile (für Interpolation beim Gast)
let prevState = null, prevStateTime = 0, stateTime = 0; // nur Gast: für flüssige Zwischenschritt-Animation

// KI ersetzt Spieler 2 (kein echter Gast, kein Netzwerk nötig) - siehe Abschnitt "KI-Gegner" unten.
let aiMode = false;
let aiDifficulty = null; // 'beginner' | 'challenger' | 'worldender'
let aiDecisionAccum = 0, aiSendAccum = 0;

// WICHTIG: Trage hier die Adresse deines Multiplayer-Servers ein (siehe Deployment-Anleitung).
// Solange die Domain noch nicht läuft, kannst du hier auch die onrender.com-Adresse eintragen.
// Verbindet sich automatisch mit dem Server, der diese Seite ausliefert.
// Falls du die Datei separat hostest (z.B. itch.io) und den Server woanders
// laufen lässt, hier stattdessen die feste Adresse eintragen, z.B.:
// const WS_SERVER_URL = 'wss://td-multiplayer-xxxx.onrender.com';
const WS_SERVER_URL = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;

let ws = null;
let roomsPollTimer = null;

// Verbindung wird erst aufgebaut, sobald der Multiplayer-Modus tatsächlich gewählt wird
// (nicht schon beim reinen Seitenaufruf, falls jemand nur den Singleplayer spielen will).
function connectMultiplayer() {
  if (ws) return; // schon verbunden
  ws = new WebSocket(WS_SERVER_URL);
  ws.addEventListener('open', () => {
    setLobbyMsg('Verbunden mit Server. Raum-Code eingeben und loslegen.');
    refreshRoomsList();
    roomsPollTimer = setInterval(refreshRoomsList, 2000);
  });
  ws.addEventListener('close', () => setLobbyMsg('Verbindung zum Server verloren. Seite neu laden.'));
  ws.addEventListener('message', (evt) => {
  let data;
  try { data = JSON.parse(evt.data); } catch (e) { return; }

  if (data.type === 'hosted') {
    stopRoomsPolling();
    enterGame();
    setMessage(`Raum "${roomCode}" erstellt. Teile den Code — sobald Spieler 2 beitritt und beide bereit sind, geht's los.`);
    requestAnimationFrame(hostLoop);
    setInterval(hostBroadcast, 70);
  } else if (data.type === 'join-failed') {
    setLobbyMsg(`Raum "${roomCode}" wurde noch nicht erstellt. Spieler 1 muss zuerst "Raum erstellen" klicken.`);
    roomCode = null;
  } else if (data.type === 'joined') {
    stopRoomsPolling();
    enterGame();
    setMessage('Verbunden! Beide auf "Bereit" klicken, um zu starten.');
    requestAnimationFrame(guestRenderLoop);
  } else if (data.type === 'guest-joined') {
    setConnStatus(true);
  } else if (data.type === 'opponent-left') {
    setConnStatus(false);
    setMessage('Der Gegner hat die Verbindung getrennt.');
  } else if (data.type === 'rooms-list') {
    renderRoomsList(data.rooms || []);
  } else if (data.type === 'state') {
    const wasEnded = state && state.phase === 'ended';
    prevState = state;
    prevStateTime = stateTime;
    state = data.payload;
    stateTime = performance.now();
    setConnStatus(true);
    if (state.phase === 'ended' && !wasEnded) showEndOverlay();
    if (state.phase !== 'ended') hideEndOverlay();
  } else if (data.type === 'action' && isHost) {
    applyHostAction(data.payload);
  }
  });
}

function freshState() {
  return {
    phase: 'ready', // 'ready' -> 'countdown' -> 'playing' -> 'ended'
    p1Ready: false, p2Ready: false, countdownValue: null,
    p1Gold: 100, p1Lives: 20, p2Gold: 100, p2Lives: 20,
    p1MaxLives: 20, p2MaxLives: 20,
    p1BonusIncome: 0, p2BonusIncome: 0, // wächst, wenn man Einheiten schickt
    p1UnitTiers: { sprinter: 0, guard: 0, brecher: 0, icecube: 0, titan: 0 },
    p2UnitTiers: { sprinter: 0, guard: 0, brecher: 0, icecube: 0, titan: 0 },
    p1SendTimes: [], p2SendTimes: [], // Zeitstempel für das Sende-Limit
    p1Structures: [], p2Structures: [],
    unitsOnLaneP1: [], unitsOnLaneP2: [],
    projP1: [], projP2: [],
    // Tech-Tree
    p1TechPoints: 0, p2TechPoints: 0,
    p1TechPointsBought: 0, p2TechPointsBought: 0, // wie viele Punkte in diesem Match schon mit Gold gekauft wurden (für die Fibonacci-Kostenkurve)
    p1Tech: { defense: 0, economy: 0, attack: 0 },
    p2Tech: { defense: 0, economy: 0, attack: 0 },
    p1UnitRegenAccum: 0, p2UnitRegenAccum: 0,
    p1ShieldCharges: 0, p2ShieldCharges: 0,
    p1ShieldAccum: 0, p2ShieldAccum: 0,
    // Boss-Intervalle (bedrohen beide Seiten gleichzeitig, unabhängig von den Spielern)
    bossTimer: BOSS_INTERVAL_MS, bossRound: 0,
    gameOver: false, winner: null,
  };
}
function selectMode(mode) {
  document.getElementById('modeSelect').style.display = 'none';
  if (mode === 'multiplayer') {
    document.getElementById('multiplayerMode').style.display = 'block';
    connectMultiplayer();
  } else if (mode === 'singleplayer') {
    document.getElementById('singleplayerMode').style.display = 'block';
    window.startSingleplayerMode();
  }
}

function confirmExit() {
  if (confirm('Wirklich beenden? Der aktuelle Spielstand geht verloren.')) {
    location.reload();
  }
}

function hostRoom() {
  const code = (document.getElementById('roomCodeInput').value || '').trim().toUpperCase();
  if (!code) { setLobbyMsg('Bitte einen Raum-Code eingeben.'); return; }
  roomCode = code; myRole = 'p1'; isHost = true;
  state = freshState();
  ws.send(JSON.stringify({ type: 'host', room: roomCode }));
}

function joinRoom() {
  const code = (document.getElementById('roomCodeInput').value || '').trim().toUpperCase();
  if (!code) { setLobbyMsg('Bitte einen Raum-Code eingeben.'); return; }
  roomCode = code; myRole = 'p2'; isHost = false;
  ws.send(JSON.stringify({ type: 'join', room: roomCode }));
}

function setLobbyMsg(msg) { document.getElementById('lobbyMsg').textContent = msg; }

function refreshRoomsList() {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'list-rooms' }));
}
function stopRoomsPolling() {
  if (roomsPollTimer) { clearInterval(roomsPollTimer); roomsPollTimer = null; }
}
function renderRoomsList(rooms) {
  const listEl = document.getElementById('openRoomsList');
  if (!rooms.length) { listEl.innerHTML = '<div class="rooms-empty">Gerade keine offenen Räume. Erstelle selbst einen!</div>'; return; }
  listEl.innerHTML = rooms.map(r => `
    <div class="room-row">
      <span class="room-code">${r.code}</span>
      <span class="room-players">${r.playerCount}/2 Spieler</span>
      <button onclick="joinRoomFromList('${r.code}')">Beitreten</button>
    </div>`).join('');
}
function joinRoomFromList(code) {
  document.getElementById('roomCodeInput').value = code;
  roomCode = code; myRole = 'p2'; isHost = false;
  ws.send(JSON.stringify({ type: 'join', room: code }));
}

function enterGame() {
  document.getElementById('lobby').style.display = 'none';
  document.getElementById('game').style.display = 'flex';
  document.getElementById('meLabel').textContent = isHost ? 'DU (Spieler 1)' : 'DU (Spieler 2)';
  document.getElementById('oppLabel').textContent = aiMode
    ? `GEGNER (KI – ${AI_PROFILES[aiDifficulty].label})`
    : (isHost ? 'GEGNER (Spieler 2)' : 'GEGNER (Spieler 1)');
  setConnStatus(aiMode);
  buildPalette();
  updateUIFromState();
}

// Kurzbeschreibung der Tier-50-Apex-Fähigkeiten für die Sende-Palette (siehe updateUIFromState()) -
// Text hier zentral halten statt in jeder Anzeigestelle einzeln zu wiederholen.
const APEX_INFO = {
  sprinter: 'immun ggü. Flächenschaden',
  guard: `heilt sich um ${Math.round(GUARD_APEX_HEAL_PCT_PER_SEC * 100)}% Max-HP/s`,
  brecher: 'zusätzlich immun ggü. Slow',
  icecube: 'nur vom Tesla-Turm anvisierbar',
};

// Icons fürs Bau-Wheel (die Bauen-Panel-Liste nutzt stattdessen einen Farb-Swatch,
// im runden Wheel ist ein Symbol pro Turmtyp aber besser erkennbar).
const MP_TOWER_WHEEL_ICON = {
  arrow: '🏹', cannon: '💣', frost: '❄️', tesla: '⚡', booster: '🔧', mine: '⛏️',
};

// ── Bau-Palette & Sende-Palette (UI) ─────────────────────────────────────
function buildPalette() {
  const buildDiv = document.getElementById('buildButtons');
  BUILD_ORDER.forEach(key => {
    const t = TOWER_TYPES[key];
    const row = document.createElement('div');
    row.className = 'build-row';
    const btn = document.createElement('button');
    btn.className = 'pick-btn'; btn.id = 'build-' + key;
    const sub = key === 'mine' ? '+6 Gold/s' : (key === 'tesla' ? `${t.damage} Dmg · nur Luft, Kette` : `${t.damage} Dmg`);
    const countLabel = key === 'mine' ? ` <span id="mine-count-label"></span>` : '';
    const targetIcons = key === 'mine' ? '' : ` ${towerTargetIconsHtml(t)}`; // Minen feuern nie, keine Ziel-Icons nötig
    btn.innerHTML = `<div class="swatch" style="background:${t.color}"></div>
      <div class="info"><div class="name">${t.name}${targetIcons}</div><div class="cost">${t.cost} Gold — ${sub}${countLabel}</div></div>`;
    btn.onclick = () => selectBuildType(key);
    row.appendChild(btn);

    const upgAllBtn = document.createElement('button');
    upgAllBtn.className = 'upgrade-all-btn'; upgAllBtn.id = 'upgrade-all-' + key;
    upgAllBtn.title = `Alle ${t.name}-Türme um eine Stufe upgraden (soweit Gold reicht)`;
    upgAllBtn.textContent = '⬆ Alle';
    upgAllBtn.onclick = () => upgradeAllOfType(key);
    row.appendChild(upgAllBtn);

    buildDiv.appendChild(row);
  });
  const sendDiv = document.getElementById('sendButtons');
  Object.entries(UNIT_TYPES).forEach(([key, u]) => {
    const block = document.createElement('div');
    block.className = 'unit-block'; block.id = 'unit-block-' + key;
    block.innerHTML = `
      <button class="send-btn" id="send-${key}">
        <div class="name">${u.name} — <span id="send-${key}-cost">${u.cost}</span> Gold</div>
        <div class="sub" id="send-${key}-sub"></div>
      </button>
      <div class="unit-upg-row">
        <span class="tier-label" id="unit-${key}-tier"></span>
        <button class="unit-upg-btn" id="unit-upg-${key}"></button>
      </div>`;
    block.querySelector('.send-btn').onclick = () => sendUnit(key);
    block.querySelector('.unit-upg-btn').onclick = () => upgradeUnit(key);
    if (u.requiresTech) block.classList.add('tech-locked-unit');
    sendDiv.appendChild(block);
  });

  const techDiv = document.getElementById('techTree');
  TECH_BRANCHES.forEach(branch => {
    const wrap = document.createElement('div');
    wrap.className = 'tech-branch';
    let html = `<div class="tech-branch-title">${TECH_LABELS[branch].name}</div>`;
    for (let tier = 1; tier <= TECH_MAX_TIER; tier++) {
      html += `<div class="tech-node" id="tech-${branch}-${tier}" onclick="unlockTech('${branch}')">
        <div class="tech-tier-badge">${tier}</div>
        <div class="tech-desc">${TECH_LABELS[branch].tiers[tier - 1]}</div>
        <div class="tech-cost">${techPointCost(tier)}P</div>
      </div>`;
    }
    wrap.innerHTML = html;
    techDiv.appendChild(wrap);
  });
}

let selectedBuildType = null;
let selectedStructure = null;

function selectBuildType(key) {
  const myGold = isHost ? state.p1Gold : state.p2Gold;
  if (myGold < TOWER_TYPES[key].cost) { setMessage(`Nicht genug Gold für ${TOWER_TYPES[key].name}.`); return; }
  if (key === 'mine') {
    const myStructs = isHost ? state.p1Structures : state.p2Structures;
    if (myStructs.filter(s => s.type === 'mine').length >= MINE_MAX_COUNT) { setMessage(`Minen-Limit erreicht (max. ${MINE_MAX_COUNT}).`); return; }
  }
  deselect();
  // Nachtrag (Bugfix, analog zu selectTower() im Endlos-Modus): nicht mehr abwählen, wenn derselbe
  // Typ erneut angeklickt wird - siehe Kommentar dort für die Begründung.
  selectedBuildType = key;
  document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('selected'));
  if (selectedBuildType) document.getElementById('build-' + selectedBuildType).classList.add('selected');
}

function setMessage(msg) { document.getElementById('message').textContent = msg; }

// Prüft Gold/Minen-Limit/Weg wie bisher und baut dann - gemeinsam genutzt vom alten
// Bauen-Panel-Flow (erst Typ auswählen, dann Feld anklicken) und vom neuen Bau-Wheel
// (Feld anklicken, dann Typ im Wheel wählen). Reine Extraktion, keine Verhaltensänderung
// am bisherigen Panel-Flow.
function tryBuildAt(key, c, r) {
  const myStructures = isHost ? state.p1Structures : state.p2Structures;
  if (!isBuildable(c, r)) { setMessage('Hier kann nichts gebaut werden (Weg).'); return; }
  if (key === 'mine' && myStructures.filter(s => s.type === 'mine').length >= MINE_MAX_COUNT) { setMessage(`Minen-Limit erreicht (max. ${MINE_MAX_COUNT}).`); return; }
  const type = TOWER_TYPES[key];
  const myGold = isHost ? state.p1Gold : state.p2Gold;
  if (myGold < type.cost) { setMessage('Nicht genug Gold.'); return; }
  if (isHost) { hostBuild(key, c, r); }
  else { queueAction({ type: 'build', buildType: key, c, r }); }
}

// ── Klick auf die eigene Spur ─────────────────────────────────────────
document.getElementById('myCanvas').addEventListener('click', (e) => {
  if (!state || state.phase !== 'playing') return;
  const canvas = e.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  const { c, r } = cellFromPixel(x, y);
  const myStructures = isHost ? state.p1Structures : state.p2Structures;
  const existing = myStructures.find(s => s.c === c && s.r === r);

  if (existing) {
    selectedBuildType = null;
    document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('selected'));
    selectStructure(existing);
    return;
  }
  if (selectedBuildType) {
    tryBuildAt(selectedBuildType, c, r);
    deselect();
    return;
  }
  // Kein Turmtyp im Panel vorgewählt: Bau-Wheel direkt am Klickpunkt öffnen
  // (auf Nutzeranfrage: "Man klickt auf ein Feld und bekommt ein Wheel mit den
  // Türmen zum Anklicken."). Nur auf bebaubaren Feldern, sonst wie bisher die
  // Weg-Meldung zeigen.
  if (!isBuildable(c, r)) { setMessage('Hier kann nichts gebaut werden (Weg).'); return; }
  const myGold = isHost ? state.p1Gold : state.p2Gold;
  const towers = BUILD_ORDER.map(key => {
    const t = TOWER_TYPES[key];
    const sub = key === 'mine' ? '+6 Gold/s' : (key === 'tesla' ? `${t.damage} Dmg · nur Luft, Kette` : `${t.damage} Dmg`);
    return { key, name: t.name, color: t.color, icon: MP_TOWER_WHEEL_ICON[key] || '⚙️', cost: t.cost, sub, locked: false, affordable: myGold >= t.cost };
  });
  openBuildWheel(e.clientX, e.clientY, towers).then(key => {
    if (key) tryBuildAt(key, c, r);
  });
});

// Doppelklick auf einen bestehenden Turm: direkt upgraden, ohne erst das Panel zu öffnen.
document.getElementById('myCanvas').addEventListener('dblclick', (e) => {
  if (!state || state.phase !== 'playing') return;
  const canvas = e.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  const { c, r } = cellFromPixel(x, y);
  const myStructures = isHost ? state.p1Structures : state.p2Structures;
  const existing = myStructures.find(s => s.c === c && s.r === r);
  if (existing) {
    selectedBuildType = null;
    document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('selected'));
    selectStructure(existing);
    upgradeSelected();
  }
});

function selectStructure(obj) { selectedStructure = obj; updateInfoPanel(); }
function deselect() { selectedStructure = null; document.getElementById('towerInfo').style.display = 'none'; }
function setSelectedPriority(p) {
  if (!selectedStructure) return;
  if (isHost) { selectedStructure.priority = p; }
  else { queueAction({ type: 'priority', c: selectedStructure.c, r: selectedStructure.r, priority: p }); selectedStructure.priority = p; }
  updateInfoPanel();
}
function upgradeSelected() {
  if (!selectedStructure) return;
  const cost = tierUpgradeCost(selectedStructure.tier + 1);
  const myGold = isHost ? state.p1Gold : state.p2Gold;
  if (myGold < cost) { setMessage('Nicht genug Gold für Upgrade.'); return; }
  if (isHost) { hostUpgrade(selectedStructure.c, selectedStructure.r); }
  else { queueAction({ type: 'upgrade', c: selectedStructure.c, r: selectedStructure.r }); }
}
function sellSelected() {
  if (!selectedStructure) return;
  if (isHost) { hostSell(selectedStructure.c, selectedStructure.r); }
  else { queueAction({ type: 'sell', c: selectedStructure.c, r: selectedStructure.r }); }
  deselect();
}
function sellAllTowers() {
  if (!state || state.phase !== 'playing') return;
  deselect();
  if (isHost) { hostSellAll(); }
  else { queueAction({ type: 'sellAll' }); }
}
function upgradeAllOfType(buildType) {
  if (!state || state.phase !== 'playing') return;
  if (isHost) { hostUpgradeAllOfType(buildType); }
  else { queueAction({ type: 'upgradeAllOfType', buildType }); }
}
let mySendTimes = []; // clientseitiger Spiegel des Sende-Limits, für sofortiges Feedback
function clientCanSend() {
  const now = Date.now();
  while (mySendTimes.length && now - mySendTimes[0] > SEND_LIMIT_WINDOW_MS) mySendTimes.shift();
  return mySendTimes.length < SEND_LIMIT_COUNT;
}
function sendUnit(key) {
  if (!state || state.phase !== 'playing') return;
  const u = UNIT_TYPES[key];
  const myGold = isHost ? state.p1Gold : state.p2Gold;
  const myTiers = isHost ? state.p1UnitTiers : state.p2UnitTiers;
  const cost = unitSendCost(key, myTiers[key]);
  if (myGold < cost) { setMessage(`Nicht genug Gold für ${u.name}.`); return; }
  if (!clientCanSend()) { setMessage(`Sende-Limit erreicht: max. ${SEND_LIMIT_COUNT} Einheiten pro ${SEND_LIMIT_WINDOW_MS/1000}s.`); return; }
  mySendTimes.push(Date.now());
  if (isHost) { hostSendUnit(key); }
  else { queueAction({ type: 'send', unitType: key }); }
  setMessage(`${u.name} geschickt!`);
}
function upgradeUnit(key) {
  if (!state || state.phase !== 'playing') return;
  const tiers = isHost ? state.p1UnitTiers : state.p2UnitTiers;
  if (tiers[key] >= UNIT_MAX_TIER) return;
  const cost = unitUpgradeCost(key, tiers[key] + 1);
  const myGold = isHost ? state.p1Gold : state.p2Gold;
  if (myGold < cost) { setMessage('Nicht genug Gold für Einheiten-Upgrade.'); return; }
  if (isHost) { hostUpgradeUnit(key); }
  else { queueAction({ type: 'upgradeUnit', unitType: key }); }
}

function unlockTech(branch) {
  if (!state || state.phase !== 'playing') return;
  const tech = isHost ? state.p1Tech : state.p2Tech;
  const points = isHost ? state.p1TechPoints : state.p2TechPoints;
  const nextTier = tech[branch] + 1;
  if (nextTier > TECH_MAX_TIER) return;
  const cost = techPointCost(nextTier);
  if (points < cost) { setMessage('Nicht genug Tech-Punkte. Bosse besiegen oder Punkte mit Gold kaufen!'); return; }
  if (isHost) { hostUnlockTech(branch); }
  else { queueAction({ type: 'unlockTech', branch }); }
}

function buyTechPoint() {
  if (!state || state.phase !== 'playing') return;
  const bought = isHost ? state.p1TechPointsBought : state.p2TechPointsBought;
  const cost = techPointBuyCost(bought + 1);
  const myGold = isHost ? state.p1Gold : state.p2Gold;
  if (myGold < cost) { setMessage(`Nicht genug Gold für einen Tech-Punkt (${cost} Gold).`); return; }
  if (isHost) { hostBuyTechPoint(); }
  else { queueAction({ type: 'buyTechPoint' }); }
}

let myReadyLocal = false;
function toggleReady() {
  if (!state || state.phase !== 'ready') return;
  myReadyLocal = !myReadyLocal;
  if (isHost) { hostSetReady(myReadyLocal); }
  else { queueAction({ type: 'ready', ready: myReadyLocal }); }
  updateReadyUI();
}
function requestRematch() {
  myReadyLocal = false;
  if (isHost) { hostRematch(); }
  else { queueAction({ type: 'rematch' }); }
}
function updateReadyUI() {
  const btn = document.getElementById('readyBtn');
  btn.textContent = myReadyLocal ? 'Bereit ✅ (klicken zum Zurücknehmen)' : 'Bereit ✅';
  btn.classList.toggle('active', myReadyLocal);
}

function queueAction(action) {
  ws.send(JSON.stringify({ type: 'action', payload: action }));
}

function updateInfoPanel() {
  const panel = document.getElementById('towerInfo');
  if (!selectedStructure || !state) { panel.style.display = 'none'; return; }
  const t = selectedStructure;
  const isMine = t.type === 'mine';
  const maxed = t.tier >= TOWER_MAX_TIER;
  document.getElementById('tiTitle').textContent = `${TOWER_TYPES[t.type].name} (Tier ${t.tier}/${TOWER_MAX_TIER})`;
  document.getElementById('tiPriority').style.display = isMine ? 'none' : 'flex';
  if (!isMine) {
    document.getElementById('prioFirstBtn').classList.toggle('active', t.priority !== 'hp');
    document.getElementById('prioHpBtn').classList.toggle('active', t.priority === 'hp');
  }
  const row1 = document.getElementById('tiRow1'), row2 = document.getElementById('tiRow2'), row3 = document.getElementById('tiRow3');
  if (isMine) {
    row1.innerHTML = `<span>Einkommen</span><span>+${mineIncome(t)} Gold/s</span>`;
    row2.innerHTML = ''; row3.innerHTML = '';
  } else {
    row1.innerHTML = `<span>Schaden</span><span>${effectiveDamage(t).toFixed(1)}</span>`;
    row2.innerHTML = `<span>Feuerrate</span><span>${(1000 / effectiveFireRate(t)).toFixed(2)}/s</span>`;
    row3.innerHTML = `<span>Reichweite</span><span>${Math.round(effectiveRange(t))}px${t.baseSplash ? ` (AoE ${Math.round(effectiveSplash(t))}px)` : ''}${t.type === 'tesla' ? ` (Kette ×${teslaChainJumps(t.tier)})` : ''}</span>`;
  }
  const upgradeBtn = document.getElementById('tiUpgradeBtn');
  if (maxed) { upgradeBtn.textContent = 'Max. Tier erreicht'; upgradeBtn.disabled = true; }
  else {
    const cost = tierUpgradeCost(t.tier + 1);
    const myGold = isHost ? state.p1Gold : state.p2Gold;
    upgradeBtn.textContent = `Upgrade (${cost} Gold)`;
    upgradeBtn.disabled = myGold < cost;
  }
  panel.style.display = 'block';
}

// ── Host: direkte Simulations-Operationen ────────────────────────────────
function newStructure(key, c, r) {
  const type = TOWER_TYPES[key];
  const { x: cx, y: cy } = cellCenter(c, r);
  const s = { c, r, x: cx, y: cy, type: key, cost: type.cost, tier: 0, cooldown: 0, color: type.color };
  if (key !== 'mine') {
    Object.assign(s, {
      baseDamage: type.damage, baseFireRate: type.fireRate, baseRange: type.range,
      baseSplash: type.splash || 0, projSpeed: type.projSpeed,
      slow: type.slow, slowDuration: type.slowDuration, priority: 'first',
      groundOnly: !!type.groundOnly, airOnly: !!type.airOnly,
    });
  }
  return s;
}
function hostBuild(key, c, r, forGuest) {
  const structs = forGuest ? state.p2Structures : state.p1Structures;
  if (structs.some(s => s.c === c && s.r === r) || !isBuildable(c, r)) return;
  if (key === 'mine' && structs.filter(s => s.type === 'mine').length >= MINE_MAX_COUNT) return; // Minen-Limit
  const type = TOWER_TYPES[key];
  if (forGuest) { if (state.p2Gold < type.cost) return; state.p2Gold -= type.cost; }
  else { if (state.p1Gold < type.cost) return; state.p1Gold -= type.cost; }
  structs.push(newStructure(key, c, r));
}
function hostUpgrade(c, r, forGuest) {
  const structs = forGuest ? state.p2Structures : state.p1Structures;
  const s = structs.find(x => x.c === c && x.r === r);
  if (!s || s.tier >= TOWER_MAX_TIER) return;
  const cost = tierUpgradeCost(s.tier + 1);
  if (forGuest) { if (state.p2Gold < cost) return; state.p2Gold -= cost; }
  else { if (state.p1Gold < cost) return; state.p1Gold -= cost; }
  s.tier++;
}
function hostSell(c, r, forGuest) {
  const structs = forGuest ? state.p2Structures : state.p1Structures;
  const s = structs.find(x => x.c === c && x.r === r);
  if (!s) return;
  const refund = Math.floor(s.cost * 0.6);
  if (forGuest) { state.p2Gold += refund; state.p2Structures = state.p2Structures.filter(x => x !== s); }
  else { state.p1Gold += refund; state.p1Structures = state.p1Structures.filter(x => x !== s); }
}
function hostSellAll(forGuest) {
  const structs = forGuest ? state.p2Structures : state.p1Structures;
  const refund = structs.reduce((sum, s) => sum + Math.floor(s.cost * 0.6), 0);
  if (forGuest) { state.p2Gold += refund; state.p2Structures = []; }
  else { state.p1Gold += refund; state.p1Structures = []; }
}
function hostUpgradeAllOfType(buildType, forGuest) {
  const structs = forGuest ? state.p2Structures : state.p1Structures;
  // Günstigste Upgrades zuerst (niedrigste aktuelle Stufe), damit das Gold möglichst
  // viele Türme dieses Typs anhebt statt nur einen einzelnen bis ans Limit zu pumpen.
  const candidates = structs.filter(s => s.type === buildType && s.tier < TOWER_MAX_TIER).sort((a, b) => a.tier - b.tier);
  for (const s of candidates) {
    const cost = tierUpgradeCost(s.tier + 1);
    const gold = forGuest ? state.p2Gold : state.p1Gold;
    if (gold < cost) break; // aufsteigend sortiert: wenn diese (günstigste) Stufe nicht mehr leistbar ist, sind es die teureren erst recht nicht
    if (forGuest) state.p2Gold -= cost; else state.p1Gold -= cost;
    s.tier++;
  }
}
function hostSetPriority(c, r, priority, forGuest) {
  const structs = forGuest ? state.p2Structures : state.p1Structures;
  const s = structs.find(x => x.c === c && x.r === r);
  if (s && s.type !== 'mine') s.priority = priority;
}
function hostSetReady(ready, forGuest) {
  if (state.phase !== 'ready') return;
  if (forGuest) state.p2Ready = ready; else state.p1Ready = ready;
}
function hostRematch() {
  const fresh = freshState();
  Object.assign(state, fresh);
  if (aiMode) { state.p2Ready = true; aiDecisionAccum = 0; aiSendAccum = 0; aiPanic = false; } // KI ist beim Rematch sofort wieder bereit
}
function hostUpgradeUnit(key, forGuest) {
  const tiers = forGuest ? state.p2UnitTiers : state.p1UnitTiers;
  if (tiers[key] >= UNIT_MAX_TIER) return;
  const cost = unitUpgradeCost(key, tiers[key] + 1);
  if (forGuest) { if (state.p2Gold < cost) return; state.p2Gold -= cost; }
  else { if (state.p1Gold < cost) return; state.p1Gold -= cost; }
  tiers[key]++;
}
function hostSendUnit(key, forGuest) {
  const u = UNIT_TYPES[key];
  const tech = forGuest ? state.p2Tech : state.p1Tech;
  if (u.requiresTech && tech[u.requiresTech.branch] < u.requiresTech.tier) return; // noch nicht freigeschaltet
  const tiers = forGuest ? state.p2UnitTiers : state.p1UnitTiers;
  const tier = tiers[key];
  const cost = unitSendCost(key, tier);
  const gold = forGuest ? state.p2Gold : state.p1Gold;
  if (gold < cost) return;
  const sendTimes = forGuest ? state.p2SendTimes : state.p1SendTimes;
  if (!canSend(sendTimes, sendLimitFor(tech))) return;
  const rate = (u.incomeBoostRate !== undefined ? u.incomeBoostRate : DEFAULT_INCOME_BOOST_RATE) + incomeRateBonusFor(tech);
  const hp = unitEffectiveHp(key, tier);
  const speed = u.speed * unitSpeedMultFor(tech);
  // cost wird auf der Einheit gespeichert (nicht neu aus dem aktuellen Tier berechnet), weil die
  // Kill-Belohnung (siehe damageUnit()/hostUpdate()) erst beim Tod der Einheit ausgezahlt wird -
  // zu dem Zeitpunkt könnte der sendende Spieler seinen Einheiten-Tier schon weiter hochgezogen
  // haben, dann wäre der Sende-Preis von damals nicht mehr rekonstruierbar.
  // `key` (Einheiten-Typ, z.B. 'brecher'/'sprinter'/'guard'/'icecube') wird ab jetzt mitgespeichert -
  // die Tier-50-Apex-Fähigkeiten (siehe UNIT_TYPES-Kommentar in balance-multiplayer.js) müssen zur
  // Laufzeit wissen, welchen Typ eine Einheit hat, nicht nur ihre Basiswerte.
  const unitObj = { id: nextEntityId++, key, hp, maxHp: hp, speed, radius: u.radius, color: u.color, flying: !!u.flying, tier, cost, x: 0, y: PATH_Y, slowUntil: 0 };
  sendTimes.push(Date.now());
  // Kein sofortiges Gold mehr für den Gegner beim Senden (war vorher Math.floor(cost/3), unabhängig
  // davon ob die Einheit je etwas bewirkt) - stattdessen bekommt jetzt der die Belohnung, der die
  // Einheit tatsächlich TÖTET (Kill-Bounty, siehe damageUnit()/hostUpdate()). Macht erfolgreiche
  // Verteidigung lohnend statt "jeder Angriff finanziert automatisch den Verteidiger mit".
  if (forGuest) {
    state.p2Gold -= cost;
    state.p2BonusIncome += sendIncomeBoost(cost, rate);
    state.unitsOnLaneP1.push(unitObj);
  } else {
    state.p1Gold -= cost;
    state.p1BonusIncome += sendIncomeBoost(cost, rate);
    state.unitsOnLaneP2.push(unitObj);
  }
}

// ── Host: Simulationsschritt (läuft nur beim Host) ──────────────────────
function fireTowers(structures, units, projectiles, rangeMult) {
  structures.forEach(t => {
    if (t.type === 'mine') return;
    t.cooldown -= dtGlobal;
    if (t.cooldown > 0) return;
    const effRange = effectiveRange(t) * (rangeMult || 1);
    let target = null, bestScore = -1;
    units.forEach(u => {
      if (t.groundOnly && u.flying) return; // Boden-Verteidigung kann Fliegende nicht anvisieren
      if (t.airOnly && !u.flying) return; // Tesla feuert nur auf Fliegende (Gegenstück zu groundOnly)
      // Apex-Fähigkeit Ice Cube bei Vollausbau (UNIT_MAX_TIER): nur noch vom Tesla-Turm anvisierbar, siehe
      // UNIT_TYPES-Kommentar in balance-multiplayer.js.
      if (u.key === 'icecube' && u.tier >= UNIT_MAX_TIER && t.type !== 'tesla') return;
      const d = Math.hypot(u.x - t.x, u.y - t.y);
      if (d > effRange) return;
      const score = t.priority === 'hp' ? u.hp : u.x;
      if (score > bestScore) { bestScore = score; target = u; }
    });
    if (target) {
      t.cooldown = effectiveFireRate(t);
      projectiles.push({
        id: nextEntityId++, x: t.x, y: t.y, target, speed: t.projSpeed, damage: effectiveDamage(t),
        color: t.color, splash: effectiveSplash(t), slow: t.slow, slowDuration: t.slowDuration,
        groundOnly: !!t.groundOnly,
        // Tesla-Kettenblitz: Anzahl der Sprünge nach Tower-Tier (siehe teslaChainJumps() in
        // balance-multiplayer.js), Auswertung beim Einschlag in moveProjectiles() unten.
        chainJumps: t.type === 'tesla' ? teslaChainJumps(t.tier) : 0,
      });
    }
  });
}
function moveUnits(units, onReachEnd) {
  const now = performance.now();
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    let speed = u.speed;
    // Apex-Fähigkeit Brecher bei Vollausbau (UNIT_MAX_TIER): zusätzlich zu Fliegenden auch slow-immun (siehe
    // UNIT_TYPES-Kommentar in balance-multiplayer.js).
    const slowImmune = u.flying || (u.key === 'brecher' && u.tier >= UNIT_MAX_TIER);
    if (!slowImmune && now < u.slowUntil) speed *= 0.5;
    // Apex-Fähigkeit Guard bei Vollausbau (UNIT_MAX_TIER): Selbstheilung GUARD_APEX_HEAL_PCT_PER_SEC (8%) der Max-HP
    // pro Sekunde, kontinuierlich (nicht erst am Wellenende o.ä.) - macht einen voll ausgebauten
    // Guard etwas robuster gegenüber Schaden, das ist hier bewusst die
    // Apex-Belohnung dieser Einheit (siehe docs/balancing.md für die Einordnung).
    if (u.key === 'guard' && u.tier >= UNIT_MAX_TIER && u.hp < u.maxHp) {
      u.hp = Math.min(u.maxHp, u.hp + u.maxHp * GUARD_APEX_HEAL_PCT_PER_SEC * (dtGlobal / 1000));
    }
    u.x += speed * dtGlobal / 1000;
    if (u.x >= LANE_W) { units.splice(i, 1); onReachEnd(u); }
  }
}
// onUnitDeath(unit): wird für JEDEN Kill aufgerufen (Bosse und normale Einheiten), nicht nur für
// Bosse - der Aufrufer (siehe hostUpdate()) entscheidet dort, ob Tech-Punkt (Boss) oder Kill-Bounty
// (normale Einheit) fällig ist.
function damageUnit(u, dmg, units, onUnitDeath) {
  u.hp -= dmg;
  if (u.hp <= 0) {
    const idx = units.indexOf(u);
    if (idx >= 0) units.splice(idx, 1);
    if (onUnitDeath) onUnitDeath(u);
  }
}
function moveProjectiles(projectiles, units, onUnitDeath) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    if (!units.includes(p.target)) { projectiles.splice(i, 1); continue; }
    const dx = p.target.x - p.x, dy = p.target.y - p.y;
    const dist = Math.hypot(dx, dy);
    const step = p.speed * dtGlobal / 1000;
    if (dist < step + 5) {
      if (p.splash) {
        units.slice().forEach(u => {
          if (p.groundOnly && u.flying) return;
          // Apex-Fähigkeit Sprinter bei Vollausbau (UNIT_MAX_TIER): immun gegen Flächenschaden. Kanonen-Schaden läuft in
          // diesem Code ausschließlich über diesen Splash-Zweig (auch beim direkten Treffer, siehe
          // Radius-Check unten mit Distanz 0 zum Ziel selbst) - ein Tier-50-Sprinter wird von Kanonen
          // dadurch komplett ignoriert, wie angefragt ("kann kein Area-Damage mehr bekommen").
          if (u.key === 'sprinter' && u.tier >= UNIT_MAX_TIER) return;
          if (Math.hypot(u.x - p.target.x, u.y - p.target.y) <= p.splash) damageUnit(u, p.damage, units, onUnitDeath);
        });
      } else if (p.chainJumps) {
        // Tesla-Kettenblitz: erster Treffer beim Primärziel, danach springt der Schaden vom jeweils
        // zuletzt getroffenen Ziel zum nächstgelegenen noch nicht getroffenen FLIEGENDEN Ziel weiter -
        // OHNE Reichweiten-Begrenzung (Nachtrag, auf Nutzeranfrage) -, bis entweder kein weiteres
        // ungetroffenes fliegendes Ziel mehr existiert oder p.chainJumps Sprünge verbraucht sind.
        // `hit` verhindert Mehrfachtreffer desselben Ziels.
        const hit = new Set();
        let current = p.target;
        damageUnit(current, p.damage, units, onUnitDeath);
        hit.add(current);
        for (let hop = 0; hop < p.chainJumps; hop++) {
          let next = null, bestDist = Infinity;
          units.forEach(u => {
            if (hit.has(u) || !u.flying) return;
            const d = Math.abs(u.x - current.x); // gemeinsame Lane (feste y), x-Abstand reicht
            if (d < bestDist) { bestDist = d; next = u; }
          });
          if (!next) break;
          hit.add(next);
          damageUnit(next, p.damage, units, onUnitDeath);
          current = next;
        }
      } else {
        damageUnit(p.target, p.damage, units, onUnitDeath);
        if (p.slow && !p.target.flying) p.target.slowUntil = performance.now() + p.slowDuration;
      }
      projectiles.splice(i, 1);
    } else { p.x += (dx / dist) * step; p.y += (dy / dist) * step; }
  }
}

function tickBossSpawn(dt) {
  state.bossTimer -= dt;
  if (state.bossTimer <= 0) {
    state.bossRound++;
    state.bossTimer = BOSS_INTERVAL_MS;
    const hp = Math.round(BOSS_BASE_HP * Math.pow(BOSS_HP_GROWTH, state.bossRound - 1) * 1.3);
    const bossIndex = Math.min(10, state.bossRound); // Levels 1-10, dann bleibt es bei 10
    const mk = () => ({ id: nextEntityId++, hp, maxHp: hp, speed: BOSS_SPEED, radius: BOSS_RADIUS, color: '#e63946', flying: false, isBoss: true, bossIndex, x: 0, y: PATH_Y, slowUntil: 0 });
    state.unitsOnLaneP1.push(mk());
    state.unitsOnLaneP2.push(mk());
  }
}
function tickPlayerTimers(dt) {
  // Defense-Tier-1: die eigenen gesendeten Einheiten regenerieren HP auf der gegnerischen Lane.
  // p1 sendet nach unitsOnLaneP2, p2 sendet nach unitsOnLaneP1 (siehe hostSendUnit) — Bosse
  // (isBoss) sind neutral und gehören keinem Spieler, die schließt der Filter aus.
  if (hasTech(state.p1Tech, 'defense', 1)) {
    state.p1UnitRegenAccum += dt;
    if (state.p1UnitRegenAccum >= UNIT_REGEN_INTERVAL_MS) {
      state.p1UnitRegenAccum -= UNIT_REGEN_INTERVAL_MS;
      state.unitsOnLaneP2.forEach(u => { if (!u.isBoss) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * UNIT_REGEN_PCT); });
    }
  }
  if (hasTech(state.p2Tech, 'defense', 1)) {
    state.p2UnitRegenAccum += dt;
    if (state.p2UnitRegenAccum >= UNIT_REGEN_INTERVAL_MS) {
      state.p2UnitRegenAccum -= UNIT_REGEN_INTERVAL_MS;
      state.unitsOnLaneP1.forEach(u => { if (!u.isBoss) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * UNIT_REGEN_PCT); });
    }
  }
  if (hasTech(state.p1Tech, 'defense', 2)) {
    state.p1ShieldAccum += dt;
    if (state.p1ShieldAccum >= 90000 && state.p1ShieldCharges < 3) { state.p1ShieldAccum -= 90000; state.p1ShieldCharges = 3; }
  }
  if (hasTech(state.p2Tech, 'defense', 2)) {
    state.p2ShieldAccum += dt;
    if (state.p2ShieldAccum >= 90000 && state.p2ShieldCharges < 3) { state.p2ShieldAccum -= 90000; state.p2ShieldCharges = 3; }
  }
}

function hostUpdate(dt) {
  dtGlobal = dt;

  if (state.phase === 'ready') {
    if (state.p1Ready && state.p2Ready) {
      state.phase = 'countdown';
      state.countdownValue = 3;
      countdownAccum = 0;
    }
    return;
  }
  if (state.phase === 'countdown') {
    countdownAccum += dt;
    if (countdownAccum >= 1000) {
      countdownAccum -= 1000;
      state.countdownValue--;
      if (state.countdownValue <= 0) state.phase = 'playing';
    }
    return;
  }
  if (state.phase === 'ended') return;

  // phase === 'playing'
  // Brutto zuerst (ohne Zinsen/Steuern), dann Steuer aus dem GEGNER-Brutto ableiten (nicht aus
  // dessen Gesamteinkommen inkl. eigener Steuer) - vermeidet Zirkularität, wenn beide Steuer-Tech haben.
  const p1Gross = grossIncomeFor(state.p1Tech, state.p1Structures, state.p1BonusIncome);
  const p2Gross = grossIncomeFor(state.p2Tech, state.p2Structures, state.p2BonusIncome);
  const p1Income = p1Gross + interestIncomeFor(state.p1Tech, state.p1Gold) + taxIncomeFor(state.p1Tech, p2Gross);
  const p2Income = p2Gross + interestIncomeFor(state.p2Tech, state.p2Gold) + taxIncomeFor(state.p2Tech, p1Gross);
  state.p1Gold += p1Income * dt / 1000;
  state.p2Gold += p2Income * dt / 1000;

  tickBossSpawn(dt);
  tickPlayerTimers(dt);
  if (aiMode) aiTick(dt);

  // Einheiten, die durchkommen, verlieren dem Ziel ein Leben - überleben aber (außer Bosse) und
  // laufen sofort in die jeweils andere Spur weiter (mit ihren aktuellen HP), bis sie sterben.
  moveUnits(state.unitsOnLaneP1, (u) => {
    if (state.p1ShieldCharges > 0) {
      state.p1ShieldCharges--;
      if (!u.isBoss) { u.x = 0; u.y = PATH_Y; u.slowUntil = 0; state.unitsOnLaneP2.push(u); }
      return;
    }
    if (u.isBoss) {
      state.p1Lives -= BOSS_LEAK_LIVES;
      if (state.p1Lives <= 0) hostEndGame('p2');
      return;
    }
    state.p1Lives--;
    if (state.p1Lives <= 0) { hostEndGame('p2'); return; }
    if (hasTech(state.p2Tech, 'attack', 1)) state.p2Lives = Math.min(state.p2MaxLives, state.p2Lives + 1);
    u.x = 0; u.y = PATH_Y; u.slowUntil = 0;
    state.unitsOnLaneP2.push(u);
  });
  moveUnits(state.unitsOnLaneP2, (u) => {
    if (state.p2ShieldCharges > 0) {
      state.p2ShieldCharges--;
      if (!u.isBoss) { u.x = 0; u.y = PATH_Y; u.slowUntil = 0; state.unitsOnLaneP1.push(u); }
      return;
    }
    if (u.isBoss) {
      state.p2Lives -= BOSS_LEAK_LIVES;
      if (state.p2Lives <= 0) hostEndGame('p1');
      return;
    }
    state.p2Lives--;
    if (state.p2Lives <= 0) { hostEndGame('p1'); return; }
    if (hasTech(state.p1Tech, 'attack', 1)) state.p1Lives = Math.min(state.p1MaxLives, state.p1Lives + 1);
    u.x = 0; u.y = PATH_Y; u.slowUntil = 0;
    state.unitsOnLaneP1.push(u);
  });
  fireTowers(state.p1Structures, state.unitsOnLaneP1, state.projP1, rangeMultFor(state.p1Tech));
  fireTowers(state.p2Structures, state.unitsOnLaneP2, state.projP2, rangeMultFor(state.p2Tech));
  // Kill-Bounty: wer die Einheit tötet, bekommt das Gold (floor(gespeicherter Sende-Preis / 3),
  // wie vorher beim automatischen Sende-Bonus) - Bosse geben stattdessen weiterhin einen Tech-Punkt.
  moveProjectiles(state.projP1, state.unitsOnLaneP1, (u) => {
    if (u.isBoss) state.p1TechPoints++;
    else state.p1Gold += Math.floor((u.cost || 0) / 3);
  });
  moveProjectiles(state.projP2, state.unitsOnLaneP2, (u) => {
    if (u.isBoss) state.p2TechPoints++;
    else state.p2Gold += Math.floor((u.cost || 0) / 3);
  });
}
function hostEndGame(winner) { state.gameOver = true; state.winner = winner; state.phase = 'ended'; }

function hostLoop(ts) {
  const dt = ts - lastTime; lastTime = ts;
  if (state) {
    hostUpdate(dt); draw(); updateUIFromState();
    if (state.phase === 'ended' && !hostShownEnded) { hostShownEnded = true; showEndOverlay(); }
    if (state.phase !== 'ended' && hostShownEnded) { hostShownEnded = false; hideEndOverlay(); }
  }
  requestAnimationFrame(hostLoop);
}
function hostBroadcast() {
  if (!state || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'state', payload: state }));
}
function applyHostAction(a) {
  if (a.type === 'build') hostBuild(a.buildType, a.c, a.r, true);
  else if (a.type === 'upgrade') hostUpgrade(a.c, a.r, true);
  else if (a.type === 'sell') hostSell(a.c, a.r, true);
  else if (a.type === 'sellAll') hostSellAll(true);
  else if (a.type === 'upgradeAllOfType') hostUpgradeAllOfType(a.buildType, true);
  else if (a.type === 'priority') hostSetPriority(a.c, a.r, a.priority, true);
  else if (a.type === 'send') hostSendUnit(a.unitType, true);
  else if (a.type === 'upgradeUnit') hostUpgradeUnit(a.unitType, true);
  else if (a.type === 'ready') hostSetReady(a.ready, true);
  else if (a.type === 'rematch') hostRematch();
  else if (a.type === 'unlockTech') hostUnlockTech(a.branch, true);
  else if (a.type === 'buyTechPoint') hostBuyTechPoint(true);
}

function hostBuyTechPoint(forGuest) {
  const bought = forGuest ? state.p2TechPointsBought : state.p1TechPointsBought;
  const cost = techPointBuyCost(bought + 1);
  const gold = forGuest ? state.p2Gold : state.p1Gold;
  if (gold < cost) return;
  if (forGuest) { state.p2Gold -= cost; state.p2TechPoints++; state.p2TechPointsBought++; }
  else { state.p1Gold -= cost; state.p1TechPoints++; state.p1TechPointsBought++; }
}

function hostUnlockTech(branch, forGuest) {
  const tech = forGuest ? state.p2Tech : state.p1Tech;
  const points = forGuest ? state.p2TechPoints : state.p1TechPoints;
  const nextTier = tech[branch] + 1;
  if (nextTier > TECH_MAX_TIER) return;
  const cost = techPointCost(nextTier);
  if (points < cost) return;
  if (forGuest) state.p2TechPoints -= cost; else state.p1TechPoints -= cost;
  tech[branch] = nextTier;
  // Einmalige Sofort-Effekte
  if (branch === 'defense' && nextTier === 4) {
    if (forGuest) { state.p2MaxLives += 5; state.p2Lives += 5; }
    else { state.p1MaxLives += 5; state.p1Lives += 5; }
  }
}

// ── KI-Gegner (ersetzt Spieler 2, läuft rein lokal beim Host, kein Netzwerk nötig) ──────────
// Ruft dieselben host*()-Funktionen mit forGuest=true auf, die auch ein echter Gast über die
// Aktions-Queue auslösen würde - die KI ist aus Sicht der Spiellogik einfach "Spieler 2".
// Zahlen/Parameter pro Schwierigkeitsgrad stehen in AI_PROFILES (js/balance-multiplayer.js),
// Begründung dort und in docs/balancing.md.

function startAiMatch(difficulty) {
  stopRoomsPolling();
  roomCode = null;
  myRole = 'p1'; isHost = true;
  aiMode = true; aiDifficulty = difficulty;
  aiDecisionAccum = 0; aiSendAccum = 0; aiPanic = false;
  state = freshState();
  hostSetReady(true, true); // KI ist immer sofort bereit, es muss nur der Mensch noch bestätigen
  enterGame();
  setMessage(`Match gegen KI (${AI_PROFILES[difficulty].label}) gestartet. Klick "Bereit ✅", um loszulegen.`);
  requestAnimationFrame(hostLoop);
  // Kein setInterval(hostBroadcast, ...) - es gibt keinen Gast, an den gesendet werden müsste,
  // und die KI braucht daher auch keine funktionierende Server-/WebSocket-Verbindung.
}

function aiProfile() { return AI_PROFILES[aiDifficulty]; }

// Spalten-Reihenfolge, die früh über die ganze Spurbreite streut statt stur links anzufangen
// (bessere Feld-Abdeckung schon mit wenigen Türmen) - simple Bisektion von [0, n-1].
function spreadOrder(n) {
  const order = [];
  const queue = [[0, n - 1]];
  while (queue.length) {
    const [lo, hi] = queue.shift();
    if (lo > hi) continue;
    const mid = Math.floor((lo + hi) / 2);
    order.push(mid);
    queue.push([lo, mid - 1], [mid + 1, hi]);
  }
  return order;
}
const AI_COL_ORDER = spreadOrder(LANE_COLS);
const AI_ROW_ORDER = [1, 3, 0]; // Reihen direkt am Pfad zuerst (mehr Feuerüberlappung), äußere Reihe zuletzt

function aiFindBuildSpot() {
  for (const r of AI_ROW_ORDER) {
    for (const c of AI_COL_ORDER) {
      if (!isBuildable(c, r)) continue;
      if (state.p2Structures.some(s => s.c === c && s.r === r)) continue;
      return { c, r };
    }
  }
  return null; // Feld voll
}

// Gewichtete Zufallsauswahl unter den Optionen, die filterFn erfüllen (i.d.R. "kann ich mir leisten").
function aiWeightedPick(weights, filterFn) {
  const entries = Object.keys(weights).filter(k => weights[k] > 0 && filterFn(k)).map(k => [k, weights[k]]);
  if (!entries.length) return null;
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * total;
  for (const [k, w] of entries) { roll -= w; if (roll <= 0) return k; }
  return entries[entries.length - 1][0];
}

// Nur Weltenender: reagiert auf den Anteil fliegender Einheiten, die der Spieler gerade schickt -
// Kanonen können Flieger nicht treffen, also bei viel Flieger-Anteil weniger Kanonen, mehr Frost/Pfeil.
function aiAdaptiveTowerWeights() {
  const incoming = state.unitsOnLaneP2;
  const flyingShare = incoming.length ? incoming.filter(u => u.flying).length / incoming.length : 0;
  const cannon = Math.max(0.05, 0.30 - flyingShare * 0.25);
  const frost = 0.30 + flyingShare * 0.10;
  const arrow = Math.max(0.1, 1 - cannon - frost);
  return { arrow, frost, cannon };
}

// Nur Weltenender: je stärker die gegnerische Verteidigung (mehr/höherstufige Türme), desto mehr
// auf robuste Einheiten setzen statt nur auf billige Masse.
function aiAdaptiveUnitWeights() {
  const oppTowers = state.p1Structures.filter(s => s.type !== 'mine');
  const avgTier = oppTowers.length ? oppTowers.reduce((s, t) => s + t.tier, 0) / oppTowers.length : 0;
  const strength = Math.min(1, (oppTowers.length / 12) * 0.5 + (avgTier / TOWER_MAX_TIER) * 0.5);
  const weights = {
    sprinter: Math.max(0.10, 0.35 - strength * 0.15),
    guard: 0.20,
    icecube: 0.20 + strength * 0.05,
    brecher: 0.15 + strength * 0.20,
  };
  if (state.p2Tech.attack >= 4) weights.titan = 0.10 + strength * 0.15; // Titan erst ab Angriffs-Tech-Tier 4 nutzbar
  return weights;
}

// Nur Weltenender: statt fester Reihenfolge den Zweig mit der aktuell niedrigsten Stufe wählen
// (balanciertes, nah-optimales Wachstum statt einseitiger Spezialisierung).
function aiPickTechBranch(tech) {
  const order = ['defense', 'economy', 'attack'];
  let best = null;
  order.forEach(b => { if (tech[b] < TECH_MAX_TIER && (!best || tech[b] < tech[best])) best = b; });
  return best;
}

function aiUpgradeCheapestTowers(budget) {
  if (budget <= 0) return;
  const candidates = state.p2Structures.filter(s => s.type !== 'mine' && s.tier < TOWER_MAX_TIER).sort((a, b) => a.tier - b.tier);
  let spent = 0;
  for (const s of candidates) {
    const cost = tierUpgradeCost(s.tier + 1);
    if (spent + cost > budget) continue; // aufsteigend sortiert, aber Kosten variieren pro Turm-Typ - weiterprobieren statt abbrechen
    if (state.p2Gold < cost) break;
    hostUpgrade(s.c, s.r, true);
    spent += cost;
  }
}

function aiUpgradeCheapestUnitTier(profile) {
  const keys = Object.keys(UNIT_TYPES).filter(k => {
    const u = UNIT_TYPES[k];
    return !u.requiresTech || state.p2Tech[u.requiresTech.branch] >= u.requiresTech.tier;
  });
  if (!keys.length) return;
  keys.sort((a, b) => state.p2UnitTiers[a] - state.p2UnitTiers[b]);
  const key = keys[0];
  if (state.p2UnitTiers[key] >= UNIT_MAX_TIER) return;
  const cost = unitUpgradeCost(key, state.p2UnitTiers[key] + 1);
  if (state.p2Gold - cost >= state.p2Gold * profile.reserveGoldRatio) hostUpgradeUnit(key, true);
}

// Akute Gefahr: gerade rollt ein Schwarm Einheiten im Anflug, den die aktuelle Turmzahl absehbar
// nicht bewältigt. Dann pausiert die KI Angriff/Tech-Käufe/Einheiten-Upgrades komplett und wirft
// ihr gesamtes Gold (Reserve ignoriert) in den Turmbau/-ausbau, bis minSafeTowers Türme stehen,
// statt stur weiter "maximal aggressiv" zu spielen.
//
// Bewusst NICHT mehr an "noch keine Türme" allein gekoppelt (frühere Version): das zwang die KI,
// direkt am Spielanfang erst eine Mindest-Verteidigung zu bauen, BEVOR sie überhaupt in Wirtschaft
// investieren durfte - und war damit spürbar langsamer/schwächer als gefordert ("am Anfang
// optimierte Balance aus Wirtschaft + Angriff, danach instant auf Defense"). Jetzt gilt: solange
// nichts anrollt, ist auch 0 Türme kein Notfall - die KI kann von Beginn an frei in Minen und
// Angriff investieren. Sobald aber Einheiten ankommen (vom Spieler geschickt ODER eigene, beim
// Gegner durchgekommene und zurückgelaufene Einheiten - siehe die moveUnits()-Loop-Mechanik: jede
// eigene Angriffs-Einheit, die der Spieler nicht abwehrt, greift danach die KI selbst an), schlägt
// der Notfallmodus SOFORT (nächster Entscheidungs-Tick) zu.
//
// Ebenfalls bewusst NICHT an "eigene Leben gesunken" gekoppelt: Boss-Wellen (alle 90s, treffen
// beide Seiten unabhängig vom Spielerverhalten) kosten planmäßig auch mal Leben - das deckt schon
// die normale, mit der Bossrunde wachsende Ziel-Turmzahl ab (siehe Balancing-Doc, "Boss-HP
// herleiten"). Würde jeder Boss-Treffer denselben Notfallmodus auslösen wie ein Spieler-Rush,
// würde die KI ihre Verteidigung künstlich auf minSafeTowers klein halten und nie zur vollen, für
// Bosse eigentlich ausreichenden Ausbaustufe kommen (realer Bug in einer früheren Version dieser
// Logik). state.p2MaxLives-basierter nearDeath-Wert bleibt nur als Rückfall für echte Lebensgefahr
// unabhängig von der Ursache erhalten, niedrig angesetzt.
//
// Mit Hysterese (aiPanic): ohne die würde die KI bei jedem kurzen Nachlassen des Schwarms sofort
// wieder auf volle Aggression umschalten und dann erneut einbrechen, sobald der Spieler weiter
// Druck macht - sie "flattert" zwischen Panik und voller Offensive, statt die Verteidigung wirklich
// zu stabilisieren.
let aiPanic = false;
function aiInEmergency(profile) {
  const towerCount = state.p2Structures.filter(s => s.type !== 'mine').length;
  const incomingPlayerUnits = state.unitsOnLaneP2.filter(u => !u.isBoss).length;

  const swarmed = incomingPlayerUnits > 0 && incomingPlayerUnits > towerCount * 2;
  const nearDeath = state.p2Lives <= state.p2MaxLives * profile.emergencyLivesRatio; // echter Rückfall, unabhängig von der Ursache
  if (swarmed || nearDeath) { aiPanic = true; return true; }

  // Hysterese: erst wieder raus, wenn der Ansturm klar abgeklungen ist (nicht schon beim ersten
  // Moment mit etwas weniger Druck).
  if (aiPanic && incomingPlayerUnits > towerCount) return true;
  aiPanic = false;
  return false;
}

// Kontinuierliches Bedrohungsmaß (0 = ganz sicher, 1 = voller Notfall) - reagiert wie aiInEmergency
// auf den tatsächlichen ankommenden Schwarm relativ zur eigenen Turmzahl, nicht auf Boss-
// Chipschaden und nicht schon auf "noch keine Türme" allein. Lässt die Offensive schon VOR dem
// harten Notfall sanft abklingen, statt erst abrupt zu bremsen und danach sofort wieder auf
// Vollgas zu schalten.
function aiThreatLevel(profile) {
  const incomingPlayerUnits = state.unitsOnLaneP2.filter(u => !u.isBoss).length;
  if (incomingPlayerUnits === 0) return 0;
  const towerCount = state.p2Structures.filter(s => s.type !== 'mine').length;
  if (towerCount === 0) return 1;
  return Math.max(0, Math.min(1, incomingPlayerUnits / (towerCount * 2)));
}

function aiDecide(profile) {
  const emergency = aiInEmergency(profile);
  // Bedrohungsmaß auch außerhalb des harten Notfalls: dämpft Reserve-Ausgaben für Tech/Wirtschaft
  // proportional, damit die KI schon vorsorglich vorsichtiger wird, bevor die Lage wirklich kippt,
  // statt bis zur letzten Sekunde unverändert aggressiv zu wirtschaften und dann hart umzuschalten.
  const threat = emergency ? 1 : aiThreatLevel(profile);

  // 1) Verfügbare Tech-Punkte einsetzen + 2) Tech-Punkt mit Gold kaufen - im Notfall pausiert,
  // damit kein Gold an der Verteidigung vorbeigeht.
  if (!emergency) {
    if (state.p2TechPoints > 0) {
      const branch = profile.adaptive ? aiPickTechBranch(state.p2Tech) : profile.techPriority.find(b => state.p2Tech[b] < TECH_MAX_TIER);
      if (branch) hostUnlockTech(branch, true);
    }
    const buyCost = techPointBuyCost(state.p2TechPointsBought + 1);
    if (state.p2Gold - buyCost >= profile.techBuyThresholdGold * (1 + threat * 2)) hostBuyTechPoint(true);
  }

  // 3) Wirtschaft: Minen bis Zielanzahl bauen - im Notfall ebenfalls pausiert (Türme statt Minen).
  const reserve = emergency ? 0 : state.p2Gold * profile.reserveGoldRatio * (1 - threat * 0.8);
  if (!emergency) {
    const mineCount = state.p2Structures.filter(s => s.type === 'mine').length;
    const targetMines = Math.min(MINE_MAX_COUNT, Math.round(profile.targetMinesBase + profile.targetMinesPerBossRound * state.bossRound));
    if (mineCount < targetMines && state.p2Gold - TOWER_TYPES.mine.cost >= reserve) {
      const spot = aiFindBuildSpot();
      if (spot) hostBuild('mine', spot.c, spot.r, true);
    }
  }

  // 4) Verteidigung: Türme bis Zielanzahl bauen, danach vorhandene upgraden. Im Notfall gilt NUR
  // minSafeTowers als Ziel (statt des vollen, mit der Bossrunde wachsenden Zielwerts) - im Notfall
  // zählt schnell eine kleine, erreichbare Anzahl Türme zu erreichen und die dann SOFORT hoch
  // aufzurüsten (echte DPS), statt endlos neue Tier-0-Türme zu bauen und nie zum Aufrüsten zu
  // kommen, weil das reguläre Ziel mit der Zeit immer weiter mitwächst.
  const towerCount = state.p2Structures.filter(s => s.type !== 'mine').length;
  const targetTowers = emergency
    ? profile.minSafeTowers
    : Math.round(profile.targetTowersBase + profile.targetTowersPerBossRound * state.bossRound);
  const towerWeights = profile.adaptive ? aiAdaptiveTowerWeights() : profile.towerWeights;
  if (towerCount < targetTowers) {
    const key = aiWeightedPick(towerWeights, k => state.p2Gold - TOWER_TYPES[k].cost >= reserve);
    if (key) {
      const spot = aiFindBuildSpot();
      if (spot) hostBuild(key, spot.c, spot.r, true);
    }
  } else {
    // Auch der Upgrade-Anteil steigt mit der Bedrohung, statt starr bei upgradeTowerShare zu bleiben.
    const share = Math.min(1, profile.upgradeTowerShare + threat * (1 - profile.upgradeTowerShare));
    const upgradeBudget = emergency ? state.p2Gold : Math.max(0, state.p2Gold - reserve) * share;
    aiUpgradeCheapestTowers(upgradeBudget);
  }

  // 5) Gelegentlich eigene Einheiten-Tiers hochziehen, statt immer nur neue Türme/Minen - im
  // Notfall pausiert (Gold bleibt für die eigene Verteidigung reserviert).
  if (!emergency && Math.random() < profile.unitUpgradeChance * (1 - threat)) aiUpgradeCheapestUnitTier(profile);
}

function aiConsiderSending(profile) {
  // Verteidigung geht vor Angriff, solange die eigene Basis akut gefährdet ist - "maximal
  // aggressiv" heißt "so aggressiv wie sicher möglich", nicht "sendet auch dann noch, wenn die
  // eigene Verteidigung gerade zusammenbricht".
  if (aiInEmergency(profile)) return;
  // Auch außerhalb des harten Notfalls: je näher die Leben an der Notfall-Schwelle sind, desto
  // weniger Einheiten pro Salve - sanftes Abbremsen statt "voll aggressiv bis zum Kollaps, dann
  // Vollbremsung". Ohne das würde die KI bei dauerhaftem Druck ständig zwischen Panik und voller
  // Offensive hin- und herspringen und dabei nie eine stabile Verteidigung aufbauen.
  const threat = aiThreatLevel(profile);
  const burst = Math.max(1, Math.round(profile.sendBurst * (1 - threat * 0.75)));
  const unitWeights = profile.adaptive ? aiAdaptiveUnitWeights() : profile.unitWeights;
  for (let i = 0; i < burst; i++) {
    if (!canSend(state.p2SendTimes, sendLimitFor(state.p2Tech))) break;
    const key = aiWeightedPick(unitWeights, k => {
      const u = UNIT_TYPES[k];
      if (u.requiresTech && state.p2Tech[u.requiresTech.branch] < u.requiresTech.tier) return false;
      return state.p2Gold >= unitSendCost(k, state.p2UnitTiers[k]);
    });
    if (!key) break;
    hostSendUnit(key, true);
  }
}

function aiTick(dt) {
  if (state.phase !== 'playing') return;
  const profile = aiProfile();
  aiDecisionAccum += dt;
  if (aiDecisionAccum >= profile.decisionIntervalMs) {
    aiDecisionAccum -= profile.decisionIntervalMs;
    aiDecide(profile);
  }
  aiSendAccum += dt;
  if (aiSendAccum >= profile.sendIntervalMs) {
    aiSendAccum -= profile.sendIntervalMs;
    aiConsiderSending(profile);
  }
}

// ── Gast: zeichnen + UI-Sync im eigenen Animationstakt (nicht bei jeder Netzwerknachricht) ──
function guestRenderLoop(ts) {
  const dt = ts - lastTime; lastTime = ts;
  draw();
  updateUIFromState();
  requestAnimationFrame(guestRenderLoop);
}

function setConnStatus(online) {
  const el = document.getElementById('connStatus');
  el.textContent = aiMode ? '🤖 KI aktiv' : (online ? '🟢 Gegner verbunden' : '⚪ Warte auf Gegner…');
  el.classList.toggle('online', online);
}

// ── UI-Aktualisierung & Zeichnen ─────────────────────────────────────────
let lastPhase = null;
let lastMyLives = null, lastOppLives = null;
function triggerFlash(id) {
  const el = document.getElementById(id);
  el.classList.remove('active');
  void el.offsetWidth; // Reflow erzwingen, damit die Animation bei schnellen Wiederholungen neu startet
  el.classList.add('active');
}
function updateUIFromState() {
  if (!state) return;

  // Phasenwechsel behandeln
  if (state.phase === 'ready' && lastPhase !== 'ready') { myReadyLocal = false; lastMyLives = null; lastOppLives = null; }
  lastPhase = state.phase;

  document.getElementById('readyScreen').style.display = state.phase === 'ready' ? 'block' : 'none';
  document.getElementById('countdownOverlay').style.display = state.phase === 'countdown' ? 'flex' : 'none';
  document.querySelector('.controls').style.display = state.phase === 'playing' ? 'flex' : 'none';
  document.querySelector('.lanes').style.display = state.phase === 'ready' ? 'none' : 'flex';

  if (state.phase === 'ready') {
    const myR = isHost ? state.p1Ready : state.p2Ready;
    const oppR = isHost ? state.p2Ready : state.p1Ready;
    const myTag = document.getElementById('myReadyTag'), oppTag = document.getElementById('oppReadyTag');
    myTag.textContent = myR ? 'bereit ✅' : 'nicht bereit'; myTag.classList.toggle('yes', myR);
    oppTag.textContent = oppR ? 'bereit ✅' : 'nicht bereit'; oppTag.classList.toggle('yes', oppR);
    updateReadyUI();
  }
  if (state.phase === 'countdown') {
    document.getElementById('countdownNum').textContent = Math.max(1, state.countdownValue);
  }
  if (state.phase !== 'playing') return; // Wirtschaft/Bau-UI erst während des Spiels aktualisieren

  const myGold = isHost ? state.p1Gold : state.p2Gold;
  const myLives = isHost ? state.p1Lives : state.p2Lives;
  const oppGold = isHost ? state.p2Gold : state.p1Gold;
  const oppLives = isHost ? state.p2Lives : state.p1Lives;

  if (lastMyLives !== null && myLives < lastMyLives) triggerFlash('myFlash');
  if (lastOppLives !== null && oppLives < lastOppLives) triggerFlash('oppFlash');
  lastMyLives = myLives; lastOppLives = oppLives;

  const myStructs = isHost ? state.p1Structures : state.p2Structures;
  const oppStructs = isHost ? state.p2Structures : state.p1Structures;
  const myBonus = isHost ? state.p1BonusIncome : state.p2BonusIncome;
  const oppBonus = isHost ? state.p2BonusIncome : state.p1BonusIncome;
  const myTiers = isHost ? state.p1UnitTiers : state.p2UnitTiers;
  const myTech = isHost ? state.p1Tech : state.p2Tech;
  const oppTech = isHost ? state.p2Tech : state.p1Tech;
  const myTechPoints = isHost ? state.p1TechPoints : state.p2TechPoints;
  const oppTechPoints = isHost ? state.p2TechPoints : state.p1TechPoints;
  const myShield = isHost ? state.p1ShieldCharges : state.p2ShieldCharges;

  document.getElementById('myGold').textContent = Math.floor(myGold);
  document.getElementById('myLives').textContent = myLives;
  document.getElementById('oppGold').textContent = Math.floor(oppGold);
  document.getElementById('oppLives').textContent = oppLives;
  // Anzeige spiegelt jetzt dieselbe Brutto+Zinsen+Steuer-Rechnung wie hostUpdate() (siehe dort für
  // die Begründung der Brutto/Netto-Trennung bei der Steuer).
  const myGrossDisp = grossIncomeFor(myTech, myStructs, myBonus);
  const oppGrossDisp = grossIncomeFor(oppTech, oppStructs, oppBonus);
  document.getElementById('myIncome').textContent = (myGrossDisp + interestIncomeFor(myTech, myGold) + taxIncomeFor(myTech, oppGrossDisp)).toFixed(1);
  document.getElementById('oppIncome').textContent = (oppGrossDisp + interestIncomeFor(oppTech, oppGold) + taxIncomeFor(oppTech, myGrossDisp)).toFixed(1);
  document.getElementById('myTechPoints').textContent = myTechPoints;
  document.getElementById('oppTechPoints').textContent = oppTechPoints;
  document.getElementById('techPointsLabel').textContent = myTechPoints;
  const myBought = isHost ? state.p1TechPointsBought : state.p2TechPointsBought;
  const buyCost = techPointBuyCost(myBought + 1);
  const buyBtn = document.getElementById('buyTechPointBtn');
  buyBtn.textContent = `+1 Tech-Punkt kaufen (${buyCost} Gold)`;
  buyBtn.disabled = myGold < buyCost;
  document.getElementById('myShieldIndicator').textContent = myShield > 0 ? '●'.repeat(myShield) : '—';
  document.getElementById('bossTimerVal').textContent = Math.max(0, Math.ceil(state.bossTimer / 1000));
  document.getElementById('bossRoundVal').textContent = state.bossRound;

  const myMineCount = myStructs.filter(s => s.type === 'mine').length;
  BUILD_ORDER.forEach(key => {
    const mineCapped = key === 'mine' && myMineCount >= MINE_MAX_COUNT;
    const buildBtn = document.getElementById('build-' + key);
    buildBtn.style.opacity = (mineCapped || myGold < TOWER_TYPES[key].cost) ? '0.5' : '1';
    buildBtn.disabled = mineCapped;
    const cheapestNext = myStructs.filter(s => s.type === key && s.tier < TOWER_MAX_TIER).sort((a, b) => a.tier - b.tier)[0];
    const upgAllBtn = document.getElementById('upgrade-all-' + key);
    upgAllBtn.disabled = !cheapestNext || myGold < tierUpgradeCost(cheapestNext.tier + 1);
  });
  document.getElementById('mine-count-label').textContent = `(${myMineCount}/${MINE_MAX_COUNT})`;
  document.getElementById('sellAllBtn').style.opacity = myStructs.length ? '1' : '0.5';
  document.getElementById('sellAllBtn').disabled = myStructs.length === 0;
  Object.keys(UNIT_TYPES).forEach(key => {
    const u = UNIT_TYPES[key];
    const block = document.getElementById('unit-block-' + key);
    if (u.requiresTech) {
      const unlocked = myTech[u.requiresTech.branch] >= u.requiresTech.tier;
      block.classList.toggle('tech-locked-unit', !unlocked);
      if (!unlocked) return; // Rest der Anzeige für diese Einheit überspringen, ist eh versteckt
    }
    const tier = myTiers[key];
    const hp = unitEffectiveHp(key, tier);
    const sendCost = unitSendCost(key, tier);
    const reward = Math.floor(sendCost / 3);
    const tag = u.flying ? ' · Fliegend, immun ggü. Slow, von Boden-Verteidigung nicht angreifbar' : '';
    // Apex-Fähigkeit (bei Vollausbau, UNIT_MAX_TIER) als Vorschau anzeigen (schon vor dem Erreichen,
    // damit erkennbar ist, worauf sich der volle Ausbau lohnt) - Wortlaut ändert sich, sobald
    // UNIT_MAX_TIER erreicht ist. Text dynamisch aus UNIT_MAX_TIER gebaut (Nachtrag Stern-
    // Kompression: war vorher hart "Tier 50" - stimmte nicht mehr, seit UNIT_MAX_TIER 50 → 10).
    const apexInfo = APEX_INFO[key];
    const apexTag = apexInfo ? (tier >= UNIT_MAX_TIER ? ` · ✨ Tier ${UNIT_MAX_TIER}: ${apexInfo}` : ` · ab Tier ${UNIT_MAX_TIER}: ${apexInfo}`) : '';
    document.getElementById('send-' + key).disabled = myGold < sendCost;
    document.getElementById('send-' + key + '-cost').textContent = sendCost;
    document.getElementById('send-' + key + '-sub').textContent = `${hp.toFixed(0)} HP, Gegner erhält +${reward} Gold${tag}${apexTag}`;
    const maxed = tier >= UNIT_MAX_TIER;
    document.getElementById('unit-' + key + '-tier').textContent = `Tier ${tier}/${UNIT_MAX_TIER}`;
    const upgBtn = document.getElementById('unit-upg-' + key);
    if (maxed) { upgBtn.textContent = 'MAX'; upgBtn.disabled = true; }
    else {
      const cost = unitUpgradeCost(key, tier + 1);
      upgBtn.textContent = `⬆ ${cost} Gold`;
      upgBtn.disabled = myGold < cost;
    }
  });

  TECH_BRANCHES.forEach(branch => {
    const currentTier = myTech[branch];
    for (let tier = 1; tier <= TECH_MAX_TIER; tier++) {
      const node = document.getElementById(`tech-${branch}-${tier}`);
      const cost = techPointCost(tier);
      const unlocked = currentTier >= tier;
      const available = !unlocked && currentTier === tier - 1 && myTechPoints >= cost;
      node.classList.toggle('unlocked', unlocked);
      node.classList.toggle('available', available);
      node.classList.toggle('locked', !unlocked && !available);
      node.querySelector('.tech-tier-badge').textContent = unlocked ? '✓' : tier;
    }
  });

  if (selectedStructure) {
    const fresh = myStructs.find(s => s.c === selectedStructure.c && s.r === selectedStructure.r);
    selectedStructure = fresh || null;
  }
  updateInfoPanel();
}

function drawLane(ctx, structures, units, projectiles) {
  ctx.clearRect(0, 0, LANE_W, LANE_H);
  // Nachtrag (Steampunk-Wüsten-Redesign, auf Nutzeranfrage, 2026-08-04): das bisherige
  // Kachel-Band-System (ground_r1c2/r2c1/r2c2, siehe Git-Historie) ist ersetzt durch EIN
  // einziges Hintergrundbild (mp_lane_bg, siehe MP_ASSET_FILES in mpAssets.js), das exakt
  // LANE_W×LANE_H deckt - die Schienen im Bild wurden beim Zuschnitt gezielt auf PATH_ROW
  // ausgerichtet. Fallback (Bild noch nicht geladen): alte Schachbrett-Optik.
  if (!mpDrawSprExact(ctx, 'mp_lane_bg', 0, 0, LANE_W, LANE_H)) {
    for (let r = 0; r < LANE_ROWS; r++) for (let c = 0; c < LANE_COLS; c++) {
      ctx.fillStyle = (r + c) % 2 === 0 ? '#232a33' : '#212831';
      ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
    }
  }
  // Nachtrag (auf Nutzeranfrage): Reichweiten-Kreis wurde vorher für ALLE Türme dauerhaft gezeichnet -
  // bei vielen Türmen unübersichtlich. Jetzt nur noch für den aktuell ausgewählten Turm, dafür mit
  // einem Rahmen, damit der Kreis trotz der dünnen Füllung gut erkennbar bleibt.
  if (selectedStructure && selectedStructure.type !== 'mine') {
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.arc(selectedStructure.x, selectedStructure.y, effectiveRange(selectedStructure), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  structures.forEach(t => {
    const radius = t.type === 'mine' ? 12 : 14;
    // Nachtrag (Teil 11, "Tower sprites hinzufügen"): echtes Sprite statt Kreis für die 3 Turmarten
    // mit vorhandenem Bildmaterial (arrow/cannon/frost, siehe MP_TOWER_SPRITE_PREFIX weiter oben) -
    // vollständiger Fallback auf die bisherige Kreis-Optik, falls Bild (noch) nicht geladen ist oder
    // die Turmart keinen Sprite-Satz hat (tesla/mine).
    const spritePrefix = MP_TOWER_SPRITE_PREFIX[t.type];
    const spriteDrawn = spritePrefix && mpDrawSpr(ctx, spritePrefix + '_L' + mpTowerSpriteStage(t.tier), t.x, t.y, radius * 5.2);
    if (!spriteDrawn) {
      ctx.beginPath(); ctx.fillStyle = darkenColor(t.color, t.tier); ctx.arc(t.x, t.y, radius, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#10151b'; ctx.lineWidth = 2; ctx.stroke();
    }
    // Minen zeigen jetzt (wie Türme) den Level-Stern statt eines "$"-Zeichens — konsistente
    // Optik über alle Strukturen hinweg, Level-Fortschritt bei Minen war vorher unsichtbar.
    drawLevelStars(ctx, t.x, t.y, t.tier);
    if (t === selectedStructure) {
      ctx.beginPath(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3;
      ctx.arc(t.x, t.y, radius + 4, 0, Math.PI * 2); ctx.stroke();
    }
  });
  units.forEach(u => {
    // Nachtrag (Teil 11, "alle Einheiten ... sprites hinzugefügt werden"): echte Lauf-Animation statt
    // Kreis, über MP_UNIT_VISUAL_KIND (siehe weiter oben für die Zuordnungs-Begründung, insbesondere
    // icecube->flugeinheit und titan->boss). Sprite-Stufe = u.tier (0-10, 1:1 dieselbe Skala wie die
    // 10 Lauf-Sprite-Level), mindestens Stufe 1 (es gibt kein *_L0_walk-Bild). Fallback auf die
    // bisherige Kreis-Optik, falls Bild (noch) nicht geladen oder u.key keiner Kategorie zugeordnet ist.
    // Bugfix (User-Feedback "Boss-Sprites lvl1-10 verwenden"): Boss-Objekte (tickBossSpawn()) haben
    // KEIN u.key (nur u.isBoss/u.bossIndex) - MP_UNIT_VISUAL_KIND[u.key] lieferte für Bosse also immer
    // undefined und sie fielen komplett auf den Kreis-Fallback zurück, obwohl boss_L1..L10_walk.png
    // längst vorhanden sind. Jetzt: Bosse nutzen 'boss' + ihren (in tickBossSpawn() bereits auf 1-10
    // gedeckelten) bossIndex, alle anderen Einheiten wie bisher MP_UNIT_VISUAL_KIND[u.key] + u.tier.
    const visKind = u.isBoss ? 'boss' : MP_UNIT_VISUAL_KIND[u.key];
    const visLevel = u.isBoss ? (u.bossIndex || 1) : Math.max(1, Math.min(10, u.tier || 0));
    // Nachtrag (User-Feedback, 2026-08-03: "Skalierung auf 80% von der aktuellen Größe"): ×0.8 auf
    // die bisherige Zielbreite, statt (verworfener Versuch) den Boden-Anker zu ändern.
    // Nachtrag 2 (User-Feedback, Screenshot "Boss ist nicht auf der Spur"): bei Mittelpunkt-Anker
    // wird jedes Sprite je zur Hälfte über/unter u.y gezeichnet - der Boss hatte mit BOSS_RADIUS=40
    // UND dem größten Multiplikator (6.8, ggü. 5.6 bei normalen Einheiten) eine Bildhöhe von ~455px
    // bei nur 80px Zeilenhöhe (CELL) - er "schwebte" dadurch weit über die Spur hinaus, deutlich
    // extremer als jede normale Einheit. Boss-Multiplikator 6.8→5.2 gesenkt (bleibt trotzdem klar
    // größer als alle normalen Einheiten, ~×1,15 der bisher größten Einheit Titan) - normale
    // Einheiten (5.6) bewusst unverändert gelassen, wie angefragt.
    const targetW = u.radius * (visKind === 'boss' ? 5.2 : 5.6) * 0.8;
    // Nachtrag (User-Feedback "Flugeinheiten sollen ein halbes Feld höher dargestellt werden"):
    // drawY statt u.y für alles Sichtbare (Sprite/Kreis-Fallback/Flieger-Ring/Level-Stern) - u.y
    // selbst bleibt unverändert (Spiellogik/Kollision/Weg-Position), nur die Darstellung wird für
    // fliegende Einheiten um eine halbe Zelle nach oben versetzt.
    const drawY = u.y - (u.flying ? CELL / 2 : 0);
    const spriteDrawn = visKind && mpDrawWalkAnim(ctx, visKind + '_L' + visLevel + '_walk', u.x, drawY, targetW, mpWalkAnimFrame);
    if (!spriteDrawn) {
      ctx.beginPath(); ctx.fillStyle = u.color; ctx.arc(u.x, drawY, u.radius, 0, Math.PI * 2); ctx.fill();
    }
    if (u.flying) {
      ctx.beginPath(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.arc(u.x, drawY, u.radius + 3, 0, Math.PI * 2); ctx.stroke();
    }
    if (!u.isBoss && u.tier) drawLevelStars(ctx, u.x, drawY, u.tier);
    const w = u.radius * 2;
    ctx.fillStyle = '#000'; ctx.fillRect(u.x - w / 2, drawY - u.radius - 8, w, 4);
    ctx.fillStyle = '#7CFC00'; ctx.fillRect(u.x - w / 2, drawY - u.radius - 8, w * (u.hp / u.maxHp), 4);
  });
  projectiles.forEach(p => { ctx.beginPath(); ctx.fillStyle = p.color; ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); });
  ctx.fillStyle = 'rgba(255,255,255,0.15)'; ctx.fillRect(LANE_W - 6, PATH_ROW * CELL, 6, CELL);
}
function interpolateList(prevList, currList, t) {
  if (!prevList || !prevList.length) return currList;
  const prevById = new Map();
  prevList.forEach(e => { if (e.id !== undefined) prevById.set(e.id, e); });
  return currList.map(e => {
    const p = e.id !== undefined ? prevById.get(e.id) : undefined;
    if (!p) return e; // neu aufgetaucht seit letztem Snapshot - kein Interpolieren möglich
    return Object.assign({}, e, { x: p.x + (e.x - p.x) * t, y: p.y + (e.y - p.y) * t });
  });
}

function draw() {
  if (!state) return;
  mpUpdateWalkAnim(); // Teil 11: Lauf-Animations-Takt einmal pro Render-Frame weiterschalten
  const myCtx = document.getElementById('myCanvas').getContext('2d');
  const oppCtx = document.getElementById('oppCanvas').getContext('2d');

  let u1 = state.unitsOnLaneP1, u2 = state.unitsOnLaneP2;
  let pr1 = state.projP1, pr2 = state.projP2;

  // Der Gast bekommt den Zustand nur alle paar Millisekunden per Netzwerk,
  // zeichnet aber mit 60fps - deshalb zwischen den letzten zwei Snapshots interpolieren,
  // sonst "springen" Einheiten und wirken ruckelig.
  if (!isHost && prevState) {
    const span = Math.max(stateTime - prevStateTime, 30);
    const t = Math.min(1, Math.max(0, (performance.now() - stateTime) / span));
    u1 = interpolateList(prevState.unitsOnLaneP1, state.unitsOnLaneP1, t);
    u2 = interpolateList(prevState.unitsOnLaneP2, state.unitsOnLaneP2, t);
    pr1 = interpolateList(prevState.projP1, state.projP1, t);
    pr2 = interpolateList(prevState.projP2, state.projP2, t);
  }

  if (isHost) {
    drawLane(myCtx, state.p1Structures, u1, pr1);
    drawLane(oppCtx, state.p2Structures, u2, pr2);
  } else {
    drawLane(myCtx, state.p2Structures, u2, pr2);
    drawLane(oppCtx, state.p1Structures, u1, pr1);
  }
}

function showEndOverlay() {
  const iWon = state.winner === myRole;
  document.getElementById('overlay').style.display = 'flex';
  document.getElementById('overlayTitle').textContent = iWon ? '🎉 Du hast gewonnen!' : '💀 Du hast verloren!';
  document.getElementById('overlayText').textContent = iWon ? 'Der Gegner hat keine Leben mehr.' : 'Du hast keine Leben mehr.';
  document.getElementById('rematchStatus').textContent = '';
}
function hideEndOverlay() {
  document.getElementById('overlay').style.display = 'none';
}

// Refactoring Schritt 1/n (siehe Kommentar oben am Blockanfang): dieser
// Block ist jetzt ein ES-Modul, seine Top-Level-Funktionen sind daher NICHT
// mehr automatisch global. Die im HTML oben per onclick="..." referenzierten
// Funktionen müssen deshalb explizit auf window gehängt werden — reine
// technische Notwendigkeit des Modul-Umbaus, keine Verhaltensänderung.
window.selectMode = selectMode;
window.confirmExit = confirmExit;
window.hostRoom = hostRoom;
window.joinRoom = joinRoom;
window.startAiMatch = startAiMatch;
window.toggleReady = toggleReady;
window.sellAllTowers = sellAllTowers;
window.setSelectedPriority = setSelectedPriority;
window.upgradeSelected = upgradeSelected;
window.sellSelected = sellSelected;
window.deselect = deselect;
window.buyTechPoint = buyTechPoint;
window.requestRematch = requestRematch;
window.joinRoomFromList = joinRoomFromList;
window.unlockTech = unlockTech;
