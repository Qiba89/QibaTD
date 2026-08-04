// Singleplayer/Endlos-Modus: Canvas/Constants + Sprite-Loading/Zeichen-Helfer.
// Reine Verschiebung aus dem SP-Inline-Script (Teil der ursprünglichen IIFE),
// keine Verhaltensänderung. SP_TOWER_TYPES kommt aus js/balance-singleplayer.js
// (klassisches <script>-Tag, vor allen Modulen geladen).

export const canvas = document.getElementById('spGameCanvas');
export const ctx = canvas.getContext('2d');
// Nachtrag (Teil 8, auf Nutzeranfrage "mit den ganzen Bildern und map tiles ... machen wir das
// Spiel doppelt so groß, damit man auch was sieht"): CELL war ursprünglich 40 - bei den
// hochauflösenden eigenen Kacheln/Sprites (z.B. die 180×180px-Wege-Kacheln aus Teil 6/7) ging beim
// Herunterskalieren auf nur 40px pro Feld viel Bilddetail verloren. Jetzt CELL=80 (Canvas
// entsprechend 1440×960 statt 720×480, siehe HTML). `VSCALE` = Verhältnis zum ursprünglichen
// Referenzwert 40 - alle Stellen im Code, die eine feste Pixelgröße/-distanz für das ursprüngliche
// CELL=40-Raster fest verdrahtet hatten (Gegner-/Turm-Zeichenradien, Trefferpartikel, Healthbar,
// fliegende Schadenszahl, sowie SP_TOWER_TYPES.range/splash/projSpeed aus balance-singleplayer.js,
// siehe unten), werden EINMALIG mit VSCALE hochskaliert - damit ändert sich NUR die Optik, nicht die
// tatsächliche Balance (Reichweite in Spielfeldern, Projektil-Tempo relativ zur Zelle usw. bleiben
// exakt wie zuvor). `pathCells`/`WAY_TILE_VARIANTS`/`ROAD_TILE_INFO` brauchen keine Anpassung, da sie
// ausschließlich in Grid-Koordinaten (c,r) rechnen, nicht in Pixeln - CELL/COLS/ROWS unten bleiben
// die einzige Quelle der Wahrheit fürs Pixel-Mapping.
export const CELL = 80;
export const VSCALE = CELL / 40;
export const COLS = canvas.width / CELL;
export const ROWS = canvas.height / CELL;
// SP_TOWER_TYPES kommt aus js/balance-singleplayer.js (lädt als eigenes <script> VOR diesem Block,
// siehe HTML) - `range`/`splash`/`projSpeed` sind dort für CELL=40 kalibriert und ausführlich
// dokumentiert (z.B. "range: 60 = 1,5 Feld"). Statt jeden Wert dort von Hand zu verdoppeln (und die
// Dokumentation/Herleitung dort ungültig zu machen), einmalig hier mit VSCALE hochskalieren - die
// Kommentare in balance-singleplayer.js bleiben so weiterhin exakt gültig als "Basis-Werte bei
// CELL=40", nur die tatsächlich im Spiel genutzten Werte sind schon mal mit VSCALE multipliziert.
Object.values(SP_TOWER_TYPES).forEach(t => {
  if (t.range != null) t.range *= VSCALE;
  if (t.splash != null) t.splash *= VSCALE;
  if (t.projSpeed != null) t.projSpeed *= VSCALE;
});

