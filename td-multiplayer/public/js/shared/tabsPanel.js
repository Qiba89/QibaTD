// Generische, spiel-unabhängige Tab-Umschaltung für Sidebar-Panels.
// Wird sowohl von Multiplayer als auch (optional) von Singleplayer genutzt.
// Kennt keine Spiellogik - reagiert nur auf .ctab-Buttons und zeigt/versteckt
// die passenden .panel[data-tab]-Elemente innerhalb des übergebenen Containers.
//
// Nutzung: initTabsPanel('.controls') wird einmal beim Laden des Moduls aufgerufen,
// das ".controls"-Element muss beim Aufruf bereits im DOM vorhanden sein
// (module-scripts laufen nach dem vollständigen HTML-Parse, das ist also der Fall).
export function initTabsPanel(containerSelector) {
  const container = document.querySelector(containerSelector);
  if (!container) return;
  const tabs = container.querySelectorAll(':scope > .controls-tabs > .ctab');
  const panels = container.querySelectorAll(':scope > .panel[data-tab]');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.toggle('active', b === btn));
      panels.forEach(p => {
        p.style.display = (p.dataset.tab === btn.dataset.tab) ? 'block' : 'none';
      });
    });
  });
}
