# Data Directory

Source TTL files extracted from DBpedia dumps. These are gitignored due to size (~108MB total).

## Files

- `artist_abstract_graph.ttl` (~46MB) - Artist abstracts from DBpedia
- `artist_category_graph.ttl` (~62MB) - Artist categories from DBpedia

## How to Obtain

The data files are extracted from DBpedia dumps:

1. Download from https://downloads.dbpedia.org/
2. Extract music artist abstracts and categories
3. Convert to Turtle format
4. Place in this directory

Or contact the MusicLynx project maintainers for existing extracts.

## TTL Format

### artist_abstract_graph.ttl
- Subject: DBpedia artist URIs
- Predicate: `rdfs:comment`
- Object: Artist description text

### artist_category_graph.ttl
- Subject: DBpedia artist URIs
- Predicate: `dcterms:subject`
- Object: Category URIs

## Converting to SQL

```bash
node parse-ttl-to-sql.js
```

This reads the TTL files and generates SQL insert files in the `sql/` directory.
