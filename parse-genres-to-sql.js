#!/usr/bin/env node

/**
 * Parse DBpedia dbo_props_remaining.ttl.gz and extract dbo:genre triples.
 *
 * Filters to artists present in artist_links (via 05-artist-links.sql),
 * outputs PostgreSQL COPY format for bulk loading into genres + artist_genres.
 */

const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');

const DATA_DIR         = path.join(__dirname, 'data', 'dbpedia');
const GENRE_FILE       = path.join(DATA_DIR, 'mappingbased-objects_lang=en.ttl.bz2');
const ARTIST_LINKS_SQL = path.join(__dirname, 'sql', '05-artist-links.sql');
const OUTPUT_DIR       = path.join(__dirname, 'sql');

const GENRE_PRED = '<http://dbpedia.org/ontology/genre>';

// ─── Allowlist ────────────────────────────────────────────────────────────────

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeCopy(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

function nameFromUri(uri) {
  const raw = uri.split('/').pop();
  try { return decodeURIComponent(raw).replace(/_/g, ' '); }
  catch (_) { return raw.replace(/_/g, ' '); }
}

// ─── Parse ────────────────────────────────────────────────────────────────────

async function parseGenres(allowlist) {
  console.log(`Parsing ${path.basename(GENRE_FILE)}...`);

  const genres = new Map();       // genre_uri -> name
  const artistGenres = [];        // { artist_uri, genre_uri }
  let lineCount = 0;
  let matchCount = 0;

  const bzproc = spawn('bunzip2', ['-c', GENRE_FILE]);
  const rl = readline.createInterface({ input: bzproc.stdout, crlfDelay: Infinity });

  for await (const line of rl) {
    lineCount++;
    if (lineCount % 500000 === 0) process.stdout.write(`  ${lineCount} lines, ${matchCount} genre triples...\r`);

    if (!line.includes(GENRE_PRED)) continue;
    if (!line.startsWith('<http://dbpedia.org/resource/')) continue;

    const uriEnd = line.indexOf('>');
    if (uriEnd < 0) continue;
    const artistUri = line.substring(1, uriEnd);
    if (!allowlist.has(artistUri)) continue;

    const predEnd = line.indexOf('>', uriEnd + 1);
    if (predEnd < 0) continue;

    const objStart = line.indexOf('<http://dbpedia.org/resource/', predEnd);
    if (objStart < 0) continue;
    const objEnd = line.indexOf('>', objStart + 1);
    if (objEnd < 0) continue;
    const genreUri = line.substring(objStart + 1, objEnd);

    if (!genres.has(genreUri)) {
      genres.set(genreUri, nameFromUri(genreUri));
    }
    artistGenres.push({ artist_uri: artistUri, genre_uri: genreUri });
    matchCount++;
  }

  console.log(`\nScanned ${lineCount} lines`);
  console.log(`Found ${genres.size} unique genres`);
  console.log(`Found ${artistGenres.length} artist-genre relationships`);
  return { genres, artistGenres };
}

// ─── Write SQL ────────────────────────────────────────────────────────────────

function writeCopyFile(filepath, header, columns, rows, getRow) {
  const out = fs.createWriteStream(filepath);
  out.write(header + '\n\n');
  out.write(`COPY ${columns} FROM stdin;\n`);
  for (const row of rows) out.write(getRow(row) + '\n');
  out.write('\\.\n');
  out.end();
  console.log(`Written: ${filepath}`);
}

function generateSql(genres, artistGenres) {
  console.log('\nWriting SQL files...');

  writeCopyFile(
    path.join(OUTPUT_DIR, '09-genres.sql'),
    '-- DBpedia genres from dbo:genre triples\n-- Generated from dbo_props_remaining.ttl.gz filtered by artist_links',
    'genres (uri, name)',
    [...genres.entries()],
    ([uri, name]) => `${escapeCopy(uri)}\t${escapeCopy(name)}`
  );

  writeCopyFile(
    path.join(OUTPUT_DIR, '10-artist-genres.sql'),
    '-- Artist-genre relationships from dbo:genre triples\n-- Generated from dbo_props_remaining.ttl.gz filtered by artist_links',
    'artist_genres (artist_uri, genre_uri)',
    artistGenres,
    (ag) => `${escapeCopy(ag.artist_uri)}\t${escapeCopy(ag.genre_uri)}`
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('DBpedia genre extraction\n');

  for (const f of [GENRE_FILE, ARTIST_LINKS_SQL]) {
    if (!fs.existsSync(f)) {
      console.error(`Missing file: ${f}`);
      process.exit(1);
    }
  }

  const allowlist = loadAllowlist();
  const { genres, artistGenres } = await parseGenres(allowlist);
  generateSql(genres, artistGenres);

  console.log('\nDone.');
  console.log(`  Genres:              ${genres.size}`);
  console.log(`  Artist-genre rows:   ${artistGenres.length}`);
  console.log('\nNext: load into DB with psql -f sql/08-genres-schema.sql then sql/09-genres.sql then sql/10-artist-genres.sql');
}

main().catch(err => { console.error(err); process.exit(1); });
