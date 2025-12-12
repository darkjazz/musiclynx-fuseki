#!/bin/bash
# Simply start Fuseki - data is already in the configuration

echo "Starting Fuseki server..."
echo "Note: TTL data will be loaded on-demand when Fuseki starts"

# Just run Fuseki normally
exec /docker-entrypoint.sh
