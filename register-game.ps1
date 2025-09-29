# Auto-register game with WebSocket service
param(
    [Parameter(Mandatory=$true)]
    [string]$GameCode
)

Write-Host "Registering game $GameCode with WebSocket service..." -ForegroundColor Cyan

$body = @{
    action = "game_created"
    settings = @{
        max_teams = 4
        max_rounds = 10
        selected_genres = @("rock", "pop")
    }
} | ConvertTo-Json

try {
    $response = Invoke-WebRequest -Uri "http://sound-clash-alb-1680771077.us-east-1.elb.amazonaws.com/api/game/$GameCode/notify" -Method POST -Body $body -ContentType "application/json"
    
    if ($response.StatusCode -eq 200) {
        Write-Host "OK Game $GameCode registered successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Test URLs:" -ForegroundColor Yellow
        Write-Host "Team: http://sound-clash-frontend-381492257993-us-east-1.s3-website-us-east-1.amazonaws.com/game/$GameCode/waiting" -ForegroundColor White
        Write-Host "Manager: http://sound-clash-frontend-381492257993-us-east-1.s3-website-us-east-1.amazonaws.com/manager/$GameCode" -ForegroundColor White
    }
} catch {
    Write-Host "ERROR Failed to register game: $_" -ForegroundColor Red
}
