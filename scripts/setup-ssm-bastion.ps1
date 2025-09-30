# Setup AWS Systems Manager Bastion for RDS Access
# This creates a tiny EC2 instance you can use for port forwarding to RDS
# No SSH keys needed, uses AWS SSM Session Manager

Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host "Setup SSM Bastion for RDS Access" -ForegroundColor Cyan
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host ""

Write-Host "This will create:" -ForegroundColor Yellow
Write-Host "  - t4g.nano EC2 instance (~$3/month)" -ForegroundColor Gray
Write-Host "  - IAM role for SSM Session Manager" -ForegroundColor Gray
Write-Host "  - Security group allowing RDS access" -ForegroundColor Gray
Write-Host ""
Write-Host "Then you can access RDS via port forwarding:" -ForegroundColor Yellow
Write-Host '  aws ssm start-session --target i-xxx --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters ''{"portNumber":["5432"],"localPortNumber":["5432"],"host":["rds-endpoint"]}''' -ForegroundColor Gray
Write-Host ""

$confirm = Read-Host "Continue? (yes/no)"
if ($confirm -ne "yes") {
    Write-Host "[*] Aborted" -ForegroundColor Yellow
    exit 0
}

Write-Host ""

# Check if AWS CLI is installed
Write-Host "[1] Checking AWS CLI..." -ForegroundColor Yellow
try {
    $awsVersion = aws --version 2>&1
    Write-Host "   [OK] AWS CLI installed: $awsVersion" -ForegroundColor Green
} catch {
    Write-Host "   [FAIL] AWS CLI not found" -ForegroundColor Red
    exit 1
}

# Check if Session Manager plugin is installed
Write-Host ""
Write-Host "[2] Checking Session Manager plugin..." -ForegroundColor Yellow
try {
    $ssmVersion = session-manager-plugin --version 2>&1
    Write-Host "   [OK] Session Manager plugin installed" -ForegroundColor Green
} catch {
    Write-Host "   [FAIL] Session Manager plugin not installed" -ForegroundColor Red
    Write-Host ""
    Write-Host "   Install it from:" -ForegroundColor Yellow
    Write-Host "   https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "   Quick install for Windows:" -ForegroundColor Yellow
    Write-Host "   1. Download: https://s3.amazonaws.com/session-manager-downloads/plugin/latest/windows/SessionManagerPluginSetup.exe" -ForegroundColor Gray
    Write-Host "   2. Run the installer" -ForegroundColor Gray
    Write-Host "   3. Restart PowerShell" -ForegroundColor Gray
    Write-Host ""
    exit 1
}

$region = "us-east-1"
$vpcId = "vpc-06d41d7e1218920f0"
$publicSubnetId = "subnet-02b6ee4d81a16a031"  # us-east-1a
$rdsSecurityGroupId = "sg-07b9c193b73e8cd89"
$rdsEndpoint = "soundclash-db-public.c0hq0io4a87a.us-east-1.rds.amazonaws.com"

Write-Host ""
Write-Host "[3] Creating IAM role for SSM..." -ForegroundColor Yellow

# Check if role exists
$roleExists = aws iam get-role --role-name SoundClashSSMBastionRole 2>$null
if ($roleExists) {
    Write-Host "   [OK] Role already exists" -ForegroundColor Green
} else {
    # Create trust policy
    $trustPolicy = @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ec2.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
"@
    
    $trustPolicy | Out-File -FilePath trust-policy.json -Encoding utf8
    
    aws iam create-role `
        --role-name SoundClashSSMBastionRole `
        --assume-role-policy-document file://trust-policy.json `
        --description "Role for SSM bastion to access RDS"
    
    # Attach SSM managed policy
    aws iam attach-role-policy `
        --role-name SoundClashSSMBastionRole `
        --policy-arn arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
    
    Remove-Item trust-policy.json
    Write-Host "   [OK] Role created" -ForegroundColor Green
}

# Create instance profile
$profileExists = aws iam get-instance-profile --instance-profile-name SoundClashSSMBastionProfile 2>$null
if ($profileExists) {
    Write-Host "   [OK] Instance profile already exists" -ForegroundColor Green
} else {
    aws iam create-instance-profile --instance-profile-name SoundClashSSMBastionProfile
    aws iam add-role-to-instance-profile `
        --instance-profile-name SoundClashSSMBastionProfile `
        --role-name SoundClashSSMBastionRole
    
    Write-Host "   [OK] Instance profile created" -ForegroundColor Green
    Write-Host "   [*] Waiting 10 seconds for IAM propagation..." -ForegroundColor Gray
    Start-Sleep -Seconds 10
}

Write-Host ""
Write-Host "[4] Creating security group for bastion..." -ForegroundColor Yellow

# Check if SG exists
$sgExists = aws ec2 describe-security-groups `
    --filters "Name=group-name,Values=SoundClashSSMBastion" "Name=vpc-id,Values=$vpcId" `
    --region $region `
    --query 'SecurityGroups[0].GroupId' `
    --output text 2>$null

if ($sgExists -and $sgExists -ne "None") {
    $bastionSgId = $sgExists
    Write-Host "   [OK] Security group already exists: $bastionSgId" -ForegroundColor Green
} else {
    $bastionSgId = aws ec2 create-security-group `
        --group-name SoundClashSSMBastion `
        --description "Security group for SSM bastion" `
        --vpc-id $vpcId `
        --region $region `
        --query 'GroupId' `
        --output text
    
    Write-Host "   [OK] Security group created: $bastionSgId" -ForegroundColor Green
}

