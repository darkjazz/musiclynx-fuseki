#!/usr/bin/env node

/**
 * Export lx_db.json and mp_db.json to SQL INSERT files
 * for loading into the musiclynx PostgreSQL database.
 */

const fs = require('fs');
const path = require('path');

const SERVER_DATA_DIR = path.join(__dirname, '..', 'musiclynx-server', 'static', 'data');
const OUTPUT_DIR = path.join(__dirname, 'sql');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function escapeSql(str) {
  if (!str) return '';
  return str.replace(/'/g, "''");
}

/**
 * Export lx_db.json -> sql/05-artist-links.sql
 * The JSON has bidirectional entries: { mbid: uri, uri: mbid }
 * We extract only the MBID->URI direction to avoid duplicates.
 */
function exportArtistLinks() {
  console.log('Reading lx_db.json...');
  const data = JSON.parse(fs.readFileSync(path.join(SERVER_DATA_DIR, 'lx_db.json'), 'utf8'));

  const pairs = [];
  for (const [key, value] of Object.entries(data)) {
    if (UUID_REGEX.test(key)) {
      pairs.push({ mbid: key, dbpedia_uri: value });
    }
  }

  console.log(`Found ${pairs.length} MBID->URI pairs`);

  // Use COPY format for speed
  let out = '-- Artist MBID <-> DBpedia URI links\n';
  out += '-- Generated from lx_db.json\n\n';
  out += 'COPY artist_links (mbid, dbpedia_uri) FROM stdin;\n';

  for (const pair of pairs) {
    out += `${pair.mbid}\t${pair.dbpedia_uri}\n`;
  }

  out += '\\.\n';

  const outFile = path.join(OUTPUT_DIR, '05-artist-links.sql');
  fs.writeFileSync(outFile, out);
  console.log(`Written to ${outFile}`);
}

/**
 * Export mp_db.json -> sql/06-moodplay-similar.sql
 * Structure: { mbid: { id, name, links: [{id, name}...] } }
 */
function exportMoodplaySimilar() {
  console.log('Reading mp_db.json...');
  const data = JSON.parse(fs.readFileSync(path.join(SERVER_DATA_DIR, 'mp_db.json'), 'utf8'));

  let totalLinks = 0;

  // Use COPY format for speed
  let out = '-- Moodplay mood-based similarity\n';
  out += '-- Generated from mp_db.json\n\n';
  out += 'COPY moodplay_similar (artist_mbid, similar_mbid, similar_name, rank) FROM stdin;\n';

  for (const [mbid, artist] of Object.entries(data)) {
    if (!artist.links) continue;
    artist.links.forEach((link, idx) => {
      out += `${mbid}\t${link.id}\t${escapeSql(link.name).replace(/\t/g, ' ')}\t${idx}\n`;
      totalLinks++;
    });
  }

  out += '\\.\n';

  console.log(`Found ${Object.keys(data).length} artists, ${totalLinks} links`);

  const outFile = path.join(OUTPUT_DIR, '06-moodplay-similar.sql');
  fs.writeFileSync(outFile, out);
  console.log(`Written to ${outFile}`);
}

function main() {
  console.log('Exporting JSON data to SQL...\n');
  exportArtistLinks();
  console.log('');
  exportMoodplaySimilar();
  console.log('\nDone!');
}

main();
