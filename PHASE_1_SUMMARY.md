# Phase 1 Complete - Files Created & Commands Summary

## 📁 Files Created/Modified

### Modified Files (1)
✏️ `backend/websocket-service/main_simple.py`
   - Added `debug` endpoint for diagnostics
   - Enhanced health check with active games count
   - Added timestamp to responses

### New Test & Deployment Scripts (5)
📝 `backend/websocket-service/test_local.ps1` - Test service locally
📝 `backend/websocket-service/test_alb.ps1` - Test via ALB after deployment  
📝 `backend/websocket-service/deploy.ps1` - Full deployment script
📝 `backend/websocket-service/diagnose.ps1` - Quick health diagnosis

### Documentation (3)
📘 `PHASE_1_TESTING_GUIDE.md` - Detailed testing guide with troubleshooting
📘 `PHASE_1_QUICK_START.md` - Fast command reference
📘 `TASK_2.3_WAITING_ROOM_PLAN.md` - Full 5-phase implementation plan

---

## 🚀 Commands to Run (In Order)

### Step 1: Local Testing
```powershell
# Terminal 1 - Start service
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements_simple.txt
python main_simple.py
```

```powershell
# Terminal 2 - Run tests
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service
.\test_local.ps1
```

**✅ Success:** All 6 tests pass with green checkmarks

---

### Step 2: Deploy to AWS
```powershell
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service
.\deploy.ps1
```

**✅ Success:** "Deployment Complete!" message appears (~10 min)

---

### Step 3: Check Service Health
```powershell
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service
.\diagnose.ps1
```

**✅ Success:** All checks show green ✓
- ECS service running
- Tasks healthy
- Target group healthy
- Logs show startup

---

### Step 4: Test via ALB
```powershell
# Get ALB DNS
cd C:\Users\galbenar\Sound-Clash\infrastructure
$albDns = (cdk deploy SoundClashAlbStack --outputs-file outputs.json --require-approval never | Out-Null; (Get-Content outputs.json | ConvertFrom-Json).SoundClashAlbStack.LoadBalancerDNS)
Write-Host "ALB DNS: $albDns" -ForegroundColor Cyan

# Run ALB tests
cd ..\backend\websocket-service
.\test_alb.ps1 -AlbDns $albDns
```

**✅ Success Indicator:** Test 6 shows `websocket_ready: true`

---

## 🎯 Success Criteria

Phase 1 is complete when you see this in the game creation response:

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

---

## 🔍 Quick Validation Commands

### One-line health check:
```powershell
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service; .\diagnose.ps1
```

### Check CloudWatch logs:
```powershell
aws logs tail /ecs/websocket-service --follow
```

### Check if service is running:
```powershell
aws ecs describe-services --cluster sound-clash-cluster --services websocket-service --query "services[0].{Status:status,Running:runningCount,Desired:desiredCount}"
```

### Check target group health:
```powershell
$tg = aws elbv2 describe-target-groups --query "TargetGroups[?contains(TargetGroupName,'websocket')].TargetGroupArn" --output text
aws elbv2 describe-target-health --target-group-arn $tg --query "TargetHealthDescriptions[0].TargetHealth.State" --output text
```

---

## 🐛 Common Issues & Quick Fixes

### Issue 1: Local tests fail - "Connection refused"
```powershell
# Check if port 8002 is already in use
netstat -ano | findstr :8002

# If in use, kill the process (replace <PID>)
taskkill /PID <PID> /F

# Restart service
python main_simple.py
```

### Issue 2: Docker build fails
```powershell
# Verify Docker is running
docker ps

# If not running, start Docker Desktop
# Then retry
.\deploy.ps1
```

### Issue 3: ECS tasks won't start
```powershell
# Check logs for errors
aws logs tail /ecs/websocket-service --since 5m

# Common causes:
# - Docker image not in ECR
# - Task definition incorrect
# - No available capacity

# Verify image exists
aws ecr describe-images --repository-name sound-clash-websocket
```

### Issue 4: Target group shows unhealthy
```powershell
# Get detailed health status
$tg = aws elbv2 describe-target-groups --query "TargetGroups[?contains(TargetGroupName,'websocket')].TargetGroupArn" --output text
aws elbv2 describe-target-health --target-group-arn $tg

# Common causes:
# - Health check path wrong (should be /health)
# - Security group blocking port 8002
# - Service crashed on startup

# Check security groups allow 8002
cd ..\..\infrastructure
cdk deploy SoundClashVpcStack --require-approval never
```

### Issue 5: websocket_ready = false
```powershell
# Test if WebSocket service is reachable from Game Management
# This means HTTP notifications are failing

# Check WebSocket service is running
.\diagnose.ps1

# Check Game Management logs
aws logs tail /ecs/game-management --since 5m | Select-String "websocket"

# Verify internal connectivity
# Services must be in same VPC and security groups must allow traffic
```

