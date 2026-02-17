#!/usr/bin/env node

/**
 * Parse TTL files and generate PostgreSQL schema + data
 */

const fs = require('fs');
const path = require('path');

const ABSTRACT_FILE = path.join(__dirname, 'data', 'artist_abstract_graph.ttl');
const CATEGORY_FILE = path.join(__dirname, 'data', 'artist_category_graph.ttl');
const OUTPUT_DIR = path.join(__dirname, 'sql');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Escape string for SQL
function escapeSql(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\\\')     // Escape backslashes first
    .replace(/'/g, "''")         // Escape single quotes
    .replace(/\n/g, ' ')         // Replace newlines with spaces
    .replace(/\r/g, '')          // Remove carriage returns
    .replace(/\t/g, ' ');        // Replace tabs with spaces
}

// Extract artist name from DBpedia URI
function getNameFromUri(uri) {
  const name = uri.split('/').pop();
  return escapeSql(decodeURIComponent(name).replace(/_/g, ' '));
}

// Extract category label from URI
function getCategoryLabel(uri) {
  let label = uri.split('/').pop();
  label = label.replace(/^Category:/, '');
  return escapeSql(decodeURIComponent(label).replace(/_/g, ' '));
}

// Parse artist abstracts
function parseAbstracts() {
  console.log('Parsing artist abstracts...');
  const content = fs.readFileSync(ABSTRACT_FILE, 'utf8');
  const lines = content.split('\n');

  const artists = new Map();
  let currentArtist = null;
  let currentType = null;
  let currentComment = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and prefixes
    if (!trimmed || trimmed.startsWith('PREFIX') || trimmed.startsWith('@prefix')) {
      continue;
    }

    // New artist URI
    if (trimmed.startsWith('<http://dbpedia.org/resource/')) {
      // Save previous artist
      if (currentArtist && currentComment) {
        artists.set(currentArtist, {
          uri: currentArtist,
          name: getNameFromUri(currentArtist),
          type: currentType,
          description: currentComment
        });
      }

      currentArtist = trimmed.replace(/>\s*$/, '').replace(/^</, '');
      currentType = null;
      currentComment = null;
    }
    // rdf:type
    else if (trimmed.includes('rdf:type')) {
      const match = trimmed.match(/dbo:(\w+)/);
      if (match) {
        currentType = match[1];
      }
    }
    // rdfs:comment
    else if (trimmed.includes('rdfs:comment')) {
      const match = trimmed.match(/"(.+)"@en/);
      if (match) {
        currentComment = escapeSql(match[1]);
      }
    }
  }

  // Save last artist
  if (currentArtist && currentComment) {
    artists.set(currentArtist, {
      uri: currentArtist,
      name: getNameFromUri(currentArtist),
      type: currentType,
      description: currentComment
    });
  }

  console.log(`Found ${artists.size} artists with descriptions`);
  return artists;
}

// Parse artist categories
function parseCategories(artists) {
  console.log('Parsing artist categories...');
  const content = fs.readFileSync(CATEGORY_FILE, 'utf8');
  const lines = content.split('\n');

  const categories = new Map();
  const artistCategories = [];
  let currentArtist = null;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and prefixes
    if (!trimmed || trimmed.startsWith('PREFIX') || trimmed.startsWith('@prefix')) {
      continue;
    }

    // New artist URI
    if (trimmed.startsWith('<http://dbpedia.org/resource/') && !trimmed.includes('Category:')) {
      currentArtist = trimmed.replace(/>\s*$/, '').replace(/^</, '');
    }
    // dct:subject with categories
    else if (trimmed.includes('dct:subject') && currentArtist) {
      // Extract all category URIs from this line
      const categoryMatches = trimmed.matchAll(/<(http:\/\/dbpedia\.org\/resource\/Category:[^>]+)>/g);
      for (const match of categoryMatches) {
        const categoryUri = match[1];
        const categoryName = getCategoryLabel(categoryUri);

        // Add category if not exists
        if (!categories.has(categoryUri)) {
          categories.set(categoryUri, {
            uri: categoryUri,
            name: categoryName
          });
        }

        // Link artist to category (only if artist has description)
        if (artists.has(currentArtist)) {
          artistCategories.push({
            artist_uri: currentArtist,
            category_uri: categoryUri
          });
        }
      }
    }
  }

  console.log(`Found ${categories.size} unique categories`);
  console.log(`Found ${artistCategories.length} artist-category relationships`);
  return { categories, artistCategories };
}

