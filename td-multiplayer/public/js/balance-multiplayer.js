// ── Balancing-Werte: Multiplayer (PvP über Raum-Code) ──────────────────────
// Ausgelagert aus index.html (war vorher inline im ersten <script>-Block).
// Geteilte Tier-Skalierung (Türme) steht in balance-shared.js.
// Siehe docs/balancing.md für Tabellen & Design-Begründung.

// Türme
// Nachtrag (Reichweiten-Fix, User-Feedback "Türme haben zu wenig Reichweite" + "Arrow-Turm sollte
// mindestens x1,5 Reichweite ggü. Kanone haben"): Pfeilturm-Basisreichweite 110→135, damit das
// Verhältnis zur Kanone (90) exakt ×1.5 beträgt (135/90 = 1.5) - unabhängig vom separaten
// CELL/VSCALE-Fix in index.html (der beide Werte gleichermaßen skaliert und das Verhältnis daher
// nicht verändert).
const TOWER_TYPES = {
  arrow:  { name: 'Pfeilturm', cost: 50,  range: 135, damage: 9,  fireRate: 500,  color: '#4fd1c5', projSpeed: 500 },
  cannon: { name: 'Kanone',    cost: 100, range: 90,  damage: 25, fireRate: 1100, color: '#ff9f43', projSpeed: 320, splash: 45, groundOnly: true },
  frost:  { name: 'Frostturm', cost: 80,  range: 100, aura: true, slow: 0.5, slowDuration: 1500, color: '#63b3ed' },
  // Tesla-Turm (Nachtrag): reiner Anti-Air-Spezialist - feuert NUR auf Fliegende (`airOnly`,
  // Gegenstück zu `groundOnly` bei der Kanone), dafür mit Kettenblitz (siehe `teslaChainJumps()`
  // unten und moveProjectiles() in index.html): der Schaden springt beim Einschlag von Ziel zu Ziel
  // weiter, zum jeweils NÄCHSTGELEGENEN noch nicht getroffenen fliegenden Ziel. Nachtrag (Balance-
  // Fix, auf Nutzeranfrage: "das springen soll einfach zum nächsten gegner gehen ohne reichweiten
  // beschränkung"): ursprünglich war der Sprung auf 1 Feld Abstand begrenzt (TESLA_CHAIN_RANGE), das
  // wurde als zu schwach empfunden - jetzt springt die Kette uneingeschränkt weit. Sprunganzahl
  // wächst weiterhin mit dem Turm-Tier: 1 (Basis) → 2 (ab Stern 2) → 3 (ab Stern 4) → 5 (ab Stern 6),
  // siehe teslaChainJumps() unten (Schwellen seit der Stern-Kompression 2/4/6 statt vorher 10/20/30).
  // Kosten/Reichweite wie Kanone (wie angefragt: "Spezialist"). Schaden bewusst NICHT wie Kanone
  // (das wäre die AoE-Kurve, DAMAGE_CAP_MULT_AOE=2.6 in balance-shared.js) - Tesla trifft pro Ziel
  // EINZELN (kein Flächenradius, `splash` bleibt 0), nutzt also automatisch die höhere Einzelziel-
  // Kurve (DAMAGE_CAP_MULT_SINGLE=4.5, wie Pfeil-/Frostturm). Basis-Schaden 8 = ca. 33% der Kanone
  // (25 × 0.33 ≈ 8.25, abgerundet), wie vom Nutzer vorgeschlagen: gegen ein einzelnes fliegendes
  // Ziel bleibt Tesla dadurch klar schwächer als der Pfeilturm (Basis 9, gleiche Kurve, aber
  // schnellere Feuerrate 500ms statt 1100ms hier) - der eigentliche Wert kommt erst durch die Kette
  // gegen mehrere geclusterte Flieger (z.B. eine gezielte Ice-Cube-Schwarm-Taktik des Gegners) sowie
  // dadurch, dass Tesla bei Vollausbau der EINZIGE Turm ist, der einen voll ausgebauten Flattermann (intern weiterhin "icecube") noch
  // anvisieren kann (siehe UNIT_TYPES.icecube-Kommentar unten). Siehe docs/balancing.md, Abschnitt
  // "Tesla-Turm".
  tesla:  { name: 'Tesla-Turm', cost: 100, range: 90, damage: 8, fireRate: 1100, color: '#22d3ee', projSpeed: 500, airOnly: true },
  // `auraTarget: 'towers'` (Nachtrag, siehe towerTargetIconsHtml()-Fix in balance-shared.js): ohne
  // diesen Wert zeigte das Tooltip fälschlich den "verlangsamt Gegner"-Text (SPs Default für Auren
  // ohne explizites auraTarget) statt "verstärkt Türme im Radius".
  booster: { name: 'Booster',   cost: 80,  range: 120, aura: true, auraTarget: 'towers', color: '#fbbf24' },
  // Kosten 60 → 100: bei 60 war die Amortisationszeit (10s bis der Grund-Ertrag von 6 Gold/s die
  // Kosten wieder reingeholt hat) zu kurz - eine Mine war praktisch risikofrei sofort im Vorteil.
  // Bei 100 sind es ~16.7s Amortisation, spürbar mehr Risiko/Opportunitätskosten (das Gold hätte in
  // der Zeit auch schon einen halben Turm-Tier oder eine Einheiten-Sendung sein können). Ertrag
  // (6 Gold/s Basis) bewusst unverändert, siehe mineIncome() unten.
  mine:   { name: 'Mine',      cost: 100, color: '#ffd166' },
};
const BUILD_ORDER = ['arrow', 'cannon', 'frost', 'tesla', 'booster', 'mine'];
// Nachtrag (2026-08-05, User-Report "Frost-Aura funktioniert nicht" - siehe applyFrostAura() in
// mpCore.js): Frost hatte nie `damage`/`fireRate`/`projSpeed`, konnte als vermeintlicher
// Projektil-Turm also nie tatsächlich treffen (NaN-Geschwindigkeit statt echter Bewegung). Der
// Tooltip-Text (towerTargetIconsHtml() in balance-shared.js) beschrieb Frost aber schon vorher
// korrekt als "kontinuierlich, kein Projektil" - das ist jetzt auch tatsächlich die Implementierung.
// `TOWER_TYPES.frost.slow`/`slowDuration` werden dafür nicht mehr genutzt (waren fürs alte, nie
// funktionierende Projektil-Konzept) - `applyFrostAura()` setzt stattdessen `slowUntil` jeden Tick
// neu, solange eine Einheit im Aura-Radius steht, mit folgendem Refresh-Puffer gegen Frame-Lücken:
const FROST_SLOW_REFRESH_MS = 300;