---

## 📊 What Each Script Does

| Script | Purpose | When to Use |
|--------|---------|-------------|
| `test_local.ps1` | Tests service on localhost | Before deploying |
| `deploy.ps1` | Builds & deploys to AWS | Initial deployment & updates |
| `diagnose.ps1` | Checks ECS, targets, logs | Troubleshooting |
| `test_alb.ps1` | Tests via ALB routing | After deployment |

---

## 🎓 Understanding the Test Results

### test_local.ps1 Results:
- **Test 1-3:** Basic endpoints work
- **Test 4:** Can create game rooms
- **Test 5:** Can query game status
- **Test 6:** Games are stored correctly

### diagnose.ps1 Results:
- **Check 1:** ECS service exists and tasks are running
- **Check 2:** Tasks are healthy (not crashed)
- **Check 3:** ALB knows service is healthy
- **Check 4:** No errors in application logs
- **Check 5:** (Optional) Can reach via ALB

### test_alb.ps1 Results:
- **Test 1:** Baseline - Game Management works
- **Test 2-4:** WebSocket routing tests
- **Test 5:** Target group health
- **Test 6:** End-to-end game creation ⭐ MOST IMPORTANT

---

## ✅ Phase 1 Complete Checklist

Mark each as you complete:

- [ ] Local service starts without errors
- [ ] All local tests pass (test_local.ps1)
- [ ] Docker image builds successfully
- [ ] Image pushed to ECR
- [ ] ECS service deployed
- [ ] Tasks running (not crashed)
- [ ] Target group shows healthy
- [ ] No errors in CloudWatch logs
- [ ] Can reach service via ALB
- [ ] Game creation shows `websocket_ready: true`

**When all checked ✅ → Phase 1 COMPLETE! 🎉**

---

## 🔜 What's Next: Phase 2

After Phase 1 is complete, we'll build:

1. **Frontend WebSocket Client** (`TeamWebSocketClient.ts`)
   - Connection management
   - Message handling
   - Reconnection logic

2. **React Hooks** 
   - `useTeamWebSocket` for teams
   - Auto-connect and disconnect
   - State management

3. **Type Definitions**
   - WebSocket message types
   - Connection states
   - Error types

See `TASK_2.3_WAITING_ROOM_PLAN.md` for Phase 2 details.

---

## 📞 Getting Help

**If stuck on Phase 1:**

1. Run `diagnose.ps1` and check all 5 checks
2. Look at CloudWatch logs: `aws logs tail /ecs/websocket-service --follow`
3. Verify ALB listener rules include `/ws/*` pattern
4. Check security groups allow internal traffic
5. Ensure both services in same VPC

**Key Files for Debugging:**
- CloudWatch: `/ecs/websocket-service`
- CloudWatch: `/ecs/game-management`
- Infrastructure: `infrastructure/stacks/alb_stack.py`
- Service: `backend/websocket-service/main_simple.py`

---

## 💾 Commit After Phase 1

Once everything works, commit with:

```powershell
cd C:\Users\galbenar\Sound-Clash
git add .
git commit -m "Phase 1: WebSocket ALB routing verified"
```

**Commit message kept to 7 words (within 14-word limit)**

---

## 🎯 Final Validation Command

Run this ONE command to validate Phase 1 is complete:

```powershell
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service
.\diagnose.ps1
Write-Host ""
Write-Host "Creating test game to check websocket_ready..." -ForegroundColor Yellow
$albDns = (Get-Content ..\..\infrastructure\outputs.json -ErrorAction SilentlyContinue | ConvertFrom-Json).SoundClashAlbStack.LoadBalancerDNS
if ($albDns) {
    $response = Invoke-RestMethod -Uri "http://$albDns/api/games" -Method Post -Body '{"name":"Phase1Test","max_teams":4,"max_rounds":10,"genres":["Rock"]}' -ContentType "application/json"
    Write-Host "websocket_ready: $($response.websocket_ready)" -ForegroundColor $(if ($response.websocket_ready) { "Green" } else { "Red" })
    if ($response.websocket_ready) {
        Write-Host "`n✅ PHASE 1 COMPLETE! Ready for Phase 2!" -ForegroundColor Green
    } else {
        Write-Host "`n❌ WebSocket not ready - check diagnose output above" -ForegroundColor Red
    }
} else {
    Write-Host "Could not find ALB DNS - check outputs.json" -ForegroundColor Yellow
}
```

**Expected Output:** `✅ PHASE 1 COMPLETE! Ready for Phase 2!`

---

**Ready to start? Run the commands in Step 1! 🚀**
