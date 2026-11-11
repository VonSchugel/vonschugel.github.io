import { readFile, writeFile, mkdir, cp, rm, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderNetwork } from './render-network.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTTP_PROTOCOLS = new Set(['https:', 'http:']);
const CONNECTION_STATUSES = { connected: 'Connected', shared: 'Shared stack', separate: 'Separate runtime', idea: 'Idea' };
const RELATION_LABELS = { connected: 'File handoff', shared: 'Shared stack', separate: 'Separate', idea: 'Needs adapter' };
const CONTRACT_FIELDS = { artifact: 'Input', transfer: 'Handoff', result: 'Result', boundary: 'Boundary', evidence: 'Verification' };
const SOURCE_LABELS = { public: 'Public source', private: 'Private repo', local: 'Local source' };
const PROJECT_LANES = ['Capture', 'Review & data', 'Experience'];

export function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

function string(value, label, required = true) {
  if (typeof value !== 'string' || (required && !value.trim())) throw new Error(`${label} must be ${required ? 'a non-empty' : 'a'} string.`);
  return value;
}

function link(value, label, { optional = false, email = false } = {}) {
  if (optional && (value == null || value === '')) return;
  string(value, label);
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error(`${label} must be a complete URL.`); }
  if (!HTTP_PROTOCOLS.has(parsed.protocol) && !(email && parsed.protocol === 'mailto:')) throw new Error(`${label} has an unsupported URL scheme.`);
  if (parsed.username || parsed.password) throw new Error(`${label} must not contain credentials.`);
}

function validateConnections(connections) {
  if (!Array.isArray(connections)) throw new Error('connections.json must contain an array.');
  const ids = new Set();
  connections.forEach((entry, index) => {
    const label = `connections[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`${label} must be an object.`);
    for (const key of ['id', 'title', 'kind', 'summary']) string(entry[key], `${label}.${key}`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.id) || ids.has(entry.id)) throw new Error(`${label}.id must be unique and contain lowercase letters, numbers, or hyphens.`);
    ids.add(entry.id);
    const visibility = entry.visibility ?? 'public';
    if (!Object.hasOwn(SOURCE_LABELS, visibility)) throw new Error(`${label}.visibility must be public, private, or local.`);
    if (entry.lane != null && !PROJECT_LANES.includes(entry.lane)) throw new Error(`${label}.lane is not a recognised work area.`);
    if (entry.repoState != null && (entry.repoState !== 'initialized' || visibility !== 'private')) throw new Error(`${label}.repoState can only mark an initialized private repository.`);
    link(entry.repo, `${label}.repo`, { optional: visibility !== 'public' });
    if (visibility !== 'public' && entry.repo != null) throw new Error(`${label}.repo must be omitted for non-public source.`);
    if (!Array.isArray(entry.stack)) throw new Error(`${label}.stack must be an array of strings.`);
    entry.stack.forEach((item, i) => string(item, `${label}.stack[${i}]`));
    if (!Array.isArray(entry.paths)) throw new Error(`${label}.paths must be an array.`);
    entry.paths.forEach((item, i) => {
      const pathLabel = `${label}.paths[${i}]`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${pathLabel} must be an object.`);
      if (typeof item.status !== 'string' || !Object.hasOwn(CONNECTION_STATUSES, item.status)) throw new Error(`${pathLabel}.status must be connected, shared, separate, or idea.`);
      string(item.title, `${pathLabel}.title`);
      string(item.description, `${pathLabel}.description`);
      link(item.url, `${pathLabel}.url`, { optional: true });
      if (item.sourceLabel != null) string(item.sourceLabel, `${pathLabel}.sourceLabel`);
    });
  });
  const pairs = new Set();
  connections.forEach((entry, index) => {
    if (entry.relations == null) return;
    if (!Array.isArray(entry.relations)) throw new Error(`connections[${index}].relations must be an array.`);
    entry.relations.forEach((item, i) => {
      const label = `connections[${index}].relations[${i}]`;
      if (!item || typeof item !== 'object' || !ids.has(item.to) || item.to === entry.id) throw new Error(`${label}.to must reference another project.`);
      if (!Object.hasOwn(RELATION_LABELS, item.status)) throw new Error(`${label}.status is not a recognised relationship.`);
      string(item.title, `${label}.title`);
      string(item.description, `${label}.description`);
      if (item.contract != null) {
        if (typeof item.contract !== 'object' || Array.isArray(item.contract)) throw new Error(`${label}.contract must be an object.`);
        for (const field of Object.keys(CONTRACT_FIELDS)) {
          if (field === 'evidence' && item.contract.evidence == null) continue;
          string(item.contract[field], `${label}.contract.${field}`);
        }
      }
      const pair = [entry.id, item.to].sort().join('/');
      if (pairs.has(pair)) throw new Error(`${label} duplicates a project pair.`);
      pairs.add(pair);
    });
  });
}