// Bugfix + neues Feature (2026-08-05, User-Feedback "Booster zeigt ab Level 3 kein Wheel für
// Upgrades"): beim Nachforschen zeigte sich, dass der Booster-Turm in Multiplayer bis hierhin
// GAR KEINE Wirkung hatte - `TOWER_TYPES.booster` hat kein `damage`/`fireRate` (nur reine Aura-
// Türme), fireTowers() (mpCore.js) versuchte ihn trotzdem wie einen Kampfturm zu feuern, bekam
// dabei überall NaN (undefined*Zahl) und der Turm tat schlicht nichts - kein tatsächlicher Boost
// für nahe Türme existierte im Code (anders als im Singleplayer, wo `boosterBuffFor()` in
// spCore.js genau das schon lange leistet). Jetzt nachgebaut, MP-eigene Konstanten (bewusst
// dieselben Werte wie SP_BOOSTER_* in balance-singleplayer.js, für gleiches Spielgefühl in beiden
// Modi - aber als eigene MP_-Konstanten statt eine Abhängigkeit auf SP-Code zu bauen).
const MP_BOOSTER_DAMAGE_BUFF_BASE = 0.15, MP_BOOSTER_DAMAGE_BUFF_GROWTH_PER_TIER = 0.05, MP_BOOSTER_DAMAGE_BUFF_CAP = 0.50;
const MP_BOOSTER_FIRERATE_BUFF_BASE = 0.10, MP_BOOSTER_FIRERATE_BUFF_GROWTH_PER_TIER = 0.04, MP_BOOSTER_FIRERATE_BUFF_CAP = 0.35;
// Booster-Spezialisierung (User-Idee, im Anschluss an die Stealther-Balancing-Diskussion: "der
// Turm Booster bekommt ab level 3 eine Spezialisierung, über ein Wheel kann man eine Auswählen").
// Ab BOOSTER_SPEC_TIER öffnet sich EINMALIG (siehe checkBoosterSpecPrompts() in mpCore.js) ein
// Wheel (dieselbe Komponente wie das Bau-Wheel, js/shared/buildWheel.js) zur Wahl EINER
// permanenten Zusatz-Fähigkeit, die zum normalen Schaden/Feuerrate-Boost oben ADDITIV dazukommt
// (kein Ersatz dafür) - Türme in der Aura eines spezialisierten Boosters bekommen also weiterhin
// den normalen Boost UND den Spezial-Effekt. `vision` ist der Konter gegen die neue unsichtbare
// Einheit Stealther (siehe UNIT_TYPES.stealther) - ohne einen spezialisierten Booster in der Nähe
// bleibt Stealther für JEDEN Turm unsichtbar, siehe fireTowers()-Kommentar dort.
const BOOSTER_SPEC_TIER = 3;
const BOOSTER_SPEC_RANGE_BONUS = 0.20;   // 'range': +20% Reichweite für Türme in der Aura
const BOOSTER_SPEC_SPLASH_BONUS = 0.30;  // 'splash': +30% Explosionsradius für Türme in der Aura
const BOOSTER_SPEC_CHAIN_BONUS = 1;      // 'chain': +1 Tesla-Kettensprung für Tesla-Türme in der Aura
const BOOSTER_SPECIALIZATIONS = {
  vision: { name: 'Vision', icon: '👁️', sub: 'Deckt Stealth-Einheiten in der Aura auf' },
  range: { name: 'Fernrohr', icon: '🔭', sub: `+${Math.round(BOOSTER_SPEC_RANGE_BONUS * 100)}% Reichweite (Türme in Aura)` },
  splash: { name: 'Sprengverstärker', icon: '💥', sub: `+${Math.round(BOOSTER_SPEC_SPLASH_BONUS * 100)}% Explosionsradius (Türme in Aura)` },
  chain: { name: 'Kettenverstärker', icon: '⚡', sub: `+${BOOSTER_SPEC_CHAIN_BONUS} Tesla-Kettensprung (Tesla-Türme in Aura)` },
};

