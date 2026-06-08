#!/usr/bin/env node

/**
 * Parse DBpedia TTL dumps and generate PostgreSQL COPY data files.
 *
 * Uses the full dumps in data/dbpedia/ and filters to only artists present
 * in the artist_links table (loaded from sql/05-artist-links.sql), so type-based
 * filtering is not needed — artist_links is already a curated music artist list.
 *
 * Outputs COPY FROM stdin format for fast bulk loading.
 */

const fs = require('fs');
const readline = require('readline');
const path = require('path');

const DATA_DIR    = path.join(__dirname, 'data', 'dbpedia');
const ABSTRACT_FILE   = path.join(DATA_DIR, 'short-abstracts_lang=en.ttl');
const CATEGORY_FILE   = path.join(DATA_DIR, 'categories_lang=en_articles.ttl');
const ARTIST_LINKS_SQL = path.join(__dirname, 'sql', '05-artist-links.sql');
const OUTPUT_DIR  = path.join(__dirname, 'sql');

// ─── Allowlist ───────────────────────────────────────────────────────────────

function loadAllowlist() {
  console.log('Loading artist URI allowlist from 05-artist-links.sql...');
  const content = fs.readFileSync(ARTIST_LINKS_SQL, 'utf8');
  const uris = new Set();
  let inCopy = false;
  for (const line of content.split('\n')) {
    if (line.startsWith('COPY ')) { inCopy = true; continue; }
    if (line === '\\.') { inCopy = false; continue; }
    if (inCopy && line.trim()) {
      const tab = line.indexOf('\t');
      if (tab > -1) uris.add(line.substring(tab + 1).trim());
    }
  }
  console.log(`Loaded ${uris.size} allowed URIs\n`);
  return uris;
}

// ─── COPY-format escaping ────────────────────────────────────────────────────

function escapeCopy(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
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

async function streamLines(file, onLine) {
  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const line of rl) onLine(line);
}

// ─── Parse abstracts ─────────────────────────────────────────────────────────
// Format: <URI> <http://www.w3.org/2000/01/rdf-schema#comment> "text"@en .

const COMMENT_PRED = '<http://www.w3.org/2000/01/rdf-schema#comment>';

async function parseAbstracts(allowlist) {
  console.log('Parsing short-abstracts_lang=en.ttl...');
  const artists = new Map();
  let lineCount = 0;

  await streamLines(ABSTRACT_FILE, (line) => {
    if (!line.startsWith('<http://dbpedia.org/resource/')) return;
    if (!line.includes(COMMENT_PRED)) return;

    const uriEnd = line.indexOf('>');
    const uri = line.substring(1, uriEnd);
    if (!allowlist.has(uri)) return;

    // Extract string between first " and last "@en
    const firstQuote = line.indexOf('"', uriEnd);
    if (firstQuote < 0) return;
    const langIdx = line.lastIndexOf('"@en');
    if (langIdx <= firstQuote) return;

    const description = line.substring(firstQuote + 1, langIdx);
    artists.set(uri, {
      uri,
      name: getNameFromUri(uri),
      type: 'MusicalArtist',
      description,
    });

    lineCount++;
    if (lineCount % 10000 === 0) process.stdout.write(`  ${lineCount} artists...\r`);
  });

  console.log(`\nFound ${artists.size} artists with abstracts`);
  return artists;
}

// ─── Parse categories ────────────────────────────────────────────────────────
// Format: <URI> <http://purl.org/dc/terms/subject> <Category:URI> .

const SUBJECT_PRED = '<http://purl.org/dc/terms/subject>';

async function parseCategories(allowlist, artists) {
  console.log('\nParsing categories_lang=en_articles.ttl...');
  const categories = new Map();
  const artistCategories = [];
  let lineCount = 0;

  await streamLines(CATEGORY_FILE, (line) => {
    if (!line.startsWith('<http://dbpedia.org/resource/')) return;
    if (!line.includes(SUBJECT_PRED)) return;
    if (!line.includes('Category:')) return;

    const uriEnd = line.indexOf('>');
    const artistUri = line.substring(1, uriEnd);
    if (!allowlist.has(artistUri)) return;
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

    lineCount++;
    if (lineCount % 100000 === 0) process.stdout.write(`  ${lineCount} artist-category pairs...\r`);
  });

  console.log(`\nFound ${categories.size} unique categories`);
  console.log(`Found ${artistCategories.length} artist-category relationships`);
  return { categories, artistCategories };
}

// ─── Write SQL (COPY FROM stdin format) ─────────────────────────────────────

function writeCopyFile(filepath, header, columns, rows, getRow) {
  const out = fs.createWriteStream(filepath);
  out.write(header + '\n\n');
  out.write(`COPY ${columns} FROM stdin;\n`);
  for (const row of rows) {
    out.write(getRow(row) + '\n');
  }
  out.write('\\.\n');
  out.end();
  console.log(`Written: ${filepath}`);
}

function generateSql(artists, categories, artistCategories) {
  console.log('\nWriting SQL files...');

  writeCopyFile(
    path.join(OUTPUT_DIR, '02-artists.sql'),
    '-- Artist abstracts and metadata\n-- Generated from short-abstracts_lang=en.ttl filtered by artist_links',
    'artists (uri, name, type, description)',
    [...artists.values()],
    (a) => `${escapeCopy(a.uri)}\t${escapeCopy(a.name)}\t${escapeCopy(a.type)}\t${escapeCopy(a.description)}`
  );

  writeCopyFile(
    path.join(OUTPUT_DIR, '03-categories.sql'),
    '-- DBpedia categories\n-- Generated from categories_lang=en_articles.ttl',
    'categories (uri, name)',
    [...categories.values()],
    (c) => `${escapeCopy(c.uri)}\t${escapeCopy(c.name)}`
  );

  writeCopyFile(
    path.join(OUTPUT_DIR, '04-artist-categories.sql'),
    '-- Artist-category relationships\n-- Generated from categories_lang=en_articles.ttl filtered by artist_links',
    'artist_categories (artist_uri, category_uri)',
    artistCategories,
    (ac) => `${escapeCopy(ac.artist_uri)}\t${escapeCopy(ac.category_uri)}`
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Starting TTL → PostgreSQL conversion\n');

  for (const f of [ABSTRACT_FILE, CATEGORY_FILE, ARTIST_LINKS_SQL]) {
    if (!fs.existsSync(f)) {
      console.error(`Missing file: ${f}`);
      process.exit(1);
    }
  }

  const allowlist = loadAllowlist();
  const artists = await parseAbstracts(allowlist);
  const { categories, artistCategories } = await parseCategories(allowlist, artists);

  generateSql(artists, categories, artistCategories);

  console.log('\nDone. Run ./import-to-rds.sh to reload the database.');
  console.log(`  Artists:              ${artists.size}`);
  console.log(`  Categories:           ${categories.size}`);
  console.log(`  Artist-category rows: ${artistCategories.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