export function validateData(data) {
  const { profile, projects, articles, experience, cv } = data;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('profile.json must contain an object.');
  for (const key of ['name', 'role', 'bio', 'intro']) string(profile[key], `profile.${key}`);
  link(profile.siteUrl, 'profile.siteUrl');
  link(profile.github, 'profile.github');
  link(profile.substack, 'profile.substack', { optional: true });
  if (profile.substackName != null) string(profile.substackName, 'profile.substackName');
  if (!Array.isArray(profile.socials)) throw new Error('profile.socials must be an array.');
  profile.socials.forEach((social, index) => {
    string(social.label, `profile.socials[${index}].label`);
    link(social.url, `profile.socials[${index}].url`, { email: true });
  });
  for (const key of ['projects', 'articles', 'experience']) if (!Array.isArray(data[key])) throw new Error(`${key}.json must contain an array.`);
  const ids = new Set();
  projects.forEach((project, index) => {
    const label = `projects[${index}]`;
    for (const key of ['id', 'title', 'description']) string(project[key], `${label}.${key}`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(project.id) || ids.has(project.id)) throw new Error(`${label}.id must be unique and contain lowercase letters, numbers, or hyphens.`);
    ids.add(project.id);
    if (typeof project.year !== 'string' && typeof project.year !== 'number') throw new Error(`${label}.year must be a string or number.`);
    if (!Array.isArray(project.tags) || project.tags.some(tag => typeof tag !== 'string')) throw new Error(`${label}.tags must be an array of strings.`);
    link(project.github, `${label}.github`, { optional: true });
    link(project.demo, `${label}.demo`, { optional: true });
    if (project.visual != null && !['chat', 'tea', 'pilot', 'data', 'browser'].includes(project.visual)) throw new Error(`${label}.visual is not a recognised card illustration.`);
    if (project.map != null && !/^[a-z0-9][a-z0-9-]*$/.test(project.map)) throw new Error(`${label}.map must be a project ID.`);
  });
  articles.forEach((article, index) => {
    const label = `articles[${index}]`;
    string(article.title, `${label}.title`);
    string(article.description ?? '', `${label}.description`, false);
    link(article.url, `${label}.url`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(article.date ?? '') || Number.isNaN(Date.parse(article.date)) || new Date(article.date).toISOString().slice(0, 10) !== article.date) throw new Error(`${label}.date must be a valid YYYY-MM-DD date.`);
  });
  experience.forEach((entry, index) => {
    for (const key of ['period', 'title', 'organization', 'description']) string(entry[key], `experience[${index}].${key}`, key !== 'description');
  });
  if (!cv || typeof cv !== 'object' || Array.isArray(cv)) throw new Error('cv.json must contain an object.');
  string(cv.summary, 'cv.summary');
  string(cv.now, 'cv.now');
  for (const key of ['experience', 'skills']) if (!Array.isArray(cv[key])) throw new Error(`cv.${key} must be an array.`);
  cv.skills.forEach((skill, index) => string(skill, `cv.skills[${index}]`));
  for (const key of ['experience', 'education']) {
    if (cv[key] == null && key === 'education') continue;
    if (!Array.isArray(cv[key])) throw new Error(`cv.${key} must be an array.`);
    cv[key].forEach((entry, index) => {
      string(entry.period, `cv.${key}[${index}].period`);
      string(entry.title, `cv.${key}[${index}].title`);
      if (entry.description != null) string(entry.description, `cv.${key}[${index}].description`, false);
    });
  }
  if (data.teaLogo != null) string(data.teaLogo, 'teaLogo', false);
  if (data.connections !== undefined) validateConnections(data.connections);
  for (const project of projects) {
    if (project.map && !data.connections?.some(entry => entry.id === project.map)) throw new Error(`Unknown map project: ${project.map}.`);
  }
  return data;
}

