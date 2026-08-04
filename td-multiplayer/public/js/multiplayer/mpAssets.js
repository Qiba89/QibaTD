// Multiplayer-Sprite-/Tile-Assets & Lauf-Animations-Takt (Teile 10-12, siehe
// Kommentare unten). Reine Verschiebung aus dem MP-Inline-Script, keine
// Verhaltensänderung. Nur CELL/LANE_COLS werden von außen gebraucht.
import { CELL, LANE_COLS } from './mpConstants.js';

export const MP_ASSET_FILES = {
  ground_r1c2: 'ground_r1c2.png', ground_r1c3: 'ground_r1c3.png',
  ground_r2c1: 'ground_r2c1.png', ground_r2c2: 'ground_r2c2.png',
  // Nachtrag (Steampunk-Wüsten-Redesign, auf Nutzeranfrage, 2026-08-04): EIN einziges
  // durchgehendes Szenenbild statt der bisherigen Kachel-Bänder darüber - passt exakt
  // LANE_W×LANE_H (1360×320px), die Schienen-Reihe im Bild wurde vorher gezielt so
  // zugeschnitten, dass sie exakt auf PATH_ROW (Reihe 3, 0-indiziert Reihe 2) landet.
  // Gezeichnet über mpDrawSprExact() (siehe drawLane()), Fallback auf die alte
  // Kachel-/Schachbrett-Logik bleibt erhalten, falls das Bild (noch) nicht geladen ist.
  mp_lane_bg: 'mp_lane_bg.png',
};
// Nachtrag (Teil 11): das Befüllen von MP_SPR (Bild-Ladevorgänge anstoßen) passiert jetzt erst WEITER
// UNTEN, NACHDEM alle MP_ASSET_FILES-Einträge (inkl. der Turm-/Einheiten-Sprites aus Teil 11) gesetzt
// sind - vorher lief die Schleife direkt hier und hätte alle später per `MP_ASSET_FILES.xyz = ...`
// nachträglich hinzugefügten Einträge (siehe unten) schlicht verpasst.
// mpDrawSprExact(): identisch zu SPs drawSprExact() - füllt exakt dx/dy/dw/dh. Seit Teil 13 (der
// separate Pfad-Overlay pro Zelle entfiel, siehe drawLane()) aktuell ungenutzt, bleibt aber als
// kleine Hilfsfunktion bestehen (z.B. für spätere exakt-Zelle-große Kacheln).
export function mpDrawSprExact(ctx, key, dx, dy, dw, dh) {
  const rec = MP_SPR[key];
  if (!rec || !rec.ready) return false;
  ctx.drawImage(rec.img, dx, dy, dw, dh);
  return true;
}
// mpDrawGroundTileBand() (Teil 12, erweitert in Teil 13 um `vAlign`): zeichnet einen aus der
// Quellkachel geschnittenen Ausschnitt bei fester MP_GROUND_TILE_SCALE-Skala, sodass jede
// Gelände-Kachel unabhängig von der tatsächlich verfügbaren Bandhöhe/-breite in derselben "3 Zellen =
// 1 Kachel"-Größe erscheint - bei dw=dh=3*CELL (voller Block, siehe Reihen 1-3 in drawLane()) entspricht
// der Ausschnitt der kompletten 180×180px-Quellkachel (kein Zuschnitt). Bei kleinerem dh (Reihe 0,
// "das untere Drittel") wird per `vAlign='bottom'` der UNTERE Ausschnitt statt der Bildmitte gewählt
// (`vAlign='center'`, Standard, bisheriges Verhalten unverändert für alle anderen Aufrufe).
export const MP_GROUND_TILE_SCALE = (3 * CELL) / 180; // 3 Zellen je Kachel (CELL unabhängig)
export function mpDrawGroundTileBand(ctx, key, dx, dy, dw, dh, vAlign) {
  const rec = MP_SPR[key];
  if (!rec || !rec.ready) return false;
  const srcW = Math.min(rec.w, dw / MP_GROUND_TILE_SCALE);
  const srcH = Math.min(rec.h, dh / MP_GROUND_TILE_SCALE);
  const sx = (rec.w - srcW) / 2;
  const sy = vAlign === 'bottom' ? (rec.h - srcH) : (rec.h - srcH) / 2;
  ctx.drawImage(rec.img, sx, sy, srcW, srcH, dx, dy, dw, dh);
  return true;
}
// Deterministische Pseudo-Zufallszahl aus der Spalte (analog zu SPs cellRandom()) - hier nicht mehr
// für eine a/b-Varianten-Wahl gebraucht (der Weg nutzt jetzt einheitlich nur `ground_r2c1`, siehe
// oben), bleibt aber als kleine Hilfsfunktion bestehen, falls künftig wieder mehrere Weg-Varianten
// gebraucht werden.
export function mpCellRandom(c, salt) {
  const x = Math.sin(c * 127.1 + salt * 74.7) * 43758.5453;
  return x - Math.floor(x);
}
// Terrain-Bänder oberhalb/unterhalb der Pfad-Reihe, in 3-Spalten-Gruppen alternierend (siehe
// Nachtrag oben) - je ein Eintrag pro Band: [c0, colCount] deckt Reihe(n) row0..row0+rowCount-1 ab.
export const MP_GROUND_BAND_TILES = ['ground_r1c2', 'ground_r1c3'];
// Dieselbe Spalten-Gruppierung gilt für beide Terrain-Bänder (oben UND unten) - eine Gruppe pro
// Band-Instanz reicht, da nur die Spaltengrenzen berechnet werden, nicht die Kachel-Wahl selbst
// (die passiert erst beim Zeichnen, siehe drawLane()).
export const MP_BAND_GROUPS = [];
for (let c = 0; c < LANE_COLS; c += 3) MP_BAND_GROUPS.push({ c0: c, cols: Math.min(3, LANE_COLS - c) });

