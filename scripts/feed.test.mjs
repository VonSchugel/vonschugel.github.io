import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { decodeXML, feedURL, parseRSS, updateFeed } from './update-feed.mjs';

const rss = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item><title><![CDATA[Tea &amp; code]]></title><link>https://example.com/p/tea?a=1&amp;b=2</link><pubDate>Sun, 11 Jan 2026 12:30:00 GMT</pubDate><description><![CDATA[<p>Small &amp; thoughtful.</p><script>bad()</script>]]></description></item>
  <item><title>Older article</title><link>https://example.com/p/older</link><pubDate>Sat, 10 Jan 2026 12:30:00 GMT</pubDate><description>Another note.</description></item>
  <item><title>Unsafe link</title><link>javascript:alert(1)</link><pubDate>Sun, 11 Jan 2026 12:30:00 GMT</pubDate></item>
  <item><title>Duplicate</title><link>https://example.com/p/older</link><pubDate>Sat, 10 Jan 2026 12:30:00 GMT</pubDate></item>
</channel></rss>`;

test('RSS items decode CDATA and entities, strip HTML, sort, and skip unsafe or duplicate links', () => {
  const articles = parseRSS(rss);
  assert.equal(articles.length, 2);
  assert.deepEqual(articles[0], { title: 'Tea & code', url: 'https://example.com/p/tea?a=1&b=2', date: '2026-01-11', description: 'Small & thoughtful.' });
  assert.equal(parseRSS(rss, 1).length, 1);
  assert.equal(decodeXML('&#x1FAD6; &#39; &quot;'), '🫖 \' "');
});

test('feed URLs normalize publication roots without accepting non-web schemes', () => {
  assert.equal(feedURL('https://example.substack.com/'), 'https://example.substack.com/feed');
  assert.equal(feedURL('https://example.substack.com/feed?x=1#part'), 'https://example.substack.com/feed');
  assert.throws(() => feedURL('javascript:alert(1)'), /HTTP/);
  assert.throws(() => parseRSS('<html>Try again later</html>'), /RSS 2.0/);
  assert.throws(() => parseRSS('<!DOCTYPE rss><rss><channel/></rss>'), /RSS 2.0/);
  assert.throws(() => parseRSS('<rss><channel/></rss>'), /no valid public articles/);
});

test('refresh preserves cached articles on network failure or invalid RSS; valid response updates them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portfolio-feed-'));
  const messages = [];
  try {
    await mkdir(path.join(root, 'data'));
    await writeFile(path.join(root, 'data', 'profile.json'), JSON.stringify({ substack: 'https://example.substack.com' }));
    const cache = '[{"title":"cached"}]\n';
    const articlePath = path.join(root, 'data', 'articles.json');
    await writeFile(articlePath, cache);
    const options = { root, log: value => messages.push(value), warn: value => messages.push(value) };
    assert.equal(await updateFeed({ ...options, fetcher: async () => { throw new Error('Offline'); } }), false);
    assert.equal(await readFile(articlePath, 'utf8'), cache);
    assert.equal(await updateFeed({ ...options, fetcher: async () => new Response('not XML') }), false);
    assert.equal(await readFile(articlePath, 'utf8'), cache);
    await assert.rejects(updateFeed({ ...options, requireFresh: true, fetcher: async () => { throw new Error('Offline'); } }), /Offline/);
    assert.equal(await readFile(articlePath, 'utf8'), cache);
    await assert.rejects(updateFeed({ ...options, requireFresh: true, fetcher: async () => new Response('<rss><channel/></rss>') }), /no valid public articles/);
    assert.equal(await readFile(articlePath, 'utf8'), cache);
    assert.equal(await updateFeed({ ...options, fetcher: async () => new Response(rss) }), true);
    assert.equal(JSON.parse(await readFile(articlePath, 'utf8')).length, 2);
    assert.ok(messages.some(message => message.includes('Keeping the existing article list')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an unconfigured publication skips the request and retains manual content', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'portfolio-no-feed-'));
  try {
    await mkdir(path.join(root, 'data'));
    await writeFile(path.join(root, 'data', 'profile.json'), '{"substack":null}');
    let called = false;
    assert.equal(await updateFeed({ root, requireFresh: true, fetcher: async () => { called = true; }, log: () => {} }), false);
    assert.equal(called, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
