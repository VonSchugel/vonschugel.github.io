const relationshipLabels = {
  connected: 'File handoff', shared: 'Shared stack', idea: 'Proposed adapter', separate: 'Separate runtime'
};
const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
const traceModes = { direct: 'Direct', upstream: 'Upstream', downstream: 'Downstream' };
const contractLabels = { artifact: 'Artifact', transfer: 'Transfer', result: 'Result', boundary: 'Boundary', evidence: 'Evidence' };

function element(tag, className, content) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (content) item.textContent = content;
  return item;
}

function isDirected(edge) {
  return edge.status === 'connected' || edge.status === 'idea';
}

function traceRoutes(origin, edges, mode) {
  const upstream = mode === 'upstream';
  const start = upstream ? 'to' : 'from';
  const end = upstream ? 'from' : 'to';
  const branches = new Map();
  for (const edge of edges.filter(isDirected)) {
    if (!branches.has(edge[start])) branches.set(edge[start], []);
    branches.get(edge[start]).push(edge);
  }

  const routes = [];
  const visited = new Set([origin]);
  function walk(project, path) {
    for (const edge of branches.get(project) || []) {
      const next = edge[end];
      if (visited.has(next)) continue;
      const steps = upstream ? [edge, ...path] : [...path, edge];
      routes.push({ id: steps.map(step => step.id).join('|'), steps });
      visited.add(next);
      walk(next, steps);
      visited.delete(next);
    }
  }
  walk(origin, []);
  return routes.sort((a, b) => a.steps.length - b.steps.length || a.id.localeCompare(b.id));
}