// Tesla-Kettenblitz: Sprunganzahl nach Turm-Tier gestaffelt (siehe TOWER_TYPES.tesla-Kommentar
// oben). Gedeckelt bei Tier 6 von 10 (nicht weiter bei Vollausbau gestiegen) - 5 gleichzeitig
// getroffene Flieger sind schon ein sehr hoher Deckenwert, mehr würde bei dichten Schwärmen zu
// einseitig werden. Schwellen 30/20/10 → 6/4/2 (Nachtrag Stern-Kompression, balance-shared.js):
// das waren die alten Fein-Tier-Werte für Stern 6/4/2 (30/5=6, 20/5=4, 10/5=2) - identisch
// gebliebene Sprungzahl-Stufen, jetzt einfach in der neuen 10er-Skala ausgedrückt.
function teslaChainJumps(tier) {
  if (tier >= 6) return 5;
  if (tier >= 4) return 3;
  if (tier >= 2) return 2;
  return 1;
}
const DEFAULT_INCOME_BOOST_RATE = 0.10;

// Minen-Anzahl-Limit (MINE_MAX_COUNT) und Minen-Ertragsformel (mineIncome()/mineIncomeTotal(),
// inkl. MINE_INCOME_GROWTH_PER_TIER/MINE_INCOME_CAP_MULT) stehen jetzt in balance-shared.js -
// seit dem Endlos-Modus-Port hat auch der Singleplayer Minen (siehe dort, Abschnitt "Minen"),
// die Formel/der Deckel gilt jetzt für beide Modi identisch. Siehe docs/balancing.md.

