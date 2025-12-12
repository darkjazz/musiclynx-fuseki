#!/bin/bash
set -e

export AWS_REGION=${AWS_REGION:-eu-north-1}

ASG_NAME=$(aws cloudformation describe-stack-resources \
    --stack-name MusicLynxFusekiStack \
    --query 'StackResources[?ResourceType==`AWS::AutoScaling::AutoScalingGroup`].PhysicalResourceId' \
    --output text \
    --region $AWS_REGION)

PUBLIC_IP=$(aws ec2 describe-instances \
    --filters "Name=tag:aws:autoscaling:groupName,Values=$ASG_NAME" "Name=instance-state-name,Values=running" \
    --query "Reservations[0].Instances[0].PublicIpAddress" \
    --output text \
    --region $AWS_REGION)

if [ "$PUBLIC_IP" != "None" ] && [ -n "$PUBLIC_IP" ]; then
    echo "Fuseki Endpoint: http://$PUBLIC_IP:3030"
    echo ""
    echo "SPARQL Query Endpoint: http://$PUBLIC_IP:3030/musiclynx/query"
    echo ""
    echo "Test with:"
    echo "  curl http://$PUBLIC_IP:3030/\$/ping"
else
    echo "Instance not found or not running yet. Please wait a few minutes and try again."
    exit 1
fi
