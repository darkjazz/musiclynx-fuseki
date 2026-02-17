-- MusicLynx DBpedia Artist Database Schema

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
