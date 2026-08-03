// ── Geteilte Turm-Tier-Skalierung ─────────────────────────────────────────
// Diese Formeln & Konstanten gelten für Multiplayer (PvP) UND Singleplayer
// (Endlos-Modus) — sie waren bisher in beiden Spiel-Engines separat (aber
// identisch) definiert. Jetzt gibt es nur noch eine Stelle zum Pflegen;
// wird hier etwas geändert, wirkt es sich auf BEIDE Modi aus.
// Siehe docs/balancing.md für die Design-Begründung hinter den Werten.

// TOWER_MAX_TIER 50 → 10 (Nachtrag, auf Nutzeranfrage: "Die skalierung von upgrades ist nicht
// balanced... schrumpfen das system auf die stern level zusammen... 1. upgrade direkt der stern,
// 2. zwei sterne etc, die zwischenlevel entfallen, aber die stärken sollten bei den stern level
// stärken bleiben"). Vorher gab es 50 Fein-Tiers mit 1 Stern alle 5 Stufen (10 Sterne bei Tier 50);
// die 4 "Zwischen-Tiers" zwischen zwei Sternen fühlten sich im Verhältnis zu ihren Kosten kaum
// spürbar an (kleiner Schadenszuwachs pro Klick) - das war der eigentliche Kern der Beschwerde.
// Jetzt ist 1 Klick = 1 Stern: TOWER_MAX_TIER 10, jeder Klick bringt einen vollen "Sprung" der
// Stärke, die vorher 5 Tiers gebraucht hat. Damit sich am Skill-Ceiling nichts verschiebt (kein
// Leichter/Schwerer-Effekt durch die Kompression selbst), gilt strikt: neuer Tier T liefert exakt
// denselben Effektiv-Wert (Schaden/Feuerrate/Reichweite/Splash), den der ALTE Tier 5×T geliefert
// hätte - siehe die GROWTH-Konstanten unten, die dafür aus den alten Fein-Tier-Werten hergeleitet
// werden (^5 bzw. ×5, siehe dort). Die CAP-Werte (DAMAGE_CAP_MULT_*, AS_CAP_MULT, RANGE_CAP_MULT,
// RADIUS_CAP_MULT) bleiben UNVERÄNDERT - das sind die tatsächlichen Balance-Endpunkte ("ein Turm
// darf am Ende maximal ×9.9 Schadens-Durchsatz haben"), die bleiben richtig, unabhängig von der
// Anzahl der Klicks, mit der man sie erreicht. Gilt für Türme (beide Modi), die Multiplayer-Mine
// (teilt sich TOWER_MAX_TIER/tierUpgradeCost() mit Türmen, siehe unten) sowie - analog, mit
// eigenen Konstanten - für Multiplayer-Einheiten (siehe UNIT_MAX_TIER in balance-multiplayer.js).
// Siehe docs/balancing.md, Abschnitt "Stern-Kompression" für die volle Herleitung + Tabellen.
const TOWER_MAX_TIER = 10;
// Kosten-Kurve (Nutzerentscheidung: "kumulierte Kosten gleich halten" statt zusätzlich verteuern):
// TIER_COST_BASE/TIER_COST_GROWTH beschreiben weiterhin die alte, feine 50-Tier-Kostenkurve (1.15
// pro Fein-Tier, wie vorher) - tierUpgradeCost() unten summiert für einen neuen Stern-Klick T jetzt
// aber die 5 alten Fein-Tier-Kosten auf, die dieser Klick ersetzt (Tier (T-1)×5+1 .. T×5). Dadurch
// ist die KUMULIERTE Gesamtsumme bis zum Vollausbau exakt identisch zu vorher (~124.500 Gold pro
// Turm) - nur die Granularität wird gröber (10 große Zahlungen statt 50 kleine). Kein Wirtschafts-
// Vorteil durch die Kompression, nur weniger Klicks - das war explizit gewünscht ("nicht zu einfach").
const TIER_COST_BASE = 15, TIER_COST_GROWTH = 1.15;
// Wachstumsraten: aus den alten Fein-Tier-Raten (_PER_OLD_TIER) per ^5 (multiplikatives Wachstum)
// bzw. ×5 (lineares Wachstum bei der Feuerrate) hergeleitet - das ist exakt die Umkehrung der
// Kompression: alter Tier 5T und neuer Tier T liefern damit denselben Effektiv-Wert (siehe
// Herleitung oben und docs/balancing.md).
const DAMAGE_GROWTH_PER_OLD_TIER_SINGLE = 1.0305, AOE_DAMAGE_GROWTH_PER_OLD_TIER = 1.0193;
const DAMAGE_GROWTH_SINGLE = Math.pow(DAMAGE_GROWTH_PER_OLD_TIER_SINGLE, 5), AOE_DAMAGE_GROWTH = Math.pow(AOE_DAMAGE_GROWTH_PER_OLD_TIER, 5);
const DAMAGE_CAP_MULT_SINGLE = 4.5, DAMAGE_CAP_MULT_AOE = 2.6;
const AS_GROWTH_PER_OLD_TIER = 0.024;
const AS_GROWTH_PER_TIER = AS_GROWTH_PER_OLD_TIER * 5, AS_CAP_MULT = 2.2;
const RANGE_GROWTH_PER_OLD_TIER = 1.0037;
const RANGE_GROWTH_PER_TIER = Math.pow(RANGE_GROWTH_PER_OLD_TIER, 5), RANGE_CAP_MULT = 1.2;
const RADIUS_GROWTH_PER_OLD_TIER = 1.0060;
const RADIUS_GROWTH_PER_TIER = Math.pow(RADIUS_GROWTH_PER_OLD_TIER, 5), RADIUS_CAP_MULT = 1.35;

