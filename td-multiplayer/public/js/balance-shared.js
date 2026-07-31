// ── Geteilte Turm-Tier-Skalierung ─────────────────────────────────────────
// Diese Formeln & Konstanten gelten für Multiplayer (PvP) UND Singleplayer
// (Endlos-Modus) — sie waren bisher in beiden Spiel-Engines separat (aber
// identisch) definiert. Jetzt gibt es nur noch eine Stelle zum Pflegen;
// wird hier etwas geändert, wirkt es sich auf BEIDE Modi aus.
// Siehe docs/balancing.md für die Design-Begründung hinter den Werten.

const TOWER_MAX_TIER = 4;
const TIER_COST_BASE = 15, TIER_COST_GROWTH = 1.7;
const DAMAGE_GROWTH_SINGLE = 1.40, AOE_DAMAGE_GROWTH = 1.25;
const AS_GROWTH_PER_TIER = 0.15, AS_CAP_MULT = 2.2;
const RANGE_GROWTH_PER_TIER = 1.05, RANGE_CAP_MULT = 1.2;
const RADIUS_GROWTH_PER_TIER = 1.08, RADIUS_CAP_MULT = 1.35;

function tierUpgradeCost(nextTier) { return Math.round(TIER_COST_BASE * Math.pow(TIER_COST_GROWTH, nextTier)); }
function effectiveDamage(t) { const g = t.baseSplash > 0 ? AOE_DAMAGE_GROWTH : DAMAGE_GROWTH_SINGLE; return t.baseDamage * Math.pow(g, t.tier); }
function effectiveFireRate(t) { const m = Math.min(1 + AS_GROWTH_PER_TIER * t.tier, AS_CAP_MULT); return t.baseFireRate / m; }
function effectiveRange(t) { const m = Math.min(Math.pow(RANGE_GROWTH_PER_TIER, t.tier), RANGE_CAP_MULT); return t.baseRange * m; }
function effectiveSplash(t) { if (!t.baseSplash) return 0; const m = Math.min(Math.pow(RADIUS_GROWTH_PER_TIER, t.tier), RADIUS_CAP_MULT); return t.baseSplash * m; }
