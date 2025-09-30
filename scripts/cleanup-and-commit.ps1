# Cleanup and Commit Script
Write-Host "Analyzing files for cleanup and commit..." -ForegroundColor Cyan
Write-Host ""

# Files to DELETE (temporary, redundant, or outdated)
$filesToDelete = @(
    "COMMIT_MESSAGE.md",
    "DATABASE_CREDENTIALS_READY.md", 
    "DATABASE_FIX_SUMMARY.md",
    "RUN_THIS_NOW.md",
    "START_HERE.md",
    "backend/.env",
    "scripts/fix-rds-connection-correct-sg.ps1",
    "scripts/fix-rds-connection.md",
    "scripts/fix-rds-connection.ps1",
    "scripts/fix-rds-find-and-fix.ps1",
    "scripts/fix-rds-public-access.ps1",
    "scripts/validate-deployment.ps1",
    "scripts/validate-new-rds.ps1",
    "scripts/run-phase1-complete.ps1",
    "scripts/load-db-credentials.ps1",
    "docs/TASK_2_4_IMPLEMENTATION_PLAN.md"
)

# Files to KEEP and commit
$filesToCommit = @(
    "backend/song-management/scripts/",
    "docs/CURRENT_STATUS_TASK_2_4.md",
    "docs/RDS_CONNECTION_SOLUTIONS.md",
    "docs/TASK_2_4_REVISED_PLAN.md",
    "scripts/cloudshell/",
    "scripts/check-task-status.ps1",
    "scripts/diagnose-rds-network.ps1",
    "scripts/test-port-5432.ps1",
    "scripts/setup-ssm-bastion.ps1",
    "scripts/commit-cloudshell-scripts.ps1",
    "scripts/check-ecr-usage.ps1",
    "scripts/cleanup-ecr-targeted.ps1",
    "scripts/cleanup-ecr.ps1",
    "scripts/setup-ecr-lifecycle.ps1",
    "infrastructure/stacks/database_stack.py"
)

Write-Host "Files to DELETE:" -ForegroundColor Red
foreach ($file in $filesToDelete) {
    if (Test-Path $file) {
        Write-Host "  - $file" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "Files to COMMIT:" -ForegroundColor Green
foreach ($file in $filesToCommit) {
    if (Test-Path $file) {
        Write-Host "  - $file" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "Modified files (need review):" -ForegroundColor Yellow
Write-Host "  - data/sample/songs_converted.csv" -ForegroundColor Gray
Write-Host "  - data/sample/songs_simple.csv" -ForegroundColor Gray
Write-Host "  - scripts/database/migrate.py" -ForegroundColor Gray

Write-Host ""
$confirm = Read-Host "Proceed with cleanup and commit? (yes/no)"

if ($confirm -ne "yes") {
    Write-Host "Aborted" -ForegroundColor Yellow
    exit 0
}

Write-Host ""
Write-Host "Deleting temporary files..." -ForegroundColor Yellow
foreach ($file in $filesToDelete) {
    if (Test-Path $file) {
        Remove-Item $file -Force
        Write-Host "  [OK] Deleted: $file" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "Staging files for commit..." -ForegroundColor Yellow
foreach ($file in $filesToCommit) {
    if (Test-Path $file) {
        git add $file
        Write-Host "  [OK] Added: $file" -ForegroundColor Gray
    }
}

# Also add modified CSVs if they have actual changes
git add data/sample/songs_converted.csv
git add data/sample/songs_simple.csv

Write-Host ""
Write-Host "[OK] Cleanup and staging complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Branch name suggestion: rds-cloudshell-access" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next commands:" -ForegroundColor Yellow
Write-Host "  git checkout -b rds-cloudshell-access" -ForegroundColor White
Write-Host '  git commit -m "Add CloudShell scripts for RDS database access"' -ForegroundColor White
Write-Host "  git push origin rds-cloudshell-access" -ForegroundColor White
Write-Host ""
