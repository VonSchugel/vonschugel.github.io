import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { DEFAULT_MODEL, LIMITS, LOCAL_ENDPOINT, enrichLocal, validateArticles, validateSuggestions } from './enrich-local.mjs';

const articles = [{ title: 'Tea & code', url: 'https://example.com/p/tea', date: '2026-01-11', description: 'A small project about making tea.' }];
const suggestion = { index: 0, description: 'A small project about making tea.', tags: ['Tea', 'Projects'] };
const quiet = () => {};

function answer(suggestions = [suggestion], overrides = {}) {
  return new Response(JSON.stringify({ done: true, done_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ suggestions }) }, ...overrides }));
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portfolio-enrich-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'data'));
  await mkdir(path.join(root, 'local-drafts'));
  const source = `${JSON.stringify(articles, null, 2)}\n`;
  const sourcePath = path.join(root, 'data', 'articles.json');
  const draftPath = path.join(root, 'local-drafts', 'article-enrichment.json');
  await writeFile(sourcePath, source);
  await writeFile(draftPath, 'previous reviewed draft\n');
  return { root, source, sourcePath, draftPath };
}

test('local enrichment creates a review draft with provenance, without editing source data', async t => {
  const fixtureData = await fixture(t);
  const { root, source, sourcePath, draftPath } = fixtureData;
  let requests = 0;
  const { output, draft } = await enrichLocal({
    root, log: quiet, model: DEFAULT_MODEL, now: () => new Date('2026-10-24T12:00:00Z'),
    fetcher: async (url, options) => {
      requests += 1;
      assert.equal(url, LOCAL_ENDPOINT);
      assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      const body = JSON.parse(options.body);
      assert.equal(body.model, DEFAULT_MODEL);
      assert.equal(body.stream, false);
      assert.equal(body.think, false);
      assert.equal(body.options.temperature, 0);
      assert.equal(body.format.additionalProperties, false);
      assert.ok(Buffer.byteLength(JSON.stringify(body.messages), 'utf8') <= LIMITS.promptBytes);
      assert.deepEqual(JSON.parse(body.messages[1].content).articles, [{ index: 0, title: articles[0].title, excerpt: articles[0].description }]);
      return answer();
    },
  });
  assert.equal(requests, 1);
  assert.equal(output, draftPath);
  assert.equal(await readFile(sourcePath, 'utf8'), source);
  assert.equal(draft.status, 'requires-review');
  assert.equal(draft.sourceSHA256, createHash('sha256').update(source).digest('hex'));
  assert.equal(draft.generatedAt, '2026-10-24T12:00:00.000Z');
  assert.equal(draft.model, DEFAULT_MODEL);
  assert.deepEqual(draft.articles[0].source, articles[0]);
  assert.deepEqual(draft.articles[0].draft, { description: suggestion.description, tags: suggestion.tags });
  assert.deepEqual(JSON.parse(await readFile(draftPath, 'utf8')), draft);
  assert.deepEqual(await readdir(path.dirname(draftPath)), ['article-enrichment.json']);
});

test('provider failures and malformed output preserve the existing source cache and draft', async t => {
  const { root, source, sourcePath, draftPath } = await fixture(t);
  const failures = [
    async () => { throw new Error('Offline'); },
    async () => new Response('Service unavailable', { status: 503 }),
    async () => new Response('not JSON'),
    async () => answer([], {}),
    async () => answer([suggestion], { done: false }),
    async () => answer([suggestion], { done_reason: 'length' }),
    async () => answer([suggestion], { message: { role: 'assistant', content: '```json\n{}\n```' } }),
    async () => answer([{ ...suggestion, description: 'x'.repeat(241) }]),
    async () => answer([{ ...suggestion, index: 1 }]),
    async () => answer([{ ...suggestion, facts: 'Invented field' }]),
  ];
  for (const fetcher of failures) {
    await assert.rejects(enrichLocal({ root, log: quiet, fetcher }));
    assert.equal(await readFile(sourcePath, 'utf8'), source);
    assert.equal(await readFile(draftPath, 'utf8'), 'previous reviewed draft\n');
  }
  assert.deepEqual(await readdir(path.dirname(draftPath)), ['article-enrichment.json']);
});

test('declared and streamed oversized responses are cancelled before draft replacement', async t => {
  const { root, source, sourcePath, draftPath } = await fixture(t);
  let cancelled = 0;
  const response = (declared) => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(LIMITS.responseBytes + 1)); },
    cancel() { cancelled += 1; },
  }), { headers: declared ? { 'Content-Length': String(LIMITS.responseBytes + 1) } : {} });
  for (const declared of [true, false]) {
    await assert.rejects(enrichLocal({ root, log: quiet, fetcher: async () => response(declared) }), /64 KB limit/);
  }
  assert.equal(cancelled, 2);
  assert.equal(await readFile(sourcePath, 'utf8'), source);
  assert.equal(await readFile(draftPath, 'utf8'), 'previous reviewed draft\n');
});

test('bounded input and invalid model choices fail before sending any data', async t => {
  const { root, source, sourcePath, draftPath } = await fixture(t);
  let requests = 0;
  const fetcher = async () => { requests += 1; return answer(); };
  for (const model of ['qwen3:cloud', 'gemma-cloud:latest', 'https://example.com/model']) {
    await assert.rejects(enrichLocal({ root, log: quiet, fetcher, model }), /installed local model/);
  }
  assert.equal(await readFile(sourcePath, 'utf8'), source);
  await writeFile(sourcePath, ' '.repeat(LIMITS.inputBytes + 1));
  await assert.rejects(enrichLocal({ root, log: quiet, fetcher }), /32 KB input limit/);
  assert.equal(requests, 0);
  assert.equal(await readFile(draftPath, 'utf8'), 'previous reviewed draft\n');
});

