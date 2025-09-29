# Create and Register Game - One Command
Write-Host "Creating new game..." -ForegroundColor Cyan

# Create game
$response = Invoke-WebRequest -Uri "http://sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com/api/games/create" -Method POST -Body '{"max_teams":4,"max_rounds":10,"selected_genres":["rock","pop"]}' -ContentType "application/json"
$game = $response.Content | ConvertFrom-Json
$gameCode = $game.game_code

Write-Host "Game created: $gameCode" -ForegroundColor Green

# Register with WebSocket
$body = @{
    action = "game_created"
    settings = @{
        max_teams = 4
        max_rounds = 10
        selected_genres = @("rock", "pop")
    }
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com/api/game/$gameCode/notify" -Method POST -Body $body -ContentType "application/json" | Out-Null

Write-Host "Game registered with WebSocket service" -ForegroundColor Green
Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Game Code: $gameCode" -ForegroundColor Yellow
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Team URL:" -ForegroundColor White
Write-Host "http://sound-clash-frontend-381492257993-us-east-1.s3-website-us-east-1.amazonaws.com/game/$gameCode/waiting" -ForegroundColor Cyan
Write-Host ""
Write-Host "Manager URL:" -ForegroundColor White  
Write-Host "http://sound-clash-frontend-381492257993-us-east-1.s3-website-us-east-1.amazonaws.com/manager/$gameCode" -ForegroundColor Cyan
Write-Host ""
