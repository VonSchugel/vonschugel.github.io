const WIDTH = 1000;
const BASE_HEIGHT = 520;
const CARD_HEIGHT = 68;
const LANES = [
  { name: 'Capture', x: 50, width: 205 },
  { name: 'Review & data', x: 374, width: 212 },
  { name: 'Experience', x: 705, width: 225 },
];
const SLOTS = {
  'swarm-studio': ['Capture', 84],
  thesus: ['Capture', 309],
  'data-osint': ['Review & data', 286],
  astig: ['Review & data', 414],
  'support-studio': ['Experience', 58],
  'phone-gateway': ['Experience', 183],
  portfolio: ['Experience', 308],
  marketplace: ['Experience', 429],
};
const STATUSES = {
  connected: 'File handoff',
  shared: 'Shared stack',
  idea: 'Proposed adapter',
  separate: 'Separate',
};

const number = value => Number(value.toFixed(3));
const percent = (value, dimension) => `${number(value / dimension * 100)}%`;
const point = (x, y) => [x, y];
const position = value => `${number(value[0])} ${number(value[1])}`;

function placeNodes(nodes) {
  const extras = new Map();
  const rectangles = new Map();
  let height = BASE_HEIGHT;
  for (const node of nodes) {
    const slot = Object.hasOwn(SLOTS, node.id) ? SLOTS[node.id] : null;
    const lane = LANES.find(item => item.name === (node.lane || slot?.[0])) || LANES.at(-1);
    let y = slot?.[0] === lane.name ? slot[1] : null;
    if (y == null) {
      const index = extras.get(lane.name) || 0;
      y = BASE_HEIGHT + 20 + index * 110;
      extras.set(lane.name, index + 1);
      height = Math.max(height, y + CARD_HEIGHT + 30);
    }
    rectangles.set(node.id, { lane: lane.name, x: lane.x, y, w: lane.width, h: CARD_HEIGHT });
  }
  return { rectangles, height };
}

function cubicAt(start, first, second, end, t) {
  const inverse = 1 - t;
  return start.map((value, i) => inverse ** 3 * value + 3 * inverse ** 2 * t * first[i] + 3 * inverse * t ** 2 * second[i] + t ** 3 * end[i]);
}

function cubicRoute(start, first, second, end) {
  return { path: `M ${position(start)} C ${position(first)}, ${position(second)}, ${position(end)}`, label: cubicAt(start, first, second, end, .5), end, lead: second };
}

function lineRoute(points, label) {
  return { path: points.map((item, i) => `${i ? 'L' : 'M'} ${position(item)}`).join(' '), label, end: points.at(-1), lead: points.at(-2) };
}

function inside([x, y], rect, gap = 10) {
  return x > rect.x - gap && x < rect.x + rect.w + gap && y > rect.y - gap && y < rect.y + rect.h + gap;
}

function routeEdge(edge, layout) {
  const { rectangles, height } = layout;
  const from = rectangles.get(edge.from);
  const to = rectangles.get(edge.to);
  const others = [...rectangles].filter(([id]) => id !== edge.from && id !== edge.to).map(([, rect]) => rect);
  const fromY = from.y + from.h / 2;
  const toY = to.y + to.h / 2;
  if (from.lane === to.lane) {
    const center = from.x + from.w / 2;
    const downward = fromY < toY;
    const start = point(center, downward ? from.y + from.h : from.y);
    const end = point(center, downward ? to.y - 7 : to.y + to.h + 7);
    if (!others.some(rect => rect.lane === from.lane && rect.y > Math.min(from.y, to.y) && rect.y < Math.max(from.y, to.y))) {
      return lineRoute([start, end], point(center, (start[1] + end[1]) / 2));
    }
    // If new nodes intervene in a lane, go around their right edge.
    const right = from.x + from.w;
    const gutter = right + 37;
    const corner = point(gutter, fromY);
    const approach = point(gutter, toY);
    return lineRoute([point(right, fromY), corner, approach, point(right + 7, toY)], point(gutter, (fromY + toY) / 2));
  }

  const sign = from.x < to.x ? 1 : -1;
  const startX = sign > 0 ? from.x + from.w : from.x;
  const endX = sign > 0 ? to.x - 7 : to.x + to.w + 7;
  // Two supported Swarm handoffs leave at different points so neither looks like the other.
  const fork = edge.from === 'swarm-studio' ? ({ 'support-studio': -10, 'phone-gateway': 15 })[edge.to] || 0 : 0;
  const start = point(startX, fromY + fork);
  const end = point(endX, toY);
  const reach = Math.abs(endX - startX) * .41;
  const first = point(start[0] + sign * reach, start[1]);
  const second = point(end[0] - sign * reach, end[1]);
  const obstructed = others.some(rect => Array.from({ length: 25 }, (_, i) => (i + 1) / 26).some(t => inside(cubicAt(start, first, second, end, t), rect)));
  if (!obstructed) return cubicRoute(start, first, second, end);

  // An added cross-lane link can pass through occupied columns. Use the clear
  // inter-lane gutters and the bottom margin in that case.
  const startGutter = startX + sign * 26;
  const endGutter = endX - sign * 26;
  const bottom = height - 15;
  return lineRoute([start, point(startGutter, start[1]), point(startGutter, bottom), point(endGutter, bottom), point(endGutter, end[1]), end], point((startGutter + endGutter) / 2, bottom));
}