// Einheiten (werden zum Gegner geschickt)
//
// Apex-Fähigkeiten bei Vollausbau (Nachtrag): eine voll ausgebaute (Tier === UNIT_MAX_TIER, seit der
// Stern-Kompression 10 statt vorher 50) Einheit bekommt zusätzlich zur normalen HP-Skalierung
// (unitHpMult(), unten) eine einmalige, feste Sonderfähigkeit - ein spürbarer "es hat sich gelohnt,
// komplett auszubauen"-Moment am Ende der ohnehin schon sehr teuren Kosten-Kurve
// (UNIT_COST_GROWTH_PER_TIER, ungedeckelt). Umsetzung jeweils direkt an der betroffenen
// Spielmechanik (Slow-Anwendung in moveUnits(), Flächenschaden-Anwendung in moveProjectiles(),
// Ziel-Auswahl in fireTowers() - alle in index.html), Prüfung überall per `u.tier >= UNIT_MAX_TIER`
// auf die gesendete Einheit (braucht das neue `key`-Feld auf dem Einheiten-Objekt, siehe
// hostSendUnit()). Details/Begründung je Einheit in docs/balancing.md, Abschnitt "Apex-Fähigkeiten".
//  - sprinter: bei Vollausbau immun gegen Flächenschaden (Kanonen-Splash trifft ihn nicht mehr).
//  - guard:    bei Vollausbau Selbstheilung GUARD_APEX_HEAL_PCT_PER_SEC (8%) der Max-HP pro Sekunde.
//              (Nachtrag, Bugfix auf Nutzeranfrage: stand ursprünglich fälschlich auf 80% - bei 80%/s
//              war die Einheit bei Vollausbau praktisch unbesiegbar, siehe docs/balancing.md.)
//  - brecher:  bei Vollausbau zusätzlich immun gegen Slow (war bisher nur Fliegenden vorbehalten).
//  - icecube:  bei Vollausbau nur noch vom Tesla-Turm anvisierbar - alle anderen Türme ignorieren ihn
//              komplett bei der Zielsuche (siehe TOWER_TYPES.tesla-Kommentar oben).
//  - stealther: bei Vollausbau "Manipulation" - alle STEALTHER_MANIP_INTERVAL_MS (3s) wird der
//              nächstgelegene gegnerische Turm im Radius STEALTHER_MANIP_RADIUS für
//              STEALTHER_MANIP_DISABLE_MS (2s) deaktiviert (siehe applyStealtherManipulation() in
//              mpCore.js). Umsetzung: `u.manipCooldown`-Feld auf dem Einheiten-Objekt.
const UNIT_TYPES = {
  sprinter: { name: 'Sprinter', cost: 10, hp: 25,  speed: 140, color: '#4fd1c5', radius: 16 },
  guard:    { name: 'Guard',    cost: 25, hp: 70,  speed: 90,  color: '#ff9f43', radius: 20 },
  brecher:  { name: 'Brecher',  cost: 60, hp: 220, speed: 55,  color: '#c084fc', radius: 28 },
  // Nachtrag (2026-08-05, auf Nutzeranfrage): im UI umbenannt zu "Flattermann" (neues eigenes
  // Bewegungssprite, siehe MP_UNIT_VISUAL_KIND in mpAssets.js) - der interne Key `icecube` bleibt
  // bewusst unverändert (wird an vielen Stellen referenziert: AI-Gewichte, Upgrade-Kosten, APEX_INFO,
  // Tesla-Zielsuche-Kommentar oben usw.), nur der Anzeigename ändert sich.
  icecube:  { name: 'Flattermann', cost: 45, hp: 100, speed: 90,  color: '#a5f3fc', radius: 22, flying: true, incomeBoostRate: 0.05 },
  titan:    { name: 'Titan',    cost: 100, hp: 350, speed: 45, color: '#f43f5e', radius: 32, requiresTech: { branch: 'attack', tier: 4 } },
  // Nachtrag (2026-08-05, neue Einheit auf Nutzeranfrage): Stealther ist für Türme komplett
  // unsichtbar/unanvisierbar (siehe `stealth: true` - ausgewertet in fireTowers()/drawLane() in
  // mpCore.js) - es gibt aktuell KEINEN Turm mit "Vision", der das aufheben könnte (geplant, aber noch
  // nicht gebaut). Bewusst fragil (wenig HP, sogar unter Guard) und nur mittleres Tempo, damit die
  // ansonsten kaum konterbare Unsichtbarkeit nicht auch noch mit Tankiness kombiniert wird.
  // Balancing (Nachtrag, Entscheidung revidiert): KEIN Tech-Gate (ursprünglich Angriff-Tier 3 geplant,
  // wieder verworfen) - stattdessen hoher Basis-Preis (cost: 300, ggü. z.B. Titan 100) als alleinige
  // Bremse, warum die Einheit nicht von Beginn an im großen Stil gespammt werden kann. Der normale
  // Sende-Kosten-Wachstum pro Tier (unitSendCost(), unten) gilt unverändert weiter obendrauf.
  // `incomeBoostRate: 0` (Nachtrag, auf Nutzeranfrage "da er eine Technik-Unit ist soll er kein Gold
  // Gain geben, also +0/s"): ohne diesen Wert würde hostSendUnit() auf DEFAULT_INCOME_BOOST_RATE
  // (10%) zurückfallen, wie bei sprinter/guard/brecher/titan - Stealther soll aber bewusst gar keinen
  // Bonus-Einkommen-Ertrag geben (anders als z.B. Flattermann mit reduzierten 5%, siehe icecube oben).
  stealther: { name: 'Stealther', cost: 300, hp: 50, speed: 90, color: '#7c3aed', radius: 18, stealth: true, incomeBoostRate: 0 },
};
const GUARD_APEX_HEAL_PCT_PER_SEC = 0.08;
// Stealther-Apex-Fähigkeit "Manipulation" (siehe UNIT_TYPES-Kommentar oben): Radius in Pixeln (auf
// CELL=80-Basis kalibriert, ähnlich einer Pfeilturm-Reichweite) sowie Intervall/Dauer in Millisekunden.
const STEALTHER_MANIP_INTERVAL_MS = 3000;
const STEALTHER_MANIP_DISABLE_MS = 2000;
const STEALTHER_MANIP_RADIUS = 160;

