#!/bin/bash
# Script to pre-load data into TDB2 database before building Docker image
# This is called by CodeBuild during the build phase

set -e

echo "Building TDB2 database from TTL files..."

DATASET_NAME="musiclynx"
DB_DIR="./fuseki/databases/$DATASET_NAME"

# Clean existing database
rm -rf "$DB_DIR"
mkdir -p "$DB_DIR"

echo "Loading data using Apache Jena TDB2 tools..."
echo "Processing 108MB of RDF triples (artist abstracts + categories)..."

# Use Docker to run tdb2loader as user 100:100 (same as Fuseki runtime user)
# This ensures files are created with correct ownership
docker run --rm \
  --user 100:100 \
  -v "$(pwd)/data:/data:ro" \
  -v "$(pwd)/fuseki/databases:/databases" \
  -w /jena-fuseki \
  stain/jena-fuseki \
  /bin/bash -c "java -cp 'fuseki-server.jar:*' tdb2.tdbloader --loc /databases/$DATASET_NAME /data/artist_abstract_graph.ttl /data/artist_category_graph.ttl"

# Ensure world-readable permissions for good measure
echo "Setting database file permissions..."
chmod -R 755 "$DB_DIR"

echo ""
echo "✓ Database built successfully!"
echo "  Location: $DB_DIR"
echo "  Size: $(du -sh $DB_DIR 2>/dev/null | cut -f1 || echo 'N/A')"
echo ""
