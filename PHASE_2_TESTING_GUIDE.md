# Phase 2 Testing Guide - Frontend WebSocket Client

## What Was Implemented

Phase 2 creates the frontend WebSocket client infrastructure that allows React components to connect to the WebSocket service and receive real-time updates.

### Files Created

1. **`frontend/src/services/websocket/types.ts`** - TypeScript interfaces for all WebSocket messages
2. **`frontend/src/services/websocket/config.ts`** - WebSocket configuration and URL management
3. **`frontend/src/services/websocket/TeamWebSocketClient.ts`** - WebSocket client class with reconnection logic
4. **`frontend/src/hooks/useTeamWebSocket.ts`** - React hook for easy WebSocket integration
5. **`frontend/src/components/WebSocketTester.tsx`** - Testing component with UI
6. **`frontend/.env`** - Updated with ALB DNS

### Files Modified

1. **`frontend/src/App.tsx`** - Added test route `/test/websocket`

---

## Testing Phase 2

### Prerequisites

1. Backend services must be running (Phase 1 complete)
2. Node.js and npm installed
3. Frontend dependencies installed

### Step 1: Install Frontend Dependencies

```powershell
cd C:\Users\galbenar\Sound-Clash\frontend
npm install
```

### Step 2: Start Frontend Development Server

```powershell
cd C:\Users\galbenar\Sound-Clash\frontend
npm run dev
```

Expected output:
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

### Step 3: Create a Test Game

Open PowerShell and create a game via the backend:

```powershell
$gameData = @{
    max_teams = 4
    max_rounds = 10
    selected_genres = @("Rock", "Pop")
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com/api/games/create" -Method Post -Body $gameData -ContentType "application/json"

Write-Host "Game Code: $($response.game_code)" -ForegroundColor Green
Write-Host "WebSocket Ready: $($response.websocket_ready)" -ForegroundColor $(if($response.websocket_ready){"Green"}else{"Red"})

# Save the game code for testing
$testGameCode = $response.game_code
Write-Host "`nUse this game code in the tester: $testGameCode" -ForegroundColor Cyan
```

### Step 4: Open WebSocket Tester

1. Open browser: `http://localhost:5173/test/websocket`
2. You should see the WebSocket tester interface

### Step 5: Test Single Connection

1. Enter the game code from Step 3
2. Enter a team name (e.g., "Team Alpha")
3. Click "Connect"

**Expected Results:**
- Connection status changes to "CONNECTED" (green)
- Connected: YES
- Teams list shows your team name
- Event log shows connection messages

### Step 6: Test Multiple Connections

Open the same URL in 2-3 different browser tabs/windows:

**Tab 1:**
- Game Code: [same code]
- Team Name: "Team Alpha"
- Click Connect

**Tab 2:**
- Game Code: [same code]
- Team Name: "Team Bravo"
- Click Connect

**Tab 3:**
- Game Code: [same code]
- Team Name: "Team Charlie"
- Click Connect

**Expected Results:**
- All tabs show all 3 teams in the teams list
- Each tab's event log shows "Team joined" messages
- Updates happen in real-time (within 1 second)

### Step 7: Test Disconnection

In any tab, click "Disconnect"

**Expected Results:**
- That tab shows "DISCONNECTED" status
- Other tabs show the team was removed from the list
- Other tabs' event logs show "Team left" message

### Step 8: Test Reconnection

1. Disconnect from a tab
2. Connect again with the same team name

**Expected Results:**
- Successfully reconnects
- Team appears in all tabs again

---

## Validation Checklist

### Basic Functionality
- [ ] Can connect to WebSocket server
- [ ] Connection status updates correctly
- [ ] Team name appears in teams list after connection
- [ ] Can disconnect cleanly

### Real-Time Updates
- [ ] Multiple clients see each other
- [ ] Team joins broadcast to all clients
- [ ] Team leaves broadcast to all clients
- [ ] Updates appear within 1 second

### Error Handling
- [ ] Shows error for invalid game code
- [ ] Shows error for duplicate team name
- [ ] Connection timeout handled gracefully
- [ ] Displays connection errors to user

### State Management
- [ ] Connected state tracked correctly
- [ ] Connecting state shows during connection
- [ ] Error state clears on successful connection
- [ ] Teams list stays synchronized

---

## Troubleshooting

### Issue: Cannot connect to WebSocket

**Check 1: Backend services running**
```powershell
aws ecs describe-services --cluster sound-clash-cluster --services websocket-service --query "services[0].{Running:runningCount,Desired:desiredCount}"
```
Should show Running:1, Desired:1