// Einheiten-Upgrades: UNIT_MAX_TIER 50 → 10 (Nachtrag, Stern-Kompression - siehe TOWER_MAX_TIER-
// Kommentar in balance-shared.js für die volle Begründung; auf Nutzerentscheidung "Türme + Einheiten"
// gilt dieselbe Kompression auch hier). 1 Klick = 1 Stern statt 1 Klick = 1 von 50 Fein-Tiers; jeder
// Klick liefert jetzt exakt die HP/Kosten, die vorher der ALTE Tier 5×T geliefert hätte (siehe
// UNIT_HP_GROWTH_PER_TIER-Herleitung unten). Die Tier-50-Apex-Fähigkeiten (siehe UNIT_TYPES-Kommentar
// oben) prüfen weiterhin relativ gegen UNIT_MAX_TIER (`u.tier >= UNIT_MAX_TIER`), lösen jetzt also
// bei Stufe 10 (statt 50) aus - unverändert "erst beim komplett ausgebauten Vollausbau".
// HP-Wachstum bleibt EXPLIZIT GEDECKELT bei UNIT_HP_CAP_MULT=20 (unverändert - absoluter
// Balance-Endpunkt, siehe TOWER_MAX_TIER-Kommentar in balance-shared.js, gleiches Prinzip), bewusst
// weiterhin ÜBER dem Turm-Schadens-Durchsatz-Deckel (x9.9 = Schaden x4.5 * Feuerrate x2.2,
// unverändert), damit eine voll ausgebaute Einheit strukturell mehr HP-Wachstum hat als der Turm
// Schaden aufbauen kann. Wachstumsrate (UNIT_HP_GROWTH_PER_TIER) per ^5 aus der alten Fein-Tier-Rate
// hergeleitet (UNIT_HP_GROWTH_PER_OLD_TIER, unverändert 1.0617) - exakt dasselbe Herleitungs-Prinzip
// wie bei den Turm-Wachstumsraten in balance-shared.js, damit HP bei kompaktem Tier T identisch zum
// alten Wert bei Fein-Tier 5×T bleibt.
// Kosten-Kurve (Nutzerentscheidung: "kumulierte Kosten gleich halten"): UNIT_UPGRADE_COST_BASE/
// UNIT_COST_GROWTH_PER_TIER beschreiben weiterhin die alte, feine 50-Tier-Kostenkurve unverändert -
// unitUpgradeCost() unten summiert für einen neuen Stern-Klick T jetzt die 5 alten Fein-Tier-Kosten
// auf, die dieser Klick ersetzt. Kumulierte Gesamtkosten bis Vollausbau bleiben dadurch exakt
// identisch zu vorher, nur gröbere Granularität (10 Zahlungen statt 50) - exakt dasselbe Prinzip wie
// bei tierUpgradeCost() in balance-shared.js.
const UNIT_MAX_TIER = 10;
// Bugfix (2026-08-05, User-Feedback "Gold wird NaN"): `stealther` fehlte hier - genau wie beim
// p1UnitTiers/p2UnitTiers-Bugfix (siehe mpCore.js) führte der fehlende Eintrag zu
// `UNIT_UPGRADE_COST_BASE[key] === undefined` und damit zu NaN-Upgrade-Kosten. Wert nach demselben
// Muster wie alle anderen Einheiten gewählt (Upgrade-Basis = 3× Sende-Kosten, siehe sprinter 10→30,
// guard 25→75, brecher 60→180, icecube 45→135, titan 100→300).
const UNIT_UPGRADE_COST_BASE = { sprinter: 30, guard: 75, brecher: 180, icecube: 135, titan: 300, stealther: 900 };
const UNIT_HP_GROWTH_PER_OLD_TIER = 1.0617;
const UNIT_HP_GROWTH_PER_TIER = Math.pow(UNIT_HP_GROWTH_PER_OLD_TIER, 5);
const UNIT_HP_CAP_MULT = 20;
const UNIT_COST_GROWTH_PER_TIER = 1.0902;

// Sende-Limit: max. 20 Einheiten pro rollierendem 10-Sekunden-Fenster (25 mit Angriffs-Tech T3)
const SEND_LIMIT_COUNT = 20;
const SEND_LIMIT_COUNT_UPGRADED = 25;
const SEND_LIMIT_WINDOW_MS = 10000;

