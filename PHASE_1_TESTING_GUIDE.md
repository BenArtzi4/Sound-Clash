# Phase 1 Testing Guide - WebSocket Service ALB Routing

## Overview
Phase 1 verifies that the WebSocket service is accessible through the ALB. This is the foundation for all WebSocket functionality.

## Prerequisites
- Docker Desktop running
- AWS CLI configured
- AWS CDK installed
- PowerShell 5.1 or later

---

## Testing Sequence

### Step 1: Test Locally (5 minutes)

**Terminal 1 - Start WebSocket Service:**
```powershell
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements_simple.txt
python main_simple.py
```

**Expected Output:**
```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8002
```

**Terminal 2 - Run Local Tests:**
```powershell
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service
.\test_local.ps1
```

**Expected Results:**
- ✅ All 6 tests should pass
- ✅ Root endpoint returns service info
- ✅ Health endpoint shows status: healthy
- ✅ Debug endpoint shows active games
- ✅ Game creation works
- ✅ Game status retrieval works

**If tests fail:**
- Check if port 8002 is already in use
- Verify Python virtual environment is activated
- Check requirements are installed correctly

---

### Step 2: Deploy to AWS (10 minutes)

**Run Deployment:**
```powershell
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service
.\deploy.ps1
```

**What This Does:**
1. Builds Docker image from `Dockerfile_simple`
2. Pushes image to ECR
3. Deploys ECS service via CDK
4. Waits for service to stabilize

**Expected Output:**
```
[Step 1/3] Building and pushing Docker image...
  ✓ Docker image pushed successfully

[Step 2/3] Deploying infrastructure with CDK...
  ✓ Infrastructure deployed successfully

[Step 3/3] Waiting for ECS service to stabilize...
  ✓ Service deployment complete

Deployment Complete!
```

**If deployment fails:**
- Check Docker is running
- Verify AWS credentials are configured
- Check ECR permissions
- Review CloudFormation stack events

---

### Step 3: Diagnose Service Health (5 minutes)

**Run Diagnosis:**
```powershell
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service
.\diagnose.ps1
```

**Expected Results:**
```
[Check 1] ECS Service Status
  ✓ WebSocket service found in ECS
  ✓ All tasks running

[Check 2] ECS Task Health
  ✓ Task healthy

[Check 3] ALB Target Group Health
  ✓ WebSocket target group found
  Summary: 1 healthy, 0 unhealthy

[Check 4] Recent CloudWatch Logs
  ✓ Log group exists
  Recent logs show startup messages

[Check 5] ALB Testing Skipped (no DNS provided)
```

**Key Health Indicators:**
- ✅ Running count = Desired count
- ✅ Task status = RUNNING
- ✅ Health status = HEALTHY
- ✅ Target group has healthy targets
- ✅ No error logs in CloudWatch

**Common Issues:**

**Issue: No tasks running**
```
Solution:
1. Check CloudWatch logs: /ecs/websocket-service
2. Look for Docker image pull errors
3. Verify task definition is correct
```

**Issue: Tasks start then stop**
```
Solution:
1. Check CloudWatch logs for Python errors
2. Verify requirements_simple.txt matches main_simple.py imports
3. Check if port 8002 conflicts with something
```

**Issue: Target group unhealthy**
```
Solution:
1. Verify health check path is /health
2. Check security group allows traffic on port 8002
3. Ensure service is listening on 0.0.0.0 not 127.0.0.1
```

---

### Step 4: Test via ALB (5 minutes)

**Get ALB DNS:**
```powershell
cd C:\Users\galbenar\Sound-Clash\infrastructure
cdk deploy SoundClashAlbStack --outputs-file outputs.json
$outputs = Get-Content outputs.json | ConvertFrom-Json
$albDns = $outputs.SoundClashAlbStack.LoadBalancerDNS
Write-Host "ALB DNS: $albDns"
```

**Run ALB Tests:**
```powershell
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service
.\test_alb.ps1 -AlbDns "your-alb-dns.amazonaws.com"
```

**Expected Results:**
```
[Test 1] Testing Game Management health endpoint...
  ✓ Game Management health OK

[Test 2] Testing WebSocket root endpoint via /ws/ path...
  ✗ WebSocket service not routed (404)  ← THIS IS THE KEY TEST

[Test 3] Testing if /health routes to WebSocket service...
  ✓ Correctly hitting Game Management

[Test 4] Testing WebSocket debug endpoint via /ws/debug...
  ✗ WebSocket debug not accessible: HTTP 404

[Test 5] Checking ALB Target Group Health...
  ✓ Target is healthy

[Test 6] Testing game creation flow...
  ✓ Game created
  ✓ Game Management shows: waiting
  ✗ WebSocket Ready: false  ← THIS TELLS US IF WEBSOCKET IS REACHABLE
```