// Summiert die 5 alten Fein-Tier-Kosten auf, die der neue Stern-Klick `nextTier` (1..10) ersetzt -
// siehe Kommentar oben ("kumulierte Kosten gleich halten"). Bewusst als Summenschleife statt
// geschlossener Formel implementiert, damit die Kostenkurve 1:1 nachvollziehbar/testbar aus der
// alten, unveränderten Fein-Tier-Formel hervorgeht (kein Rundungs-Näherungsfehler ggü. der alten
// Summe pro Turm).
function tierUpgradeCost(nextTier) {
  let sum = 0;
  for (let k = (nextTier - 1) * 5 + 1; k <= nextTier * 5; k++) sum += Math.round(TIER_COST_BASE * Math.pow(TIER_COST_GROWTH, k));
  return sum;
}
function effectiveDamage(t) {
  const isAoe = t.baseSplash > 0;
  const g = isAoe ? AOE_DAMAGE_GROWTH : DAMAGE_GROWTH_SINGLE;
  const cap = isAoe ? DAMAGE_CAP_MULT_AOE : DAMAGE_CAP_MULT_SINGLE;
  return t.baseDamage * Math.min(Math.pow(g, t.tier), cap);
}
function effectiveFireRate(t) { const m = Math.min(1 + AS_GROWTH_PER_TIER * t.tier, AS_CAP_MULT); return t.baseFireRate / m; }
function effectiveRange(t) { const m = Math.min(Math.pow(RANGE_GROWTH_PER_TIER, t.tier), RANGE_CAP_MULT); return t.baseRange * m; }
function effectiveSplash(t) { if (!t.baseSplash) return 0; const m = Math.min(Math.pow(RADIUS_GROWTH_PER_TIER, t.tier), RADIUS_CAP_MULT); return t.baseSplash * m; }

// ── Minen (nur noch Multiplayer, seit der Minen-Entfernung aus dem Endlos-Modus - siehe
// docs/balancing.md, Abschnitt "Minen im Endlos-Modus") ──────────────────────────────────
// Minen teilen sich die Tier-Stufen (0-10, seit der Stern-Kompression oben) und die Upgrade-Kosten
// (tierUpgradeCost() oben) mit Türmen, aber Ertrag statt Schaden wächst pro Tier. Wachstum gedeckelt
// (×60 ≈ 360 Gold/s bei Tier10), sonst würde das absurd explodieren (gleiches Prinzip wie beim
// Turm-Schadensdeckel oben - siehe docs/balancing.md für die volle Herleitung). Wachstumsrate per ^5
// aus der alten Fein-Tier-Rate hergeleitet (Nachtrag Stern-Kompression), damit der Ertrag bei
// kompaktem Tier T identisch zum alten Ertrag bei Fein-Tier 5×T bleibt - exakt dasselbe Prinzip wie
// bei den Turm-Wachstumsraten oben.
const MINE_INCOME_GROWTH_PER_OLD_TIER = 1.09;
const MINE_INCOME_GROWTH_PER_TIER = Math.pow(MINE_INCOME_GROWTH_PER_OLD_TIER, 5);
const MINE_INCOME_CAP_MULT = 60;
function mineIncome(t) { return 6 * Math.min(Math.pow(MINE_INCOME_GROWTH_PER_TIER, t.tier), MINE_INCOME_CAP_MULT); }
function mineIncomeTotal(structs) { return structs.filter(s => s.type === 'mine').reduce((s, m) => s + mineIncome(m), 0); }

// Minen-Anzahl-Limit: 7 pro Spieler/Partie. Ohne Limit ist bei 50 Tier-Stufen sonst eine "je mehr
// Minen, desto besser"-Strategie ohne Gegenwert möglich - Minen-Ertrag ist rein additiv und passiv,
// kostet anders als Türme keine laufende Aufmerksamkeit/Zielauswahl. Ein Limit erzwingt eine echte
// Baufeld-vs-Wirtschaft-Entscheidung, besonders jetzt wo Zinsen-/Steuern-Tech (Multiplayer) bzw.
// Zinsen-Tech (Endlos-Modus) zusätzlich mit dem Goldbestand skalieren - ohne Deckel würde das einen
// sich selbst verstärkenden Wirtschafts-Schneeball erzeugen. Derselbe Wert (7) gilt bewusst für
// beide Modi: im Multiplayer hergeleitet aus der 51-Zellen-Lane (siehe docs/balancing.md), im
// Endlos-Modus trotz des deutlich größeren Baufelds (18×12) unverändert übernommen, weil hier nicht
// die Feldgröße, sondern die Wirtschafts-Schneeball-Begrenzung der eigentliche Grund ist.
const MINE_MAX_COUNT = 7;