const arrow = '<span aria-hidden="true">↗</span>';
const chatArt = '<div class="mini-chat"><div class="mini-chat-top"><span class="mini-mark">✳</span><span>AI Chatbot</span><span class="mini-dots">•••</span></div><div class="mini-chat-body"><span class="mini-prompt">Where does curiosity lead?</span><div class="mini-response"><span class="mini-star">✳</span><div><span></span><span></span><span></span></div></div></div><div class="mini-input">Ask a question<span>↑</span></div></div>';
const teaArt = "<div class=\"mini-browser\"><div class=\"mini-browser-top\"><span>○ ○ ○</span><span>marqicci.github.io</span></div><div class=\"mini-tea\"><svg viewBox=\"19 0 61 61\" aria-hidden=\"true\" style=\"max-width:100px\"><g transform=\"translate(21 1.5) scale(.183)\" fill=\"currentColor\"><path d=\"M84 138C92 162 88 181 73 204C57 206 48 198 39 182C25 156 14 140 0 132L0 153C12 170 12 203 22 228C31 250 47 260 65 264C77 291 99 303 129 303H175C205 303 227 289 235 269C245 246 231 209 223 187C215 167 211 151 215 140C207 136 201 132 197 125L196 115C193 108 186 105 184 98L184 88C179 78 176 65 160 57C158 53 159 50 162 44C168 31 160 21 150 15C139 20 132 30 136 41L140 55C126 62 121 76 115 86L115 97C111 105 105 108 104 115L102 126C97 134 90 136 84 138Z\"/><path d=\"M214 153C225 128 248 129 267 138C298 151 307 176 298 197C289 219 270 233 250 244C235 251 237 267 249 276C262 284 278 269 268 257C263 251 253 257 259 263M214 153C206 168 212 184 225 187C237 190 248 177 240 169\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"11.5\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></g></svg><span>A little corner of the internet.</span></div></div>";

export function renderProjects(projects) {
  const drawings = {
    pilot: ['CLIENT', 'REQUEST', 'MATCH', 'QUOTE'],
    data: ['LOCAL', 'ARCHIVE', 'REVIEW', 'DATASET'],
    browser: ['SESSION', 'ACTION', 'REVIEW', 'REPLAY'],
  };
  return projects.map(project => {
    const visual = project.visual || 'tea';
    const art = drawings[visual] ? `<div class="project-schematic"><div class="project-schematic-title">● &nbsp;${drawings[visual][0]}</div><div class="project-schematic-steps">${drawings[visual].slice(1).map((step,i)=>`<span><small>0${i+1}</small>${step}</span>`).join('')}</div></div>` : (visual === 'chat' ? chatArt : teaArt);
    const links = [project.github ? `<a href="${escapeHTML(project.github)}" target="_blank" rel="noopener noreferrer">GitHub ${arrow}</a>` : '', project.demo ? `<a href="${escapeHTML(project.demo)}" target="_blank" rel="noopener noreferrer">Public site ${arrow}</a>` : '', project.map ? `<a href="#map-detail-${escapeHTML(project.map)}">In the map <span aria-hidden="true">↑</span></a>` : ''].filter(Boolean).join('\n');
    return `<article class="project-card" data-project="${escapeHTML(project.id)}" data-tags="${escapeHTML(project.tags.join(' ').toLowerCase())}">
      <div class="project-art project-art--${visual}" aria-hidden="true">${art}</div>
      <div class="project-meta"><span>${escapeHTML(project.year)}</span></div>
      <h3>${escapeHTML(project.title)}</h3>
      <p class="project-description">${escapeHTML(project.description)}</p>
      <ul class="tags" aria-label="Technologies">${project.tags.map(tag => `<li>${escapeHTML(tag)}</li>`).join('')}</ul>
      <div class="project-links">${links}</div>
    </article>`;
  }).join('\n');
}

