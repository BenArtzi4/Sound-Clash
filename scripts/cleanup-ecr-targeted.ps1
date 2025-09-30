# Targeted ECR Cleanup - Delete non-Sound Clash repositories and clean up the rest

$region = "us-east-1"

Write-Host "=== Sound Clash ECR Targeted Cleanup ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Delete webserver repository (not part of Sound Clash)
Write-Host "Step 1: Removing non-Sound Clash repositories" -ForegroundColor Yellow
Write-Host ""

$webserverExists = aws ecr describe-repositories --repository-names webserver --region $region 2>$null
if ($webserverExists) {
    Write-Host "Found 'webserver' repository (4.9 GB, 13 images)" -ForegroundColor White
    Write-Host "This appears to be from a different project (last updated Feb 2025)" -ForegroundColor Gray
    $confirm = Read-Host "Delete entire 'webserver' repository? (yes/no)"
    
    if ($confirm -eq "yes") {
        Write-Host "Deleting webserver repository..." -ForegroundColor Yellow
        aws ecr delete-repository --repository-name webserver --force --region $region
        Write-Host "  Done: webserver repository deleted (freed ~4.9 GB)" -ForegroundColor Green
    } else {
        Write-Host "  Skipped webserver deletion" -ForegroundColor Gray
    }
} else {
    Write-Host "No webserver repository found (already deleted or doesn't exist)" -ForegroundColor Gray
}

Write-Host ""

# Step 2: Check for empty Sound Clash repositories
Write-Host "Step 2: Checking for empty Sound Clash repositories" -ForegroundColor Yellow
Write-Host ""

$emptyRepos = @(
    "sound-clash/game-api",
    "sound-clash/manager-console", 
    "sound-clash/public-display",
    "cdk-hnb659fds-container-assets-381492257993-us-east-1"
)

foreach ($repo in $emptyRepos) {
    $exists = aws ecr describe-repositories --repository-names $repo --region $region 2>$null
    if ($exists) {
        $images = aws ecr describe-images --repository-name $repo --region $region --query 'imageDetails' --output json 2>$null | ConvertFrom-Json
        if ($images.Count -eq 0) {
            Write-Host "Found empty repository: $repo" -ForegroundColor White
            $confirm = Read-Host "Delete empty repository '$repo'? (yes/no)"
            
            if ($confirm -eq "yes") {
                aws ecr delete-repository --repository-name $repo --region $region
                Write-Host "  Done: Deleted $repo" -ForegroundColor Green
            } else {
                Write-Host "  Skipped: $repo" -ForegroundColor Gray
            }
        }
    }
}

Write-Host ""

# Step 3: Clean up active Sound Clash repositories (keep only 2 latest images)
Write-Host "Step 3: Cleaning up active Sound Clash repositories" -ForegroundColor Yellow
Write-Host "This will keep only the 2 most recent images per repository" -ForegroundColor Gray
Write-Host ""

$activeRepos = @(
    "sound-clash/song-management",
    "sound-clash/game-management",
    "sound-clash/websocket-service"
)

function Cleanup-Repository {
    param([string]$repoName)
    
    Write-Host "Processing: $repoName" -ForegroundColor Cyan
    
    # Get all images sorted by push date (oldest first)
    $images = aws ecr describe-images --repository-name $repoName --region $region --query 'sort_by(imageDetails, &imagePushedAt)[*].[imageTags[0], imagePushedAt, imageSizeInBytes, imageDigest]' --output json | ConvertFrom-Json
    
    if ($images.Count -eq 0) {
        Write-Host "  No images found" -ForegroundColor Gray
        return
    }
    
    $totalSizeMB = ($images | ForEach-Object { $_[2] } | Measure-Object -Sum).Sum / 1MB
    Write-Host "  Current: $($images.Count) images, $([math]::Round($totalSizeMB, 2)) MB" -ForegroundColor White
    
    # Keep only 2 most recent
    if ($images.Count -le 2) {
        Write-Host "  Action: Keeping all images (already at limit)" -ForegroundColor Green
        return
    }
    
    # Delete all except the last 2
    $imagesToDelete = $images[0..($images.Count - 3)]
    $savedSizeMB = ($imagesToDelete | ForEach-Object { $_[2] } | Measure-Object -Sum).Sum / 1MB
    
    Write-Host "  Will delete: $($imagesToDelete.Count) images" -ForegroundColor Yellow
    Write-Host "  Will free: $([math]::Round($savedSizeMB, 2)) MB" -ForegroundColor Yellow
    
    # Delete images
    $deletedCount = 0
    foreach ($image in $imagesToDelete) {
        $imageDigest = $image[3]
        try {
            aws ecr batch-delete-image --repository-name $repoName --image-ids imageDigest=$imageDigest --region $region --output json | Out-Null
            $deletedCount++
        } catch {
            Write-Host "    Warning: Failed to delete one image" -ForegroundColor Red
        }
    }
    
    Write-Host "  Done: Deleted $deletedCount images, freed $([math]::Round($savedSizeMB, 2)) MB" -ForegroundColor Green
    Write-Host ""
}

$confirmCleanup = Read-Host "Clean up active repositories (keep 2 latest per repo)? (yes/no)"

if ($confirmCleanup -eq "yes") {
    foreach ($repo in $activeRepos) {
        $exists = aws ecr describe-repositories --repository-names $repo --region $region 2>$null
        if ($exists) {
            Cleanup-Repository -repoName $repo
        } else {
            Write-Host "Repository $repo not found (skipping)" -ForegroundColor Gray
        }
    }
} else {
    Write-Host "Skipped cleanup of active repositories" -ForegroundColor Gray
}

# Step 4: Show final summary
Write-Host ""
Write-Host "=== Final Summary ===" -ForegroundColor Cyan
Write-Host ""

$allRepos = aws ecr describe-repositories --region $region --query 'repositories[*].repositoryName' --output json | ConvertFrom-Json
$totalStorageBytes = 0

foreach ($repo in $allRepos) {
    $images = aws ecr describe-images --repository-name $repo --region $region --query 'imageDetails[*].imageSizeInBytes' --output json 2>$null | ConvertFrom-Json
    if ($images.Count -gt 0) {
        $repoSize = ($images | Measure-Object -Sum).Sum
        $totalStorageBytes += $repoSize
        $repoSizeMB = $repoSize / 1MB
        Write-Host "$repo : $($images.Count) images, $([math]::Round($repoSizeMB, 2)) MB" -ForegroundColor White
    }
}

$totalStorageGB = $totalStorageBytes / 1GB
$freeTierGB = 0.5
$usagePercent = ($totalStorageGB / $freeTierGB) * 100

Write-Host ""
Write-Host "Total Storage: $([math]::Round($totalStorageGB, 4)) GB" -ForegroundColor White
Write-Host "Free Tier: $freeTierGB GB" -ForegroundColor Yellow
Write-Host "Usage: $([math]::Round($usagePercent, 2))%" -ForegroundColor $(if ($usagePercent -gt 100) { "Red" } elseif ($usagePercent -gt 85) { "Yellow" } else { "Green" })

if ($usagePercent -gt 100) {
    $overage = $totalStorageGB - $freeTierGB
    Write-Host "Still over limit by $([math]::Round($overage, 4)) GB" -ForegroundColor Red
} elseif ($usagePercent -lt 100) {
    Write-Host "Success: Now within free tier!" -ForegroundColor Green
}

Write-Host ""
Write-Host "Cleanup complete!" -ForegroundColor Green
Write-Host "Note: AWS billing updates may take a few hours to reflect changes" -ForegroundColor Gray
