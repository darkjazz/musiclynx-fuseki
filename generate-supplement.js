#!/usr/bin/env node

/**
 * Generate supplement.sql — adds only the artists missing from the local
 * musiclynx PostgreSQL database (in artist_links but not in artists).
 *
 * Uses psql to fetch missing URIs, then streams the full DBpedia TTL dumps
 * to collect abstracts and categories for those URIs only.
 *
 * Output: sql/supplement.sql  (safe to run on a live db, uses ON CONFLICT DO NOTHING)
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');
const { execSync } = require('child_process');

const DATA_DIR      = path.join(__dirname, 'data', 'dbpedia');
const ABSTRACT_FILE = path.join(DATA_DIR, 'short-abstracts_lang=en.ttl');
const CATEGORY_FILE = path.join(DATA_DIR, 'categories_lang=en_articles.ttl');
const OUTPUT_FILE   = path.join(__dirname, 'sql', 'supplement.sql');
const PSQL          = 'psql -U alo -h /var/run/postgresql -d musiclynx';

// ─── Get missing URIs from local db ─────────────────────────────────────────

function getMissingUris() {
  console.log('Querying local db for missing artist URIs...');
  const tmpFile = '/tmp/missing_uris.txt';
  const sql = `SELECT al.dbpedia_uri FROM artist_links al LEFT JOIN artists a ON a.uri = al.dbpedia_uri WHERE a.uri IS NULL`;
  execSync(`${PSQL} -t -A -o ${tmpFile} -c "${sql}"`);
  const uris = new Set(fs.readFileSync(tmpFile, 'utf8').split('\n').filter(Boolean));
  fs.unlinkSync(tmpFile);
  console.log(`Found ${uris.size} missing artists\n`);
  return uris;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getNameFromUri(uri) {
  const raw = uri.split('/').pop();
  try { return decodeURIComponent(raw).replace(/_/g, ' '); }
  catch (_) { return raw.replace(/_/g, ' '); }
}

function getCategoryLabel(uri) {
  let label = uri.split('/').pop().replace(/^Category:/, '');
  try { return decodeURIComponent(label).replace(/_/g, ' '); }
  catch (_) { return label.replace(/_/g, ' '); }
}

// Escape for PostgreSQL COPY FROM stdin (tab-delimited text format)
function esc(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

async function streamLines(file, onLine) {
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const line of rl) onLine(line);
}

// ─── Parse abstracts ─────────────────────────────────────────────────────────

const COMMENT_PRED = '<http://www.w3.org/2000/01/rdf-schema#comment>';

async function parseAbstracts(missing) {
  console.log('Streaming short-abstracts_lang=en.ttl...');
  const artists = new Map();
  let checked = 0;

  await streamLines(ABSTRACT_FILE, (line) => {
    if (!line.startsWith('<http://dbpedia.org/resource/')) return;
    if (!line.includes(COMMENT_PRED)) return;

    const uriEnd = line.indexOf('>');
    const uri = line.substring(1, uriEnd);
    if (!missing.has(uri)) return;

    const firstQuote = line.indexOf('"', uriEnd);
    if (firstQuote < 0) return;
    const langIdx = line.lastIndexOf('"@en');
    if (langIdx <= firstQuote) return;

    artists.set(uri, {
      uri,
      name: getNameFromUri(uri),
      description: line.substring(firstQuote + 1, langIdx),
    });

    checked++;
    if (checked % 5000 === 0) process.stdout.write(`  ${checked} found...\r`);
  });

  console.log(`\nFound abstracts for ${artists.size} of ${missing.size} missing artists`);
  return artists;
}

// ─── Parse categories ────────────────────────────────────────────────────────

const SUBJECT_PRED = '<http://purl.org/dc/terms/subject>';

async function parseCategories(artists) {
  console.log('\nStreaming categories_lang=en_articles.ttl...');
  const categories = new Map();
  const artistCategories = [];
  let checked = 0;

  await streamLines(CATEGORY_FILE, (line) => {
    if (!line.startsWith('<http://dbpedia.org/resource/')) return;
    if (!line.includes(SUBJECT_PRED)) return;
    if (!line.includes('Category:')) return;

    const uriEnd = line.indexOf('>');
    const artistUri = line.substring(1, uriEnd);
    if (!artists.has(artistUri)) return;

    const catStart = line.indexOf('<http://dbpedia.org/resource/Category:');
    if (catStart < 0) return;
    const catEnd = line.indexOf('>', catStart + 1);
    if (catEnd < 0) return;
    const categoryUri = line.substring(catStart + 1, catEnd);

    if (!categories.has(categoryUri)) {
      categories.set(categoryUri, { uri: categoryUri, name: getCategoryLabel(categoryUri) });
    }
    artistCategories.push({ artist_uri: artistUri, category_uri: categoryUri });

    checked++;
    if (checked % 100000 === 0) process.stdout.write(`  ${checked} pairs...\r`);
  });

  console.log(`\nFound ${categories.size} new categories`);
  console.log(`Found ${artistCategories.length} new artist-category pairs`);
  return { categories, artistCategories };
}

// ─── Write supplement.sql ────────────────────────────────────────────────────

function writeSupplement(artists, categories, artistCategories) {
  console.log('\nWriting sql/supplement.sql...');
  const out = fs.createWriteStream(OUTPUT_FILE);

  const w = (s) => out.write(s + '\n');

  w('-- Supplement: add missing artists, categories, and artist-category links');
  w('-- Safe to run on a live db — uses ON CONFLICT DO NOTHING throughout.');
  w('-- Generated by generate-supplement.js\n');
  w('BEGIN;\n');

  // ── Artists ──
  w('CREATE TEMP TABLE _new_artists (uri TEXT, name TEXT, type TEXT, description TEXT) ON COMMIT DROP;');
  w('COPY _new_artists (uri, name, type, description) FROM stdin;');
  for (const a of artists.values()) {
    w(`${esc(a.uri)}\t${esc(a.name)}\tMusicalArtist\t${esc(a.description)}`);
  }
  w('\\.');
  w('INSERT INTO artists (uri, name, type, description)');
  w('  SELECT uri, name, type, description FROM _new_artists');
  w('  ON CONFLICT (uri) DO NOTHING;\n');

  // ── Categories ──
  w('CREATE TEMP TABLE _new_categories (uri TEXT, name TEXT) ON COMMIT DROP;');
  w('COPY _new_categories (uri, name) FROM stdin;');
  for (const c of categories.values()) {
    w(`${esc(c.uri)}\t${esc(c.name)}`);
  }
  w('\\.');
  w('INSERT INTO categories (uri, name)');
  w('  SELECT uri, name FROM _new_categories');
  w('  ON CONFLICT (uri) DO NOTHING;\n');

  // ── Artist-categories ──
  w('CREATE TEMP TABLE _new_ac (artist_uri TEXT, category_uri TEXT) ON COMMIT DROP;');
  w('COPY _new_ac (artist_uri, category_uri) FROM stdin;');
  for (const ac of artistCategories) {
    w(`${esc(ac.artist_uri)}\t${esc(ac.category_uri)}`);
  }
  w('\\.');
  w('INSERT INTO artist_categories (artist_uri, category_uri)');
  w('  SELECT artist_uri, category_uri FROM _new_ac');
  w('  ON CONFLICT (artist_uri, category_uri) DO NOTHING;\n');

  w('COMMIT;');
  out.end();

  console.log(`Written: ${OUTPUT_FILE}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  for (const f of [ABSTRACT_FILE, CATEGORY_FILE]) {
    if (!fs.existsSync(f)) { console.error(`Missing: ${f}`); process.exit(1); }
  }

  const missing  = getMissingUris();
  const artists  = await parseAbstracts(missing);
  const { categories, artistCategories } = await parseCategories(artists);

  writeSupplement(artists, categories, artistCategories);

  console.log('\nDone.');
  console.log(`  New artists:              ${artists.size}`);
  console.log(`  New categories:           ${categories.size}`);
  console.log(`  New artist-category rows: ${artistCategories.length}`);
  console.log(`\nLoad with:`);
  console.log(`  psql -U alo -h /var/run/postgresql -d musiclynx -f sql/supplement.sql`);
}

main().catch(err => { console.error(err); process.exit(1); });
