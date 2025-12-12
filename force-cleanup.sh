#!/bin/bash
set -e

export AWS_REGION=${AWS_REGION:-eu-north-1}

echo "Force cleaning up MusicLynx Fuseki infrastructure..."
echo ""

# Step 1: Delete ECS Service (this releases the capacity provider)
echo "Step 1: Deleting ECS service..."
aws ecs update-service \
    --cluster musiclynx-cluster \
    --service musiclynx-fuseki-service \
    --desired-count 0 \
    --region $AWS_REGION \
    --no-cli-pager 2>/dev/null || true

sleep 5

aws ecs delete-service \
    --cluster musiclynx-cluster \
    --service musiclynx-fuseki-service \
    --force \
    --region $AWS_REGION \
    --no-cli-pager 2>/dev/null || true

echo "✓ Service deleted"
echo ""

# Step 2: Wait for service to be deleted
echo "Step 2: Waiting for service to be deleted (30 seconds)..."
sleep 30
echo "✓ Done waiting"
echo ""

# Step 3: Remove capacity provider from cluster
echo "Step 3: Removing capacity provider from cluster..."
CAPACITY_PROVIDER=$(aws ecs describe-clusters \
    --clusters musiclynx-cluster \
    --region $AWS_REGION \
    --query 'clusters[0].capacityProviders[0]' \
    --output text 2>/dev/null || echo "")

if [ -n "$CAPACITY_PROVIDER" ] && [ "$CAPACITY_PROVIDER" != "None" ]; then
    aws ecs put-cluster-capacity-providers \
        --cluster musiclynx-cluster \
        --capacity-providers [] \
        --default-capacity-provider-strategy [] \
        --region $AWS_REGION \
        --no-cli-pager 2>/dev/null || true
    echo "✓ Capacity provider removed"
else
    echo "✓ No capacity provider to remove"
fi
echo ""

# Step 4: Now delete the CloudFormation stack
echo "Step 4: Deleting CloudFormation stack..."
cd cdk
npx cdk destroy --force
cd ..

echo ""
echo "✓ Cleanup complete!"
echo ""
echo "You can now run: ./deploy.sh"
