# MusicLynx Artist Database

A PostgreSQL database on AWS RDS containing DBpedia music artist abstracts and categories for the [MusicLynx](https://musiclynx.github.io) discovery platform.

## Overview

This project replaces direct DBpedia SPARQL endpoint queries with a self-hosted PostgreSQL database. Artist data is extracted from DBpedia TTL dumps, converted to SQL, and loaded into an RDS instance deployed via AWS CDK.

The database contains:

- **Artists**: ~90k music artists with names, types, and description abstracts
- **Categories**: DBpedia category classifications
- **Artist-Category relationships**: Junction table linking artists to categories

## Project Structure

```
.
├── cdk/                           # AWS CDK infrastructure
│   ├── bin/musiclynx-fuseki.ts    # CDK entry point (deploys RDS stack)
│   ├── lib/musiclynx-rds-stack.ts # RDS PostgreSQL stack definition
│   └── ...                        # CDK config and dependencies
├── data/                          # Source TTL files (gitignored)
│   └── README.md                  # Data provenance docs
├── sql/
│   └── 01-schema.sql              # Database schema (tracked)
│   └── *.sql                      # Data insert files (gitignored)
├── parse-ttl-to-sql.js            # TTL to SQL converter
├── import-to-rds.sh               # RDS data import script
├── destroy.sh                     # Emergency AWS cleanup
└── README.md
```

## Database Schema

Three tables defined in `sql/01-schema.sql`:

- **artists** (`uri`, `name`, `type`, `description`) - Primary key on URI
- **categories** (`uri`, `name`) - Primary key on URI
- **artist_categories** (`artist_uri`, `category_uri`) - Junction table with foreign keys

Includes indexes on name, type, and a GIN index for full-text search on descriptions.

## Regenerating SQL from TTL

If you need to regenerate the SQL data files from source TTL:

1. Place TTL files in `data/`:
   - `artist_abstract_graph.ttl` (artist abstracts)
   - `artist_category_graph.ttl` (artist categories)

2. Run the converter:
   ```bash
   node parse-ttl-to-sql.js
   ```

   This produces `sql/02-artists.sql`, `sql/03-categories.sql`, `sql/04-artist-categories.sql`, etc.

## Deploying Infrastructure

```bash
cd cdk
npm install
npx cdk bootstrap   # first time only
npx cdk deploy
```

This creates an RDS PostgreSQL instance (db.t3.micro, free tier eligible) in eu-north-1.

## Importing Data to RDS

After deployment, import the schema and data:

```bash
./import-to-rds.sh
```

This fetches credentials from AWS Secrets Manager and runs all SQL files against the RDS instance.

## Destroying Infrastructure

```bash
./destroy.sh
```

## Integration

The MusicLynx server connects to this database via a `DATABASE_URL` environment variable. See [musiclynx-server](https://github.com/darkjazz/musiclynx-server) for details.

## Related Repositories

- [musiclynx](https://github.com/darkjazz/musiclynx) - Frontend (Angular)
- [musiclynx-server](https://github.com/darkjazz/musiclynx-server) - Server (Express.js)

## Live

- **UI**: https://musiclynx.github.io/#/dashboard
- **Server**: https://musiclynx-server.fly.dev

## License

Data sourced from DBpedia, licensed under Creative Commons Attribution-ShareAlike 3.0 and GNU Free Documentation License.
