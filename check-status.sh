#!/bin/bash
set -e

export AWS_REGION=${AWS_REGION:-eu-north-1}

echo "Checking MusicLynx Fuseki deployment status..."
echo ""

# Check ECS service status
echo "=== ECS Service Status ==="
aws ecs describe-services \
    --cluster musiclynx-cluster \
    --services musiclynx-fuseki-service \
    --region $AWS_REGION \
    --query 'services[0].{DesiredCount:desiredCount,RunningCount:runningCount,Status:status,Events:events[0:3]}' \
    --output json

echo ""
echo "=== ECS Tasks ==="
TASK_ARN=$(aws ecs list-tasks \
    --cluster musiclynx-cluster \
    --service-name musiclynx-fuseki-service \
    --region $AWS_REGION \
    --query 'taskArns[0]' \
    --output text)

if [ "$TASK_ARN" != "None" ] && [ -n "$TASK_ARN" ]; then
    echo "Task ARN: $TASK_ARN"
    echo ""

    aws ecs describe-tasks \
        --cluster musiclynx-cluster \
        --tasks $TASK_ARN \
        --region $AWS_REGION \
        --query 'tasks[0].{LastStatus:lastStatus,HealthStatus:healthStatus,StoppedReason:stoppedReason,Containers:containers[0].{Name:name,Status:lastStatus,ExitCode:exitCode,Reason:reason}}' \
        --output json

    echo ""
    echo "=== Recent Container Logs ==="
    aws logs tail /ecs/musiclynx-fuseki \
        --since 10m \
        --region $AWS_REGION \
        --format short 2>/dev/null || echo "No logs available yet"
else
    echo "No tasks found. Service may still be starting..."
fi

echo ""
echo "=== EC2 Instance Status ==="
ASG_NAME=$(aws cloudformation describe-stack-resources \
    --stack-name MusicLynxFusekiStack \
    --query 'StackResources[?ResourceType==`AWS::AutoScaling::AutoScalingGroup`].PhysicalResourceId' \
    --output text \
    --region $AWS_REGION)

INSTANCE_ID=$(aws ec2 describe-instances \
    --filters "Name=tag:aws:autoscaling:groupName,Values=$ASG_NAME" "Name=instance-state-name,Values=running" \
    --query "Reservations[0].Instances[0].InstanceId" \
    --output text \
    --region $AWS_REGION)

PUBLIC_IP=$(aws ec2 describe-instances \
    --filters "Name=tag:aws:autoscaling:groupName,Values=$ASG_NAME" "Name=instance-state-name,Values=running" \
    --query "Reservations[0].Instances[0].PublicIpAddress" \
    --output text \
    --region $AWS_REGION)

echo "Instance ID: $INSTANCE_ID"
echo "Public IP: $PUBLIC_IP"
echo ""

echo "Run this to see live logs:"
echo "  aws logs tail /ecs/musiclynx-fuseki --follow --region $AWS_REGION"