// ── Einheiten- & Turm-Sprites für die MP-Lane (Teil 11, auf Nutzeranfrage "Ferner sollen im
// Multiplayer alle Einheiten und Tower sprites hinzugefügt werden") ────────────────────────────
// Turm-Sprites: dieselben 4 Sorten wie im Endlos-Modus (Teil 3/9) - `arrow`/`cannon`/`frost` gibt
// es in beiden Modi unter demselben Namen, `booster` existiert in MP gar nicht (siehe TOWER_TYPES
// in js/balance-multiplayer.js: nur arrow/cannon/frost/tesla/mine) und wird deshalb hier nicht
// gelistet. Tesla und Mine bleiben wie in SP bei der Kreis-Optik (kein Sprite-Material).
MP_ASSET_FILES.tower_arrow_L1 = 'tower_arrow_L1.png'; MP_ASSET_FILES.tower_arrow_L2 = 'tower_arrow_L2.png';
MP_ASSET_FILES.tower_arrow_L3 = 'tower_arrow_L3.png'; MP_ASSET_FILES.tower_arrow_L4 = 'tower_arrow_L4.png';
MP_ASSET_FILES.tower_arrow_L5 = 'tower_arrow_L5.png';
MP_ASSET_FILES.tower_cannon_L1 = 'tower_cannon_L1.png'; MP_ASSET_FILES.tower_cannon_L2 = 'tower_cannon_L2.png';
MP_ASSET_FILES.tower_cannon_L3 = 'tower_cannon_L3.png'; MP_ASSET_FILES.tower_cannon_L4 = 'tower_cannon_L4.png';
MP_ASSET_FILES.tower_cannon_L5 = 'tower_cannon_L5.png';
MP_ASSET_FILES.tower_frost_L1 = 'tower_frost_L1.png'; MP_ASSET_FILES.tower_frost_L2 = 'tower_frost_L2.png';
MP_ASSET_FILES.tower_frost_L3 = 'tower_frost_L3.png'; MP_ASSET_FILES.tower_frost_L4 = 'tower_frost_L4.png';
MP_ASSET_FILES.tower_frost_L5 = 'tower_frost_L5.png';
MP_ASSET_FILES.tower_booster_L1 = 'tower_booster_L1.png'; MP_ASSET_FILES.tower_booster_L2 = 'tower_booster_L2.png';
MP_ASSET_FILES.tower_booster_L3 = 'tower_booster_L3.png'; MP_ASSET_FILES.tower_booster_L4 = 'tower_booster_L4.png';
MP_ASSET_FILES.tower_booster_L5 = 'tower_booster_L5.png';
export const MP_TOWER_SPRITE_PREFIX = { arrow: 'tower_arrow', cannon: 'tower_cannon', frost: 'tower_frost', booster: 'tower_booster' };
export function mpTowerSpriteStage(tier) { return Math.min(5, Math.floor(tier / 2) + 1); } // identisch zur SP-Formel (Teil 3/9)

