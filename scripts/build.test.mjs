import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, escapeHTML, renderSite, validateData } from './build.mjs';

function fixture() {
  return {
    profile: { name: 'Example & Co.', role: 'Developer', bio: 'A brief biography.', intro: 'Hello there.', siteUrl: 'https://example.com', github: 'https://github.com/example', substack: null, socials: [{ label: 'GitHub', url: 'https://github.com/example' }] },
    projects: [{ id: 'one', title: 'A project', description: 'A useful tool.', year: 2026, tags: ['HTML', 'CSS'], github: 'https://github.com/example/one', demo: null, visual: 'chat' }],
    articles: [{ title: 'A note', url: 'https://example.com/note', date: '2026-01-11', description: 'A short description.' }],
    experience: [{ period: '2026', title: 'Developer', organization: 'Independent', description: 'Making things.' }],
    cv: { summary: 'Student & learner', experience: [{ period: '2026', title: 'Independent projects', description: 'Making things.' }], skills: ['HTML', 'CSS'], now: 'Learning in public.' },
  };
}

function mapFixture() {
  return [
    {
      id: 'site', title: 'Site & notes', kind: 'Static site', summary: 'A project index.', repo: 'https://example.com/site', stack: ['HTML', 'CSS'],
      paths: [
        { status: 'connected', title: 'Public link', description: 'Links to the demo.', url: 'https://example.com/site/blob/main/index.html?ref=main&plain=1', sourceLabel: 'Source "link"' },
        { status: 'shared', title: 'Shared HTML', description: 'Both projects use HTML.' },
      ],
    },
    {
      id: 'app', title: 'App', kind: 'Web app', summary: 'A separate project.', repo: 'https://example.com/app', stack: ['HTML', 'Node.js'],
      paths: [
        { status: 'separate', title: 'Separate runtime', description: 'Runs independently.' },
        { status: 'idea', title: 'Potential embed', description: 'Could add an embed in the future.' },
      ],
    },
  ];
}

test('data becomes escaped static content, including quotes in attributes', () => {
  const data = fixture();
  data.projects[0].title = '<script>alert("x")</script>';
  data.projects[0].tags = ['<HTML>'];
  data.profile.socials[0].label = 'A "quoted" label';
  const html = renderSite('{{PROFILE_NAME}}{{PROJECTS}}{{WRITING}}{{EXPERIENCE}}{{SOCIALS}}{{YEAR}}', data, 2030);
  assert.ok(html.includes('Example &amp; Co.'));
  assert.ok(html.includes('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;HTML&gt;'));
  assert.ok(html.includes('A &quot;quoted&quot; label'));
  assert.ok(html.includes('datetime="2026-01-11"'));
  assert.ok(html.endsWith('2030'));
  assert.ok(!html.includes('<script>'));
  assert.equal(escapeHTML("' &"), '&#39; &amp;');
});

test('invalid data prevents unsafe links, duplicate IDs, and impossible dates', () => {
  const data = fixture();
  data.projects[0].demo = 'javascript:alert(1)';
  assert.throws(() => validateData(data), /unsupported URL scheme/);
  data.projects[0].demo = null;
  data.projects.push({ ...data.projects[0] });
  assert.throws(() => validateData(data), /unique/);
  data.projects.pop();
  data.articles[0].date = '2026-02-30';
  assert.throws(() => validateData(data), /valid YYYY-MM-DD/);
});

test('an unconfigured publication uses a concise visible fallback without fake links', () => {
  const data = fixture();
  data.articles = [];
  const html = renderSite('{{WRITING}}{{SUBSTACK_FEED_LINK}}{{SUBSTACK_LINK}}{{SUBSTACK_ARCHIVE_LINK}}', data);
  assert.ok(html.includes('More thoughts soon.'));
  assert.ok(!html.includes('substack.com'));
  assert.throws(() => renderSite('{{UNKNOWN_MARKER}}', data), /Unknown template marker/);
});

test('CV content renders in the page, is escaped, and supports optional education without invented entries', () => {
  const data = fixture();
  data.cv.summary = '<Student> & learner';
  let html = renderSite('{{CV}}', data);
  assert.ok(html.includes('&lt;Student&gt; &amp; learner'));
  assert.ok(html.includes('Independent projects'));
  assert.ok(html.includes('Tools I’ve explored'));
  assert.ok(html.includes('<li>HTML</li>'));
  assert.ok(!html.includes('Education'));
  assert.ok(!html.includes('download'));
  assert.ok(!html.includes('.pdf'));
  data.cv.education = [{ period: '2026', title: 'A verified course' }];
  html = renderSite('{{CV}}', data);
  assert.ok(html.includes('Education'));
  assert.ok(html.includes('A verified course'));
  data.cv.skills = 'not an array';
  assert.throws(() => validateData(data), /cv.skills must be an array/);
});

test('small tea logo is present in static markup and article descriptions stay out of the compact list', () => {
  const data = fixture();
  data.teaLogo = '<svg id="tea-logo-art" viewBox="0 0 90 48"><path d="M0 0"/></svg>';
  const html = renderSite('{{TEA_LOGO}}{{WRITING}}{{PROJECTS}}', data);
  assert.ok(html.includes('<svg id="tea-logo-art"'));
  assert.ok(html.includes('A note'));
  assert.ok(!html.includes('A short description.'));
  assert.ok(!html.includes('project-art-label'));
  assert.ok(!html.includes('<span class="mono">01</span>'));
  assert.equal(renderSite('{{TEA_LOGO}}', fixture()), '');
});

