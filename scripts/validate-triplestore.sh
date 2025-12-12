#!/bin/bash
# Script to validate the TDB2 database has been built correctly
# This is called by CodeBuild after building the database

set -e

echo "Validating TDB2 database..."

DATASET_NAME="musiclynx"
DB_DIR="./fuseki/databases/$DATASET_NAME"

# Check database directory exists
if [ ! -d "$DB_DIR" ]; then
  echo "❌ Error: Database directory not found: $DB_DIR"
  exit 1
fi

# Check database has data files
if [ ! -d "$DB_DIR/Data-0001" ]; then
  echo "❌ Error: Database data files not found in $DB_DIR"
  exit 1
fi

# Get statistics from the database
echo "Running tdb2.tdbstats to verify data..."
STATS_OUTPUT=$(docker run --rm \
  -v "$(pwd)/fuseki/databases:/databases:ro" \
  stain/jena-fuseki \
  /bin/bash -c "cd /jena-fuseki && java -cp 'fuseki-server.jar:*' tdb2.tdbstats --loc /databases/$DATASET_NAME 2>/dev/null" || echo "")

if [ -z "$STATS_OUTPUT" ]; then
  echo "❌ Error: Failed to read database statistics"
  exit 1
fi

# Extract triple count
TRIPLE_COUNT=$(echo "$STATS_OUTPUT" | grep -oP '\(count \K[0-9]+' | head -1)

if [ -z "$TRIPLE_COUNT" ]; then
  echo "❌ Error: Could not determine triple count"
  exit 1
fi

# Validate we have the expected number of triples (approximately 1 million)
if [ "$TRIPLE_COUNT" -lt 900000 ]; then
  echo "❌ Error: Triple count too low: $TRIPLE_COUNT (expected ~1,010,000)"
  exit 1
fi

echo "✓ Database validation successful!"
echo "  Triples loaded: $TRIPLE_COUNT"
echo "  Database size: $(du -sh $DB_DIR 2>/dev/null | cut -f1 || echo 'N/A')"
echo ""