# Allow bastion to connect to RDS
aws ec2 authorize-security-group-ingress `
    --group-id $rdsSecurityGroupId `
    --protocol tcp `
    --port 5432 `
    --source-group $bastionSgId `
    --region $region 2>$null

Write-Host ""
Write-Host "[5] Launching EC2 bastion instance..." -ForegroundColor Yellow

# Get latest Amazon Linux 2023 AMI
$amiId = aws ec2 describe-images `
    --owners amazon `
    --filters "Name=name,Values=al2023-ami-2023.*-kernel-6.1-x86_64" "Name=state,Values=available" `
    --query 'Images | sort_by(@, &CreationDate) | [-1].ImageId' `
    --output text `
    --region $region

Write-Host "   Using AMI: $amiId" -ForegroundColor Gray

# Check if instance already exists
$existingInstance = aws ec2 describe-instances `
    --filters "Name=tag:Name,Values=SoundClashSSMBastion" "Name=instance-state-name,Values=running,pending,stopped" `
    --region $region `
    --query 'Reservations[0].Instances[0].InstanceId' `
    --output text 2>$null

if ($existingInstance -and $existingInstance -ne "None") {
    Write-Host "   [OK] Instance already exists: $existingInstance" -ForegroundColor Green
    $instanceId = $existingInstance
} else {
    # Launch instance
    $instanceId = aws ec2 run-instances `
        --image-id $amiId `
        --instance-type t3.nano `
        --iam-instance-profile Name=SoundClashSSMBastionProfile `
        --security-group-ids $bastionSgId `
        --subnet-id $publicSubnetId `
        --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=SoundClashSSMBastion}]' `
        --region $region `
        --query 'Instances[0].InstanceId' `
        --output text
    
    Write-Host "   [OK] Instance launched: $instanceId" -ForegroundColor Green
    Write-Host "   [*] Waiting for instance to be ready..." -ForegroundColor Gray
    
    aws ec2 wait instance-running --instance-ids $instanceId --region $region
    Write-Host "   [OK] Instance is running" -ForegroundColor Green
    
    Write-Host "   [*] Waiting for SSM agent to register (60 seconds)..." -ForegroundColor Gray
    Start-Sleep -Seconds 60
}

Write-Host ""
Write-Host "[6] Testing SSM connectivity..." -ForegroundColor Yellow

$ssmReady = $false
for ($i = 1; $i -le 6; $i++) {
    $ssmStatus = aws ssm describe-instance-information `
        --filters "Key=InstanceIds,Values=$instanceId" `
        --region $region `
        --query 'InstanceInformationList[0].PingStatus' `
        --output text 2>$null
    
    if ($ssmStatus -eq "Online") {
        Write-Host "   [OK] SSM agent is online" -ForegroundColor Green
        $ssmReady = $true
        break
    } else {
        Write-Host "   [*] Attempt $i/6: SSM agent not ready yet, waiting..." -ForegroundColor Gray
        Start-Sleep -Seconds 20
    }
}

if (-not $ssmReady) {
    Write-Host "   [FAIL] SSM agent did not come online" -ForegroundColor Red
    Write-Host "   The instance may need more time. Try again in a few minutes." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "=" * 80 -ForegroundColor Green
Write-Host "SUCCESS! SSM Bastion is Ready" -ForegroundColor Green
Write-Host "=" * 80 -ForegroundColor Green
Write-Host ""

Write-Host "Instance Details:" -ForegroundColor Cyan
Write-Host "  Instance ID: $instanceId" -ForegroundColor White
Write-Host "  Type: t3.nano (~$3/month)" -ForegroundColor White
Write-Host "  Region: $region" -ForegroundColor White
Write-Host ""

Write-Host "To Access RDS via Port Forwarding:" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Run this command:" -ForegroundColor Yellow
Write-Host '  aws ssm start-session \' -ForegroundColor White
Write-Host "    --target $instanceId \" -ForegroundColor White
Write-Host "    --document-name AWS-StartPortForwardingSessionToRemoteHost \" -ForegroundColor White
Write-Host '    --parameters "{\"portNumber\":[\"5432\"],\"localPortNumber\":[\"5432\"],\"host\":[\"' -NoNewline -ForegroundColor White
Write-Host $rdsEndpoint -NoNewline -ForegroundColor Cyan
Write-Host '\"]}"' -ForegroundColor White
Write-Host ""
Write-Host "  Then in another terminal:" -ForegroundColor Yellow
Write-Host "    psql -h localhost -p 5432 -U postgres -d soundclash" -ForegroundColor White
Write-Host "    # OR" -ForegroundColor Gray
Write-Host '    $env:POSTGRES_HOST="localhost"' -ForegroundColor White
Write-Host "    python backend/song-management/scripts/load_songs.py" -ForegroundColor White
Write-Host ""

Write-Host "Save this command to a script:" -ForegroundColor Cyan
$portForwardCommand = "aws ssm start-session --target $instanceId --document-name AWS-StartPortForwardingSessionToRemoteHost --parameters '{\"portNumber\":[\"5432\"],\"localPortNumber\":[\"5432\"],\"host\":[\"$rdsEndpoint\"]}'"
$portForwardCommand | Out-File -FilePath "scripts\connect-to-rds.ps1" -Encoding utf8

Write-Host "  [OK] Saved to: scripts\connect-to-rds.ps1" -ForegroundColor Green
Write-Host ""

Write-Host "Cost: ~$3/month for the t3.nano instance" -ForegroundColor Yellow
Write-Host "To stop when not using: aws ec2 stop-instances --instance-ids $instanceId" -ForegroundColor Gray
Write-Host "To start again: aws ec2 start-instances --instance-ids $instanceId" -ForegroundColor Gray
Write-Host ""
