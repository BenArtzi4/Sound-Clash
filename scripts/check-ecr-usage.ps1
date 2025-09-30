# Check ECR Storage Usage - See what's using space in ECR

$region = "us-east-1"

Write-Host "=== ECR Storage Analysis ===" -ForegroundColor Cyan
Write-Host ""

# Get all repositories
$repositories = aws ecr describe-repositories --region $region --query 'repositories[*].repositoryName' --output json | ConvertFrom-Json

if ($repositories.Count -eq 0) {
    Write-Host "No ECR repositories found." -ForegroundColor Yellow
    exit
}

$totalStorageBytes = 0
$totalImages = 0

Write-Host "Repository Breakdown:" -ForegroundColor Green
Write-Host "-----------------------------------------------------------" -ForegroundColor Gray

foreach ($repo in $repositories) {
    # Get images for this repository
    $images = aws ecr describe-images --repository-name $repo --region $region --query 'imageDetails[*].[imageTags[0], imagePushedAt, imageSizeInBytes]' --output json | ConvertFrom-Json
    
    if ($images.Count -eq 0) {
        Write-Host "$repo" -ForegroundColor White
        Write-Host "  No images" -ForegroundColor Gray
        Write-Host ""
        continue
    }
    
    # Calculate repository size
    $repoSizeBytes = ($images | ForEach-Object { $_[2] } | Measure-Object -Sum).Sum
    $repoSizeMB = $repoSizeBytes / 1MB
    $totalStorageBytes += $repoSizeBytes
    $totalImages += $images.Count
    
    Write-Host "$repo" -ForegroundColor White -NoNewline
    Write-Host " ($($images.Count) images, $([math]::Round($repoSizeMB, 2)) MB)" -ForegroundColor Yellow
    
    # Show each image
    $sortedImages = $images | Sort-Object { $_[1] } -Descending
    foreach ($image in $sortedImages) {
        $tag = if ($image[0]) { $image[0] } else { "<untagged>" }
        $date = ([DateTime]$image[1]).ToString("yyyy-MM-dd HH:mm")
        $sizeMB = [math]::Round($image[2] / 1MB, 2)
        Write-Host "  - $tag" -ForegroundColor Gray -NoNewline
        Write-Host " | $date | $sizeMB MB" -ForegroundColor DarkGray
    }
    Write-Host ""
}

Write-Host "-----------------------------------------------------------" -ForegroundColor Gray
Write-Host ""

# Calculate totals
$totalStorageMB = $totalStorageBytes / 1MB
$totalStorageGB = $totalStorageBytes / 1GB

Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "Total Repositories: $($repositories.Count)" -ForegroundColor White
Write-Host "Total Images: $totalImages" -ForegroundColor White
Write-Host "Total Storage: $([math]::Round($totalStorageMB, 2)) MB ($([math]::Round($totalStorageGB, 4)) GB)" -ForegroundColor White
Write-Host ""

# Free tier limit
$freeTierGB = 0.5
$usagePercent = ($totalStorageGB / $freeTierGB) * 100

Write-Host "Free Tier Limit: $freeTierGB GB" -ForegroundColor Yellow
Write-Host "Current Usage: $([math]::Round($usagePercent, 2))% of free tier" -ForegroundColor $(if ($usagePercent -gt 85) { "Red" } elseif ($usagePercent -gt 50) { "Yellow" } else { "Green" })

if ($usagePercent -gt 100) {
    $overage = $totalStorageGB - $freeTierGB
    Write-Host "WARNING: OVER LIMIT by $([math]::Round($overage, 4)) GB!" -ForegroundColor Red
    Write-Host "Estimated cost: approximately $([math]::Round($overage * 0.10, 2)) dollars per month" -ForegroundColor Red
} elseif ($usagePercent -gt 85) {
    Write-Host "WARNING: Close to limit! Consider cleanup." -ForegroundColor Yellow
} else {
    Write-Host "Status: Within free tier limits" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Recommendations ===" -ForegroundColor Cyan

if ($totalImages -gt $repositories.Count * 2) {
    $imagesToRemove = $totalImages - ($repositories.Count * 2)
    Write-Host "* Keep only 2 latest images per repository (remove approximately $imagesToRemove images)" -ForegroundColor Yellow
}

if ($usagePercent -gt 50) {
    Write-Host "* Run cleanup script: .\scripts\cleanup-ecr.ps1" -ForegroundColor Yellow
}

Write-Host "* Use image lifecycle policies to auto-delete old images" -ForegroundColor White
Write-Host "* Consider using ECR Public for public images (no storage costs)" -ForegroundColor White
Write-Host ""
