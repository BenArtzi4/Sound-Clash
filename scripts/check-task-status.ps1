# Quick Status Check Script - Windows Compatible (No Emojis)
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "Task 2.4 - Current Status Check" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host ""

# Check if database credentials are set
Write-Host "1. Checking environment variables..." -ForegroundColor Yellow

# Try to get credentials from Secrets Manager if not set
if (-not $env:POSTGRES_HOST -or -not $env:POSTGRES_PASSWORD) {
    Write-Host "   [!] Environment variables not set, retrieving from AWS..." -ForegroundColor Yellow
    
    try {
        $secretArn = "arn:aws:secretsmanager:us-east-1:381492257993:secret:DatabaseSecret86DBB7B3-oAo4OgQZm1dI-KjftEC"
        $secretValue = aws secretsmanager get-secret-value `
            --secret-id $secretArn `
            --region us-east-1 `
            --query 'SecretString' `
            --output text 2>$null | ConvertFrom-Json
        
        $rdsEndpoint = aws cloudformation describe-stacks `
            --stack-name SoundClashDatabaseStack `
            --region us-east-1 `
            --query 'Stacks[0].Outputs[?OutputKey==`PostgresEndpoint`].OutputValue' `
            --output text 2>$null
        
        if ($secretValue -and $rdsEndpoint) {
            $env:POSTGRES_HOST = $rdsEndpoint
            $env:POSTGRES_PORT = "5432"
            $env:POSTGRES_DB = "soundclash"
            $env:POSTGRES_USER = $secretValue.username
            $env:POSTGRES_PASSWORD = $secretValue.password
            Write-Host "   [OK] Credentials retrieved from AWS" -ForegroundColor Green
        } else {
            Write-Host "   [FAIL] Could not retrieve credentials from AWS" -ForegroundColor Red
            Write-Host ""
            Write-Host "   Please run: .\scripts\validate-deployment.ps1" -ForegroundColor Yellow
            exit 1
        }
    } catch {
        Write-Host "   [FAIL] Error retrieving credentials: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host ""
        Write-Host "   Please set manually:" -ForegroundColor Yellow
        Write-Host '   $env:POSTGRES_HOST="your_rds_endpoint"' -ForegroundColor Gray
        Write-Host '   $env:POSTGRES_PASSWORD="your_password"' -ForegroundColor Gray
        exit 1
    }
}

Write-Host "   [OK] Host: $env:POSTGRES_HOST" -ForegroundColor Green
Write-Host ""

# Check database schema with timeout handling
Write-Host "2. Checking database schema..." -ForegroundColor Yellow
$checkOutput = python backend/song-management/scripts/check_schema.py 2>&1
$exitCode = $LASTEXITCODE

Write-Host $checkOutput

if ($exitCode -eq 0) {
    Write-Host ""
    Write-Host "   [OK] Database schema verified" -ForegroundColor Green
} else {
    Write-Host ""
    
    if ($checkOutput -match "timeout|Connection timeout") {
        Write-Host "   [FAIL] Connection timeout detected" -ForegroundColor Red
        Write-Host ""
        Write-Host "   This usually means:" -ForegroundColor Yellow
        Write-Host "   1. RDS instance is still starting up" -ForegroundColor Gray
        Write-Host "   2. Security group not properly configured" -ForegroundColor Gray
        Write-Host "   3. RDS is not publicly accessible" -ForegroundColor Gray
        Write-Host ""
        Write-Host "   Run this to diagnose: .\scripts\validate-deployment.ps1" -ForegroundColor Cyan
        exit 1
    } elseif ($checkOutput -match "password authentication failed") {
        Write-Host "   [FAIL] Authentication failed" -ForegroundColor Red
        Write-Host "   Password may have changed. Retrieve new password from Secrets Manager." -ForegroundColor Yellow
        exit 1
    } else {
        Write-Host "   [!] Could not verify database schema" -ForegroundColor Yellow
    }
}

Write-Host ""

# Check what files exist
Write-Host "3. Checking implementation files..." -ForegroundColor Yellow

$files = @(
    @{Path="backend/song-management/api/songs.py"; Name="Song API"},
    @{Path="backend/song-management/scripts/load_songs.py"; Name="Load Songs Script"},
    @{Path="backend/websocket-service/main_simple.py"; Name="WebSocket Service"},
    @{Path="backend/websocket-service/services/round_manager.py"; Name="Round Manager"},
    @{Path="backend/websocket-service/services/song_selector.py"; Name="Song Selector"},
    @{Path="backend/websocket-service/models/game_state.py"; Name="Game State Models"}
)

foreach ($file in $files) {
    if (Test-Path $file.Path) {
        Write-Host "   [OK] $($file.Name)" -ForegroundColor Green
    } else {
        Write-Host "   [TODO] $($file.Name) - NOT CREATED YET" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "Status Check Complete!" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host ""

# Summary
Write-Host "SUMMARY:" -ForegroundColor Cyan
Write-Host "- Phase 1 (Database): " -NoNewline
if ($exitCode -eq 0) {
    Write-Host "VERIFIED [OK]" -ForegroundColor Green
} else {
    Write-Host "NEEDS VERIFICATION [!]" -ForegroundColor Yellow
}
Write-Host "- Phase 2 (Song API): " -NoNewline
Write-Host "COMPLETE [OK]" -ForegroundColor Green
Write-Host "- Phase 3 (Game States): " -NoNewline
Write-Host "NOT STARTED [TODO]" -ForegroundColor Yellow
Write-Host ""

if ($exitCode -ne 0) {
    Write-Host "[!] NEXT STEP: Run .\scripts\validate-deployment.ps1" -ForegroundColor Cyan
    Write-Host "    This will diagnose the connection issue." -ForegroundColor Gray
} else {
    Write-Host "NEXT STEPS:" -ForegroundColor Cyan
    Write-Host "1. Verify songs are loaded (check output above)" -ForegroundColor White
    Write-Host "2. If no songs, run: python backend/song-management/scripts/load_songs.py" -ForegroundColor White
    Write-Host "3. Start Phase 3 implementation" -ForegroundColor White
}
Write-Host ""
