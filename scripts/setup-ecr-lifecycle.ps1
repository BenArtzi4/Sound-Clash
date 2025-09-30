# Setup ECR Lifecycle Policies - Auto-delete old images
# This ensures you never hit the limit again

$region = "us-east-1"

Write-Host "=== Setting up ECR Lifecycle Policies ===" -ForegroundColor Cyan
Write-Host "This will automatically keep only the latest 2 images per repository" -ForegroundColor Yellow
Write-Host ""

# Lifecycle policy - keep only 2 images
$lifecyclePolicy = @'
{
  "rules": [
    {
      "rulePriority": 1,
      "description": "Keep only 2 most recent images",
      "selection": {
        "tagStatus": "any",
        "countType": "imageCountMoreThan",
        "countNumber": 2
      },
      "action": {
        "type": "expire"
      }
    }
  ]
}
'@

# Get all repositories
$repositories = aws ecr describe-repositories --region $region --query 'repositories[*].repositoryName' --output json | ConvertFrom-Json

if ($repositories.Count -eq 0) {
    Write-Host "No ECR repositories found." -ForegroundColor Yellow
    exit
}

Write-Host "Found $($repositories.Count) repositories" -ForegroundColor Green
Write-Host ""

# Apply lifecycle policy to each repository
foreach ($repo in $repositories) {
    Write-Host "Setting lifecycle policy for: $repo" -ForegroundColor White
    
    try {
        aws ecr put-lifecycle-policy `
            --repository-name $repo `
            --lifecycle-policy-text $lifecyclePolicy `
            --region $region | Out-Null
        
        Write-Host "  ✓ Policy applied successfully" -ForegroundColor Green
    } catch {
        Write-Host "  ✗ Failed: $_" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== Lifecycle Policies Setup Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "From now on, AWS will automatically:" -ForegroundColor Green
Write-Host "  • Keep only the 2 most recent images per repository" -ForegroundColor White
Write-Host "  • Delete older images automatically" -ForegroundColor White
Write-Host "  • Prevent storage from exceeding limits" -ForegroundColor White
Write-Host ""
Write-Host "✓ You won't need to manually cleanup again!" -ForegroundColor Green