export function initProjectNetwork(map, announcement) {
  const network = map.querySelector('[data-map-view="network"]');
  if (!network) return false;
  const data = network.querySelector('[data-network-data]');
  if (!data) return false;
  const { nodes, edges } = JSON.parse(data.textContent);
  const projects = new Map(nodes.map(project => [project.id, project]));
  const relationships = new Map(edges.map(edge => [edge.id, edge]));
  const viewport = network.querySelector('[data-network-viewport]');
  const plane = network.querySelector('[data-network-plane]');
  const inspector = network.querySelector('[data-network-inspector]');
  const overview = [...inspector.childNodes].map(child => child.cloneNode(true));
  const filters = [...network.querySelectorAll('[data-network-filter]')];
  const graphNodes = [...network.querySelectorAll('[data-network-node]')];
  const graphEdges = [...network.querySelectorAll('[data-network-edge]')];
  const wires = [...network.querySelectorAll('[data-network-wire]')];
  const scale = network.querySelector('[data-network-scale]');
  const zoomOut = network.querySelector('[data-network-zoom="out"]');
  const zoomFit = network.querySelector('[data-network-zoom="fit"]');
  const zoomIn = network.querySelector('[data-network-zoom="in"]');
  const statuses = new Set(filters.map(button => button.dataset.networkFilter));
  let selectedProject;
  let selectedEdge;
  let selectedRoute;
  let traceMode = 'direct';
  let zoom = 1;
  let fit = false;
  let drag;

  function announce(message) {
    if (announcement) announcement.textContent = message;
  }

  function inspectorHeading(label, title) {
    const heading = element('h3', 'network-inspector-title', title);
    heading.tabIndex = -1;
    inspector.replaceChildren(element('p', 'network-inspector-kicker', label), heading);
    return heading;
  }

  function inspectorButton(label, action, id, detail) {
    const button = element('button', 'network-inspector-action', label);
    button.type = 'button';
    button.dataset[action] = id;
    if (detail) button.append(element('small', '', detail));
    return button;
  }

  function showDirect(project, visible) {
    const adjacent = visible.filter(edge => edge.from === project.id || edge.to === project.id);
    const links = element('div', 'network-inspector-links');
    for (const edge of adjacent) {
      const outgoing = edge.from === project.id;
      const neighbor = projects.get(outgoing ? edge.to : edge.from);
      const direction = isDirected(edge) ? (outgoing ? 'To' : 'From') : 'With';
      links.append(inspectorButton(`${direction} ${neighbor.title}`, 'inspectEdge', edge.id, relationshipLabels[edge.status]));
    }
    if (!adjacent.length) links.append(element('p', 'network-inspector-text', 'No connections in the current filters.'));
    inspector.append(links);
  }

  function routeTitle(route) {
    const ids = [route.steps[0].from, ...route.steps.map(edge => edge.to)];
    return ids.map(id => projects.get(id).title).join(' → ');
  }

  function showTrace(routes, route) {
    const list = element('div', 'network-inspector-links network-trace-list');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', `${traceModes[traceMode]} routes`);
    for (const option of routes) {
      const count = option.steps.length;
      const status = option.steps.some(edge => edge.status === 'idea') ? 'Proposed' : 'File handoffs';
      const button = inspectorButton(routeTitle(option), 'traceRoute', option.id, `${status} · ${count} ${count === 1 ? 'step' : 'steps'}`);
      button.setAttribute('aria-pressed', String(option === route));
      list.append(button);
    }
    if (!routes.length) list.append(element('p', 'network-inspector-text', `No ${traceMode} routes in the current filters.`));
    inspector.append(list);
    if (!route) return;

    const steps = element('ol', 'network-trace-steps');
    for (const edge of route.steps) {
      const item = element('li');
      const label = `${projects.get(edge.from).title} → ${projects.get(edge.to).title}`;
      const detail = [relationshipLabels[edge.status], edge.contract?.artifact].filter(Boolean).join(' · ');
      const button = inspectorButton(label, 'inspectEdge', edge.id, detail);
      button.dataset.traceStep = '';
      item.append(button);
      steps.append(item);
    }
    inspector.append(element('h4', 'network-inspector-subheading', 'Route steps'), steps);
  }

  function showProject(project, visible, routes, route) {
    const heading = inspectorHeading(project.lane || 'Project', project.title);
    const source = project.repoState === 'initialized' ? 'Private · README only' : { public: 'Public source', private: 'Private repo', local: 'Local source' }[project.visibility];
    inspector.append(element('p', 'network-inspector-status', [project.kind, source].filter(Boolean).join(' · ')), element('p', 'network-inspector-text', project.summary));
    if (project.stack.length) {
      const stack = element('ul', 'network-inspector-tags');
      stack.setAttribute('aria-label', 'Technologies');
      stack.append(...project.stack.map(item => element('li', '', item)));
      inspector.append(stack);
    }
    const controls = element('div', 'network-trace-controls');
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Connection view');
    for (const [mode, label] of Object.entries(traceModes)) {
      const button = inspectorButton(label, 'traceMode', mode);
      button.setAttribute('aria-pressed', String(mode === traceMode));
      controls.append(button);
    }
    inspector.append(controls);
    if (traceMode === 'direct') showDirect(project, visible);
    else showTrace(routes, route);
    const detail = element('a', 'network-inspector-action', 'View project details →');
    detail.href = `#map-detail-${project.id}`;
    detail.dataset.mapJump = project.id;
    inspector.append(detail);
    return heading;
  }

  function showRelationship(edge) {
    const from = projects.get(edge.from);
    const to = projects.get(edge.to);
    const directed = isDirected(edge);
    const heading = inspectorHeading(relationshipLabels[edge.status], edge.title);
    const pair = element('p', 'network-inspector-status', `${from.title} ${directed ? '→' : '·'} ${to.title}`);
    pair.dataset.status = edge.status;
    inspector.append(
      pair,
      element('p', 'network-inspector-text', edge.description)
    );
    if (edge.contract) {
      const contract = element('dl', 'network-contract');
      for (const [key, label] of Object.entries(contractLabels)) {
        const value = edge.contract[key];
        if (!value) continue;
        const row = element('div');
        row.append(element('dt', '', label), element('dd', '', value));
        contract.append(row);
      }
      inspector.append(contract);
    }
    const links = element('div', 'network-inspector-links');
    links.append(inspectorButton(from.title, 'inspectNode', from.id, directed ? 'Source' : 'Project'), inspectorButton(to.title, 'inspectNode', to.id, directed ? 'Destination' : 'Project'));
    inspector.append(links);
    if (selectedRoute) inspector.append(inspectorButton('← Back to route', 'traceReturn', selectedRoute));
    return heading;
  }

  function refresh(focusInspector = false) {
    const visible = edges.filter(edge => statuses.has(edge.status));
    if (selectedEdge && !visible.includes(selectedEdge)) selectedEdge = undefined;
    const routes = selectedProject && traceMode !== 'direct' ? traceRoutes(selectedProject, visible, traceMode) : [];
    const route = routes.find(option => option.id === selectedRoute);
    if (selectedRoute && !route) selectedEdge = undefined;
    selectedRoute = route?.id;
    const hasSelection = Boolean(selectedProject || selectedEdge);
    const focusedEdges = selectedProject && traceMode !== 'direct'
      ? route?.steps || routes.flatMap(option => option.steps)
      : visible.filter(edge => edge === selectedEdge || edge.from === selectedProject || edge.to === selectedProject);
    const incident = new Set(focusedEdges);
    const pathEdges = new Set(route?.steps);
    const relatedNodes = new Set([...incident].flatMap(edge => [edge.from, edge.to]));
    for (const button of filters) button.setAttribute('aria-pressed', String(statuses.has(button.dataset.networkFilter)));
    for (const button of graphNodes) {
      const id = button.dataset.networkNode;
      const active = id === selectedProject;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
      button.classList.toggle('is-related', !active && relatedNodes.has(id));
      button.classList.toggle('is-muted', hasSelection && !active && !relatedNodes.has(id));
    }
    for (const item of [...wires, ...graphEdges]) {
      const edge = relationships.get(item.dataset.networkWire || item.dataset.networkEdge);
      const active = edge === selectedEdge;
      const highlighted = active || pathEdges.has(edge);
      const related = incident.has(edge);
      const hidden = !statuses.has(edge.status);
      item.toggleAttribute('hidden', hidden);
      item.classList.toggle('is-filtered', hidden);
      item.classList.toggle('is-active', highlighted);
      item.classList.toggle('is-related', related && !highlighted);
      item.classList.toggle('is-muted', hasSelection && !related);
      if (item.dataset.networkEdge) item.setAttribute('aria-pressed', String(active));
    }
    const count = network.querySelector('[data-network-count]');
    if (count) count.textContent = `${visible.length} of ${edges.length} connections`;
    let heading;
    if (selectedEdge) heading = showRelationship(selectedEdge);
    else if (selectedProject) heading = showProject(projects.get(selectedProject), visible, routes, route);
    else inspector.replaceChildren(...overview.map(child => child.cloneNode(true)));
    if (focusInspector) heading?.focus({ preventScroll: true });
    return visible.length;
  }

  function focusRoute(id) {
    inspector.querySelector(`[data-trace-route="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  }

  function returnToRoute() {
    selectedEdge = undefined;
    refresh();
    focusRoute(selectedRoute);
    announce('Route steps shown.');
  }

  function updateZoom(center = true) {
    const previousWidth = plane.offsetWidth;
    const scrollCenter = (viewport.scrollLeft + viewport.clientWidth / 2) / previousWidth;
    plane.style.setProperty('--network-zoom', zoom);
    viewport.toggleAttribute('data-network-fit', fit);
    scale.textContent = fit ? 'Fit' : `${Math.round(zoom * 100)}%`;
    zoomFit.setAttribute('aria-pressed', String(fit));
    zoomOut.disabled = fit;
    zoomIn.disabled = zoom === 1.75;
    if (center && previousWidth) viewport.scrollLeft = scrollCenter * plane.offsetWidth - viewport.clientWidth / 2;
  }

  network.addEventListener('click', event => {
    const filter = event.target.closest('[data-network-filter]');
    if (filter) {
      const status = filter.dataset.networkFilter;
      if (statuses.has(status)) statuses.delete(status);
      else statuses.add(status);
      const count = refresh();
      announce(`${count} of ${edges.length} connections shown.`);
      return;
    }
    const zoomButton = event.target.closest('[data-network-zoom]');
    if (zoomButton) {
      const action = zoomButton.dataset.networkZoom;
      if (action === 'fit' || (action === 'out' && zoom === 1)) {
        fit = true;
        zoom = 1;
      } else if (fit) fit = false;
      else zoom += action === 'in' ? .25 : -.25;
      updateZoom();
      announce(fit ? 'Network fitted to view.' : `Network zoom ${scale.textContent}.`);
      return;
    }
    if (event.target.closest('[data-network-reset]')) {
      for (const button of filters) statuses.add(button.dataset.networkFilter);
      selectedProject = undefined;
      selectedEdge = undefined;
      selectedRoute = undefined;
      traceMode = 'direct';
      fit = false;
      zoom = 1;
      updateZoom(false);
      viewport.scrollTo(0, 0);
      refresh();
      announce('Network reset.');
      return;
    }
    const mode = event.target.closest('[data-trace-mode]');
    if (mode) {
      traceMode = mode.dataset.traceMode;
      selectedRoute = undefined;
      refresh();
      inspector.querySelector(`[data-trace-mode="${traceMode}"]`).focus({ preventScroll: true });
      announce(`${traceModes[traceMode]} connections shown.`);
      return;
    }
    const route = event.target.closest('[data-trace-route]');
    if (route) {
      const id = route.dataset.traceRoute;
      selectedRoute = selectedRoute === id ? undefined : id;
      refresh();
      focusRoute(id);
      announce(selectedRoute ? 'Route highlighted.' : 'Route highlight cleared.');
      return;
    }
    if (event.target.closest('[data-trace-return]')) {
      returnToRoute();
      return;
    }
    const project = event.target.closest('[data-network-node], [data-inspect-node]');
    const link = event.target.closest('[data-network-edge], [data-network-wire], [data-inspect-edge]');
    if (!project && !link) return;
    if (!link?.hasAttribute('data-trace-step')) {
      selectedProject = project?.dataset.networkNode || project?.dataset.inspectNode;
      selectedRoute = undefined;
      traceMode = 'direct';
    }
    selectedEdge = link && relationships.get(link.dataset.networkEdge || link.dataset.networkWire || link.dataset.inspectEdge);
    refresh(inspector.contains(event.target));
    announce(`${selectedEdge?.title || projects.get(selectedProject)?.title} selected.`);
  });

  network.addEventListener('keydown', event => {
    if (event.target.matches('[data-network-node]') && Object.hasOwn(arrows, event.key)) {
      event.preventDefault();
      const [x, y] = arrows[event.key];
      let nearest;
      let best = Infinity;
      for (const node of graphNodes) {
        const dx = node.offsetLeft - event.target.offsetLeft;
        const dy = node.offsetTop - event.target.offsetTop;
        const forward = dx * x + dy * y;
        const cross = dx * y - dy * x;
        const distance = forward + 2 * Math.abs(cross);
        if (forward > 0 && distance < best) {
          best = distance;
          nearest = node;
        }
      }
      nearest?.focus();
      return;
    }
    if (event.key !== 'Escape' || (!selectedProject && !selectedEdge)) return;
    if (selectedRoute && selectedEdge) {
      returnToRoute();
      return;
    }
    if (selectedRoute) {
      selectedRoute = undefined;
      refresh();
      inspector.querySelector(`[data-trace-mode="${traceMode}"]`).focus({ preventScroll: true });
      announce('Route highlight cleared.');
      return;
    }
    selectedProject = undefined;
    selectedEdge = undefined;
    traceMode = 'direct';
    const fromInspector = inspector.contains(event.target);
    refresh();
    if (fromInspector) viewport.focus({ preventScroll: true });
    announce('Network selection cleared.');
  });

  viewport.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || viewport.scrollWidth <= viewport.clientWidth || event.target.closest('button, a, [data-network-wire]')) return;
    drag = { pointer: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
  });
  viewport.addEventListener('pointermove', event => {
    if (drag?.pointer !== event.pointerId) return;
    viewport.scrollLeft = drag.left + drag.x - event.clientX;
    viewport.scrollTop = drag.top + drag.y - event.clientY;
  });
  viewport.addEventListener('lostpointercapture', () => {
    drag = undefined;
    viewport.classList.remove('is-panning');
  });

  updateZoom(false);
  return true;
}
