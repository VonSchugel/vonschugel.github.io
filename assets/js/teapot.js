/** The header's small Moroccan teapot doubles as a document reading indicator. */
const clamp = (value) => Math.max(0, Math.min(1, value));
const ease = (value) => value * value * (3 - 2 * value);
const PIVOT = { x: 49, y: 34 };
const SPOUT = { x: 21, y: 25.656 };
const GLASS_CENTER = 10;
const GLASS_BOTTOM = 59;
const GLASS_HEIGHT = 16;

/**
 * @param {HTMLElement} container The header element containing tea-logo.svg.
 * @returns {{setProgress: (value:number)=>number, destroy: ()=>void, readonly progress:number}|null}
 */
export function initTeapot(container) {
  if (!container) return null;
  const pot = container.querySelector('#logo-teapot');
  const stream = container.querySelector('#logo-stream');
  const fill = container.querySelector('#logo-glass-fill');
  const surface = container.querySelector('#logo-glass-surface');
  if (!pot || !stream || !fill) return null;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let progress = 0;
  let pouring = false;
  let angle = 0;
  let tween = null;
  let frame = 0;
  let idleTimer = 0;
  let destroyed = false;
  let lastScrollY = window.scrollY || 0;
  const removers = [];
  const listen = (target, event, handler, options) => {
    target.addEventListener(event, handler, options);
    removers.push(() => target.removeEventListener(event, handler, options));
  };

  function draw(now = performance.now()) {
    if (tween) {
      const elapsed = clamp((now - tween.start) / tween.duration);
      angle = tween.from + (tween.to - tween.from) * ease(elapsed);
      if (elapsed === 1) tween = null;
    }
    pot.setAttribute('transform', `rotate(${angle.toFixed(4)} ${PIVOT.x} ${PIVOT.y})`);
    const height = GLASS_HEIGHT * progress;
    const y = GLASS_BOTTOM - height;
    fill.setAttribute('y', String(y));
    fill.setAttribute('height', String(height));
    if (surface) {
      surface.setAttribute('cy', String(y));
      surface.setAttribute('rx', String(5.4 + progress * 1.4));
      surface.setAttribute('opacity', progress > 0 ? '.46' : '0');
    }
    const radians = angle * Math.PI / 180;
    const x = PIVOT.x + (SPOUT.x - PIVOT.x) * Math.cos(radians) - (SPOUT.y - PIVOT.y) * Math.sin(radians);
    const tipY = PIVOT.y + (SPOUT.x - PIVOT.x) * Math.sin(radians) + (SPOUT.y - PIVOT.y) * Math.cos(radians);
    stream.setAttribute('d', `M${x.toFixed(4)} ${tipY.toFixed(4)} C${(x - 4).toFixed(4)} ${(tipY + 6).toFixed(4)} ${GLASS_CENTER} ${(y - 7).toFixed(4)} ${GLASS_CENTER} ${y.toFixed(4)}`);
    stream.setAttribute('opacity', pouring && !reducedMotion.matches ? '.6' : '0');
    container.dataset.progress = String(progress);
    container.dataset.pouring = String(pouring && !reducedMotion.matches);
  }

  function tick(now) {
    frame = 0;
    if (destroyed || document.hidden) return;
    draw(now);
    if (tween) frame = requestAnimationFrame(tick);
  }

  function queue() {
    if (!frame && !destroyed && !document.hidden) frame = requestAnimationFrame(tick);
  }

  function setPouring(next) {
    const active = Boolean(next && !reducedMotion.matches && !document.hidden);
    if (active !== pouring) {
      pouring = active;
      tween = reducedMotion.matches ? null : { from: angle, to: active ? -10 : 0, start: performance.now(), duration: 140 };
      if (reducedMotion.matches) angle = 0;
    }
    queue();
  }

  function readProgress(scrollY = window.scrollY || 0) {
    const page = document.scrollingElement || document.documentElement;
    const distance = page.scrollHeight - document.documentElement.clientHeight;
    progress = distance > 0 ? clamp(scrollY / distance) : 0;
  }

  function measure() {
    if (destroyed) return;
    lastScrollY = window.scrollY || 0;
    readProgress(lastScrollY);
    queue();
  }

  function onScroll() {
    const y = window.scrollY || 0;
    const delta = y - lastScrollY;
    lastScrollY = y;
    readProgress(y);
    if (delta > 0) {
      clearTimeout(idleTimer);
      setPouring(true);
      idleTimer = setTimeout(() => { idleTimer = 0; setPouring(false); }, 180);
    } else if (delta < 0) {
      clearTimeout(idleTimer);
      idleTimer = 0;
      setPouring(false);
    }
    queue();
  }

  function setProgress(value) {
    const number = Number(value);
    progress = Number.isFinite(number) ? clamp(number) : 0;
    draw();
    return progress;
  }

  listen(window, 'scroll', onScroll, { passive: true });
  listen(window, 'resize', measure, { passive: true });
  listen(window, 'pageshow', measure);
  listen(reducedMotion, 'change', () => {
    clearTimeout(idleTimer);
    idleTimer = 0;
    pouring = false;
    angle = 0;
    tween = null;
    queue();
  });
  listen(document, 'visibilitychange', () => {
    clearTimeout(idleTimer);
    idleTimer = 0;
    pouring = false;
    angle = 0;
    tween = null;
    if (document.hidden) { cancelAnimationFrame(frame); frame = 0; draw(); }
    else measure();
  });

  // Filtering projects, loading fonts, and changing viewport size can change
  // the reading distance even when the browser's scroll position stays put.
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
  observer?.observe(document.documentElement);
  if (document.body) observer?.observe(document.body);
  document.fonts?.ready.then(() => { if (!destroyed) measure(); });
  measure();
  draw();

  return {
    setProgress,
    get progress() { return progress; },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frame);
      clearTimeout(idleTimer);
      observer?.disconnect();
      removers.forEach((remove) => remove());
    },
  };
}
