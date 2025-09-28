# Sound Clash ALB Routing Rules Documentation

## Current ALB Configuration

**Load Balancer**: `sound-clash-alb`
**DNS**: `sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com`

## Listener Rules (Port 80)

### CDK-Managed Rules (Safe to destroy/rebuild)

| Priority | Path Pattern | Target Group | Service | Port | Status |
|----------|-------------|-------------|---------|------|--------|
| 60 | `/health` | game-management-tg | Game Management | 8000 | ✅ CDK Managed |
| 100 | `/api/games/*`, `/api/games` | game-management-tg | Game Management | 8000 | ✅ CDK Managed |
| 150 | `/api/songs/*` | song-service-new-tg | Song Service | 8005 | ✅ CDK Managed |
| 200 | `/api/gameplay/*` | game-api-tg | Game API | 8001 | ✅ CDK Managed |
| 300 | `/ws/*`, `/socket.io/*` | websocket-tg | WebSocket | 8002 | ✅ CDK Managed |
| 400 | `/api/manager/*` | manager-console-tg | Manager Console | 8003 | ✅ CDK Managed |
| 500 | `/api/display/*` | public-display-tg | Public Display | 8004 | ✅ CDK Managed |
| default | `*` | N/A | Fixed Response: `{"error": "Service not found"}` | N/A | ✅ CDK Managed |

### Manually Created Rules (Conflicts)

| Priority | Path Pattern | Target Group | Status |
|----------|-------------|-------------|--------|
| 50 | `/health` | game-management-tg | ❌ Manual (conflicts with CDK) |
| 150 | `/api/songs/*` | song-service-tg | ❌ Manual (conflicts with CDK) |

## Target Groups

### CDK-Managed Target Groups

| Name | Port | Health Check Path | Status |
|------|------|------------------|--------|
| game-management-tg | 8000 | `/health` | ✅ CDK Managed |
| game-api-tg | 8001 | `/health` | ✅ CDK Managed |
| websocket-tg | 8002 | `/health` | ✅ CDK Managed |
| manager-console-tg | 8003 | `/health` | ✅ CDK Managed |
| public-display-tg | 8004 | `/health` | ✅ CDK Managed |
| song-service-new-tg | 8005 | `/health` | ✅ CDK Managed |

### Manually Created Target Groups (To be replaced)

| Name | Port | Health Check Path | Status |
|------|------|------------------|--------|
| song-service-tg | 8005 | `/health` | ❌ Manual (will be replaced) |

## Clean Rebuild Process

When destroying and rebuilding the CDK stack:

1. **All CDK-managed resources** will be properly destroyed and recreated
2. **Manual resources** need to be cleaned up separately
3. **New resources** use different names to avoid conflicts

## Deployment Commands

```bash
# Deploy ALB stack with conflict-free names
cdk deploy SoundClashAlbStack --require-approval never

# Test endpoints
curl http://sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com/health
curl http://sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com/api/games/health
```

## Manual Cleanup (If needed)

```bash
# Remove conflicting manual rules (if they exist)
aws elbv2 delete-rule --rule-arn <MANUAL_RULE_ARN>

# Remove conflicting manual target groups (if they exist)
aws elbv2 delete-target-group --target-group-arn <MANUAL_TG_ARN>
```

---

**Last Updated**: $(date)
**CDK Stack**: SoundClashAlbStack
**Version**: Phase 1 - ALB Routing Fix
