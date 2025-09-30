# Get RDS Database Credentials - Quick Reference

## Find RDS Endpoint (DB_HOST)
```powershell
# Get all RDS instances with their endpoints
aws rds describe-db-instances --region us-east-1 --query 'DBInstances[*].[DBInstanceIdentifier,Endpoint.Address,DBName,MasterUsername]' --output table

# Just the endpoint
aws rds describe-db-instances --region us-east-1 --query 'DBInstances[0].Endpoint.Address' --output text
```

## Find Database Name (DB_NAME)
```powershell
# Get database name
aws rds describe-db-instances --region us-east-1 --query 'DBInstances[0].DBName' --output text

# If empty, try:
aws rds describe-db-instances --region us-east-1 --query 'DBInstances[*].DBName' --output table
```

## Find Master Username (DB_USER)
```powershell
# Get master username
aws rds describe-db-instances --region us-east-1 --query 'DBInstances[0].MasterUsername' --output text
```

## Find Password (DB_PASSWORD)
**Passwords are NOT stored in AWS and cannot be retrieved!**

### Option 1: Check Your CDK/Infrastructure Code
```powershell
# Search for password in infrastructure code
cd C:\Users\galbenar\Sound-Clash\infrastructure
Select-String -Path ".\stacks\database_stack.py" -Pattern "password|Password"
```

### Option 2: Check AWS Secrets Manager
```powershell
# List all secrets
aws secretsmanager list-secrets --region us-east-1 --query 'SecretList[*].[Name,ARN]' --output table

# Get a specific secret (if found)
aws secretsmanager get-secret-value --secret-id "sound-clash-db-password" --region us-east-1 --query 'SecretString' --output text
```

### Option 3: Reset Password in RDS Console
If you can't find it, reset it:
1. Go to AWS Console → RDS → Databases
2. Select your database
3. Click "Modify"
4. Scroll to "Settings" → New master password
5. Enter new password (write it down!)
6. Click "Continue" → "Modify DB Instance"
7. Wait 5-10 minutes for changes to apply

## All-in-One Command
```powershell
# Get all info at once
Write-Host "=== RDS Database Information ===" -ForegroundColor Cyan
$rdsInfo = aws rds describe-db-instances --region us-east-1 --query 'DBInstances[0]' | ConvertFrom-Json

Write-Host "DB_HOST: $($rdsInfo.Endpoint.Address)" -ForegroundColor Green
Write-Host "DB_PORT: $($rdsInfo.Endpoint.Port)" -ForegroundColor Green
Write-Host "DB_NAME: $($rdsInfo.DBName)" -ForegroundColor Green
Write-Host "DB_USER: $($rdsInfo.MasterUsername)" -ForegroundColor Green
Write-Host "DB_PASSWORD: <CHECK SECRETS MANAGER OR INFRASTRUCTURE CODE>" -ForegroundColor Yellow
Write-Host ""
Write-Host "Database Status: $($rdsInfo.DBInstanceStatus)" -ForegroundColor $(if ($rdsInfo.DBInstanceStatus -eq 'available') { 'Green' } else { 'Yellow' })
Write-Host "Engine: $($rdsInfo.Engine) $($rdsInfo.EngineVersion)" -ForegroundColor Gray
```

## Set Environment Variables
```powershell
# Once you have the values, set them:
$env:DB_HOST = "sound-clash-db.xxxxx.us-east-1.rds.amazonaws.com"  # From describe-db-instances
$env:DB_NAME = "buzzer_game_db"  # From describe-db-instances
$env:DB_USER = "postgres"  # From describe-db-instances (MasterUsername)
$env:DB_PASSWORD = "your-password"  # From Secrets Manager or infrastructure code
$env:DB_PORT = "5432"  # Default PostgreSQL port

# Verify they're set
Write-Host "DB_HOST: $env:DB_HOST"
Write-Host "DB_NAME: $env:DB_NAME"
Write-Host "DB_USER: $env:DB_USER"
Write-Host "DB_PASSWORD: ****$(if($env:DB_PASSWORD){$env:DB_PASSWORD.Substring([Math]::Max(0,$env:DB_PASSWORD.Length-4))})"
```

## Check Infrastructure Code for Password
```powershell
# Search all infrastructure files
cd C:\Users\galbenar\Sound-Clash\infrastructure\stacks
Select-String -Pattern "password|Password|master_user_password" -Path *.py

# Check CDK context
cat ..\cdk.json | Select-String -Pattern "password"

# Check environment files
Select-String -Pattern "password|Password" -Path ..\..\backend\*\.env* -Recurse
```

## If Database Doesn't Exist Yet
```powershell
# Check if RDS instance exists
aws rds describe-db-instances --region us-east-1 --query 'DBInstances[*].DBInstanceIdentifier' --output table

# If empty, deploy infrastructure first
cd C:\Users\galbenar\Sound-Clash\infrastructure
cdk deploy DatabaseStack
```