// Einheiten-Sprites: MPs 5 Einheitentypen (sprinter/guard/brecher/icecube/titan, siehe UNIT_TYPES in
// js/balance-multiplayer.js) sind KEINE 1:1-Entsprechung zu SPs 5 animierten Gegner-Kategorien
// (sprinter/guard/brecher/flugeinheit/boss, siehe ENEMY_WALK_TYPES in Teil 4) - 3 davon passen exakt
// (gleicher Name UND gleiches Konzept: eine Figur, die pro Stufe stärker/gepanzerter aussieht), die
// übrigen 2 brauchen eine bewusste Zuordnungs-Entscheidung:
//  - icecube (MPs einzige fliegende Einheit) -> flugeinheit (SPs einzige fliegende Gegner-Kategorie) -
//    konzeptionell die naheliegendste Wahl.
//  - titan (MPs Tech-gated Elite-Einheit, NICHT zu verwechseln mit SPs Titan-TURM) -> boss. Einzige
//    verbleibende SP-Kategorie, aber mit einer Einschränkung: SPs boss_L1..L10_walk sind (anders als
//    die anderen 4 Typen) 10 UNTERSCHIEDLICHE Charaktere statt einer einzelnen eskalierenden Figur
//    (siehe docs/visuals.md, Teil 4) - ein hochgestufter Titan wechselt sein Aussehen also bei jedem
//    Tier-Aufstieg komplett, statt (wie bei den anderen 4 Typen) sichtbar stärker zu wirken. Mangels
//    dediziertem Titan-Bildmaterial die einzig sinnvolle Option; siehe docs/visuals.md, Teil 11,
//    "Weiteres Vorgehen" - offen für Nutzer-Feedback.
export const MP_UNIT_VISUAL_KIND = { sprinter: 'sprinter', guard: 'guard', brecher: 'brecher', icecube: 'flugeinheit', titan: 'boss' };
for (let lvl = 1; lvl <= 10; lvl++) {
  ['sprinter', 'guard', 'brecher', 'flugeinheit', 'boss'].forEach(kind => {
    MP_ASSET_FILES[kind + '_L' + lvl + '_walk'] = kind + '_L' + lvl + '_walk.png';
  });
}
// Jetzt, wo alle MP_ASSET_FILES-Einträge (Gelände/Weg aus Teil 10 + Türme/Einheiten aus Teil 11)
// feststehen, die Bild-Ladevorgänge tatsächlich anstoßen (siehe Hinweis weiter oben bei der
// MP_ASSET_FILES-Deklaration).
export const MP_SPR = {};
Object.keys(MP_ASSET_FILES).forEach(key => {
  const img = new Image();
  const rec = { img, ready: false, w: 0, h: 0 };
  img.onload = () => { rec.ready = true; rec.w = img.naturalWidth; rec.h = img.naturalHeight; };
  img.onerror = () => { rec.ready = false; };
  img.src = 'assets/' + MP_ASSET_FILES[key];
  MP_SPR[key] = rec;
});
// mpDrawSpr(): identisch zu SPs drawSpr() - zentriert auf (cx,cy), Zielbreite targetW, Seiten-
// verhältnis bleibt erhalten (für die Turm-Sprites, die kein Spritesheet sind).
export function mpDrawSpr(ctx, key, cx, cy, targetW) {
  const rec = MP_SPR[key];
  if (!rec || !rec.ready) return false;
  const h = targetW * (rec.h / rec.w);
  ctx.drawImage(rec.img, cx - targetW / 2, cy - h / 2, targetW, h);
  return true;
}
// mpDrawWalkAnim(): identisch zu SPs drawWalkAnim() - horizontales 4-Frame-Spritesheet, ctx als
// expliziter Parameter (statt geschlossenem globalen ctx wie in SP) passend zum drawLane(ctx,...)-Stil.
// (Nachtrag rückgängig gemacht, 2026-08-03: Boden-Anker "auf der x-Achse aufliegend" sah in der
// Praxis nicht gut aus - User-Feedback "mach die einheiten wieder dahin wo sie waren". (cx,cy) ist
// wieder der Bild-MITTELPUNKT wie ursprünglich; die gewünschte kompaktere Optik kommt jetzt über eine
// kleinere targetW an den Aufrufstellen, siehe dort.)
export function mpDrawWalkAnim(ctx, key, cx, cy, targetW, frameIdx) {
  const rec = MP_SPR[key];
  if (!rec || !rec.ready) return false;
  const fw = rec.w / 4, fh = rec.h;
  const h = targetW * (fh / fw);
  ctx.drawImage(rec.img, frameIdx * fw, 0, fw, fh, cx - targetW / 2, cy - h / 2, targetW, h);
  return true;
}
// Lauf-Animations-Takt (analog zu SPs walkAnimAccum/-Frame, Teil 4): läuft mit dem ECHTEN Frame-dt
// aus draw() (siehe dort) - MP hat (anders als SP) kein 1x/2x/5x/10x-Spieltempo, trotzdem bewusst
// über einen eigenen Timer statt direkt an die Render-Framerate gekoppelt, damit die Lauf-Animation
// bei stark schwankender Framerate (z.B. Gast-Interpolation) gleichmäßig bleibt.
export let mpWalkAnimAccum = 0;
export let mpWalkAnimFrame = 0;
export let mpWalkAnimLastTs = null;
export function mpUpdateWalkAnim() {
  const now = performance.now();
  if (mpWalkAnimLastTs === null) { mpWalkAnimLastTs = now; return; }
  mpWalkAnimAccum += now - mpWalkAnimLastTs;
  mpWalkAnimLastTs = now;
  while (mpWalkAnimAccum >= 150) { mpWalkAnimAccum -= 150; mpWalkAnimFrame = (mpWalkAnimFrame + 1) % 4; }
}