test('a concurrent feed update rejects stale inference and retains the previous draft', async t => {
  const { root, sourcePath, draftPath } = await fixture(t);
  const refreshed = `${JSON.stringify([{ ...articles[0], title: 'New cached article' }])}\n`;
  await assert.rejects(enrichLocal({ root, log: quiet, fetcher: async () => {
    await writeFile(sourcePath, refreshed);
    return answer();
  } }), /source snapshot changed/);
  assert.equal(await readFile(sourcePath, 'utf8'), refreshed);
  assert.equal(await readFile(draftPath, 'utf8'), 'previous reviewed draft\n');
  assert.deepEqual(await readdir(path.dirname(draftPath)), ['article-enrichment.json']);
});

test('an older in-flight request cannot overwrite a newer completed source snapshot', async t => {
  const { root, sourcePath, draftPath } = await fixture(t);
  let releaseOld, markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  const older = enrichLocal({ root, log: quiet, fetcher: async () => {
    markStarted();
    return new Promise(resolve => { releaseOld = () => resolve(answer([{ ...suggestion, description: 'Old source.' }])); });
  } });
  await started;
  const refreshed = `${JSON.stringify([{ ...articles[0], title: 'Fresh source' }])}\n`;
  await writeFile(sourcePath, refreshed);
  await enrichLocal({ root, log: quiet, fetcher: async () => answer([{ ...suggestion, description: 'Fresh source.' }]) });
  releaseOld();
  await assert.rejects(older, /source snapshot changed/);
  assert.equal(JSON.parse(await readFile(draftPath, 'utf8')).articles[0].draft.description, 'Fresh source.');
  assert.equal(await readFile(sourcePath, 'utf8'), refreshed);
});

test('concurrent draft commits remain complete and clear all temporary files', async t => {
  const { root, source, sourcePath, draftPath } = await fixture(t);
  await writeFile(draftPath, '{"fixture":"original"}\n');
  const writers = Array.from({ length: 24 }, (_, index) => enrichLocal({ root, log: quiet, fetcher: async () => answer([{ ...suggestion, description: `Draft ${index}.` }]) }));
  const reader = (async () => {
    for (let index = 0; index < 120; index += 1) JSON.parse(await readFile(draftPath, 'utf8'));
  })();
  await Promise.all([...writers, reader]);
  assert.equal(await readFile(sourcePath, 'utf8'), source);
  assert.equal(JSON.parse(await readFile(draftPath, 'utf8')).status, 'requires-review');
  assert.deepEqual(await readdir(path.dirname(draftPath)), ['article-enrichment.json']);
});

test('a long multilingual source snapshot exceeds the model prompt budget before any request', async t => {
  const { root, sourcePath, draftPath } = await fixture(t);
  const longExcerpt = Array.from({ length: 950 }, (_, index) => String.fromCharCode(0x4e00 + (index * 37) % 2000)).join('');
  const longArticles = [{ ...articles[0], description: longExcerpt }];
  assert.doesNotThrow(() => validateArticles(longArticles));
  const source = `${JSON.stringify(longArticles)}\n`;
  assert.ok(Buffer.byteLength(source, 'utf8') < LIMITS.inputBytes);
  await writeFile(sourcePath, source);
  let requests = 0;
  await assert.rejects(enrichLocal({ root, log: quiet, fetcher: async () => {
    requests += 1;
    return answer();
  } }), /2,800-byte.*prompt budget.*Split or batch/);
  assert.equal(requests, 0);
  assert.equal(await readFile(sourcePath, 'utf8'), source);
  assert.equal(await readFile(draftPath, 'utf8'), 'previous reviewed draft\n');
});

test('validation rejects unsafe source metadata, duplicate indices, markup, and unbounded tags', () => {
  assert.throws(() => validateArticles([]), /1 to 6/);
  assert.throws(() => validateArticles(Array(7).fill(articles[0])), /1 to 6/);
  assert.throws(() => validateArticles([{ ...articles[0], url: 'javascript:alert(1)' }]), /HTTP/);
  assert.throws(() => validateArticles([{ ...articles[0], date: '2026-02-30' }]), /invalid/);
  assert.throws(() => validateArticles([{ ...articles[0], description: 'x'.repeat(1001) }]), /1000/);
  assert.throws(() => validateSuggestions({ suggestions: [suggestion, suggestion] }, 2), /indices/);
  assert.throws(() => validateSuggestions({ suggestions: [{ ...suggestion, description: '<script>alert(1)</script>' }] }, 1), /plain text/);
  assert.throws(() => validateSuggestions({ suggestions: [{ ...suggestion, tags: ['Tea', 'tea'] }] }, 1), /unique/);
  assert.throws(() => validateSuggestions({ suggestions: [{ ...suggestion, tags: ['x'.repeat(33)] }] }, 1), /32/);
  assert.throws(() => validateSuggestions({ suggestions: [{ ...suggestion, tags: ['<img>'] }] }, 1), /plain text/);
  assert.throws(() => validateSuggestions({ suggestions: [{ ...suggestion, tags: [] }] }, 1), /1 to 4/);
});
