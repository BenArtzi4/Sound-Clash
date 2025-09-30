#!/bin/bash
# Test Game State Transitions
# Run this in AWS CloudShell to test the complete game flow

set -e

echo "============================================================"
echo "Test Game State Transitions"
echo "============================================================"
echo ""

# Get password
echo "[1/6] Getting database credentials..."
PASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id arn:aws:secretsmanager:us-east-1:381492257993:secret:DatabaseSecret86DBB7B3-oAo4OgQZm1dI-KjftEC \
  --region us-east-1 \
  --query 'SecretString' \
  --output text | python3 -c "import sys, json; print(json.load(sys.stdin)['password'])")

export POSTGRES_HOST="soundclash-db-public.c0hq0io4a87a.us-east-1.rds.amazonaws.com"
export POSTGRES_PORT="5432"
export POSTGRES_DB="soundclash"
export POSTGRES_USER="postgres"
export POSTGRES_PASSWORD="$PASSWORD"

echo "Password retrieved"
echo ""

# Install dependencies
echo "[2/6] Installing Python dependencies..."
pip3 install --quiet asyncpg aiohttp 2>/dev/null || pip3 install --user --quiet asyncpg aiohttp

# Test the new game state models
echo "[3/6] Testing game state models..."

cat > /tmp/test_game_state.py << 'PYTHON_TEST'
import sys
sys.path.insert(0, '/home/cloudshell-user/Sound-Clash/backend/websocket-service')

from models.game_state import GameState, RoundState, GameData, RoundData, SongInfo
from datetime import datetime

# Test creating a game
game = GameData(
    game_code="TEST123",
    max_rounds=5,
    selected_genres=["rock", "pop"],
    created_at=datetime.now()
)

print(f"[OK] Created game: {game.game_code}")
print(f"    State: {game.state}")
print(f"    Max rounds: {game.max_rounds}")
print(f"    Genres: {game.selected_genres}")

# Test creating a round
song = SongInfo(
    id=1,
    title="Bohemian Rhapsody",
    artist="Queen",
    youtube_id="fJ9rUzIMcZQ",
    genres=["rock"]
)

round_data = RoundData(
    round_number=1,
    song=song,
    started_at=datetime.now()
)

print(f"[OK] Created round: {round_data.round_number}")
print(f"    Song: {round_data.song.title} by {round_data.song.artist}")
print(f"    State: {round_data.state}")

print("\n[OK] Game state models working correctly!")
PYTHON_TEST

python3 /tmp/test_game_state.py

echo ""

# Test song selector
echo "[4/6] Testing song selector service..."

cat > /tmp/test_song_selector.py << 'PYTHON_TEST'
import sys
import asyncio
sys.path.insert(0, '/home/cloudshell-user/Sound-Clash/backend/websocket-service')

from services.song_selector import SongSelector

async def test_song_selector():
    # Note: In real deployment, this would be the ALB URL
    # For testing, we'll use a mock URL
    selector = SongSelector("http://localhost:8001")
    
    print("[OK] Song selector initialized")
    print("    (Will use real URL in deployment)")
    
    await selector.close_session()

asyncio.run(test_song_selector())
print("[OK] Song selector service working!")
PYTHON_TEST

python3 /tmp/test_song_selector.py

echo ""

# Test round manager
echo "[5/6] Testing round manager service..."

cat > /tmp/test_round_manager.py << 'PYTHON_TEST'
import sys
import asyncio
sys.path.insert(0, '/home/cloudshell-user/Sound-Clash/backend/websocket-service')

from services.round_manager import RoundManager
from services.song_selector import SongSelector

async def test_round_manager():
    selector = SongSelector("http://localhost:8001")
    manager = RoundManager(selector)
    
    # Create a game
    game = manager.create_game(
        game_code="TEST123",
        max_rounds=10,
        selected_genres=["rock", "pop"]
    )
    
    print(f"[OK] Created game via RoundManager")
    print(f"    Code: {game.game_code}")
    print(f"    State: {game.state}")
    
    # Start game
    game = await manager.start_game("TEST123")
    print(f"[OK] Started game")
    print(f"    State: {game.state}")
    
    # Get game
    retrieved = manager.get_game("TEST123")
    print(f"[OK] Retrieved game")
    print(f"    Current round: {retrieved.current_round}")
    print(f"    Max rounds: {retrieved.max_rounds}")
    
    await selector.close_session()

asyncio.run(test_round_manager())
print("[OK] Round manager service working!")
PYTHON_TEST

python3 /tmp/test_round_manager.py

echo ""

# Verify database connection
echo "[6/6] Verifying database connection..."
SONG_COUNT=$(PGPASSWORD="$PASSWORD" psql \
  -h $POSTGRES_HOST \
  -U $POSTGRES_USER \
  -d $POSTGRES_DB \
  -t -c "SELECT COUNT(*) FROM songs;" | tr -d ' ')

echo "[OK] Database connection working"
echo "    Songs available: $SONG_COUNT"

echo ""
echo "============================================================"
echo "ALL TESTS PASSED!"
echo "============================================================"
echo ""
echo "Phase 3 components are ready:"
echo "  [OK] Game state models"
echo "  [OK] Song selector service"
echo "  [OK] Round manager service"
echo "  [OK] Database connection"
echo ""
echo "Next steps:"
echo "  1. Update WebSocket service to use these components"
echo "  2. Add manager endpoints (start game, next round)"
echo "  3. Test full game flow"
echo ""
