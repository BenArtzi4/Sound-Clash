# Phase 1 Setup - Database and Song Loading
# This script guides you through setting up the database

Write-Host "============================================================"
Write-Host "SOUND CLASH - PHASE 1 SETUP" -ForegroundColor Cyan
Write-Host "Database Schema and Song Loading"
Write-Host "============================================================"
Write-Host ""

# Check if we're in the right directory
$currentDir = Get-Location
if (-not (Test-Path "scripts\check_schema.py")) {
    Write-Host "ERROR: Must run from backend/song-management directory" -ForegroundColor Red
    Write-Host "Current: $currentDir" -ForegroundColor Gray
    Write-Host "Expected: Sound-Clash\backend\song-management" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Run this instead:" -ForegroundColor Yellow
    Write-Host "cd C:\Users\galbenar\Sound-Clash\backend\song-management" -ForegroundColor White
    Write-Host ".\scripts\setup_phase1.ps1" -ForegroundColor White
    exit 1
}

Write-Host "OK Running from correct directory" -ForegroundColor Green
Write-Host ""

# Step 1: Check environment variables
Write-Host "Step 1: Checking Environment Variables" -ForegroundColor Yellow
Write-Host "---------------------------------------" -ForegroundColor Gray

$envVars = @{
    "DB_HOST" = $env:DB_HOST
    "DB_NAME" = $env:DB_NAME
    "DB_USER" = $env:DB_USER
    "DB_PASSWORD" = if ($env:DB_PASSWORD) { "****" } else { $null }
    "DB_PORT" = $env:DB_PORT
}

$missingVars = @()
foreach ($var in $envVars.Keys) {
    $value = if ($var -eq "DB_PASSWORD") { $env:DB_PASSWORD } else { $envVars[$var] }
    $displayValue = $envVars[$var]
    
    if ($value) {
        Write-Host "  OK $var = $displayValue" -ForegroundColor Green
    } else {
        Write-Host "  ERROR $var = (not set)" -ForegroundColor Red
        $missingVars += $var
    }
}

if ($missingVars.Count -gt 0) {
    Write-Host ""
    Write-Host "ERROR Missing required environment variables!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Set them with:" -ForegroundColor Yellow
    Write-Host 'Run: .\scripts\load-db-credentials.ps1' -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host ""

# Step 2: Check dependencies
Write-Host "Step 2: Checking Python Dependencies" -ForegroundColor Yellow
Write-Host "-------------------------------------" -ForegroundColor Gray

try {
    python -c "import asyncpg" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  OK asyncpg installed" -ForegroundColor Green
    } else {
        throw "Not installed"
    }
} catch {
    Write-Host "  Installing asyncpg..." -ForegroundColor Yellow
    pip install asyncpg
    
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR Failed to install asyncpg" -ForegroundColor Red
        exit 1
    }
    Write-Host "  OK asyncpg installed successfully" -ForegroundColor Green
}

Write-Host ""

# Step 3: Check CSV file exists
Write-Host "Step 3: Verifying CSV Data File" -ForegroundColor Yellow
Write-Host "-------------------------------" -ForegroundColor Gray

$csvPath = "..\..\data\sample\songs_converted.csv"
if (Test-Path $csvPath) {
    $lineCount = (Get-Content $csvPath | Measure-Object -Line).Lines
    Write-Host "  OK CSV file found" -ForegroundColor Green
    Write-Host "  Path: $csvPath" -ForegroundColor Gray
    Write-Host "  Lines: $lineCount (approximately $($lineCount - 1) songs)" -ForegroundColor Gray
} else {
    Write-Host "  ERROR CSV file not found at: $csvPath" -ForegroundColor Red
    Write-Host ""
    Write-Host "Expected location:" -ForegroundColor Yellow
    Write-Host "C:\Users\galbenar\Sound-Clash\data\sample\songs_converted.csv" -ForegroundColor White
    exit 1
}

Write-Host ""

# Step 4: Check database schema
Write-Host "Step 4: Checking Database Schema" -ForegroundColor Yellow
Write-Host "--------------------------------" -ForegroundColor Gray
Write-Host ""

Write-Host "Running schema verification..." -ForegroundColor Cyan
python scripts\check_schema.py

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR Schema verification failed" -ForegroundColor Red
    Write-Host "Check the error messages above" -ForegroundColor Gray
    exit 1
}

Write-Host ""
Write-Host "Press any key to continue with song loading..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Write-Host ""

# Step 5: Load songs
Write-Host "Step 5: Loading Songs from CSV" -ForegroundColor Yellow
Write-Host "-------------------------------" -ForegroundColor Gray
Write-Host ""

Write-Host "Starting song import..." -ForegroundColor Cyan
python scripts\load_songs.py

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERROR Song loading failed" -ForegroundColor Red
    Write-Host "Check the error messages above" -ForegroundColor Gray
    exit 1
}

# Summary
Write-Host ""
Write-Host "============================================================"
Write-Host "PHASE 1 COMPLETE!" -ForegroundColor Green
Write-Host "============================================================"
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Cyan
Write-Host "  1. Verify songs are accessible via API" -ForegroundColor White
Write-Host "  2. Move to Phase 2: Song Selection API" -ForegroundColor White
Write-Host ""