// ── Eigene Sprites des Nutzers (Nachtrag, "Steampunk Carnival"-Thema, NUR Endlos-Modus) ────────────
// Anders als das zuvor wieder entfernte generische Gratis-Paket: hier hat der Nutzer selbst
// individuelle, freigestellte PNGs bereitgestellt (assets/*.png) - siehe docs/visuals.md für die
// Herkunft (aus einem größeren Referenz-Moodboard zugeschnitten + Karo-Hintergrund entfernt) und für
// welche Elemente bewusst NICHT übernommen wurden (die 5 anderen Turmtypen - siehe dort, Abschnitt
// "Was noch offen ist"). Jedes Bild lädt einzeln und asynchron; jede Zeichenstelle prüft `ready` und
// fällt automatisch auf den alten prozeduralen Look zurück, falls ein Bild (noch) nicht da ist.
// Nachtrag ("wild durcheinander"-Fix): terrain_construction/terrain_flowerbeds und road_4 wurden
// entfernt - die Terrain-Zufallsmischung ist einer einheitlichen Gras-Fläche gewichen (siehe unten,
// "Rest = Wiese"). road_4 (Kreuzung) und road_1 (einzelne Kurve, per Rotation an alle 4 Ecktypen
// angepasst) sind mittlerweile komplett durch das echte Wege-Kachelset (way_*, siehe WAY_TILE_VARIANTS
// unten, docs/tileset.md und docs/visuals.md Teil 6) ersetzt - beide alten Dateien bleiben
// unangetastet in assets/, falls sie später wieder gebraucht werden.
export const ASSET_FILES = {
  // Nachtrag (Teil 7, "auch das Gelände tauschen, alte tiles verwerfen"): terrain_grass/
  // terrain_cobblestone/road_1 (Teil 3/5) sowie terrain_dirt/terrain_construction/
  // terrain_flowerbeds/road_2..6/boss_monkey_hero (nie genutztes Alt-Material) sind komplett
  // entfernt - weder referenziert noch noch als Datei in assets/ vorhanden. Neuer Hintergrund:
  // terrain_plaza (aus map_tileset/gelaende/, Originaldatei "gelände 2.png" - siehe docs/tileset.md,
  // "Warum EIN Hintergrundbild statt Einzelkacheln").
  terrain_plaza: 'terrain_plaza.png',
  // Nachtrag (Teil 6, "richtige Kurven + Logik fürs Zusammenpassen"): echtes modulares Wege-Kachelset
  // aus map_tileset/wege/ - für jedes Kachel-"Sockel-Muster" (welche Kanten N/E/S/W den Pfad
  // berühren) gibt es 1-2 optisch leicht unterschiedliche Varianten (way_..._a/_b), damit eine lange
  // gerade Strecke nicht komplett identisch aussieht. Sockel-Muster wurden NICHT geschätzt, sondern
  // durch direkte Sichtprüfung jeder Einzelkachel (mit eingeblendeten Kantenmarkierungen) bestimmt -
  // siehe docs/tileset.md, Abschnitt "Sockel-Analyse (Teil 6)".
  way_ns_a: 'way_ns_a.png', way_ns_b: 'way_ns_b.png',                 // gerade, Nord-Süd
  way_ew_a: 'way_ew_a.png', way_ew_b: 'way_ew_b.png',                 // gerade, Ost-West
  way_curve_ne: 'way_curve_ne.png',                                    // Kurve Nord-Ost
  way_curve_nw_a: 'way_curve_nw_a.png', way_curve_nw_b: 'way_curve_nw_b.png', // Kurve Nord-West
  way_curve_es_a: 'way_curve_es_a.png', way_curve_es_b: 'way_curve_es_b.png', // Kurve Ost-Süd
  way_curve_sw_a: 'way_curve_sw_a.png', way_curve_sw_b: 'way_curve_sw_b.png', // Kurve Süd-West
  way_junction_esw: 'way_junction_esw.png',                            // T-Kreuzung Ost-Süd-West (für künftige verzweigte Maps)
  obj_tent1: 'obj_tent1.png', obj_tent2: 'obj_tent2.png', obj_lamppost: 'obj_lamppost.png', obj_tree: 'obj_tree.png',
  tower_arrow_L1: 'tower_arrow_L1.png', tower_arrow_L2: 'tower_arrow_L2.png', tower_arrow_L3: 'tower_arrow_L3.png',
  tower_arrow_L4: 'tower_arrow_L4.png', tower_arrow_L5: 'tower_arrow_L5.png',
  // Nachtrag (Teil 9, auf Nutzeranfrage "als nächstes fügen wir die tower hinzu ... es gibt nur 5
  // sprites von den towern, das heißt für jeden level sprite gelten im spiel 2 level"): 3 weitere
  // Turmarten bekommen jetzt dieselbe 5-Stufen-Sprite-Evolution wie der Pfeilturm seit Teil 3
  // (Formel siehe TOWER_SPRITE_STAGE() unten). Freigestellt aus `QibaTDsprites/towers/{kanone,
  // frostturm,booster}/level_0{1-5}.png` - bei kanone/level_05 lag (anders als die übrigen 19
  // Dateien, die bereits sauber transparent waren) wieder ein fest eingebrannter Karo-/Rausch-
  // Hintergrund vor, per Sättigungs-Schwellwert + randverbundenem Flood-Fill entfernt (etablierte
  // Pipeline aus Teil 3/6). Tesla-Turm bewusst NOCH NICHT dabei - im Ordner liegen bisher nur 2 von
  // 5 Stufen UND deren Hintergrund ist ein unregelmäßiges Rausch-/Marmor-Muster statt eines
  // sauberen Karos, das sich mit der bisherigen Methode nicht zuverlässig freistellen ließ (siehe
  // docs/visuals.md, Teil 9) - Titan-Turm hat noch gar kein Bildmaterial. Beide bleiben bei der
  // bisherigen prozeduralen Kreis-Optik, bis passendes Material nachgeliefert wird.
  tower_cannon_L1: 'tower_cannon_L1.png', tower_cannon_L2: 'tower_cannon_L2.png', tower_cannon_L3: 'tower_cannon_L3.png',
  tower_cannon_L4: 'tower_cannon_L4.png', tower_cannon_L5: 'tower_cannon_L5.png',
  tower_frost_L1: 'tower_frost_L1.png', tower_frost_L2: 'tower_frost_L2.png', tower_frost_L3: 'tower_frost_L3.png',
  tower_frost_L4: 'tower_frost_L4.png', tower_frost_L5: 'tower_frost_L5.png',
  tower_booster_L1: 'tower_booster_L1.png', tower_booster_L2: 'tower_booster_L2.png', tower_booster_L3: 'tower_booster_L3.png',
  tower_booster_L4: 'tower_booster_L4.png', tower_booster_L5: 'tower_booster_L5.png',
};
// Nachtrag (Teil 9): die Tier(0-10)->Sprite-Stufe(1-5)-Formel aus Teil 3 (bisher nur inline beim
// Pfeilturm) als benannte, wiederverwendbare Funktion - jetzt von mehreren Turmarten genutzt.
export function TOWER_SPRITE_STAGE(tier) { return Math.min(5, Math.floor(tier / 2) + 1); }
// Turmtyp -> Sprite-Key-Präfix, nur für Typen mit echtem Sprite-Satz (siehe ASSET_FILES oben).
// Fehlt ein Typ hier (aktuell tesla/titan), bleibt er beim bisherigen prozeduralen Look.
export const TOWER_SPRITE_PREFIX = { arrow: 'tower_arrow', cannon: 'tower_cannon', frost: 'tower_frost', booster: 'tower_booster' };
// Nachtrag (auf Nutzeranfrage "kannst du die mit Bewegungsanimation einbinden?"): der Nutzer hat für
// alle 4 normalen Gegnertypen UND den Boss einen vollständigen 10-Stufen-Satz eigener Grafiken
// nachgeliefert - jede Stufe als 4-Frame-Lauf-Spritesheet (gleiches Format wie zuvor nur der
// Affen-Boss). Bei den 4 Gegnertypen ist Stufe 1-10 eine echte Stärke-Eskalation DERSELBEN Figur
// (z. B. wird der Guard von Stufe 1 zu 10 sichtbar schwerer gepanzert) - beim Boss sind die 10
// Stufen dagegen 10 UNTERSCHIEDLICHE Charaktere (wie schon die alten boss_L1..L10-Icons, jetzt aber
// alle animiert statt nur der Affe). Ersetzt komplett die vorherigen statischen
// enemy_*/boss_L2..L10-Einzelbilder - siehe docs/visuals.md, Teil 4.
export const ENEMY_WALK_TYPES = ['sprinter', 'guard', 'brecher', 'flugeinheit', 'boss'];
ENEMY_WALK_TYPES.forEach(t => {
  for (let lvl = 1; lvl <= 10; lvl++) {
    ASSET_FILES[t + '_L' + lvl + '_walk'] = t + '_L' + lvl + '_walk.png';
  }
});
export const SPR = {};
Object.keys(ASSET_FILES).forEach(key => {
  const img = new Image();
  const rec = { img, ready: false, w: 0, h: 0 };
  img.onload = () => { rec.ready = true; rec.w = img.naturalWidth; rec.h = img.naturalHeight; };
  img.onerror = () => { rec.ready = false; };
  img.src = 'assets/' + ASSET_FILES[key];
  SPR[key] = rec;
});
// drawSpr(): zentriert auf (cx,cy), Zielbreite `targetW`, Seitenverhältnis bleibt erhalten (fürs
// Charakter-Artwork - Verzerrung würde dort auffallen). Gibt false zurück, solange nicht geladen.
export function drawSpr(key, cx, cy, targetW) {
  const rec = SPR[key];
  if (!rec || !rec.ready) return false;
  const h = targetW * (rec.h / rec.w);
  ctx.drawImage(rec.img, cx - targetW / 2, cy - h / 2, targetW, h);
  return true;
}
// drawSprExact(): füllt exakt das übergebene Rechteck (dx,dy,dw,dh) ohne Seitenverhältnis zu wahren -
// für Terrain-/Weg-Kacheln, die exakt eine Spielfeld-Zelle ausfüllen sollen (die Quellkacheln sind
// ohnehin fast quadratisch, die minimale Verzerrung fällt dort nicht auf).
export function drawSprExact(key, dx, dy, dw, dh) {
  const rec = SPR[key];
  if (!rec || !rec.ready) return false;
  ctx.drawImage(rec.img, dx, dy, dw, dh);
  return true;
}
// drawSprCover(): zeichnet EIN großes Bild als Hintergrund über das gesamte übergebene Rechteck,
// wie CSS "background-size: cover" - Seitenverhältnis bleibt gewahrt, das Bild wird mittig
// beschnitten (nicht verzerrt), falls sein Seitenverhältnis nicht exakt zum Zielrechteck passt.
// Nachtrag (Teil 7, "auch das Gelände tauschen"): fürs neue `terrain_plaza`-Hintergrundbild, das
// als EIN Stück den ganzen Spielfeld-Boden abdeckt statt pro Zelle gekachelt zu werden - die
// Gelände-Referenzgrafik ist ein zusammenhängendes Kachel-Raster-Motiv (Karussell-Platz mit
// Medaillon-Mitte, siehe docs/tileset.md), keine frei wiederholbare Einzelkachel wie die Weg-Stücke.
export function drawSprCover(key, dx, dy, dw, dh) {
  const rec = SPR[key];
  if (!rec || !rec.ready) return false;
  const srcAspect = rec.w / rec.h, dstAspect = dw / dh;
  let sx, sy, sw, sh;
  if (srcAspect > dstAspect) { // Quelle relativ breiter als Ziel -> links/rechts beschneiden
    sh = rec.h; sw = sh * dstAspect; sx = (rec.w - sw) / 2; sy = 0;
  } else { // Quelle relativ höher als Ziel -> oben/unten beschneiden
    sw = rec.w; sh = sw / dstAspect; sy = (rec.h - sh) / 2; sx = 0;
  }
  ctx.drawImage(rec.img, sx, sy, sw, sh, dx, dy, dw, dh);
  return true;
}
// drawWalkAnim(): generische 4-Frame-Lauf-Animation für JEDE Gegner-/Boss-Sprite-Stufe (ursprünglich
// nur für den Affen-Boss geschrieben, jetzt für alle Gegnertypen×Stufen wiederverwendet - siehe
// ENEMY_WALK_TYPES oben). Horizontales Spritesheet mit 4 gleich breiten Frames, `frameIdx` (0-3)
// kommt aus dem globalen `walkAnimFrame` unten (läuft mit dem echten Frame-dt, nicht mit der ggf.
// vervielfachten Spielgeschwindigkeit - siehe updateEffects()).
// (Nachtrag rückgängig gemacht, 2026-08-03, analog zum Multiplayer-Pendant mpDrawWalkAnim(): der
// Boden-Anker-Versuch sah in der Praxis nicht gut aus - User-Feedback "mach die einheiten wieder
// dahin wo sie waren". (cx,cy) ist wieder der Bildmittelpunkt; kompaktere Optik kommt jetzt über
// eine kleinere targetW an den Aufrufstellen.)
export function drawWalkAnim(key, cx, cy, targetW, frameIdx) {
  const rec = SPR[key];
  if (!rec || !rec.ready) return false;
  const fw = rec.w / 4, fh = rec.h;
  const h = targetW * (fh / fw);
  ctx.drawImage(rec.img, frameIdx * fw, 0, fw, fh, cx - targetW / 2, cy - h / 2, targetW, h);
  return true;
}
// Deterministische Pseudo-Zufallszahl aus (c,r) - für die feste Deko-Platzierung (Bäume/Zelte) auf
// Gras-Zellen unten: dieselbe Zelle liefert bei jedem Aufruf denselben Wert, die Deko "flackert" also
// nicht von Frame zu Frame, obwohl draw() jeden Frame komplett neu zeichnet.
export function cellRandom(c, r, salt) {
  const x = Math.sin(c * 127.1 + r * 311.7 + salt * 74.7) * 43758.5453;
  return x - Math.floor(x);
}
// Lauf-Animations-Takt (Nachtrag, jetzt für ALLE animierten Gegner/Bosse gemeinsam statt nur den
// Affen-Boss - ein einzelner geteilter Takt reicht, da rein kosmetisch): läuft mit dem echten
// Frame-dt in updateEffects() (siehe dort), bewusst getrennt von gameSpeedMultiplier - sonst würde
// die Lauf-Animation bei 5x/10x Tempo unlesbar schnell durchrauschen, obwohl sie rein optisch ist.
