// ── Geteilte Turm-Tier-Skalierung ─────────────────────────────────────────
// Diese Formeln & Konstanten gelten für Multiplayer (PvP) UND Singleplayer
// (Endlos-Modus) — sie waren bisher in beiden Spiel-Engines separat (aber
// identisch) definiert. Jetzt gibt es nur noch eine Stelle zum Pflegen;
// wird hier etwas geändert, wirkt es sich auf BEIDE Modi aus.
// Siehe docs/balancing.md für die Design-Begründung hinter den Werten.

const TOWER_MAX_TIER = 10; // war 4 — angehoben, damit Türme genug Stufen für das Level-Stern-System haben (alle 5 Level ein Stern)
const TIER_COST_BASE = 15, TIER_COST_GROWTH = 1.7;
const DAMAGE_GROWTH_SINGLE = 1.40, AOE_DAMAGE_GROWTH = 1.25;
// Schadens-Wachstum ist jetzt GEDECKELT (vorher unbegrenzt) — bei 10 Tiers wäre 1.40^10 ≈ x29
// sonst absurd stark geworden. Der Deckel liegt knapp über dem alten "natürlichen" Maximum bei
// Tier 4 (1.40^4≈3.84 / 1.25^4≈2.44), damit sich die alte Turmstärke am alten Max-Tier kaum
// ändert, aber jetzt über 10 statt 4 Stufen erreicht wird (siehe docs/balancing.md).
const DAMAGE_CAP_MULT_SINGLE = 4.5, DAMAGE_CAP_MULT_AOE = 2.6;
const AS_GROWTH_PER_TIER = 0.15, AS_CAP_MULT = 2.2;
const RANGE_GROWTH_PER_TIER = 1.05, RANGE_CAP_MULT = 1.2;
const RADIUS_GROWTH_PER_TIER = 1.08, RADIUS_CAP_MULT = 1.35;

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
  const stars = Math.min(Math.floor(tier / 5), 4);
  if (stars < 1) return;
  ctx.fillStyle = '#ffd700';
  ctx.font = 'bold 9px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText('★'.repeat(stars), x, y);
}
