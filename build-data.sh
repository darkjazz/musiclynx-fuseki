#!/bin/bash
# Script to pre-load data into TDB database before building Docker image
set -e

echo "Building TDB database with TTL data..."

DATASET_NAME="musiclynx"
DB_DIR="./fuseki/databases/$DATASET_NAME"

# Clean existing database
rm -rf "$DB_DIR"
mkdir -p "$DB_DIR"

echo "Loading data using Apache Jena TDB tools..."
echo "This will take a few minutes for 108MB of data..."

# Use Docker with the correct command path
docker run --rm \
    -v "$(pwd)/data:/data:ro" \
    -v "$(pwd)/fuseki/databases:/databases" \
    -w /jena-fuseki \
    stain/jena-fuseki \
    /bin/bash -c "java -cp 'fuseki-server.jar:*' tdb2.tdbloader --loc /databases/$DATASET_NAME /data/artist_abstract_graph.ttl /data/artist_category_graph.ttl"

echo ""
echo "✓ Database built successfully!"
echo "  Location: $DB_DIR"
echo "  Size: $(du -sh $DB_DIR | cut -f1)"
echo ""
echo "Now build the Docker image:"
echo "  docker build -t musiclynx-fuseki ."
