#!/bin/bash
# Apply supplement.py to the AWS RDS instance.
# Fetches credentials from Secrets Manager — no schema changes, no data drops.

set -e
cd "$(dirname "$0")"

echo "Fetching RDS credentials from Secrets Manager..."
DB_SECRET=$(aws secretsmanager get-secret-value --secret-id musiclynx-db-credentials --query SecretString --output text)
DB_PASSWORD=$(echo "$DB_SECRET" | jq -r .password)
DB_USERNAME=$(echo "$DB_SECRET" | jq -r .username)

echo "Fetching RDS endpoint from CloudFormation..."
DB_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name MusicLynxRdsStack \
  --query "Stacks[0].Outputs[?OutputKey=='DatabaseEndpoint'].OutputValue" \
  --output text)

export DATABASE_URL="postgresql://$DB_USERNAME:$DB_PASSWORD@$DB_ENDPOINT:5432/musiclynx"

echo "Connecting to $DB_ENDPOINT..."
/home/alo/miniconda3/envs/musiclynx-similarity/bin/python supplement.py
