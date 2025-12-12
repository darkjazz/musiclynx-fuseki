#!/bin/bash
# Entrypoint script for Fuseki container
# Loads TTL data from S3 on first run if database doesn't exist

set -e

DATASET_NAME="musiclynx"
DB_DIR="/fuseki/databases/$DATASET_NAME"
DATA_LOADED_MARKER="$DB_DIR/.data_loaded"

echo "Starting MusicLynx Fuseki Triple Store..."

# Check if database already has data
if [ -f "$DATA_LOADED_MARKER" ]; then
  echo "Database already loaded, skipping data import"
else
  echo "First run detected - loading data from S3..."

  # Create temporary directory for TTL files
  mkdir -p /tmp/data

  # Download TTL files from S3
  echo "Downloading TTL files from S3..."
  aws s3 cp s3://musiclynx-fuseki-data-eu-north-1/artist_abstract_graph.ttl /tmp/data/
  aws s3 cp s3://musiclynx-fuseki-data-eu-north-1/artist_category_graph.ttl /tmp/data/

  # Create database directory
  mkdir -p "$DB_DIR"

  # Load data using tdb2loader
  echo "Loading 108MB of RDF triples into TDB2 database..."
  cd /jena-fuseki
  java -cp 'fuseki-server.jar:*' tdb2.tdbloader \
    --loc "$DB_DIR" \
    /tmp/data/artist_abstract_graph.ttl \
    /tmp/data/artist_category_graph.ttl

  # Clean up TTL files
  rm -rf /tmp/data

  # Mark as loaded
  touch "$DATA_LOADED_MARKER"

  echo "✓ Data loaded successfully!"
fi

# Start Fuseki server
echo "Starting Fuseki server..."
exec /jena-fuseki/fuseki-server
