# Phase 1 - Quick Start Commands

## Summary
Phase 1 verifies WebSocket service is accessible through ALB. Follow these steps in order.

---

## Step-by-Step Commands

### 1️⃣ Test Locally (Terminal 1)

```powershell
# Navigate to websocket service
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service

# Create and activate virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1

# Install dependencies
pip install -r requirements_simple.txt

# Start the service
python main_simple.py
```

**Wait for:** `Uvicorn running on http://0.0.0.0:8002`

---

### 2️⃣ Run Local Tests (Terminal 2)

```powershell
# Navigate to websocket service
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service

# Run test script
.\test_local.ps1
```

**Expected:** All 6 tests pass with green checkmarks ✓

---

### 3️⃣ Deploy to AWS

```powershell
# Make sure Terminal 1 is stopped (Ctrl+C)
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service

# Run deployment
.\deploy.ps1
```

**Wait for:** "Deployment Complete!" message (~10 minutes)

---

### 4️⃣ Check Service Health

```powershell
# Run diagnosis
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service
.\diagnose.ps1
```

**Look for:**
- ✓ WebSocket service found in ECS
- ✓ All tasks running
- ✓ Target group healthy
- ✓ Recent logs show startup

---

### 5️⃣ Test via ALB

```powershell
# Get ALB DNS
cd C:\Users\galbenar\Sound-Clash\infrastructure
$outputs = cdk deploy SoundClashAlbStack --outputs-file outputs.json --require-approval never
$albDns = (Get-Content outputs.json | ConvertFrom-Json).SoundClashAlbStack.LoadBalancerDNS
Write-Host "ALB DNS: $albDns" -ForegroundColor Cyan

# Run ALB tests
cd ..\backend\websocket-service
.\test_alb.ps1 -AlbDns $albDns
```

**Critical Check:** Look for `websocket_ready: true` in Test 6

---

## Quick Validation

### ✅ Success Checklist
Run this single command to validate everything:

```powershell
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service
.\diagnose.ps1
```

**All should show ✓:**
- [x] ECS Service found and running
- [x] Task status: RUNNING, health: HEALTHY
- [x] Target group: 1 healthy, 0 unhealthy
- [x] Recent logs show no errors

---

## If Something Fails

### Problem: Local tests fail
```powershell
# Check if port 8002 is in use
netstat -ano | findstr :8002

# Kill process if needed (replace PID)
taskkill /PID <PID> /F

# Restart service
python main_simple.py
.\test_local.ps1
```

### Problem: Docker build fails
```powershell
# Check Docker is running
docker ps

# Start Docker Desktop if needed
# Then retry deployment
.\deploy.ps1
```

### Problem: ECS tasks not running
```powershell
# Check CloudWatch logs
aws logs tail /ecs/websocket-service --follow

# Common fixes:
# 1. Check ECR image exists
# 2. Verify task definition
# 3. Check security group rules
```

### Problem: Target group unhealthy
```powershell
# Check target health details
$tg = aws elbv2 describe-target-groups --query "TargetGroups[?contains(TargetGroupName,'websocket')].TargetGroupArn" --output text
aws elbv2 describe-target-health --target-group-arn $tg

# Common issues:
# - Health check path wrong (should be /health)
# - Security group blocking port 8002
# - Service not listening on 0.0.0.0
```

### Problem: websocket_ready = false
```powershell
# Check WebSocket service logs
aws logs tail /ecs/websocket-service --since 5m

# Check game management can reach websocket
cd ..\game-management
python test_websocket_integration.py

# Common issues:
# - WebSocket service URL wrong in game-management
# - Security group blocking internal traffic
# - Service discovery not working
```

---

## One-Line Status Check

```powershell
# Run this anytime to check status
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service; .\diagnose.ps1
```

---

## Success Indicator

**When Phase 1 is complete, you should see:**

```json
{
  "game_code": "ABC123",
  "status": "waiting",
  "websocket_ready": true,  ← THIS MUST BE TRUE
  "storage": {
    "database": true,
    "websocket": true
  }
}
```

**This means:**
✅ WebSocket service is deployed
✅ ALB routing works
✅ Game Management can talk to WebSocket
✅ Ready for Phase 2!

---

## Next: Phase 2

Once `websocket_ready: true`, proceed to Phase 2:
- Build frontend WebSocket client
- Create React hooks for WebSocket
- Test real-time connections

See: `TASK_2.3_WAITING_ROOM_PLAN.md` → Phase 2
