# Commit CloudShell scripts for RDS access

Write-Host "Preparing to commit CloudShell scripts..." -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path ".git")) {
    Write-Host "[FAIL] Not in git repository root" -ForegroundColor Red
    Write-Host "Run this from: C:\Users\galbenar\Sound-Clash" -ForegroundColor Yellow
    exit 1
}

# Check what's new
Write-Host "New files to commit:" -ForegroundColor Yellow
git status --short scripts/cloudshell/

Write-Host ""
Write-Host "Committing CloudShell scripts..." -ForegroundColor Yellow

# Add files
git add scripts/cloudshell/

# Commit with message (14 words max as requested)
git commit -m "Add CloudShell scripts for RDS access bypassing ISP block"

Write-Host ""
Write-Host "[OK] Committed!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Push to GitHub: git push origin main" -ForegroundColor White
Write-Host "2. Open AWS CloudShell" -ForegroundColor White
Write-Host "3. Clone repo: git clone YOUR_REPO_URL" -ForegroundColor White
Write-Host "4. Run script: ./scripts/cloudshell/load-songs.sh" -ForegroundColor White
Write-Host ""