// ── Bosse: bedrohen in festen Abständen BEIDE Seiten gleichzeitig ───────
const BOSS_INTERVAL_MS = 90000; // alle 90s
// BASE_HP von 300 auf 900 angehoben (Begründung + Rechenweg in docs/balancing.md,
// Abschnitt "Boss-HP herleiten"): 300 war zu niedrig gegen die in 90s aufbaubare
// Feuerkraft, Bosse starben zu schnell ("viel zu einfach"). GROWTH unverändert bei 1.3 —
// passt schon recht gut zur geschätzten Feuerkraft-Kurve über mehrere Boss-Runden.
const BOSS_BASE_HP = 900;
const BOSS_HP_GROWTH = 1.3; // pro Boss-Runde
const BOSS_SPEED = 40;
const BOSS_RADIUS = 40;
const BOSS_LEAK_LIVES = 3; // Lebenskosten, falls der Boss durchkommt

// ── Tech-Tree: 3 Zweige, je 4 Stufen, linear (Tier N braucht Tier N-1) ──
const TECH_MAX_TIER = 4;
const TECH_BRANCHES = ['defense', 'economy', 'attack'];
const TECH_LABELS = {
  defense: { name: '🛡️ Verteidigung', tiers: ['Einheiten-Regeneration (+5% Max-HP alle 2s für gesendete Einheiten)', 'Schild (3 Treffer abfangen, lädt alle 90s)', 'Turm-Reichweite +10%', 'Bollwerk (+5 Max-Leben)'] },
  // Wirtschaft Tier 3/4 umgebaut (waren vorher flache +1 bzw. +2 Gold/s - bei schon hohem Einkommen
  // spätestens ab ein paar tausend Gold/s praktisch bedeutungslos). Zinsen skalieren stattdessen MIT
  // dem eigenen Vermögen (siehe INTEREST_RATE_PER_SEC unten), Steuern MIT dem Einkommen des Gegners
  // (siehe TAX_RATE) - beide bleiben so über die ganze Partie relevant statt nur früh.
  economy: { name: '💰 Wirtschaft', tiers: ['Minen-Ertrag +20%', 'Sende-Einkommensschub +5%', 'Zinsen (1%/s vom aktuellen Gold)', 'Steuern (+5% vom Einkommen des Gegners)'] },
  attack:  { name: '⚔️ Angriff', tiers: ['Lebensklau (+1 eigenes Leben je durchgekommener Einheit)', 'Einheiten-Tempo +10%', 'Sende-Limit 20→25 pro 10s', 'Titan freigeschaltet (Elite-Einheit)'] },
};
function techPointCost(tier) { return 1; } // Jede Stufe kostet pauschal 1 Punkt (vorher: Tier 1 = 1P, Tier 2 = 2P, ... — zu langsam, da Punkte selten sind)

// Zinsen (Wirtschaft Tier 3): 1% pro Sekunde vom AKTUELLEN Gold-Bestand, kontinuierlich (nicht erst
// einmal pro ganzer Sekunde) - wächst also mit dem eigenen Vermögen mit, statt bei hohem Einkommen
// wertlos zu werden wie die alte feste +1 Gold/s. Achtung, bewusst dokumentiert: das ist Zinseszins
// (kontinuierliches Compoundieren) - bei ungenutztem, nur liegendem Gold über eine ganze lange
// Partie (>10 Minuten) kann sich das stark aufschaukeln (z.B. e^(0.01×600)≈403× nach 10 Minuten
// UNGENUTZTEM Gold). In der Praxis wird Gold aber laufend für Türme/Einheiten/Tech ausgegeben, was
// das stark dämpft - trotzdem ein Punkt fürs Playtesting, falls sich reines Gold-Horten als
// dominante Strategie erweist.
const INTEREST_RATE_PER_SEC = 0.01;
// Steuern (Wirtschaft Tier 4): +5% vom EINKOMMEN des Gegners (nicht von dessen Gold-Bestand!) als
// eigener Bonus. Bewusst als Abschöpfung der laufenden Einnahmen interpretiert, nicht als Raub am
// Vermögen - 5%/s vom GOLD-BESTAND des Gegners wäre bei ein paar tausend Gold sofort verheerend und
// könnte das Spiel im Extremfall in wenigen Sekunden gegen den Reicheren entscheiden. Bezieht sich
// auf das Brutto-Einkommen des Gegners OHNE dessen eigene Zinsen/Steuern (siehe hostUpdate()), sonst
// entsteht eine zirkuläre Abhängigkeit, falls beide Spieler Steuern haben.
const TAX_RATE = 0.05;

