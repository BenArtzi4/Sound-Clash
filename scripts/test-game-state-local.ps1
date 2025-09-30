# Test Game State Components Locally
# This tests the new Phase 3 components without needing database access

Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "Test Game State Components (Local)" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/3] Testing game state models..." -ForegroundColor Yellow

$testModels = @"
import sys
sys.path.insert(0, 'backend/websocket-service')

from models.game_state import GameState, RoundState, GameData, RoundData, SongInfo
from datetime import datetime

# Test creating a game
game = GameData(
    game_code='TEST123',
    max_rounds=5,
    selected_genres=['rock', 'pop'],
    created_at=datetime.now()
)

print(f'[OK] Created game: {game.game_code}')
print(f'    State: {game.state}')
print(f'    Max rounds: {game.max_rounds}')

# Test creating a round
song = SongInfo(
    id=1,
    title='Bohemian Rhapsody',
    artist='Queen',
    youtube_id='fJ9rUzIMcZQ',
    genres=['rock']
)

round_data = RoundData(
    round_number=1,
    song=song,
    started_at=datetime.now()
)

print(f'[OK] Created round: {round_data.round_number}')
print(f'    Song: {round_data.song.title}')
print('[OK] Game state models working!')
"@

$testModels | python
if ($LASTEXITCODE -eq 0) {
    Write-Host "   [OK] Game state models passed" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Game state models failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[2/3] Testing song selector service..." -ForegroundColor Yellow

$testSelector = @"
import sys
import asyncio
sys.path.insert(0, 'backend/websocket-service')

from services.song_selector import SongSelector

async def test():
    selector = SongSelector('http://localhost:8001')
    print('[OK] Song selector initialized')
    await selector.close_session()

asyncio.run(test())
print('[OK] Song selector service working!')
"@

$testSelector | python
if ($LASTEXITCODE -eq 0) {
    Write-Host "   [OK] Song selector service passed" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Song selector service failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[3/3] Testing round manager service..." -ForegroundColor Yellow

$testManager = @"
import sys
import asyncio
sys.path.insert(0, 'backend/websocket-service')

from services.round_manager import RoundManager
from services.song_selector import SongSelector

async def test():
    selector = SongSelector('http://localhost:8001')
    manager = RoundManager(selector)
    
    # Create a game
    game = manager.create_game(
        game_code='TEST123',
        max_rounds=10,
        selected_genres=['rock', 'pop']
    )
    
    print(f'[OK] Created game: {game.game_code}')
    print(f'    State: {game.state}')
    
    # Start game
    game = await manager.start_game('TEST123')
    print(f'[OK] Started game, state: {game.state}')
    
    # Get game
    retrieved = manager.get_game('TEST123')
    print(f'[OK] Retrieved game, rounds: {retrieved.current_round}/{retrieved.max_rounds}')
    
    await selector.close_session()

asyncio.run(test())
print('[OK] Round manager service working!')
"@

$testManager | python
if ($LASTEXITCODE -eq 0) {
    Write-Host "   [OK] Round manager service passed" -ForegroundColor Green
} else {
    Write-Host "   [FAIL] Round manager service failed" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=" * 60 -ForegroundColor Green
Write-Host "ALL TESTS PASSED!" -ForegroundColor Green
Write-Host "=" * 60 -ForegroundColor Green
Write-Host ""
Write-Host "Phase 3 components are ready:" -ForegroundColor Cyan
Write-Host "  [OK] Game state models" -ForegroundColor White
Write-Host "  [OK] Song selector service" -ForegroundColor White
Write-Host "  [OK] Round manager service" -ForegroundColor White
Write-Host ""
Write-Host "Ready to commit and test in CloudShell!" -ForegroundColor Yellow
Write-Host ""
