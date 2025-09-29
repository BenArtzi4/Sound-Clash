# Phase 1 - Quick Reference Card

## 🎯 Goal
Verify WebSocket service accessible via ALB → websocket_ready: true

## ⚡ Fast Track Commands

```powershell
# 1. Test Locally (Terminal 1)
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service
python -m venv venv; .\venv\Scripts\Activate.ps1
pip install -r requirements_simple.txt
python main_simple.py

# 2. Run Tests (Terminal 2)
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service
.\test_local.ps1

# 3. Deploy
.\deploy.ps1

# 4. Validate
.\diagnose.ps1
```

## ✅ Success = All Green ✓

```
[Check 1] ✓ ECS Service running
[Check 2] ✓ Task healthy  
[Check 3] ✓ Target group healthy
[Check 4] ✓ Logs clean
```

## 🔍 Final Check

```powershell
# This ONE command validates everything:
cd C:\Users\galbenar\Sound-Clash\backend\websocket-service
.\diagnose.ps1
```

## 🐛 If Problems

| Issue | Fix |
|-------|-----|
| Port 8002 in use | `netstat -ano \| findstr :8002` → Kill process |
| Docker fails | Start Docker Desktop |
| Tasks crash | `aws logs tail /ecs/websocket-service --follow` |
| Unhealthy targets | Check security groups allow 8002 |
| websocket_ready=false | Run `.\diagnose.ps1` and check logs |

## 📊 Phase 1 = 20 minutes

- Local test: 5 min
- Deploy: 10 min  
- Validate: 5 min

## 🎓 Key Files

- `test_local.ps1` - Test before deploy
- `deploy.ps1` - Deploy everything
- `diagnose.ps1` - Check health
- `test_alb.ps1` - Test ALB routing

## ✨ Done When

```json
{
  "websocket_ready": true ← THIS
}
```

## 🔜 Then Phase 2

Build frontend WebSocket client

---

**Start now:** Open 2 terminals, run Step 1 commands! 🚀
