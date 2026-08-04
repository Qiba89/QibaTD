// Reine Formel-Funktionen der Multiplayer-Wirtschaft/Tech-Tree. Keine eigene
// Modul-State — greifen nur auf globale Konstanten aus balance-multiplayer.js /
// balance-shared.js zu (klassische <script>-Tags, vor allen Modulen geladen,
// siehe index.html) und auf die als Parameter übergebenen Werte.
export function sendIncomeBoost(unitCost, rate) { return Math.max(1, Math.ceil(unitCost * (rate !== undefined ? rate : DEFAULT_INCOME_BOOST_RATE))); }
export function canSend(sendTimes, limit) {
  const now = Date.now();
  while (sendTimes.length && now - sendTimes[0] > SEND_LIMIT_WINDOW_MS) sendTimes.shift();
  return sendTimes.length < (limit || SEND_LIMIT_COUNT);
}
export function hasTech(techObj, branch, tier) { return techObj[branch] >= tier; }
export function sendLimitFor(tech) { return hasTech(tech, 'attack', 3) ? SEND_LIMIT_COUNT_UPGRADED : SEND_LIMIT_COUNT; }
export function incomeRateBonusFor(tech) { return hasTech(tech, 'economy', 2) ? 0.05 : 0; }
export function unitSpeedMultFor(tech) { return hasTech(tech, 'attack', 2) ? 1.1 : 1; }
export function baseIncomeFor(tech) { return 1; } // Tier 3/4 waren hier vorher eingerechnet, sind jetzt Zinsen/Steuern (siehe unten)
export function mineIncomeMultFor(tech) { return hasTech(tech, 'economy', 1) ? 1.2 : 1; }
export function rangeMultFor(tech) { return hasTech(tech, 'defense', 3) ? 1.1 : 1; }
// "Brutto"-Einkommen: Basis + Minen + Sende-Bonus, OHNE Zinsen/Steuern - das ist die Grundlage,
// von der die Steuer des Gegners abgezweigt wird (siehe hostUpdate()). Ohne diese Trennung würde
// "Steuer vom Einkommen des Gegners" zirkulär, falls beide Spieler Steuern haben (A's Einkommen
// hängt von B's Einkommen ab, das wiederum von A's Einkommen abhängt, ...).
export function grossIncomeFor(tech, structs, bonusIncome) { return baseIncomeFor(tech) + mineIncomeTotal(structs) * mineIncomeMultFor(tech) + bonusIncome; }
export function interestIncomeFor(tech, currentGold) { return hasTech(tech, 'economy', 3) ? currentGold * INTEREST_RATE_PER_SEC : 0; }
export function taxIncomeFor(tech, opponentGrossIncome) { return hasTech(tech, 'economy', 4) ? opponentGrossIncome * TAX_RATE : 0; }
