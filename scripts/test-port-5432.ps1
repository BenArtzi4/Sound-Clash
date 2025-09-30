# Quick test to confirm if port 5432 is blocked by your ISP/firewall

Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "Testing if Port 5432 is Blocked" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host ""

$rdsIp = "18.215.205.205"
$rdsEndpoint = "soundclash-db-public.c0hq0io4a87a.us-east-1.rds.amazonaws.com"

Write-Host "[Test 1] Testing connection to RDS IP:5432" -ForegroundColor Yellow
Write-Host "  Target: $rdsIp`:5432" -ForegroundColor Gray
Write-Host ""

$result1 = Test-NetConnection -ComputerName $rdsIp -Port 5432 -WarningAction SilentlyContinue

if ($result1.TcpTestSucceeded) {
    Write-Host "  [OK] Port 5432 is REACHABLE!" -ForegroundColor Green
    Write-Host "  The issue is NOT your firewall/ISP blocking port 5432" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Port 5432 is BLOCKED" -ForegroundColor Red
    Write-Host "  Your ISP or local firewall is blocking PostgreSQL traffic" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[Test 2] Testing if you can reach the IP at all (ping)" -ForegroundColor Yellow
Write-Host "  Target: $rdsIp" -ForegroundColor Gray
Write-Host ""

$result2 = Test-NetConnection -ComputerName $rdsIp -WarningAction SilentlyContinue

if ($result2.PingSucceeded) {
    Write-Host "  [OK] Can ping the IP" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Cannot ping (but this is normal, AWS blocks ICMP)" -ForegroundColor Gray
}

Write-Host ""
Write-Host "[Test 3] Testing connection to RDS endpoint:5432" -ForegroundColor Yellow
Write-Host "  Target: $rdsEndpoint`:5432" -ForegroundColor Gray
Write-Host ""

$result3 = Test-NetConnection -ComputerName $rdsEndpoint -Port 5432 -WarningAction SilentlyContinue

if ($result3.TcpTestSucceeded) {
    Write-Host "  [OK] Port 5432 is REACHABLE!" -ForegroundColor Green
} else {
    Write-Host "  [FAIL] Port 5432 is BLOCKED" -ForegroundColor Red
}

Write-Host ""
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host "DIAGNOSIS" -ForegroundColor Cyan
Write-Host "=" * 60 -ForegroundColor Cyan
Write-Host ""

if (-not $result1.TcpTestSucceeded -and -not $result3.TcpTestSucceeded) {
    Write-Host "[CONFIRMED] Port 5432 is BLOCKED" -ForegroundColor Red
    Write-Host ""
    Write-Host "This is the problem. Your ISP or firewall blocks PostgreSQL port 5432." -ForegroundColor Yellow
    Write-Host "This is common for security reasons (many ISPs block database ports)." -ForegroundColor Gray
    Write-Host ""
    Write-Host "SOLUTION: Use AWS Systems Manager Session Manager" -ForegroundColor Cyan
    Write-Host "  - No ports needed (uses HTTPS)" -ForegroundColor White
    Write-Host "  - Free (except tiny EC2 ~$3/month)" -ForegroundColor White
    Write-Host "  - Works from anywhere" -ForegroundColor White
    Write-Host "  - No SSH keys needed" -ForegroundColor White
    Write-Host ""
    Write-Host "Run this to set up:" -ForegroundColor Yellow
    Write-Host "  .\scripts\setup-ssm-bastion.ps1" -ForegroundColor Cyan
    Write-Host ""
} else {
    Write-Host "[UNCLEAR] Port test succeeded but database connection failed" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "The port is reachable but something else is wrong." -ForegroundColor Gray
    Write-Host "This could be:" -ForegroundColor Yellow
    Write-Host "  - PostgreSQL not accepting connections yet" -ForegroundColor Gray
    Write-Host "  - Password mismatch" -ForegroundColor Gray
    Write-Host "  - Database configuration issue" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Try running the full check-task-status.ps1 script again." -ForegroundColor Cyan
}

Write-Host ""
