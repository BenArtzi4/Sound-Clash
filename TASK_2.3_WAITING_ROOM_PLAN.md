# Task 2.3: Waiting Room WebSocket Integration - Implementation Plan

## Current Status Summary

### ✅ What's Already Working
1. **Backend Infrastructure**:
   - Game Management Service (port 8000) - Creates games, stores in PostgreSQL
   - WebSocket Service (port 8002) - Simplified in-memory team storage
   - ALB routing configured for `/ws/*` paths → WebSocket service
   - HTTP integration between services (`websocket_integration.py`)

2. **Frontend Structure**:
   - `WaitingRoomPage.tsx` - UI ready with TODO placeholders
   - `GameContext.tsx` - State management ready
   - Team display, settings preview, manager actions UI complete

3. **Database**:
   - PostgreSQL storing games persistently
   - Teams currently only in WebSocket service memory

### ⚠️ What's Not Working
1. WebSocket service not accessible via ALB (routing issue or health check)
2. No actual WebSocket client in frontend
3. No real-time team updates
4. No manager broadcast functionality
5. Teams disappear when WebSocket service restarts (in-memory only)

---

## Task Breakdown: 5 Phases

### **Phase 1: Verify & Fix WebSocket Service ALB Routing** (Day 1, ~2-3 hours)
**Goal**: Make sure WebSocket service is accessible via ALB

**Files to Work On**:
- `infrastructure/stacks/alb_stack.py` (verify routing)
- `backend/websocket-service/main_simple.py` (verify health endpoint)
- Testing scripts

**What We'll Do**:
1. Test WebSocket service health locally: `curl http://localhost:8002/health`
2. Deploy and check ECS task is running
3. Test via ALB: `curl http://<ALB-DNS>/health` (should hit game-management)
4. Test WebSocket health: `curl http://<ALB-DNS>/ws/health` or similar
5. Debug ALB routing if needed (check target group health, security groups)
6. Verify WebSocket path routing works

**Success Criteria**:
- ✅ WebSocket service health check passes in ECS
- ✅ Can reach WebSocket service through ALB
- ✅ `/ws/team/{game_code}` endpoint accessible (even if returns error without proper headers)

---

### **Phase 2: Create Frontend WebSocket Client Service** (Day 1-2, ~3-4 hours)
**Goal**: Build reusable WebSocket client for teams and managers

**Files to Create/Modify**:
- `frontend/src/services/websocket/TeamWebSocketClient.ts` (NEW)
- `frontend/src/services/websocket/types.ts` (NEW)
- `frontend/src/hooks/useTeamWebSocket.ts` (NEW)

**What We'll Build**:
1. **WebSocket Client Class** (`TeamWebSocketClient.ts`):
   ```typescript
   - connect(gameCode: string, teamName: string)
   - disconnect()
   - send(message: object)
   - onMessage(callback)
   - onTeamUpdate(callback)
   - onError(callback)
   - reconnect logic with exponential backoff
   ```

2. **Message Types** (`types.ts`):
   ```typescript
   interface TeamJoinMessage {
     type: 'team_join';
     team_name: string;
   }
   
   interface ConnectionAck {
     type: 'connection_ack';
     success: boolean;
     team_name: string;
     game_code: string;
   }
   
   interface TeamListUpdate {
     type: 'team_list_update';
     teams: string[];
   }
   ```

3. **React Hook** (`useTeamWebSocket.ts`):
   ```typescript
   - Manages WebSocket lifecycle
   - Handles reconnection
   - Exposes connection state
   - Returns: { connected, teams, error, connect, disconnect }
   ```

**Success Criteria**:
- ✅ Can create WebSocket connection from frontend
- ✅ Connection state properly tracked
- ✅ Reconnection works when connection drops
- ✅ Type-safe message handling

---

### **Phase 3: Integrate WebSocket into WaitingRoomPage** (Day 2, ~3-4 hours)
**Goal**: Replace TODO comments with real WebSocket integration

**Files to Modify**:
- `frontend/src/pages/game/WaitingRoomPage.tsx`
- `frontend/src/context/GameContext.tsx` (minor updates)

**What We'll Do**:
1. **Add WebSocket to WaitingRoomPage**:
   ```typescript
   const { connected, teams, error, connect, disconnect } = useTeamWebSocket();
   
   useEffect(() => {
     if (gameCode && teamName) {
       connect(gameCode, teamName);
     }
     return () => disconnect();
   }, [gameCode, teamName]);
   ```

2. **Update Teams Display**:
   - Remove static `teams` state
   - Use `teams` from WebSocket hook
   - Show connection status indicators
   - Update team count in real-time

3. **Handle Connection States**:
   - Show "Connecting..." while establishing connection
   - Show "Connected" when ready
   - Show "Reconnecting..." on disconnect
   - Display error messages

4. **Manager View**:
   - Show all connected teams
   - Display connection status for each team
   - Real-time updates when teams join/leave

**Success Criteria**:
- ✅ Teams see themselves in the waiting room after joining
- ✅ Multiple teams can join and see each other
- ✅ Real-time updates when teams join/leave
- ✅ Connection status visible to users

---

### **Phase 4: Add Team Broadcasting in WebSocket Service** (Day 2-3, ~3-4 hours)
**Goal**: Make WebSocket service broadcast team changes to all connected clients

**Files to Modify**:
- `backend/websocket-service/main_simple.py`

**What We'll Add**:
1. **Connection Manager Class**:
   ```python
   class ConnectionManager:
       def __init__(self):
           self.active_connections: Dict[str, List[WebSocket]] = {}
       
       async def connect(self, game_code: str, websocket: WebSocket):
           # Add to game room
       
       async def disconnect(self, game_code: str, websocket: WebSocket):
           # Remove from game room
       
       async def broadcast(self, game_code: str, message: dict):
           # Send to all in game room
   ```

