#!/usr/bin/env python3
"""
Add missing artists, categories, and artist-category links to the local
musiclynx PostgreSQL database.

Missing = URIs in artist_links that have no row in artists.
Reads directly from the DBpedia TTL dumps and writes to PostgreSQL via COPY.
Safe to run on a live db — uses ON CONFLICT DO NOTHING throughout.
"""

import io
import os
import sys
from pathlib import Path
from urllib.parse import unquote

import psycopg2

DATA_DIR      = Path(__file__).parent / 'data' / 'dbpedia'
ABSTRACT_FILE = DATA_DIR / 'short-abstracts_lang=en.ttl'
CATEGORY_FILE = DATA_DIR / 'categories_lang=en_articles.ttl'

COMMENT_PRED = '<http://www.w3.org/2000/01/rdf-schema#comment>'
SUBJECT_PRED = '<http://purl.org/dc/terms/subject>'


def connect():
    db_url = os.environ.get('DATABASE_URL')
    if db_url:
        return psycopg2.connect(db_url, sslmode='require')
    return psycopg2.connect(host='/var/run/postgresql', dbname='musiclynx', user='alo')


def get_missing_uris(conn):
    print('Querying missing artist URIs...')
    with conn.cursor() as cur:
        cur.execute("""
            SELECT al.dbpedia_uri
            FROM artist_links al
            LEFT JOIN artists a ON a.uri = al.dbpedia_uri
            WHERE a.uri IS NULL
        """)
        uris = {row[0] for row in cur.fetchall()}
    print(f'  {len(uris):,} missing artists\n')
    return uris


def name_from_uri(uri):
    raw = uri.rsplit('/', 1)[-1]
    try:
        return unquote(raw).replace('_', ' ')
    except Exception:
        return raw.replace('_', ' ')


def label_from_category_uri(uri):
    raw = uri.rsplit('/', 1)[-1]
    raw = raw[len('Category:'):] if raw.startswith('Category:') else raw
    try:
        return unquote(raw).replace('_', ' ')
    except Exception:
        return raw.replace('_', ' ')


def esc(s):
    """Escape a value for PostgreSQL COPY text format."""
    return s.replace('\\', '\\\\').replace('\t', '\\t').replace('\n', '\\n').replace('\r', '')


# ─── Abstracts ────────────────────────────────────────────────────────────────

def parse_abstracts(missing):
    print(f'Streaming {ABSTRACT_FILE.name}...')
    artists = {}
    with open(ABSTRACT_FILE, encoding='utf-8', errors='replace') as f:
        for line in f:
            if COMMENT_PRED not in line:
                continue
            if not line.startswith('<http://dbpedia.org/resource/'):
                continue
            uri_end = line.index('>')
            uri = line[1:uri_end]
            if uri not in missing:
                continue
            first_q = line.index('"', uri_end)
            lang_idx = line.rfind('"@en')
            if lang_idx <= first_q:
                continue
            description = line[first_q + 1:lang_idx]
            artists[uri] = (uri, name_from_uri(uri), 'MusicalArtist', description)
            if len(artists) % 10000 == 0:
                print(f'  {len(artists):,} abstracts...', end='\r', flush=True)
    print(f'\n  Found {len(artists):,} artists with abstracts')
    return artists


def insert_artists(conn, artists):
    print('Inserting artists...')
    buf = io.StringIO()
    for uri, name, type_, desc in artists.values():
        buf.write(f'{esc(uri)}\t{esc(name)}\t{esc(type_)}\t{esc(desc)}\n')
    buf.seek(0)
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TEMP TABLE _new_artists
              (uri TEXT, name TEXT, type TEXT, description TEXT)
            ON COMMIT DROP
        """)
        cur.copy_from(buf, '_new_artists', columns=('uri', 'name', 'type', 'description'))
        cur.execute("""
            INSERT INTO artists (uri, name, type, description)
              SELECT uri, name, type, description FROM _new_artists
              ON CONFLICT (uri) DO NOTHING
        """)
        print(f'  Inserted {cur.rowcount:,} rows')
    conn.commit()


# ─── Categories ───────────────────────────────────────────────────────────────

def parse_and_insert_categories(conn, artist_uris):
    print(f'\nStreaming {CATEGORY_FILE.name}...')
    categories = {}
    ac_pairs   = []
    with open(CATEGORY_FILE, encoding='utf-8', errors='replace') as f:
        for line in f:
            if 'Category:' not in line:
                continue
            if SUBJECT_PRED not in line:
                continue
            if not line.startswith('<http://dbpedia.org/resource/'):
                continue
            uri_end = line.index('>')
            artist_uri = line[1:uri_end]
            if artist_uri not in artist_uris:
                continue
            cat_start = line.find('<http://dbpedia.org/resource/Category:')
            if cat_start < 0:
                continue
            cat_end = line.index('>', cat_start + 1)
            cat_uri = line[cat_start + 1:cat_end]
            if cat_uri not in categories:
                categories[cat_uri] = label_from_category_uri(cat_uri)
            ac_pairs.append((artist_uri, cat_uri))
            if len(ac_pairs) % 100000 == 0:
                print(f'  {len(ac_pairs):,} pairs...', end='\r', flush=True)
    print(f'\n  Found {len(categories):,} new categories')
    print(f'  Found {len(ac_pairs):,} artist-category pairs')

    print('Inserting categories...')
    buf = io.StringIO()
    for uri, name in categories.items():
        buf.write(f'{esc(uri)}\t{esc(name)}\n')
    buf.seek(0)
    with conn.cursor() as cur:
        cur.execute("CREATE TEMP TABLE _new_cats (uri TEXT, name TEXT) ON COMMIT DROP")
        cur.copy_from(buf, '_new_cats', columns=('uri', 'name'))
        cur.execute("""
            INSERT INTO categories (uri, name)
              SELECT uri, name FROM _new_cats
              ON CONFLICT (uri) DO NOTHING
        """)
        print(f'  Inserted {cur.rowcount:,} rows')
    conn.commit()

    print('Inserting artist-category links...')
    buf = io.StringIO()
    for artist_uri, cat_uri in ac_pairs:
        buf.write(f'{esc(artist_uri)}\t{esc(cat_uri)}\n')
    buf.seek(0)
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TEMP TABLE _new_ac (artist_uri TEXT, category_uri TEXT)
            ON COMMIT DROP
        """)
        cur.copy_from(buf, '_new_ac', columns=('artist_uri', 'category_uri'))
        cur.execute("""
            INSERT INTO artist_categories (artist_uri, category_uri)
              SELECT artist_uri, category_uri FROM _new_ac
              ON CONFLICT (artist_uri, category_uri) DO NOTHING
        """)
        print(f'  Inserted {cur.rowcount:,} rows')
    conn.commit()


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    for f in [ABSTRACT_FILE, CATEGORY_FILE]:
        if not f.exists():
            print(f'Missing file: {f}')
            sys.exit(1)

    conn = connect()
    try:
        missing = get_missing_uris(conn)
        artists = parse_abstracts(missing)
        insert_artists(conn, artists)
        parse_and_insert_categories(conn, set(artists.keys()))
        print('\nDone.')
    finally:
        conn.close()


if __name__ == '__main__':
    main()
