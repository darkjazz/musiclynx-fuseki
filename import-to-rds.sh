#!/bin/bash
# Import MusicLynx data to RDS PostgreSQL

set -e

# Change to script directory
cd "$(dirname "$0")"

echo "MusicLynx RDS Data Import"
echo "========================="
echo ""

# Get database credentials from AWS Secrets Manager
echo "Fetching database credentials from Secrets Manager..."
DB_SECRET=$(aws secretsmanager get-secret-value --secret-id musiclynx-db-credentials --query SecretString --output text)
DB_PASSWORD=$(echo "$DB_SECRET" | jq -r .password)
DB_USERNAME=$(echo "$DB_SECRET" | jq -r .username)

# Get database endpoint from CloudFormation outputs
echo "Fetching database endpoint..."
DB_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name MusicLynxRdsStack \
  --query "Stacks[0].Outputs[?OutputKey=='DatabaseEndpoint'].OutputValue" \
  --output text)

DB_NAME="musiclynx"

echo ""
echo "Database Details:"
echo "  Endpoint: $DB_ENDPOINT"
echo "  Database: $DB_NAME"
echo "  Username: $DB_USERNAME"
echo ""

# Set PGPASSWORD for psql
export PGPASSWORD="$DB_PASSWORD"

echo "Importing schema..."
psql -h "$DB_ENDPOINT" -U "$DB_USERNAME" -d "$DB_NAME" -f sql/01-schema.sql

echo "Importing artists (this may take a few minutes)..."
psql -h "$DB_ENDPOINT" -U "$DB_USERNAME" -d "$DB_NAME" -f sql/02-artists.sql

echo "Importing categories..."
psql -h "$DB_ENDPOINT" -U "$DB_USERNAME" -d "$DB_NAME" -f sql/03-categories.sql

echo "Importing artist-category relationships..."
psql -h "$DB_ENDPOINT" -U "$DB_USERNAME" -d "$DB_NAME" -f sql/04-artist-categories.sql

echo ""
echo "✓ Import complete!"
echo ""
echo "Connection string for musiclynx-server:"
echo "postgresql://$DB_USERNAME:$DB_PASSWORD@$DB_ENDPOINT:5432/$DB_NAME"
echo ""
echo "Save this to your environment variables:"
echo "export DATABASE_URL=\"postgresql://$DB_USERNAME:$DB_PASSWORD@$DB_ENDPOINT:5432/$DB_NAME\""