**Check 2: Game exists**
```powershell
# Verify game was created
Invoke-RestMethod -Uri "http://sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com/api/games/create" -Method Post -Body '{"max_teams":4,"max_rounds":10,"selected_genres":["Rock"]}' -ContentType "application/json"
```

**Check 3: Browser console**
Open Developer Tools (F12) → Console tab
Look for WebSocket connection errors

### Issue: Teams not updating in real-time

**Check:** Browser console for errors
- Look for WebSocket disconnections
- Check for message parsing errors

**Check:** Backend logs
```powershell
aws logs tail WebSocketServiceStack-WebSocketTaskDefWebSocketContainerLogGroupB289BBC6-0EukWaWV258L --follow
```

### Issue: Connection timeout

**Possible causes:**
1. ALB DNS incorrect in `.env` file
2. WebSocket service not running
3. Firewall blocking WebSocket connections
4. CORS issues

**Solution:**
Check frontend `.env` file has correct ALB DNS:
```
VITE_ALB_DNS=sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com
```

### Issue: "Game not found" error

**Solution:** The game code must be created first via the backend API (Step 3)

---

## Testing Script (Automated)

Save this as `test-phase2.ps1`:

```powershell
# Phase 2 Automated Testing Script

Write-Host "=== Phase 2 WebSocket Testing ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Create test game
Write-Host "[1/4] Creating test game..." -ForegroundColor Yellow
$gameData = @{
    max_teams = 4
    max_rounds = 10
    selected_genres = @("Rock", "Pop")
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com/api/games/create" -Method Post -Body $gameData -ContentType "application/json"

if ($response.websocket_ready) {
    Write-Host "  OK Game created: $($response.game_code)" -ForegroundColor Green
    $testGameCode = $response.game_code
} else {
    Write-Host "  FAILED WebSocket not ready" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 2: Check frontend is running
Write-Host "[2/4] Checking frontend server..." -ForegroundColor Yellow
try {
    $frontendCheck = Invoke-WebRequest -Uri "http://localhost:5173" -TimeoutSec 3 -UseBasicParsing
    Write-Host "  OK Frontend running" -ForegroundColor Green
} catch {
    Write-Host "  FAILED Frontend not running" -ForegroundColor Red
    Write-Host "  Run: cd frontend; npm run dev" -ForegroundColor Yellow
    exit 1
}

Write-Host ""

# Step 3: Open browser
Write-Host "[3/4] Opening browser..." -ForegroundColor Yellow
Start-Process "http://localhost:5173/test/websocket"
Write-Host "  OK Browser opened" -ForegroundColor Green

Write-Host ""

# Step 4: Instructions
Write-Host "[4/4] Manual Testing Required" -ForegroundColor Yellow
Write-Host ""
Write-Host "In the browser:" -ForegroundColor White
Write-Host "  1. Enter Game Code: $testGameCode" -ForegroundColor Cyan
Write-Host "  2. Enter Team Name: Team Alpha" -ForegroundColor Cyan
Write-Host "  3. Click 'Connect'" -ForegroundColor Cyan
Write-Host "  4. Open another tab and connect as 'Team Bravo'" -ForegroundColor Cyan
Write-Host "  5. Verify both teams appear in both tabs" -ForegroundColor Cyan
Write-Host ""
Write-Host "Expected Results:" -ForegroundColor White
Write-Host "  - Connection status: CONNECTED (green)" -ForegroundColor Green
Write-Host "  - Teams list shows both teams" -ForegroundColor Green
Write-Host "  - Real-time updates when teams join/leave" -ForegroundColor Green
Write-Host ""
Write-Host "=== Phase 2 Testing Ready ===" -ForegroundColor Cyan
```

Run with:
```powershell
.\test-phase2.ps1
```

---

## Success Criteria

Phase 2 is complete when:

1. ✅ Frontend can connect to WebSocket service
2. ✅ Multiple clients can connect simultaneously
3. ✅ Teams list updates in real-time across all clients
4. ✅ Connection states (connecting, connected, disconnected) work correctly
5. ✅ Error handling displays user-friendly messages
6. ✅ Reconnection logic works after disconnection

---

## Next Steps: Phase 3

Once Phase 2 is validated, proceed to Phase 3:
- Integrate WebSocket into WaitingRoomPage
- Replace static team list with real-time data
- Add connection status indicators to UI
- Handle edge cases (duplicate names, connection drops)

See `TASK_2.3_WAITING_ROOM_PLAN.md` Phase 3 for details.
