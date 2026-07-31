// ── Geteilte Turm-Tier-Skalierung ─────────────────────────────────────────
// Diese Formeln & Konstanten gelten für Multiplayer (PvP) UND Singleplayer
// (Endlos-Modus) — sie waren bisher in beiden Spiel-Engines separat (aber
// identisch) definiert. Jetzt gibt es nur noch eine Stelle zum Pflegen;
// wird hier etwas geändert, wirkt es sich auf BEIDE Modi aus.
// Siehe docs/balancing.md für die Design-Begründung hinter den Werten.

// TOWER_MAX_TIER 10 → 50 (nochmal angehoben, auf Wunsch "alle Max-Level bis 50 ausbauen und
// skalieren"). Die CAP-Werte unten (DAMAGE_CAP_MULT_*, AS_CAP_MULT, RANGE_CAP_MULT, RADIUS_CAP_MULT)
// sind bewusst UNVERÄNDERT geblieben - das sind die tatsächlichen Balance-Endpunkte (z.B. "ein Turm
// darf am Ende maximal ×9.9 Schadens-Durchsatz haben"), die bleiben richtig, unabhängig davon, über
// wie viele Tiers sie erreicht werden. Was sich ändert, sind die GROWTH-Raten pro Tier: die wurden
// neu berechnet, damit dieselben Caps nicht mehr schon um Tier ~4-10 erreicht werden (dann wären
// Tiers 10-50 bedeutungslos - reine Kosmetik ohne jeden Kampfwert-Zuwachs), sondern smooth über den
// vollen neuen Bereich bis nahe Tier 50 (siehe docs/balancing.md für die genaue Herleitung).
const TOWER_MAX_TIER = 50;
// Kosten-Wachstum ebenfalls gesenkt (1.7 → 1.15/Tier), sonst wäre die Summe aller Upgrades bis
// Tier 50 astronomisch (bei 1.7 wären es Milliarden Gold). Bei 1.15 kostet der letzte Schritt
// (Tier 49→50) rechnerisch ~16.250 Gold, kumuliert bis Tier 50 ~124.500 Gold für einen einzelnen
// voll ausgebauten Turm — ca. das 17-fache der alten "Tier 10 komplett" Summe (~7.300 Gold), was
// über 5× mehr Tiers und die jetzt viel stärkere Wirtschaft (Minen-Deckel, Zinsen, Steuern) plausibel ist.
const TIER_COST_BASE = 15, TIER_COST_GROWTH = 1.15;
const DAMAGE_GROWTH_SINGLE = 1.0305, AOE_DAMAGE_GROWTH = 1.0193; // erreichen ihre Caps jetzt bei Tier ≈50 statt ≈4-5
const DAMAGE_CAP_MULT_SINGLE = 4.5, DAMAGE_CAP_MULT_AOE = 2.6;
const AS_GROWTH_PER_TIER = 0.024, AS_CAP_MULT = 2.2; // erreicht Cap jetzt bei Tier 50 statt Tier 8
const RANGE_GROWTH_PER_TIER = 1.0037, RANGE_CAP_MULT = 1.2; // erreicht Cap jetzt bei Tier ≈50 statt ≈4
const RADIUS_GROWTH_PER_TIER = 1.0060, RADIUS_CAP_MULT = 1.35; // erreicht Cap jetzt bei Tier ≈50 statt ≈4

function tierUpgradeCost(nextTier) { return Math.round(TIER_COST_BASE * Math.pow(TIER_COST_GROWTH, nextTier)); }
function effectiveDamage(t) {
  const isAoe = t.baseSplash > 0;
  const g = isAoe ? AOE_DAMAGE_GROWTH : DAMAGE_GROWTH_SINGLE;
  const cap = isAoe ? DAMAGE_CAP_MULT_AOE : DAMAGE_CAP_MULT_SINGLE;
  return t.baseDamage * Math.min(Math.pow(g, t.tier), cap);
}
function effectiveFireRate(t) { const m = Math.min(1 + AS_GROWTH_PER_TIER * t.tier, AS_CAP_MULT); return t.baseFireRate / m; }
function effectiveRange(t) { const m = Math.min(Math.pow(RANGE_GROWTH_PER_TIER, t.tier), RANGE_CAP_MULT); return t.baseRange * m; }
function effectiveSplash(t) { if (!t.baseSplash) return 0; const m = Math.min(Math.pow(RADIUS_GROWTH_PER_TIER, t.tier), RADIUS_CAP_MULT); return t.baseSplash * m; }

// ── Level-Optik: gilt für Türme (beide Modi) und gesendete Einheiten (Multiplayer) ──────
// Farbe wird pro Tier etwas dunkler (Boden bei 55% Helligkeit, damit sie auf dem dunklen
// Hintergrund erkennbar bleibt). Ab Level 5 ein Stern in der Mitte, alle weiteren 5 Level einer mehr.
function darkenColor(hex, tier) {
  const factor = Math.max(0.55, 1 - tier * 0.045);
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * factor);
  const g = Math.round(((n >> 8) & 255) * factor);
  const b = Math.round((n & 255) * factor);
  return `rgb(${r},${g},${b})`;
}
function drawLevelStars(ctx, x, y, tier) {
  // Sternanzahl-Deckel 4 → 10 mitgezogen (Max-Tier jetzt 50 statt 10, weiterhin 1 Stern alle 5
  // Stufen — bei Tier 50 sind das genau 10 Sterne).
  const stars = Math.min(Math.floor(tier / 5), 10);
  if (stars < 1) return;
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 8px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('★'.repeat(stars), x, y);
}