export function renderArticles(articles) {
  if (!articles.length) return '<div class="writing-empty"><p>More thoughts soon.</p></div>';
  return [...articles].sort((a, b) => b.date.localeCompare(a.date)).map(article => {
    const date = new Intl.DateTimeFormat('en', { month: 'short', day: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${article.date}T12:00:00Z`));
    return `<article class="article-row"><time class="mono" datetime="${escapeHTML(article.date)}">${date}</time><div class="article-content"><h3><a href="${escapeHTML(article.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(article.title)}</a></h3></div><span class="arrow" aria-hidden="true">↗</span></article>`;
  }).join('\n');
}

export function renderExperience(experience) {
  return experience.map(entry => `<article class="timeline-item"><div class="timeline-date mono">${escapeHTML(entry.period)}</div><div><h3>${escapeHTML(entry.title)}</h3><p class="timeline-organization">${escapeHTML(entry.organization)}</p>${entry.description ? `<p>${escapeHTML(entry.description)}</p>` : ''}</div></article>`).join('\n');
}

export function renderCV(cv) {
  const entries = items => `<ol class="cv-timeline">${items.map(entry => `<li class="cv-entry"><span class="cv-period mono">${escapeHTML(entry.period)}</span><div><h4>${escapeHTML(entry.title)}</h4>${entry.description ? `<p>${escapeHTML(entry.description)}</p>` : ''}</div></li>`).join('')}</ol>`;
  return `<div class="cv-grid">
    <article class="cv-card cv-card--experience"><h3>Experience</h3>${entries(cv.experience)}</article>
    <article class="cv-card cv-card--skills"><h3>Tools I’ve explored</h3><ul class="tags cv-skills" aria-label="Tools and technologies">${cv.skills.map(skill => `<li>${escapeHTML(skill)}</li>`).join('')}</ul></article>
    <article class="cv-card cv-card--now"><h3>Right now</h3><p class="cv-status">${escapeHTML(cv.summary)}</p><p>${escapeHTML(cv.now)}</p></article>
    ${cv.education?.length ? `<article class="cv-card cv-card--education"><h3>Education</h3>${entries(cv.education)}</article>` : ''}
  </div>`;
}

function renderConnections(connections, owner) {
  if (!connections.length) return '';
  const byId = new Map(connections.map(entry => [entry.id, entry]));
  const relations = connections.flatMap(entry => (entry.relations || []).map(relation => ({ ...relation, from: entry.id })));
  const network = relations.length ? renderNetwork(connections, relations, escapeHTML) : '';
  const jump = (id, className = '') => `<a${className ? ` class="${className}"` : ''} href="#map-detail-${id}" data-map-jump="${id}">${escapeHTML(byId.get(id).title)}</a>`;
  const lanes = PROJECT_LANES.map(label => ({ label, projects: connections.filter(entry => entry.lane === label) })).filter(lane => lane.projects.length);
  const initialized = connections.filter(entry => entry.repoState === 'initialized').length;
  const overview = lanes.length ? `<div class="map-overview">
    <div class="map-overview-head"><h3>Work areas</h3></div>
    <ul class="overview-metrics">
      <li class="overview-metric"><strong>${connections.length}</strong> Projects</li>
      <li class="overview-metric"><strong>${relations.filter(item=>item.status==='connected').length}</strong> File handoffs</li>
      <li class="overview-metric"><strong>${connections.filter(entry=>entry.visibility==='private').length}</strong> Private repos</li>
      ${initialized ? `<li class="overview-metric"><strong>${initialized}</strong> Newly initialized</li>` : ''}
    </ul>
    <ol class="ecosystem-flow" aria-label="Projects by role">${lanes.map(lane=>`<li class="flow-stage"><h4 class="flow-stage-label">${escapeHTML(lane.label)}</h4><ul class="flow-chips">${lane.projects.map(entry=>`<li>${jump(entry.id,'flow-chip')}</li>`).join('')}</ul></li>`).join('')}</ol>
  </div>` : '';
  const matrix = relations.length ? `<div class="map-matrix" data-map-view="compatibility" id="project-compatibility" role="region" aria-label="Project compatibility table" tabindex="0">
    <table class="compatibility-table"><caption>Compatibility between projects. File handoffs are implemented; adapter ideas still need work.</caption>
    <thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">Status</th><th scope="col">How it fits</th></tr></thead>
    <tbody>${relations.map(item => `<tr><th scope="row">${jump(item.from)}</th><td>${jump(item.to)}</td><td><span class="matrix-status" data-status="${item.status === 'idea' ? 'planned' : item.status}">${RELATION_LABELS[item.status]}</span></td><td><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.description)}</small>${item.contract ? `<details class="matrix-contract"><summary>Handoff details</summary><dl>${Object.entries(CONTRACT_FIELDS).filter(([key]) => item.contract[key]).map(([key, title]) => `<div><dt>${title}</dt><dd>${escapeHTML(item.contract[key])}</dd></div>`).join('')}</dl></details>` : ''}</td></tr>`).join('')}</tbody></table>
  </div>` : '';
  const branches = connections.map((entry, index) => `<li><a class="map-node" data-map-select="${entry.id}" href="#map-detail-${entry.id}">
    <span class="map-node-icon" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><span class="map-node-text"><strong>${escapeHTML(entry.title)}</strong><small>${escapeHTML(entry.kind)}</small></span><span class="map-node-arrow" aria-hidden="true">→</span>
  </a></li>`).join('\n');
  const panels = connections.map((entry,index) => {
    const source = entry.repo ? `<a class="map-source" href="${escapeHTML(entry.repo)}" aria-label="Source for ${escapeHTML(entry.title)}" target="_blank" rel="noopener noreferrer">Source ${arrow}</a>` : `<span class="map-source">${entry.repoState === 'initialized' ? 'Private · README only' : SOURCE_LABELS[entry.visibility]}</span>`;
    const paths = entry.paths.map(item => `<li class="map-path" data-status="${item.status}"><span class="map-status">${CONNECTION_STATUSES[item.status]}</span><div class="map-path-body">
      <h4>${escapeHTML(item.title)}</h4><p>${escapeHTML(item.description)}</p>${item.url ? `<a class="map-evidence" href="${escapeHTML(item.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(item.sourceLabel || 'Evidence')} ${arrow}</a>` : ''}
    </div></li>`).join('\n');
    const related = relations.filter(item => item.from === entry.id || item.to === entry.id).map(item => {
      const other = item.from === entry.id ? item.to : item.from;
      return `<li class="map-path" data-status="${item.status}"><span class="map-status">${RELATION_LABELS[item.status]}</span><div class="map-path-body"><h4>${escapeHTML(item.title)}</h4><p>${escapeHTML(item.description)}</p>${jump(other,'map-evidence')}</div></li>`;
    }).join('');
    const previous = connections[index-1];
    const next = connections[index+1];
    return `<article class="map-panel" data-map-panel="${entry.id}" id="map-detail-${entry.id}" aria-labelledby="map-title-${entry.id}" tabindex="-1">
      <div class="map-panel-head"><div><p class="map-kind">${escapeHTML(entry.kind)}</p><h3 id="map-title-${entry.id}">${escapeHTML(entry.title)}</h3></div>${source}</div>
      <p class="map-summary">${escapeHTML(entry.summary)}</p>
      ${entry.stack.length ? `<ul class="map-stack" aria-label="Technologies">${entry.stack.map(item => `<li>${escapeHTML(item)}</li>`).join('')}</ul>` : ''}
      ${paths ? `<ul class="map-paths" aria-label="Project workflow">${paths}</ul>` : ''}
      ${related ? `<h4 class="map-related-title">Across projects</h4><ul class="map-paths" aria-label="Cross-project connections">${related}</ul>` : ''}
      ${lanes.length ? `<nav class="map-panel-navigation" aria-label="Browse projects">${previous ? `<a rel="prev" data-map-jump="${previous.id}" href="#map-detail-${previous.id}">← ${escapeHTML(previous.title)}</a>` : ''}${next ? `<a rel="next" data-map-jump="${next.id}" href="#map-detail-${next.id}">${escapeHTML(next.title)} →</a>` : ''}</nav>` : ''}
    </article>`;
  }).join('\n');
  return `<div class="connection-map" data-connection-map>
    <div class="map-topline"><span>Project ecosystem</span><span>${connections.length} ${connections.length === 1 ? 'project' : 'projects'}</span></div>
    ${overview}
    ${matrix ? '<div class="map-view-controls" role="group" aria-label="Project map view"><button type="button" data-map-mode="network" aria-pressed="true">Network</button><button type="button" data-map-mode="tree" aria-pressed="false">Project tree</button><button type="button" data-map-mode="compatibility" aria-pressed="false">Compatibility</button></div>' : ''}
    ${network}
    <div class="map-layout" data-map-view="tree"><div class="map-tree"><p class="map-root"><strong>${escapeHTML(owner)}</strong><small>Project index</small></p><ul class="map-branches">${branches}</ul></div><div class="map-panels">${panels}</div></div>
    ${matrix}
  </div>`;
}

export function renderSite(template, data, year = new Date().getUTCFullYear()) {
  validateData(data);
  const { profile, projects, articles, experience, cv, connections = [] } = data;
  const publicationName = profile.substackName || 'Writing on Substack';
  const publicationRoot = profile.substack ? new URL(profile.substack) : null;
  const publicationPath = publicationRoot ? publicationRoot.pathname.replace(/\/+$/, '').replace(/\/(feed|archive)$/, '') : '';
  const publicationPage = suffix => {
    if (!publicationRoot) return '';
    const url = new URL(publicationRoot);
    url.pathname = `${publicationPath}/${suffix}`;
    url.search = '';
    url.hash = '';
    return url.href;
  };
  const values = {
    PROFILE_NAME: escapeHTML(profile.name), PROFILE_BIO: escapeHTML(profile.bio),
    ROLE: escapeHTML(profile.role), INTRO: escapeHTML(profile.intro),
    SITE_URL: escapeHTML(profile.siteUrl), GITHUB_URL: escapeHTML(profile.github),
    SUBSTACK_URL: escapeHTML(profile.substack || ''),
    SUBSTACK_NAME: escapeHTML(publicationName),
    SUBSTACK_FEED: escapeHTML(publicationPage('feed')),
    SUBSTACK_ARCHIVE: escapeHTML(publicationPage('archive')),
    SUBSTACK_FEED_LINK: profile.substack ? `<link rel="alternate" type="application/rss+xml" title="${escapeHTML(publicationName)}" href="${escapeHTML(publicationPage('feed'))}">` : '',
    SUBSTACK_ARCHIVE_LINK: profile.substack ? `<a class="writing-archive mono" href="${escapeHTML(publicationPage('archive'))}" target="_blank" rel="noopener noreferrer">More on Substack ${arrow}</a>` : '',
    YEAR: String(year),
    PROJECTS: renderProjects(projects), WRITING: renderArticles(articles), EXPERIENCE: renderExperience(experience),
    CV: renderCV(cv), TEA_LOGO: data.teaLogo || '', CONNECTIONS: renderConnections(connections, profile.name),
    SOCIALS: profile.socials.map(social => `<a class="social-link" href="${escapeHTML(social.url)}"${social.url.startsWith('mailto:') ? '' : ' target="_blank" rel="noopener noreferrer"'}>${escapeHTML(social.label)} ${arrow}</a>`).join('\n'),
    SUBSTACK_LINK: profile.substack ? `<a class="text-link" href="${escapeHTML(profile.substack)}" target="_blank" rel="noopener noreferrer">Read on Substack ${arrow}</a>` : '',
  };
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (_, marker) => {
    if (!(marker in values)) throw new Error(`Unknown template marker: {{${marker}}}. Add it to scripts/build.mjs.`);
    return values[marker];
  });
}

export async function build(root = ROOT) {
  const [template, teaLogo, profile, projects, articles, experience, cv, connections] = await Promise.all([
    readFile(path.join(root, 'site.template.html'), 'utf8'),
    readFile(path.join(root, 'assets', 'tea-logo.svg'), 'utf8'),
    ...['profile', 'projects', 'articles', 'experience', 'cv', 'connections'].map(async name => JSON.parse(await readFile(path.join(root, 'data', `${name}.json`), 'utf8'))),
  ]);
  if (!/<svg\b/i.test(teaLogo) || !/<\/svg\s*>/i.test(teaLogo)) throw new Error('assets/tea-logo.svg must contain a complete SVG logo.');
  const html = renderSite(template, { profile, projects, articles, experience, cv, connections, teaLogo: teaLogo.replace(/^\s*<\?xml[^>]*\?>\s*/i, '') });
  await writeFile(path.join(root, 'index.html'), html);
  const dist = path.resolve(root, 'dist');
  if (path.dirname(dist) !== path.resolve(root) || path.basename(dist) !== 'dist') throw new Error('Refusing to replace an unexpected output directory.');
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await writeFile(path.join(dist, 'index.html'), html);
  await writeFile(path.join(dist, '.nojekyll'), '');
  for (const item of ['assets', 'about.html', 'make.html', 'shop.html', '404.html', 'robots.txt', 'sitemap.xml', 'CNAME']) {
    try { await access(path.join(root, item)); } catch { continue; }
    await cp(path.join(root, item), path.join(dist, item), { recursive: true });
  }
  console.log(`Built index.html and dist/ (${projects.length} projects, ${articles.length} articles, ${connections.length} map entries, ${experience.length} experience entries).`);
  return { html, dist };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  build().catch(error => { console.error(`Build failed: ${error.message}`); process.exitCode = 1; });
}