// Defense-Tier-1: die vom Spieler gesendeten Einheiten regenerieren HP, während sie über
// die gegnerische Lane laufen. 5% alle 2s, damit heilt eine Einheit ca. 20% ihrer Max-HP
// in der Zeit, die eine mittelschnelle Einheit (~90px/s) für die 680px-Lane braucht (~8s → 4 Ticks).
const UNIT_REGEN_PCT = 0.05;
const UNIT_REGEN_INTERVAL_MS = 2000;

// Tech-Punkte lassen sich zusätzlich zum Boss-Kill-Einkommen mit Gold kaufen.
// Kosten steigen als Fibonacci-Folge: 1000, 2000, 3000, 5000, 8000, 13000, 21000, ...
// n = wievielter Punktkauf in diesem Match (1-basiert, pro Spieler eigener Zähler).
function techPointBuyCost(n) {
  let a = 1, b = 2;
  if (n <= 1) return 1000 * a;
  for (let i = 2; i < n; i++) { const c = a + b; a = b; b = c; }
  return 1000 * b;
}

function unitHpMult(tier) { return Math.min(Math.pow(UNIT_HP_GROWTH_PER_TIER, tier), UNIT_HP_CAP_MULT); }
function unitEffectiveHp(key, tier) { return UNIT_TYPES[key].hp * unitHpMult(tier); }
function unitSendCost(key, tier) { return Math.round(UNIT_TYPES[key].cost * unitHpMult(tier)); }
// Summiert die 5 alten Fein-Tier-Kosten auf, die der neue Stern-Klick `nextTier` (1..10) ersetzt -
// siehe Kommentar bei UNIT_MAX_TIER oben ("kumulierte Kosten gleich halten"), exakt dasselbe Prinzip
// wie tierUpgradeCost() in balance-shared.js.
function unitUpgradeCost(key, nextTier) {
  let sum = 0;
  for (let k = (nextTier - 1) * 5 + 1; k <= nextTier * 5; k++) sum += Math.round(UNIT_UPGRADE_COST_BASE[key] * Math.pow(UNIT_COST_GROWTH_PER_TIER, k - 1));
  return sum;
}