// ── Level-Optik: gilt für Türme (beide Modi) und gesendete Einheiten (Multiplayer) ──────
// Farbe wird pro Tier etwas dunkler (Boden bei 55% Helligkeit, damit sie auf dem dunklen
// Hintergrund erkennbar bleibt - bei TOWER_MAX_TIER 10 wird der Boden-Wert exakt bei Vollausbau
// erreicht, siehe factor-Formel unten). Ab Level 5 ein Stern in der Mitte, jedes weitere Level
// (seit der Stern-Kompression: jeder weitere Klick) einer mehr, siehe drawLevelStars() unten.
function darkenColor(hex, tier) {
  const factor = Math.max(0.55, 1 - tier * 0.045);
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `rgb(${r},${g},${b})`;
}
// Nachtrag (Balance/Optik): bei 5+ Sternen nebeneinander wurde die Anzeige "zu heftig" (Nutzer-
// Feedback, gilt für beide Modi) - viele kleine Sterne in einer Reihe sind kaum noch zu
// unterscheiden und wirken visuell überladen. Ab 5 Sternen deshalb EIN großer Stern, der den Kreis
// ausfüllt, mit der Sternanzahl (5, 6, 7, ... bis 10) als Zahl darin - bis 4 Sterne bleibt die
// bisherige Reihen-Darstellung, da die dort noch gut lesbar ist.
// Nachtrag (Stern-Kompression, s.o.): seit TOWER_MAX_TIER 50 → 10 ist 1 Klick = 1 Stern, `tier`
// selbst IST jetzt die Sternanzahl - kein "alle 5 Stufen" mehr nötig, die Umrechnung entfällt.
function drawLevelStars(ctx, x, y, tier) {
  const stars = Math.min(tier, 10);
  if (stars < 1) return;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (stars <= 4) {
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 8px sans-serif';
    ctx.fillText('★'.repeat(stars), x, y);
  } else {
    ctx.fillStyle = '#ffd700';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('★', x, y);
    ctx.fillStyle = '#1a1200';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText(String(stars), x, y + 1);
  }
}

// ── Ziel-Icons (Boden/Luft/Aura): gilt für Türme (beide Modi) ────────────────────────────
// Nachtrag (UI, auf Nutzeranfrage: "erstell noch nen tooltipp icon für Kanone [Boden] und Tesla
// [Luft], die anderen kriegen beide wenn sie auf beides schießen können"). Kleines Icon-Paar direkt
// neben dem Turmnamen in der Bau-Palette, mit nativem Hover-Tooltip (title-Attribut) - zeigt auf
// einen Blick, welche Zieltypen ein Turm treffen kann, ohne dass man ihn erst bauen/anklicken muss.
// 👣 = trifft Bodeneinheiten, ✈️ = trifft fliegende Einheiten. Kanone (`groundOnly`) zeigt nur 👣,
// Tesla (`airOnly`) nur ✈️, alle anderen kämpfenden Türme (weder Flag gesetzt, treffen beides)
// zeigen beide Icons nebeneinander. Gemeinsam hier in balance-shared.js statt dupliziert in MP/SP,
// da beide Modi dieselben groundOnly/airOnly-Flags auf ihren Turm-Definitionen verwenden
// (TOWER_TYPES / SP_TOWER_TYPES). Gilt nur für kämpfende Türme - für die Multiplayer-Mine (kein
// Kampfwert, feuert nie) wird diese Funktion an der Aufrufstelle bewusst nicht verwendet.
// Nachtrag (Aura-Türme, auf Nutzeranfrage "änder auch das tooltip, ein Aura symbol" für die
// Frost-Aura + "Also der Booster ist auch eine Aura"): Türme mit `kind: 'aura'` (aktuell nur im
// Endlos-Modus: Frost, Booster) feuern nie und haben kein Boden/Luft-Ziel - stattdessen EIN
// 🌀-Icon, der Tooltip-Text unterscheidet über `auraTarget`, worauf die Aura wirkt (Gegner
// verlangsamen vs. Türme verstärken).
function towerTargetIconsHtml(t) {
  if (t.kind === 'aura') {
    const label = t.auraTarget === 'towers' ? 'Aura: verstärkt Türme im Radius' : 'Aura: verlangsamt Gegner im Radius, kontinuierlich, kein Projektil';
    return `<span class="target-icon" title="${label}">🌀</span>`;
  }
  const groundIcon = '<span class="target-icon" title="Trifft Bodeneinheiten">👣</span>';
  const airIcon = '<span class="target-icon" title="Trifft fliegende Einheiten">✈️</span>';
  if (t.groundOnly) return groundIcon;
  if (t.airOnly) return airIcon;
  return groundIcon + airIcon;
}