test('Substack metadata and actions follow a single publication setting', () => {
  const data = fixture();
  data.profile.substack = 'https://example.substack.com/';
  data.profile.substackName = 'A & B';
  const html = renderSite('{{SUBSTACK_FEED_LINK}}{{SUBSTACK_LINK}}{{SUBSTACK_ARCHIVE_LINK}}', data);
  assert.ok(html.includes('href="https://example.substack.com/feed"'));
  assert.ok(html.includes('href="https://example.substack.com/archive"'));
  assert.ok(html.includes('title="A &amp; B"'));
  assert.ok(html.includes('Read on Substack'));
  data.profile.substackName = undefined;
  assert.equal(renderSite('{{SUBSTACK_NAME}}', data), 'Writing on Substack');
});

test('repository map exposes every status, evidence link, and panel through static markup', () => {
  const data = fixture();
  data.connections = mapFixture();
  const html = renderSite('{{CONNECTIONS}}', data);
  for (const { id } of data.connections) {
    assert.ok(html.includes(`data-map-select="${id}" href="#map-detail-${id}"`));
    assert.ok(html.includes(`data-map-panel="${id}" id="map-detail-${id}"`));
  }
  for (const status of ['Connected', 'Shared stack', 'Separate runtime', 'Idea']) assert.ok(html.includes(`<span class="map-status">${status}</span>`));
  assert.ok(html.includes('Example &amp; Co.'));
  assert.ok(html.includes('Site &amp; notes'));
  assert.ok(html.includes('ref=main&amp;plain=1'));
  assert.ok(html.includes('Source &quot;link&quot;'));
  assert.doesNotMatch(html, /\shidden\b/);
  assert.equal(renderSite('{{CONNECTIONS}}', fixture()), '');
});

test('repository map rejects duplicate IDs, unknown statuses, and unsafe evidence URLs', () => {
  const data = fixture();
  data.connections = mapFixture();
  const path = data.connections[0].paths[0];
  const source = path.url;
  path.url = 'javascript:alert(1)';
  assert.throws(() => validateData(data), /connections\[0\]\.paths\[0\]\.url has an unsupported URL scheme/);
  path.url = source;
  path.status = 'unknown';
  assert.throws(() => validateData(data), /status must be connected, shared, separate, or idea/);
  path.status = 'connected';
  data.connections[1].id = data.connections[0].id;
  assert.throws(() => validateData(data), /connections\[1\]\.id must be unique/);
});

test('compatibility lists verified handoffs while keeping private repository URLs out', () => {
  const data = fixture();
  data.connections = mapFixture();
  data.connections[0].lane = 'Capture';
  Object.assign(data.connections[1], { lane: 'Experience', visibility: 'private', repo: null, repoState: 'initialized' });
  data.connections[0].relations = [{ to: 'app', status: 'connected', title: 'Evidence & review', description: 'Imports a reviewed file.' }];
  const html = renderSite('{{CONNECTIONS}}', data);
  assert.match(html, /class="compatibility-table"/);
  assert.match(html, /Evidence &amp; review/);
  assert.match(html, /Private · README only/);
  assert.doesNotMatch(html, /https:\/\/example\.com\/app/);
  data.connections[1].repo = 'https://example.com/app';
  assert.throws(() => validateData(data), /must be omitted for non-public source/);
  data.connections[1].repo = null;
  data.connections[0].relations[0].to = 'missing';
  assert.throws(() => validateData(data), /reference another project/);
});

test('build produces a deployment artifact with assets and legacy routes, excluding source files', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portfolio-build-'));
  try {
    const data = fixture();
    data.connections = mapFixture();
    await mkdir(path.join(root, 'data'));
    await mkdir(path.join(root, 'assets'));
    await Promise.all(Object.entries(data).map(([key, value]) => writeFile(path.join(root, 'data', `${key}.json`), JSON.stringify(value))));
    await writeFile(path.join(root, 'site.template.html'), '<!doctype html><title>{{PROFILE_NAME}}</title>{{PROJECTS}}{{CV}}{{TEA_LOGO}}{{CONNECTIONS}}');
    await writeFile(path.join(root, 'assets', 'tea-logo.svg'), '<svg id="test-tea-logo" viewBox="0 0 90 48"></svg>');
    await writeFile(path.join(root, 'assets', 'styles.css'), 'body{}');
    await writeFile(path.join(root, 'about.html'), '<title>About</title>');
    await writeFile(path.join(root, 'README.md'), 'Private authoring instructions.');
    await mkdir(path.join(root, 'local-drafts'));
    await writeFile(path.join(root, 'local-drafts', 'article-enrichment.json'), '{"status":"requires-review"}');
    await build(root);
    assert.equal(await readFile(path.join(root, 'index.html'), 'utf8'), await readFile(path.join(root, 'dist', 'index.html'), 'utf8'));
    const published = await readFile(path.join(root, 'dist', 'index.html'), 'utf8');
    assert.ok(published.includes('id="test-tea-logo"'));
    assert.ok(published.includes('data-map-panel="site"'));
    assert.equal(await readFile(path.join(root, 'dist', 'assets', 'styles.css'), 'utf8'), 'body{}');
    assert.equal(await readFile(path.join(root, 'dist', 'about.html'), 'utf8'), '<title>About</title>');
    const files = await readdir(path.join(root, 'dist'));
    assert.ok(files.includes('.nojekyll'));
    assert.ok(!files.includes('data'));
    assert.ok(!files.includes('README.md'));
    assert.ok(!files.includes('site.template.html'));
    assert.ok(!files.includes('local-drafts'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
