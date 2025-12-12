#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${RED}WARNING: This will destroy all MusicLynx Fuseki infrastructure!${NC}"
echo ""
read -p "Are you sure you want to continue? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 0
fi

export AWS_REGION=${AWS_REGION:-eu-north-1}

echo -e "${YELLOW}Destroying infrastructure...${NC}"
cd cdk
npx cdk destroy --force
cd ..

echo ""
echo "Infrastructure destroyed."
echo ""
echo "Note: ECR images may need to be manually deleted if you changed the removal policy."
