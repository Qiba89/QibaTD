// ── Geometrie & Definitionen (identisch zum Einzelspieler-PvP) ──────────
// Balancing-Werte (Türme, Einheiten, Bosse, Tech-Tree, Tier-Skalierung)
// stecken in js/balance-shared.js und js/balance-multiplayer.js (klassische
// <script>-Tags, VOR diesem Modul geladen, siehe index.html) statt inline
// hier — siehe docs/balancing.md. TOWER_TYPES ist dadurch ein globales
// Objekt (window.TOWER_TYPES); wir mutieren es hier absichtlich weiter wie
// im Original.
export const CELL = 80;
export const LANE_COLS = 17, LANE_ROWS = 4, PATH_ROW = 2;
export const LANE_W = LANE_COLS * CELL, LANE_H = LANE_ROWS * CELL;
export const PATH_Y = PATH_ROW * CELL + CELL / 2;
// Nachtrag (Bugfix, User-Feedback "Türme haben aufeinmal zu wenig Reichweite ... wahrscheinlich
// Canvas-Vergrößerung"): TOWER_TYPES.range/splash/projSpeed (aus balance-multiplayer.js) sind für
// CELL=40 kalibriert (analog zu SP_TOWER_TYPES im zweiten Script-Block, siehe dortiger
// VSCALE-Kommentar) - als CELL hier auf 80 verdoppelt wurde, fehlte (anders als im SP-Block) die
// passende ×VSCALE-Hochskalierung, wodurch jede Turm-Reichweite nur noch die halbe relative
// Feldabdeckung hatte. Analog zum SP-Fix einmalig hier hochskaliert - ändert nur die Optik/absolute
// Pixelreichweite, nicht die Reichweite in Spielfeldern (die bleibt exakt wie zuvor kalibriert).
export const VSCALE = CELL / 40;
Object.values(TOWER_TYPES).forEach(t => {
  if (t.range != null) t.range *= VSCALE;
  if (t.splash != null) t.splash *= VSCALE;
  if (t.projSpeed != null) t.projSpeed *= VSCALE;
});
// Nachtrag (Balance-Fix, auf Nutzeranfrage: "das springen soll einfach zum nächsten gegner gehen
// ohne reichweiten beschränkung"): der Kettenblitz sprang bisher nur zu fliegenden Zielen innerhalb
// einer festen Sprungreichweite (früher hier als TESLA_CHAIN_RANGE definiert) - Tesla wurde dadurch
// als zu schwach empfunden, sobald die Ziele nicht dicht genug beieinander standen. Springt jetzt
// uneingeschränkt zum jeweils NÄCHSTGELEGENEN noch nicht getroffenen fliegenden Ziel, egal wie weit
// entfernt (siehe moveProjectiles() unten) - die einzige verbleibende Grenze ist die Sprunganzahl
// (teslaChainJumps()) und dass jedes Ziel nur einmal pro Schuss getroffen wird.
