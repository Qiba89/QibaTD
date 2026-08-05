// Generisches Radial-Wheel für den Turmbau (auf Nutzeranfrage: "Man klickt auf ein
// Feld und bekommt ein Wheel mit den Türmen zum Anklicken. Türme die noch nicht
// gebaut werden können, erscheinen erst wenn sie freigeschaltet werden, das Wheel
// wird dann größer.").
//
// Reine UI-Komponente ohne Spiellogik/Balance-Wissen: MP und SP übergeben jeweils
// ihre eigene Turmliste (aus TOWER_TYPES bzw. SP_TOWER_TYPES abgeleitet) und ihre
// eigene Bau-Funktion. Nur diese Datei wird zwischen den Modi geteilt - Spielzustand,
// Kosten-/Tech-Logik etc. bleiben vollständig in mpCore.js / spCore.js.
//
// Nutzung:
//   import { openBuildWheel } from '../shared/buildWheel.js';
//   const key = await openBuildWheel(clientX, clientY, [
//     { key: 'arrow', name: 'Pfeilturm', color: '#4fd1c5', icon: '🏹', cost: 50, sub: '9 Dmg', locked: false, affordable: true },
//     ...
//   ]);
//   if (key) { /* bauen */ }
// Gibt null zurück, wenn der Nutzer außerhalb geklickt oder Escape gedrückt hat.

const RADIUS = 78;
const SEG_SIZE = 62;
const MARGIN = 8; // Sicherheitsabstand zum Bildschirmrand

let overlayEl = null;
let activeResolve = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement('div');
  overlayEl.id = 'buildWheelOverlay';
  overlayEl.style.cssText = 'position:fixed; inset:0; z-index:9999; display:none;';
  document.body.appendChild(overlayEl);
  overlayEl.addEventListener('click', (e) => {
    if (e.target === overlayEl) closeBuildWheel(null);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.style.display !== 'none') closeBuildWheel(null);
  });
  return overlayEl;
}

function closeBuildWheel(result) {
  if (!overlayEl) return;
  overlayEl.style.display = 'none';
  overlayEl.innerHTML = '';
  if (activeResolve) { const r = activeResolve; activeResolve = null; r(result); }
}

// clientX/clientY: Bildschirmkoordinaten des Klicks (z.B. e.clientX/e.clientY), NICHT
// Canvas-interne Koordinaten - das Wheel ist ein position:fixed-Overlay über der ganzen Seite.
// towers: Array von { key, name, color, icon, cost, sub, locked, affordable }
export function openBuildWheel(clientX, clientY, towers) {
  const el = ensureOverlay();
  el.innerHTML = '';
  el.style.display = 'block';

  const n = towers.length;
  const vw = window.innerWidth, vh = window.innerHeight;
  // Anker so klemmen, dass alle Segmente (Radius + halbe Segmentgröße) im sichtbaren
  // Bereich bleiben - einfacher und robuster als das Wheel zu drehen.
  const pad = RADIUS + SEG_SIZE / 2 + MARGIN;
  const cx = Math.min(Math.max(clientX, pad), vw - pad);
  const cy = Math.min(Math.max(clientY, pad), vh - pad);

  const wheel = document.createElement('div');
  wheel.style.cssText = `position:absolute; left:${cx}px; top:${cy}px; width:0; height:0;`;
  el.appendChild(wheel);

  towers.forEach((t, i) => {
    const angle = (-90 + (360 / n) * i) * Math.PI / 180;
    const x = Math.cos(angle) * RADIUS;
    const y = Math.sin(angle) * RADIUS;
    const locked = !!t.locked;
    const seg = document.createElement('button');
    seg.type = 'button';
    seg.disabled = locked;
    seg.title = locked ? `${t.name} (noch nicht freigeschaltet)` : `${t.name} — ${t.cost} Gold${t.sub ? ' — ' + t.sub : ''}`;
    seg.style.cssText = `
      position:absolute; left:${x}px; top:${y}px; transform:translate(-50%,-50%);
      width:${SEG_SIZE}px; height:${SEG_SIZE}px; border-radius:50%;
      display:flex; align-items:center; justify-content:center; flex-direction:column;
      border:3px solid ${locked ? '#2c333c' : t.color}; cursor:${locked ? 'not-allowed' : 'pointer'};
      background:${locked ? '#232b34' : t.color + '33'}; color:#e8e8e8;
      box-shadow:0 2px 8px rgba(0,0,0,0.5); opacity:${locked ? 0.4 : (t.affordable === false ? 0.55 : 1)};
      filter:${locked ? 'grayscale(1)' : 'none'};
    `;
    seg.innerHTML = `<span style="font-size:20px;">${locked ? '🔒' : t.icon}</span>` +
      (locked ? '' : `<span style="font-size:9px;font-weight:700;">${t.cost}g</span>`);
    if (!locked) seg.addEventListener('click', (e) => { e.stopPropagation(); closeBuildWheel(t.key); });
    wheel.appendChild(seg);
  });

  const dot = document.createElement('div');
  dot.style.cssText = `position:absolute; left:${cx}px; top:${cy}px; width:12px; height:12px;
    border-radius:50%; background:#fff; border:2px solid #10151b; transform:translate(-50%,-50%);`;
  el.appendChild(dot);

  return new Promise((resolve) => { activeResolve = resolve; });
}
