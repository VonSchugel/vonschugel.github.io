const relationshipLabels = {
  connected: 'File handoff', shared: 'Shared stack', idea: 'Proposed adapter', separate: 'Separate runtime'
};
const arrows = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

function element(tag, className, content) {
  const item = document.createElement(tag);
  if (className) item.className = className;
  if (content) item.textContent = content;
  return item;
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

  function showProject(project, visible) {
    const heading = inspectorHeading(project.lane || 'Project', project.title);
    const source = project.repoState === 'initialized' ? 'Private · README only' : { public: 'Public source', private: 'Private repo', local: 'Local source' }[project.visibility];
    inspector.append(element('p', 'network-inspector-status', [project.kind, source].filter(Boolean).join(' · ')), element('p', 'network-inspector-text', project.summary));
    if (project.stack.length) {
      const stack = element('ul', 'network-inspector-tags');
      stack.setAttribute('aria-label', 'Technologies');
      stack.append(...project.stack.map(item => element('li', '', item)));
      inspector.append(stack);
    }
    const adjacent = visible.filter(edge => edge.from === project.id || edge.to === project.id);
    const links = element('div', 'network-inspector-links');
    inspector.append(element('h4', 'network-inspector-subheading', 'Connections'), links);
    for (const edge of adjacent) {
      const outgoing = edge.from === project.id;
      const neighbor = projects.get(outgoing ? edge.to : edge.from);
      const direction = edge.status === 'connected' || edge.status === 'idea' ? (outgoing ? 'To' : 'From') : 'With';
      links.append(inspectorButton(`${direction} ${neighbor.title}`, 'inspectEdge', edge.id, relationshipLabels[edge.status]));
    }
    if (!adjacent.length) links.append(element('p', 'network-inspector-text', 'No connections in the current filters.'));
    const detail = element('a', 'network-inspector-action', 'View project details →');
    detail.href = `#map-detail-${project.id}`;
    detail.dataset.mapJump = project.id;
    inspector.append(detail);
    return heading;
  }

  function showRelationship(edge) {
    const from = projects.get(edge.from);
    const to = projects.get(edge.to);
    const directed = edge.status === 'connected' || edge.status === 'idea';
    const heading = inspectorHeading(relationshipLabels[edge.status], edge.title);
    inspector.append(
      element('p', 'network-inspector-status', `${from.title} ${directed ? '→' : '·'} ${to.title}`),
      element('p', 'network-inspector-text', edge.description)
    );
    const links = element('div', 'network-inspector-links');
    links.append(inspectorButton(from.title, 'inspectNode', from.id, directed ? 'Source' : 'Project'), inspectorButton(to.title, 'inspectNode', to.id, directed ? 'Destination' : 'Project'));
    inspector.append(links);
    return heading;
  }

  function refresh(focusInspector = false) {
    const visible = edges.filter(edge => statuses.has(edge.status));
    if (selectedEdge && !visible.includes(selectedEdge)) selectedEdge = undefined;
    const hasSelection = Boolean(selectedProject || selectedEdge);
    const incident = new Set(visible.filter(edge => edge === selectedEdge || edge.from === selectedProject || edge.to === selectedProject));
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
      const related = incident.has(edge);
      const hidden = !statuses.has(edge.status);
      item.toggleAttribute('hidden', hidden);
      item.classList.toggle('is-filtered', hidden);
      item.classList.toggle('is-active', active);
      item.classList.toggle('is-related', related && !active);
      item.classList.toggle('is-muted', hasSelection && !related);
      if (item.dataset.networkEdge) item.setAttribute('aria-pressed', String(active));
    }
    const count = network.querySelector('[data-network-count]');
    if (count) count.textContent = `${visible.length} of ${edges.length} connections`;
    let heading;
    if (selectedEdge) heading = showRelationship(selectedEdge);
    else if (selectedProject) heading = showProject(projects.get(selectedProject), visible);
    else inspector.replaceChildren(...overview.map(child => child.cloneNode(true)));
    if (focusInspector) heading?.focus({ preventScroll: true });
    return visible.length;
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
      fit = false;
      zoom = 1;
      updateZoom(false);
      viewport.scrollTo(0, 0);
      refresh();
      announce('Network reset.');
      return;
    }
    const project = event.target.closest('[data-network-node], [data-inspect-node]');
    const link = event.target.closest('[data-network-edge], [data-network-wire], [data-inspect-edge]');
    if (!project && !link) return;
    selectedProject = project?.dataset.networkNode || project?.dataset.inspectNode;
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
    selectedProject = undefined;
    selectedEdge = undefined;
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
