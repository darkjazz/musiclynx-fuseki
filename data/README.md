# Data Directory

Place your TTL data files here:

- `artist_abstract_graph.ttl` (46MB) - Artist abstracts from DBpedia
- `artist_category_graph.ttl` (62MB) - Artist categories from DBpedia

## How to Obtain Data

The data files are extracted from DBpedia dumps. You can:

1. **Extract from DBpedia dumps yourself**:
   - Download from https://downloads.dbpedia.org/
   - Extract music artist abstracts and categories
   - Convert to Turtle format

2. **Use existing extracts** (if available):
   - Contact the MusicLynx project maintainers
   - Check for a separate data repository

## Expected Format

The files should be in Turtle (TTL) format containing:

### artist_abstract_graph.ttl
- Subject: DBpedia artist URIs
- Predicate: rdfs:comment
- Object: Artist descriptions/abstracts

### artist_category_graph.ttl
- Subject: DBpedia artist URIs
- Predicate: dcterms:subject
- Object: Category URIs

## After Adding Data

Once you have the TTL files in this directory:

```bash
# Build the TDB2 database
./build-data.sh

# Deploy to AWS
./deploy.sh
```
