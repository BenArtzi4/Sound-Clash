# Phase 2 Quick Start - Commands to Run

## Prerequisites Check

```powershell
# Check backend services are running
aws ecs describe-services --cluster sound-clash-cluster --services websocket-service game-management --query "services[*].{Service:serviceName,Running:runningCount}"
```

Expected: Both should show Running: 1

---

## Step-by-Step Commands

### 1. Install Frontend Dependencies (if not done)

```powershell
cd C:\Users\galbenar\Sound-Clash\frontend
npm install
```

### 2. Start Frontend Development Server

```powershell
cd C:\Users\galbenar\Sound-Clash\frontend
npm run dev
```

**Keep this terminal running!** It should show:
```
➜  Local:   http://localhost:5173/
```

### 3. Run Automated Test Script (New Terminal)

```powershell
cd C:\Users\galbenar\Sound-Clash
.\test-phase2.ps1
```

This will:
- Create a test game
- Check services are running
- Open browser to test page
- Display the game code to use

### 4. Manual Testing in Browser

The browser should open to `http://localhost:5173/test/websocket`

**Test Scenario 1: Single Connection**
1. Enter the game code shown in terminal
2. Enter team name: "Team Alpha"
3. Click "Connect"
4. Verify status shows "CONNECTED" (green)

**Test Scenario 2: Multiple Connections**
1. Open second browser tab: `http://localhost:5173/test/websocket`
2. Enter same game code
3. Enter different team name: "Team Bravo"
4. Click "Connect"
5. Check both tabs show both teams

**Test Scenario 3: Disconnection**
1. In one tab, click "Disconnect"
2. Verify other tab shows team was removed
3. Reconnect and verify team reappears

---

## Quick Validation Commands

### Check if Phase 2 is working:

```powershell
# Create game
$gameData = @{max_teams=4;max_rounds=10;selected_genres=@("Rock")} | ConvertTo-Json
$response = Invoke-RestMethod -Uri "http://sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com/api/games/create" -Method Post -Body $gameData -ContentType "application/json"

# Should show websocket_ready: true
Write-Host "Game Code: $($response.game_code)"
Write-Host "WebSocket Ready: $($response.websocket_ready)" -ForegroundColor $(if($response.websocket_ready){"Green"}else{"Red"})
```

### Check frontend is running:

```powershell
Invoke-WebRequest -Uri "http://localhost:5173" -UseBasicParsing
```

Should return status 200

---

## Troubleshooting Commands

### Frontend won't start:

```powershell
cd C:\Users\galbenar\Sound-Clash\frontend

# Clear cache and reinstall
Remove-Item node_modules -Recurse -Force
Remove-Item package-lock.json -Force
npm install
npm run dev
```

### Can't connect to WebSocket:

```powershell
# Check WebSocket service
aws ecs describe-services --cluster sound-clash-cluster --services websocket-service --query "services[0].{Running:runningCount,Desired:desiredCount}"

# Check logs
aws logs tail WebSocketServiceStack-WebSocketTaskDefWebSocketContainerLogGroupB289BBC6-0EukWaWV258L --since 2m
```

### Browser console errors:

Press F12 in browser, go to Console tab, look for:
- WebSocket connection errors
- CORS errors  
- Network errors

---

## Phase 2 Complete Checklist

- [ ] Frontend starts on http://localhost:5173
- [ ] Test page accessible at /test/websocket
- [ ] Can create game via backend API
- [ ] Can connect to WebSocket from browser
- [ ] Connection status updates correctly
- [ ] Multiple tabs can connect simultaneously
- [ ] Teams list updates in real-time
- [ ] Disconnect works properly
- [ ] Event log shows all events

---

## One-Line Test

```powershell
cd C:\Users\galbenar\Sound-Clash; .\test-phase2.ps1
```

This runs everything and opens the browser ready for testing.

---

## Next: Phase 3

Once all checkboxes above are complete, Phase 2 is done!

Phase 3 will integrate the WebSocket client into the actual WaitingRoomPage component.
