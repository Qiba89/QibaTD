// Singleplayer/Endlos-Modus: statische Weg-Geometrie (Pfad-Zellen, Wegpunkte,
// Sockel/Autotiling für die Wege-Kacheln). Reine Verschiebung, keine
// Verhaltensänderung.
import { CELL, cellRandom } from './spAssets.js';

export const pathCells = [
  [0,3],[1,3],[2,3],[3,3],[3,4],[3,5],[3,6],[4,6],[5,6],[6,6],[7,6],[7,5],[7,4],[7,3],[7,2],
  [8,2],[9,2],[10,2],[11,2],[11,3],[11,4],[11,5],[11,6],[11,7],[11,8],[12,8],[13,8],[14,8],
  [15,8],[16,8],[17,8]
];
export const waypoints = pathCells.map(([c,r]) => ({x: c*CELL + CELL/2, y: r*CELL + CELL/2}));
export const pathSet = new Set(pathCells.map(([c,r]) => `${c},${r}`));
// ── Wege-Kachel-"Logik" (Teil 6, auf Nutzeranfrage "Bau damit die Map neu ... versuche immer
// passende tiles nebeneinander zu legen ... eine Logik hinterlegen wie die zusammen gehören sodass
// wir einfacher neue Maps generieren können") ──────────────────────────────────────────────────────
// Ersetzt die alte Teil-5-Lösung (eine einzige road_1-Kurve, per canvas-Rotation an alle 4 Ecken
// angepasst, gerade Stücke = einfarbige Steinkachel ohne jede Weggrafik). Statt dessen: ein echtes
// Sockel/Autotiling-System, analog zu "Wang tiles" - jede Pfad-Zelle bekommt ein Sockel-Muster aus
// den Himmelsrichtungen, in denen sie an eine benachbarte Pfad-Zelle andockt (z. B. "NS" = Weg geht
// nach oben UND unten weiter = gerades Stück; "ES" = Weg kommt von rechts UND geht nach unten weiter
// = Kurve). Für jedes vorkommende Sockel-Muster liegt im neuen `map_tileset/wege/`-Set (siehe
// docs/tileset.md) eine passende, durch Sichtprüfung (nicht nur geraten!) bestätigte Kachel bereit -
// mehrere davon sogar in 2 optisch leicht unterschiedlichen Varianten für Abwechslung auf langen
// Strecken. Der Clou: dieser Code kennt `pathCells` selbst gar nicht mehr im Detail - er liest bei
// JEDER Zelle nur "wer sind meine Nachbarn in der Liste" aus und schlägt das passende Sockel-Muster
// in WAY_TILE_VARIANTS nach. Eine künftige, andere `pathCells`-Route (neue Karte) wird dadurch
// automatisch richtig gekachelt, ohne dass an diesem Code irgendetwas geändert werden müsste.
export const DIR_ORDER = ['N', 'E', 'S', 'W']; // feste Reihenfolge für den Sockel-Schlüssel, z.B. "ES"
// Sockel-Muster -> eine oder mehrere gleichwertige Kachel-Varianten (SPR-Keys aus ASSET_FILES oben).
// "ESW" (T-Kreuzung) wird von der aktuellen, unverzweigten `pathCells`-Route nie gebraucht, liegt
// aber bereit, falls eine künftige Karte einen Wege-Abzweig bekommt.
export const WAY_TILE_VARIANTS = {
  NS: ['way_ns_a', 'way_ns_b'],
  EW: ['way_ew_a', 'way_ew_b'],
  NE: ['way_curve_ne'],
  NW: ['way_curve_nw_a', 'way_curve_nw_b'],
  ES: ['way_curve_es_a', 'way_curve_es_b'],
  SW: ['way_curve_sw_a', 'way_curve_sw_b'],
  ESW: ['way_junction_esw'],
};
// Berechnet für Zelle `i` in `cells` (geordnete [c,r]-Liste wie `pathCells`) das Sockel-Muster als
// Set aus 'N'/'E'/'S'/'W'. Anfang/Ende der Route haben nur EINEN Nachbarn (Wellen-Quelle/Ziel) - für
// die wird die fehlende Seite auf derselben Achse künstlich dazugenommen (aus einem "nur Süden
// offen"-Sockel wird "NS"), damit dort trotzdem ein optisch stimmiges gerades Stück liegt statt gar
// keine passende Kachel zu finden.
export function computeWaySockets(cells, i) {
  const [c, r] = cells[i];
  const dirTo = (other) => {
    if (!other) return null;
    if (other[0] < c) return 'W';
    if (other[0] > c) return 'E';
    if (other[1] < r) return 'N';
    return 'S';
  };
  const dirs = new Set([dirTo(cells[i - 1]), dirTo(cells[i + 1])].filter(Boolean));
  if (dirs.size === 1) {
    const only = dirs.values().next().value;
    if (only === 'N' || only === 'S') { dirs.add('N'); dirs.add('S'); }
    else { dirs.add('E'); dirs.add('W'); }
  }
  return dirs;
}
// Sockel-Set -> Schlüssel in fester DIR_ORDER-Reihenfolge (z.B. {S,E} -> "ES"), damit die Reihenfolge
// beim Einsammeln der Richtungen keine Rolle spielt.
export function waySocketKey(dirsSet) {
  return DIR_ORDER.filter(d => dirsSet.has(d)).join('');
}
// Einmal pro Pfad-Zelle vorberechnet: Sockel-Schlüssel + (deterministisch, nicht pro Frame neu
// gewürfelt) ausgewählte Varianten-Kachel, per cellRandom() wie schon bei der Deko-Platzierung oben.
export const ROAD_TILE_INFO = new Map();
pathCells.forEach(([c, r], i) => {
  const dirs = computeWaySockets(pathCells, i);
  const key = waySocketKey(dirs);
  const variants = WAY_TILE_VARIANTS[key];
  let sprKey = null;
  if (variants) {
    sprKey = variants[Math.floor(cellRandom(c, r, 5) * variants.length)];
  }
  ROAD_TILE_INFO.set(`${c},${r}`, { key, sprKey });
});