// Generate SQL schema
function generateSchema() {
  const schema = `-- MusicLynx DBpedia Artist Database Schema

DROP TABLE IF EXISTS artist_categories CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS artists CASCADE;

-- Artists table
CREATE TABLE artists (
  uri TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Categories table
CREATE TABLE categories (
  uri TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Artist-Category junction table
CREATE TABLE artist_categories (
  artist_uri TEXT NOT NULL REFERENCES artists(uri) ON DELETE CASCADE,
  category_uri TEXT NOT NULL REFERENCES categories(uri) ON DELETE CASCADE,
  PRIMARY KEY (artist_uri, category_uri),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_artists_name ON artists(name);
CREATE INDEX idx_artists_type ON artists(type);
CREATE INDEX idx_categories_name ON categories(name);
CREATE INDEX idx_artist_categories_artist ON artist_categories(artist_uri);
CREATE INDEX idx_artist_categories_category ON artist_categories(category_uri);

-- Full-text search on descriptions
CREATE INDEX idx_artists_description_fts ON artists USING GIN(to_tsvector('english', description));
`;

  const schemaFile = path.join(OUTPUT_DIR, '01-schema.sql');
  fs.writeFileSync(schemaFile, schema);
  console.log(`Schema written to ${schemaFile}`);
}

// Generate SQL data inserts
function generateData(artists, categories, artistCategories) {
  console.log('Generating SQL INSERT statements...');

  // Artists
  let artistsSql = '-- Insert artists\n\n';
  for (const artist of artists.values()) {
    artistsSql += `INSERT INTO artists (uri, name, type, description) VALUES ('${escapeSql(artist.uri)}', '${escapeSql(artist.name)}', '${artist.type}', '${artist.description}');\n`;
  }
  const artistsFile = path.join(OUTPUT_DIR, '02-artists.sql');
  fs.writeFileSync(artistsFile, artistsSql);
  console.log(`Artists data written to ${artistsFile}`);

  // Categories
  let categoriesSql = '-- Insert categories\n\n';
  for (const category of categories.values()) {
    categoriesSql += `INSERT INTO categories (uri, name) VALUES ('${escapeSql(category.uri)}', '${escapeSql(category.name)}');\n`;
  }
  const categoriesFile = path.join(OUTPUT_DIR, '03-categories.sql');
  fs.writeFileSync(categoriesFile, categoriesSql);
  console.log(`Categories data written to ${categoriesFile}`);

  // Artist-Categories
  let artistCategoriesSql = '-- Insert artist-category relationships\n\n';
  for (const ac of artistCategories) {
    artistCategoriesSql += `INSERT INTO artist_categories (artist_uri, category_uri) VALUES ('${escapeSql(ac.artist_uri)}', '${escapeSql(ac.category_uri)}');\n`;
  }
  const artistCategoriesFile = path.join(OUTPUT_DIR, '04-artist-categories.sql');
  fs.writeFileSync(artistCategoriesFile, artistCategoriesSql);
  console.log(`Artist-categories data written to ${artistCategoriesFile}`);
}

// Main execution
function main() {
  console.log('Starting TTL to PostgreSQL conversion...\n');

  const artists = parseAbstracts();
  const { categories, artistCategories } = parseCategories(artists);

  generateSchema();
  generateData(artists, categories, artistCategories);

  console.log('\nConversion complete!');
  console.log(`\nTo import into PostgreSQL:`);
  console.log(`  createdb musiclynx`);
  console.log(`  psql musiclynx < sql/01-schema.sql`);
  console.log(`  psql musiclynx < sql/02-artists.sql`);
  console.log(`  psql musiclynx < sql/03-categories.sql`);
  console.log(`  psql musiclynx < sql/04-artist-categories.sql`);
}

main();