function arrowPath({ end, lead }) {
  const dx = end[0] - lead[0];
  const dy = end[1] - lead[1];
  const distance = Math.hypot(dx, dy) || 1;
  const x = dx / distance;
  const y = dy / distance;
  const back = point(end[0] - 10 * x, end[1] - 10 * y);
  const left = point(back[0] - 5 * y, back[1] + 5 * x);
  const right = point(back[0] + 5 * y, back[1] - 5 * x);
  return `M ${position(left)} L ${position(end)} L ${position(right)}`;
}

function inspectorNode(entry, rect) {
  const visibility = entry.visibility || 'public';
  return {
    id: entry.id, title: entry.title, kind: entry.kind, lane: rect.lane, visibility,
    summary: entry.summary, stack: entry.stack,
    ...(visibility === 'private' && entry.repoState === 'initialized' ? { repoState: 'initialized' } : {}),
  };
}

/** Render an offline network from validated public-facing project metadata. */
export function renderNetwork(connections, relations, escapeHTML) {
  if (!connections.length) return '';
  const layout = placeNodes(connections);
  const { rectangles, height } = layout;
  const nodes = connections.map(entry => inspectorNode(entry, rectangles.get(entry.id)));
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const edges = relations.map(({ from, to, status, title, description }) => ({ id: `${from}:${to}`, from, to, status, title, description }));
  const drawn = edges.map(edge => ({ edge, route: routeEdge(edge, layout) }));
  const wires = drawn.map(({ edge, route }) => {
    const directed = edge.status === 'connected' || edge.status === 'idea';
    return `<g class="network-edge" data-network-wire="${escapeHTML(edge.id)}" data-status="${edge.status}"><path class="network-edge-hit" d="${route.path}" fill="none" stroke="transparent" stroke-width="18" pointer-events="stroke" vector-effect="non-scaling-stroke"/><path class="network-edge-line" d="${route.path}" fill="none" vector-effect="non-scaling-stroke"/>${directed ? `<path class="network-edge-arrow" d="${arrowPath(route)}" fill="none" vector-effect="non-scaling-stroke"/>` : ''}</g>`;
  }).join('\n');
  const laneLabels = LANES.filter(lane => nodes.some(node => node.lane === lane.name)).map(lane => `<div class="network-lane" style="--lane-x:${percent(lane.x + lane.width / 2, WIDTH)};--lane-y:${percent(26, height)}" aria-hidden="true">${escapeHTML(lane.name)}</div>`).join('\n');
  const nodeButtons = nodes.map(node => {
    const rect = rectangles.get(node.id);
    const styles = `--node-x:${percent(rect.x, WIDTH)};--node-y:${percent(rect.y, height)};--node-w:${percent(rect.w, WIDTH)};--node-h:${percent(rect.h, height)}`;
    const badge = node.visibility === 'private' ? '<span class="network-node-badge">Private</span>' : '';
    return `<button type="button" class="network-node" data-network-node="${escapeHTML(node.id)}" aria-pressed="false" style="${styles}"><span class="network-node-title">${escapeHTML(node.title)}</span><span class="network-node-kind">${escapeHTML(node.kind)}</span>${badge}</button>`;
  }).join('\n');
  const edgeButtons = drawn.map(({ edge, route }) => {
    const from = nodeById.get(edge.from).title;
    const to = nodeById.get(edge.to).title;
    const connector = edge.status === 'connected' || edge.status === 'idea' ? ' to ' : ' and ';
    const label = `${from}${connector}${to}: ${STATUSES[edge.status]} — ${edge.title}`;
    return `<button type="button" class="network-edge-button" data-network-edge="${escapeHTML(edge.id)}" data-status="${edge.status}" aria-pressed="false" aria-label="${escapeHTML(label)}" title="${escapeHTML(edge.title)}" style="--edge-x:${percent(route.label[0], WIDTH)};--edge-y:${percent(route.label[1], height)}">${STATUSES[edge.status]}</button>`;
  }).join('\n');
  const filters = Object.entries(STATUSES).filter(([status]) => edges.some(edge => edge.status === status)).map(([status, label]) => `<button type="button" data-network-filter="${status}" aria-pressed="true">${label}</button>`).join('');
  const json = JSON.stringify({ nodes, edges }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<section class="network-view" data-map-view="network" id="project-network" aria-label="Project network">
    <div class="network-toolbar">
      <div class="network-filter-group" role="group" aria-label="Connection types">${filters}</div>
      <p class="network-count" data-network-count>${edges.length} of ${edges.length} connections</p>
      <div class="network-zoom" role="group" aria-label="Network zoom"><button type="button" data-network-zoom="out" aria-label="Zoom out">−</button><output data-network-scale aria-label="Zoom level">100%</output><button type="button" data-network-zoom="in" aria-label="Zoom in">+</button><button type="button" data-network-zoom="fit" aria-label="Fit network to view">Fit</button></div>
      <button type="button" class="network-reset" data-network-reset>Reset view</button>
    </div>
    <div class="network-layout">
      <div class="network-viewport" data-network-viewport tabindex="0" role="region" aria-label="Scrollable project network">
        <div class="network-plane" data-network-plane style="--network-ratio:${WIDTH} / ${height}">
          <svg class="network-wires" viewBox="0 0 ${WIDTH} ${height}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${wires}</svg>
          ${laneLabels}${nodeButtons}${edgeButtons}
        </div>
      </div>
      <aside class="network-inspector" data-network-inspector aria-label="Network inspector"><h3 class="network-inspector-title">Network overview</h3><p class="network-inspector-text">Select a project or connection for details. Arrows show direction. Dotted lines link projects with tools in common.</p></aside>
    </div>
    <script type="application/json" data-network-data>${json}</script>
  </section>`;
}
