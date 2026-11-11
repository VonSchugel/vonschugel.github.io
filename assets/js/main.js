import { initTeapot } from './teapot.js';
import { initProjectNetwork } from './project-network.js';

const themeButton = document.querySelector('.theme-toggle');
const moon = '<path d="M20.3 14a8.5 8.5 0 0 1-10.2-10.3A8.5 8.5 0 1 0 20.3 14Z"/>';
const sun = '<circle cx="12" cy="12" r="3.7"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.4 1.4M17.6 17.6 19 19M5 19l1.4-1.4M17.6 6.4 19 5"/>';
function syncThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark';
  themeButton.setAttribute('aria-label', 'Switch to ' + (dark ? 'light' : 'dark') + ' theme');
  themeButton.querySelector('svg').innerHTML = dark ? sun : moon;
  document.querySelector('meta[name="theme-color"]').content = dark ? '#000000' : '#ffffff';
}
syncThemeButton();
themeButton.addEventListener('click', () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('marqicci-theme', theme); } catch { /* Persistence is optional. */ }
  syncThemeButton();
  window.dispatchEvent(new CustomEvent('themechange'));
});

const filterGroup = document.querySelector('.project-filters');
const cards = [...document.querySelectorAll('.project-card')];
filterGroup.hidden = false;
filterGroup.addEventListener('click', event => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  filterGroup.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  let visible = 0;
  for (const card of cards) {
    const tags = (card.dataset.tags || '').toLowerCase().split(/\s+/);
    const show = button.dataset.filter === 'all' || tags.includes(button.dataset.filter);
    card.hidden = !show;
    if (show) visible++;
  }
  document.querySelector('#filter-status').textContent = visible + (visible === 1 ? ' project shown.' : ' projects shown.');
});

initTeapot(document.querySelector('#tea-logo'));

const navLinks = [...document.querySelectorAll('.main-nav a')];
const sectionObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    for (const link of navLinks) {
      if (link.hash === '#' + entry.target.id) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }
}, { rootMargin: '-10% 0px -55% 0px' });
document.querySelectorAll('#connections, #work, #writing, #cv').forEach(section => sectionObserver.observe(section));

function initProjectMap() {
  const map = document.querySelector('[data-connection-map]');
  if (!map) return;
  const selectors = [...map.querySelectorAll('[data-map-select]')];
  const panels = [...map.querySelectorAll('[data-map-panel]')];
  const views = [...map.querySelectorAll('[data-map-view]')];
  const modes = [...map.querySelectorAll('[data-map-mode]')];
  const overview = map.querySelector('.map-overview');
  const announcement = document.querySelector('#map-announcement');
  if (!selectors.length || !panels.length) return;
  const hasNetwork = initProjectNetwork(map, announcement);
  const viewLabels = { network: 'the project network', tree: 'the project tree', compatibility: 'project compatibility' };

  function showView(view, announce = false) {
    if (!views.some(panel => panel.dataset.mapView === view)) return;
    if (overview) overview.hidden = view === 'network';
    for (const panel of views) panel.hidden = panel.dataset.mapView !== view;
    for (const button of modes) button.setAttribute('aria-pressed', String(button.dataset.mapMode === view));
    if (announce && announcement) announcement.textContent = `Showing ${viewLabels[view]}.`;
  }

  function select(id, announce = false) {
    const selected = panels.find(panel => panel.dataset.mapPanel === id);
    if (!selected) return;
    for (const panel of panels) panel.hidden = panel !== selected;
    for (const link of selectors) {
      if (link.dataset.mapSelect === id) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
    for (const link of map.querySelectorAll('.flow-chip')) {
      if (link.dataset.mapJump === id) link.dataset.active = 'true';
      else delete link.dataset.active;
    }
    if (announce && announcement) announcement.textContent = 'Showing ' + selected.querySelector('h3').textContent + '.';
    return selected;
  }

  function fromHash() {
    if (hasNetwork && (location.hash === '#project-network' || location.hash === '#connections')) {
      showView('network');
      return true;
    }
    if (location.hash === '#project-compatibility' && modes.length) {
      showView('compatibility');
      return true;
    }
    const link = selectors.find(candidate => candidate.hash === location.hash);
    if (link) {
      showView('tree');
      select(link.dataset.mapSelect);
    }
    return Boolean(link);
  }

  map.dataset.enhanced = 'true';
  select(selectors[0].dataset.mapSelect);
  if (!fromHash()) showView(hasNetwork ? 'network' : 'tree');
  window.addEventListener('hashchange', fromHash);

  map.addEventListener('click', event => {
    const mode = event.target.closest('[data-map-mode]');
    if (mode) { showView(mode.dataset.mapMode, true); return; }
    const link = event.target.closest('[data-map-select], [data-map-jump]');
    if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    event.preventDefault();
    showView('tree');
    const selected = select(link.dataset.mapSelect || link.dataset.mapJump, true);
    if (link.hasAttribute('data-map-jump') && selected) {
      selected.focus({preventScroll: true});
      selected.scrollIntoView({block: 'nearest'});
    }
  });

  map.addEventListener('keydown', event => {
    const current = selectors.indexOf(event.target);
    if (current < 0) return;
    let next;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = (current + 1) % selectors.length;
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') next = (current + selectors.length - 1) % selectors.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = selectors.length - 1;
    else return;
    event.preventDefault();
    selectors[next].focus();
    select(selectors[next].dataset.mapSelect, true);
  });
}
initProjectMap();
