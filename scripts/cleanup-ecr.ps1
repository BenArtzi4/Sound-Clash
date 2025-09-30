# ECR Cleanup Script - Remove old Docker images to reduce storage costs
# This script safely removes old image versions while keeping the latest ones

$region = "us-east-1"
$accountId = "381492257993"

Write-Host "=== Sound Clash ECR Cleanup ===" -ForegroundColor Cyan
Write-Host "This script will remove old Docker images to reduce storage costs" -ForegroundColor Yellow
Write-Host ""

# List all ECR repositories
Write-Host "Fetching ECR repositories..." -ForegroundColor Green
$repositories = aws ecr describe-repositories --region $region --query 'repositories[*].repositoryName' --output json | ConvertFrom-Json

if ($repositories.Count -eq 0) {
    Write-Host "No ECR repositories found." -ForegroundColor Yellow
    exit
}

Write-Host "Found $($repositories.Count) repositories:" -ForegroundColor Green
$repositories | ForEach-Object { Write-Host "  - $_" }
Write-Host ""

# Function to cleanup a repository
function Cleanup-Repository {
    param(
        [string]$repoName
    )
    
    Write-Host "Analyzing repository: $repoName" -ForegroundColor Cyan
    
    # Get all images in the repository
    $images = aws ecr describe-images --repository-name $repoName --region $region --query 'sort_by(imageDetails, &imagePushedAt)[*].[imageTags[0], imagePushedAt, imageSizeInBytes, imageDigest]' --output json | ConvertFrom-Json
    
    if ($images.Count -eq 0) {
        Write-Host "  No images found in $repoName" -ForegroundColor Yellow
        return
    }
    
    Write-Host "  Total images: $($images.Count)" -ForegroundColor White
    
    # Calculate total size
    $totalSizeMB = ($images | ForEach-Object { $_[2] } | Measure-Object -Sum).Sum / 1MB
    Write-Host "  Total size: $([math]::Round($totalSizeMB, 2)) MB" -ForegroundColor White
    
    # Keep only the latest 2 images, delete the rest
    $imagesToKeep = 2
    
    if ($images.Count -le $imagesToKeep) {
        Write-Host "  Keeping all $($images.Count) images (within limit)" -ForegroundColor Green
        return
    }
    
    $imagesToDelete = $images[0..($images.Count - $imagesToKeep - 1)]
    Write-Host "  Images to delete: $($imagesToDelete.Count)" -ForegroundColor Yellow
    
    $savedSizeMB = ($imagesToDelete | ForEach-Object { $_[2] } | Measure-Object -Sum).Sum / 1MB
    Write-Host "  Space to free: $([math]::Round($savedSizeMB, 2)) MB" -ForegroundColor Yellow
    
    # Delete old images
    foreach ($image in $imagesToDelete) {
        $imageDigest = $image[3]
        $imageTag = if ($image[0]) { $image[0] } else { "untagged" }
        $pushedDate = $image[1]
        
        Write-Host "    Deleting: $imageTag (pushed: $pushedDate)" -ForegroundColor Gray
        
        try {
            aws ecr batch-delete-image `
                --repository-name $repoName `
                --image-ids imageDigest=$imageDigest `
                --region $region `
                --output json | Out-Null
            Write-Host "      Done: Deleted" -ForegroundColor Green
        } catch {
            Write-Host "      Failed: $_" -ForegroundColor Red
        }
    }
    
    Write-Host ""
}

# Ask for confirmation
Write-Host "This will keep only the latest 2 images per repository and delete older ones." -ForegroundColor Yellow
$confirmation = Read-Host "Continue? (yes/no)"

if ($confirmation -ne "yes") {
    Write-Host "Cleanup cancelled." -ForegroundColor Yellow
    exit
}

Write-Host ""

# Cleanup each repository
foreach ($repo in $repositories) {
    Cleanup-Repository -repoName $repo
}

Write-Host "=== Cleanup Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Checking current ECR usage..." -ForegroundColor Green

# Show final storage usage
$finalUsage = aws ecr describe-repositories --region $region --query 'repositories[*].[repositoryName]' --output json | ConvertFrom-Json
foreach ($repo in $finalUsage) {
    $repoName = $repo[0]
    $images = aws ecr describe-images --repository-name $repoName --region $region --query 'imageDetails[*].imageSizeInBytes' --output json | ConvertFrom-Json
    if ($images.Count -gt 0) {
        $totalSize = ($images | Measure-Object -Sum).Sum / 1MB
        Write-Host "  $repoName : $([math]::Round($totalSize, 2)) MB" -ForegroundColor White
    }
}

Write-Host ""
Write-Host "Status: ECR cleanup completed successfully!" -ForegroundColor Green
Write-Host "Note: It may take a few hours for AWS billing to reflect the changes." -ForegroundColor Yellow