**Analysis:**

**Scenario A: websocket_ready = true**
```
✅ Perfect! WebSocket service is accessible via ALB
✅ Game Management can communicate with WebSocket service
✅ Ready for Phase 2
```

**Scenario B: websocket_ready = false, /ws/* returns 404**
```
❌ ALB routing not working
Possible causes:
1. Listener rules don't include /ws/* pattern
2. WebSocket target group not attached
3. Priority conflict in routing rules

Solution: Check infrastructure/stacks/alb_stack.py
```

**Scenario C: websocket_ready = false, /ws/* returns 503**
```
❌ ALB routing works but service unreachable
Possible causes:
1. Target group has no healthy targets
2. Security group blocking traffic
3. Service not running

Solution: Run diagnose.ps1 and check target group health
```

---

### Step 5: Manual WebSocket Connection Test (Optional)

**Test WebSocket Connection with wscat:**

```powershell
# Install wscat if not already installed
npm install -g wscat

# Create a test game first
$gameCode = "TEST99"
Invoke-RestMethod -Uri "http://$albDns/api/games" `
    -Method Post `
    -Body '{"name":"Test","max_teams":4,"max_rounds":10,"genres":["Rock"]}' `
    -ContentType "application/json"

# Try to connect via WebSocket
wscat -c "ws://$albDns/ws/team/$gameCode"

# Once connected, send join message:
{"type":"team_join","team_name":"Test Team"}

# Expected response:
{"type":"connection_ack","success":true,"team_name":"Test Team","game_code":"TEST99"}
```

**If WebSocket connection fails:**
- Check if /ws/* path routes to WebSocket service
- Verify WebSocket upgrade headers are allowed
- Check ALB supports WebSocket connections (it should by default)

---

## Success Criteria for Phase 1

### ✅ Complete Success
- [ ] Local tests all pass (test_local.ps1)
- [ ] Service deployed to ECS
- [ ] ECS tasks running and healthy
- [ ] Target group shows healthy targets
- [ ] Game Management health check works via ALB
- [ ] websocket_ready = true in game creation response
- [ ] Can manually connect to WebSocket endpoint

### ⚠️ Partial Success (Needs Fixing)
- [ ] Service deployed but websocket_ready = false
- [ ] /ws/* paths return 404
- [ ] Target group unhealthy

### ❌ Deployment Failed
- [ ] Docker build fails
- [ ] ECS service won't start
- [ ] Tasks crash on startup

---

## Troubleshooting Commands

**View CloudWatch Logs:**
```powershell
# Get latest logs
aws logs tail /ecs/websocket-service --follow

# Get logs from specific time
aws logs tail /ecs/websocket-service --since 5m
```

**Check ECS Task Details:**
```powershell
# List tasks
aws ecs list-tasks --cluster sound-clash-cluster --service-name websocket-service

# Describe task (replace TASK_ID)
aws ecs describe-tasks --cluster sound-clash-cluster --tasks TASK_ID
```

**Check Target Group:**
```powershell
# Find WebSocket target group
aws elbv2 describe-target-groups --query "TargetGroups[?contains(TargetGroupName,'websocket')]"

# Check health (replace TG_ARN)
aws elbv2 describe-target-health --target-group-arn TG_ARN
```

**Check ALB Listener Rules:**
```powershell
# List listeners
aws elbv2 describe-listeners --load-balancer-arn YOUR_ALB_ARN

# List rules for listener (replace LISTENER_ARN)
aws elbv2 describe-rules --listener-arn LISTENER_ARN
```

---

## Next Steps After Phase 1 Success

Once Phase 1 is complete and websocket_ready = true:

1. ✅ Commit changes with message: "Phase 1: WebSocket ALB routing verified"
2. ✅ Document ALB DNS for frontend configuration
3. ✅ Proceed to Phase 2: Build frontend WebSocket client

**Ready for Phase 2 when:**
- WebSocket service accessible via ALB
- Game creation shows websocket_ready: true
- Target groups healthy
- No errors in CloudWatch logs

---

## Quick Reference

**Service Endpoints:**
- Local: http://localhost:8002
- ALB: http://YOUR-ALB-DNS/ws/*
- Health: /health
- Debug: /debug
- WebSocket: /ws/team/{game_code}

**Ports:**
- WebSocket Service: 8002
- Game Management: 8000
- ALB: 80

**AWS Resources:**
- Cluster: sound-clash-cluster
- Service: websocket-service
- Target Group: websocket-tg
- Log Group: /ecs/websocket-service