2. **Team Update Broadcasting**:
   - When team joins → broadcast to all in room
   - When team leaves → broadcast to all in room
   - Include updated team list in broadcasts

3. **Message Types**:
   ```python
   # Broadcast to all when team joins
   {
     "type": "team_joined",
     "team_name": "Cool Team",
     "teams": ["Team A", "Cool Team"],
     "total_teams": 2
   }
   
   # Broadcast to all when team leaves
   {
     "type": "team_left",
     "team_name": "Cool Team",
     "teams": ["Team A"],
     "total_teams": 1
   }
   ```

**Success Criteria**:
- ✅ All connected clients receive team updates
- ✅ Team list stays synchronized across all clients
- ✅ No duplicate teams appear
- ✅ Teams see updates immediately (< 1 second latency)

---

### **Phase 5: Manager Console WebSocket & Team Kick** (Day 3, ~3-4 hours)
**Goal**: Enable manager-specific features via WebSocket

**Files to Create/Modify**:
- `frontend/src/hooks/useManagerWebSocket.ts` (NEW)
- `frontend/src/pages/game/WaitingRoomPage.tsx` (add kick functionality)
- `backend/websocket-service/main_simple.py` (add kick endpoint)

**What We'll Add**:

1. **Manager WebSocket Hook**:
   ```typescript
   useManagerWebSocket(gameCode) {
     // Connect as manager (no team_name)
     // Listen for all team events
     // Can send manager commands (kick, start, etc.)
     return { teams, kickTeam, startGame }
   }
   ```

2. **Manager Actions in Backend**:
   ```python
   # New WebSocket message types
   {
     "type": "manager_kick_team",
     "team_name": "Team to Remove"
   }
   
   # Broadcast to kicked team
   {
     "type": "kicked",
     "reason": "Removed by manager"
   }
   ```

3. **UI Updates**:
   - Add "❌ Remove" button next to each team (manager only)
   - Show confirmation dialog before kicking
   - Update team list after kick
   - Kicked team gets redirected to home

**Success Criteria**:
- ✅ Manager can see all teams in real-time
- ✅ Manager can kick teams
- ✅ Kicked teams are notified and disconnected
- ✅ All other teams see the update

---

## File Structure After Implementation

```
backend/
├── websocket-service/
│   ├── main_simple.py              [MODIFIED - Add broadcasting, manager actions]
│   ├── Dockerfile_simple           [EXISTING]
│   └── requirements_simple.txt     [EXISTING]
│
├── game-management/
│   ├── main.py                     [EXISTING - No changes needed]
│   ├── websocket_integration.py   [EXISTING - No changes needed]
│   └── ...

frontend/src/
├── services/websocket/
│   ├── TeamWebSocketClient.ts      [NEW - WebSocket client class]
│   ├── types.ts                    [NEW - Message type definitions]
│   └── config.ts                   [NEW - WebSocket URL configuration]
│
├── hooks/
│   ├── useTeamWebSocket.ts         [NEW - Team WebSocket hook]
│   └── useManagerWebSocket.ts      [NEW - Manager WebSocket hook]
│
├── pages/game/
│   └── WaitingRoomPage.tsx         [MODIFIED - Replace TODOs with real logic]
│
└── context/
    └── GameContext.tsx              [MINOR UPDATES - Add connection state]
```

---

## Testing Strategy

### Phase 1 Testing:
```bash
# Local
curl http://localhost:8002/health

# Via ALB
curl http://<ALB-DNS>/health
curl http://<ALB-DNS>/ws/health  # or similar WebSocket health endpoint
```

### Phase 2 Testing:
- Open browser console
- Create WebSocket connection
- Verify connection established
- Check message formatting

### Phase 3 Testing:
- Open waiting room in 2 browser tabs
- Join as different teams
- Verify both see each other
- Close one tab, verify other updates

### Phase 4 Testing:
- Join with 3-4 teams
- Verify all see synchronized list
- Test leave/reconnect scenarios
- Check broadcast latency

### Phase 5 Testing:
- Manager kicks a team
- Verify kicked team disconnects
- Verify remaining teams see update
- Test multiple rapid kicks

---

## Known Limitations & Future Improvements

### Current Limitations:
1. **In-Memory Storage**: Teams lost on WebSocket service restart
   - **Future**: Add DynamoDB or Redis for persistence
   
2. **No Horizontal Scaling**: WebSocket connections tied to single instance
   - **Future**: Use Redis pub/sub for multi-instance broadcasting

3. **Basic Error Handling**: Simple reconnection logic
   - **Future**: More sophisticated reconnection with exponential backoff

4. **No Authentication**: Teams can join with any name
   - **Future**: Add game code validation, prevent duplicate team names

### Not Included in This Task:
- Game start functionality (Task 2.4)
- Actual gameplay WebSocket (Task 2.4)
- Public display WebSocket (Task 2.5)
- Persistent team storage in database
- Team reconnection after disconnect

---

## Deployment Strategy

### After Each Phase:
1. **Commit changes** with clear message
2. **Deploy to AWS** using existing deployment scripts
3. **Monitor logs** in CloudWatch
4. **Test via ALB** DNS
5. **Fix issues** before moving to next phase

### Deployment Commands:
```powershell
# Deploy WebSocket service
cd infrastructure
python deploy_websocket.py

# Deploy frontend (if needed)
cd ../frontend
npm run build
# Upload to S3 or deploy method
```

---

## Next Steps

**Start with Phase 1** - Let's verify and fix the WebSocket service ALB routing first. This is critical for everything else to work.

Once Phase 1 is complete and we can reach the WebSocket service through the ALB, we'll move to Phase 2 and build the frontend client.

**Ready to start Phase 1?**