// ── KI-Gegner: 3 Schwierigkeitsgrade, ersetzt Spieler 2 wenn kein echter Mitspieler da ist ──
// Die KI läuft komplett auf der Host-Seite (im selben Browser wie der menschliche Spieler) und
// ruft dieselben host*()-Funktionen mit forGuest=true auf wie ein echter Gast über die Aktions-
// Queue - sie braucht also KEINE Server-/WebSocket-Verbindung. Logik selbst steht in index.html
// (aiTick/aiDecide/...), hier nur die abgestimmten Zahlen pro Schwierigkeitsgrad.
//
// decisionIntervalMs / sendIntervalMs = "Reaktionsgeschwindigkeit" (wie oft die KI neu plant bzw.
// Einheiten schickt) - das ist der Haupthebel für "Tempo". reserveGoldRatio = welchen Anteil ihres
// Goldes die KI immer zurückhält, statt ihn sofort zu verbauen (niedriger = aggressiver/optimaler
// Kapitaleinsatz). targetTowersBase/PerBossRound und targetMinesBase/PerBossRound geben vor, wie
// viele Türme/Minen die KI anstrebt (wächst mit der Zeit, wie beim menschlichen Spieler auch).
// techPriority = feste Reihenfolge, in der Tech-Zweige hochgezogen werden (null = adaptiv, siehe
// aiPickTechBranch() in index.html). unitUpgradeChance = Wahrscheinlichkeit pro Entscheidungs-Tick,
// dass die KI statt eines Turms lieber einen Einheiten-Tier upgradet.
//
// minSafeTowers = Notfall-Schwelle (siehe aiInEmergency() in index.html): hat die KI weniger als
// minSafeTowers eigene Türme ODER rollt gerade ein Schwarm gesendeter Spieler-Einheiten an, den die
// aktuelle Turmzahl absehbar nicht bewältigt, pausiert sie Angriff, Tech-Käufe und Einheiten-
// Upgrades komplett und steckt ihr gesamtes Gold (Reserve ignoriert) in den eigenen Turmbau/-ausbau,
// bis die Gefahr vorbei ist. Ohne das würde z.B. der Weltenender bei einem sehr frühen, harten Rush
// des Spielers einfach weiter maximal aggressiv senden und nie eine eigene Verteidigung aufbauen -
// "maximal aggressiv" soll aber "so aggressiv wie sicher möglich" heißen, nicht "blind aggressiv".
// emergencyLivesRatio ist NUR ein Rückfall für echte Lebensgefahr unabhängig von der Ursache (sehr
// niedrig angesetzt) - bewusst NICHT der Haupt-Auslöser, weil Boss-Wellen (alle 90s, treffen beide
// Seiten unabhängig vom Spielverhalten) sonst denselben Notfallmodus auslösen würden wie ein
// Spieler-Rush und die KI ihre Verteidigung künstlich klein halten würde, obwohl die normale,
// mit der Bossrunde wachsende Ziel-Turmzahl Bosse eigentlich schon abdeckt.
const AI_PROFILES = {
  beginner: {
    label: 'Anfänger',
    // Solides, spürbares Tempo (nicht bewusst verlangsamt) aber "Grundlogik" statt Reaktion auf
    // den Spieler - deshalb adaptive:false und eine großzügige Gold-Reserve (spielt nicht bis aufs
    // letzte Gold aus).
    decisionIntervalMs: 1600, sendIntervalMs: 2600, sendBurst: 1,
    reserveGoldRatio: 0.30,
    targetMinesBase: 3, targetMinesPerBossRound: 0.5,
    targetTowersBase: 6, targetTowersPerBossRound: 1.0,
    towerWeights: { arrow: 0.45, frost: 0.25, cannon: 0.15, booster: 0.15 },
    unitWeights: { sprinter: 0.45, guard: 0.30, icecube: 0.15, brecher: 0.10 },
    // Wirtschaft zuerst (wie gefordert), danach Verteidigung, Angriffs-Tech zuletzt.
    techPriority: ['economy', 'defense', 'attack'],
    techBuyThresholdGold: 1500,
    unitUpgradeChance: 0.20,
    upgradeTowerShare: 0.5,
    adaptive: false,
    // Reagiert am trägsten auf Gefahr (passt zu "Grundlogik") - erst ab wenigen Türmen oder
    // ordentlichem Lebensverlust wird überhaupt umgeschaltet.
    minSafeTowers: 4,
    emergencyLivesRatio: 0.30,
  },
  challenger: {
    label: 'Herausforderer',
    // Deutlich schnelleres Tempo + kleinere Reserve = aggressiverer Kapitaleinsatz und mehr
    // Einheiten pro Zeiteinheit als der Anfänger.
    decisionIntervalMs: 1000, sendIntervalMs: 1600, sendBurst: 2,
    reserveGoldRatio: 0.15,
    targetMinesBase: 3, targetMinesPerBossRound: 0.4,
    targetTowersBase: 8, targetTowersPerBossRound: 1.2,
    towerWeights: { arrow: 0.40, frost: 0.25, cannon: 0.20, booster: 0.15 },
    unitWeights: { sprinter: 0.35, guard: 0.25, icecube: 0.20, brecher: 0.20 },
    // Verteidigung zuerst (wie gefordert - stabile eigene Basis trotz aggressivem Spiel), dann Angriff.
    techPriority: ['defense', 'attack', 'economy'],
    techBuyThresholdGold: 900,
    unitUpgradeChance: 0.35,
    upgradeTowerShare: 0.5,
    adaptive: false,
    minSafeTowers: 5,
    emergencyLivesRatio: 0.35,
  },
  worldender: {
    label: 'Weltenender',
    // Schnellste Reaktion, kleinste Reserve (setzt ihr Gold fast vollständig ein) und adaptive:true -
    // Turm-/Einheiten-Gewichtung und Tech-Zweig-Wahl reagieren live auf den Spielzustand
    // (siehe aiAdaptiveTowerWeights/aiAdaptiveUnitWeights/aiPickTechBranch in index.html), statt
    // einer festen Reihenfolge zu folgen.
    decisionIntervalMs: 450, sendIntervalMs: 900, sendBurst: 3,
    reserveGoldRatio: 0.05,
    targetMinesBase: 5, targetMinesPerBossRound: 0.6,
    targetTowersBase: 10, targetTowersPerBossRound: 1.5,
    towerWeights: { arrow: 0.35, frost: 0.25, cannon: 0.25, booster: 0.15 }, // Basiswerte, werden adaptiv überschrieben
    unitWeights: { sprinter: 0.30, guard: 0.20, icecube: 0.25, brecher: 0.25 }, // s.o.
    techPriority: null,
    techBuyThresholdGold: 400,
    unitUpgradeChance: 0.45,
    upgradeTowerShare: 0.6,
    adaptive: true,
    // Reagiert am schnellsten & frühesten auf Gefahr (höchste Schwelle, schnellster
    // decisionIntervalMs) - "perfekt reagieren" heißt auch: merkt eine Bedrohung, bevor sie
    // wirklich gefährlich wird, verteidigt kurz gezielt, und geht danach sofort wieder in volle
    // Aggression über, sobald die Basis wieder sicher ist.
    minSafeTowers: 6,
    emergencyLivesRatio: 0.40,
  },
};
