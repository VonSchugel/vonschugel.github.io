import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './build.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeXML(value) {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, key) => {
    if (key.startsWith('#')) {
      const number = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      return number > 0 && number <= 0x10ffff && !(number >= 0xd800 && number <= 0xdfff) ? String.fromCodePoint(number) : '';
    }
    return ENTITIES[key.toLowerCase()] ?? entity;
  });
}

function plainText(value) {
  return decodeXML(decodeXML(value).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function field(item, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = item.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? match[1].trim() : '';
}

// Intentionally supports the RSS 2.0 shape supplied by Substack; it does not
// execute XML or resolve entities, HTML, scripts, or external references.
export function parseRSS(xml, limit = 6) {
  if (!/<rss\b/i.test(xml) || /<!DOCTYPE/i.test(xml)) throw new Error('Expected a Substack RSS 2.0 feed.');
  const articles = [];
  const seen = new Set();
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const title = plainText(field(item, 'title'));
    const url = decodeXML(field(item, 'link'));
    const published = new Date(decodeXML(field(item, 'pubDate')));
    let parsed;
    try { parsed = new URL(url); } catch { continue; }
    if (!title || !['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || Number.isNaN(published.getTime()) || seen.has(url)) continue;
    seen.add(url);
    const excerpt = plainText(field(item, 'description'));
    const description = excerpt.length > 180 ? `${excerpt.slice(0, 177).replace(/\s+\S*$/, '')}…` : excerpt;
    articles.push({ title, url, date: published.toISOString().slice(0, 10), description });
  }
  if (!articles.length) throw new Error('The feed contained no valid public articles.');
  return articles.sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit);
}

export function feedURL(publication) {
  const url = new URL(publication);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Publication URL must be an HTTP(S) URL without credentials.');
  url.pathname = `${url.pathname.replace(/\/+$/, '').replace(/\/feed$/, '')}/feed`;
  url.search = '';
  url.hash = '';
  return url.href;
}

async function boundedText(response) {
  if (Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Feed exceeds the 2 MB limit.');
  if (!response.body) throw new Error('Feed response is empty.');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) { await reader.cancel(); throw new Error('Feed exceeds the 2 MB limit.'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function updateFeed({ root = ROOT, fetcher = fetch, log = console.log, warn = console.warn, requireFresh = false } = {}) {
  try {
    const profile = JSON.parse(await readFile(path.join(root, 'data', 'profile.json'), 'utf8'));
    if (!profile.substack) { log('No Substack publication configured; keeping the local article list.'); return false; }
    const response = await fetcher(feedURL(profile.substack), { headers: { Accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8', 'User-Agent': 'marqicci-portfolio-feed/1.0' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}.`);
    const articles = parseRSS(await boundedText(response));
    await writeFile(path.join(root, 'data', 'articles.json'), `${JSON.stringify(articles, null, 2)}\n`);
    log(`Updated ${articles.length} public Substack article${articles.length === 1 ? '' : 's'}.`);
    return true;
  } catch (error) {
    warn(`Substack update skipped: ${error.message} Keeping the existing article list.`);
    if (requireFresh) throw error;
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await updateFeed({ requireFresh: process.argv.includes('--require-fresh') });
  } catch {
    // A scheduled run must not replace a newer deployment with an older source
    // cache when the publication is temporarily unavailable.
    process.exitCode = 1;
  }
}
