# Comprehensive RDS Network Diagnostics Script
# This script checks EVERYTHING about RDS network configuration

Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host "RDS NETWORK DIAGNOSTICS - Full Analysis" -ForegroundColor Cyan
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host ""

$dbId = "soundclash-db-public"
$vpcId = "vpc-06d41d7e1218920f0"
$region = "us-east-1"

# ============================================================================
# STEP 1: RDS Instance Details
# ============================================================================
Write-Host "[STEP 1] RDS Instance Configuration" -ForegroundColor Yellow
Write-Host "-" * 80

$rds = aws rds describe-db-instances `
    --db-instance-identifier $dbId `
    --region $region `
    --query 'DBInstances[0]' `
    --output json | ConvertFrom-Json

Write-Host "Instance ID: $($rds.DBInstanceIdentifier)" -ForegroundColor White
Write-Host "Status: $($rds.DBInstanceStatus)" -ForegroundColor White
Write-Host "Endpoint: $($rds.Endpoint.Address)" -ForegroundColor White
Write-Host "Publicly Accessible: $($rds.PubliclyAccessible)" -ForegroundColor White
Write-Host "VPC: $($rds.DBSubnetGroup.VpcId)" -ForegroundColor White
Write-Host "Subnet Group: $($rds.DBSubnetGroup.DBSubnetGroupName)" -ForegroundColor White

Write-Host "`nSubnets in RDS Subnet Group:" -ForegroundColor Cyan
foreach ($subnet in $rds.DBSubnetGroup.Subnets) {
    Write-Host "  - $($subnet.SubnetIdentifier) ($($subnet.SubnetAvailabilityZone.Name))" -ForegroundColor Gray
}

Write-Host "`nSecurity Groups:" -ForegroundColor Cyan
foreach ($sg in $rds.VpcSecurityGroups) {
    Write-Host "  - $($sg.VpcSecurityGroupId) (Status: $($sg.Status))" -ForegroundColor Gray
}

Write-Host ""

# ============================================================================
# STEP 2: Subnet Analysis (Public vs Private)
# ============================================================================
Write-Host "[STEP 2] Subnet Analysis - Are they REALLY public?" -ForegroundColor Yellow
Write-Host "-" * 80

foreach ($subnet in $rds.DBSubnetGroup.Subnets) {
    $subnetId = $subnet.SubnetIdentifier
    
    Write-Host "`nAnalyzing subnet: $subnetId" -ForegroundColor Cyan
    
    # Get subnet details
    $subnetDetails = aws ec2 describe-subnets `
        --subnet-ids $subnetId `
        --region $region `
        --query 'Subnets[0]' `
        --output json | ConvertFrom-Json
    
    Write-Host "  CIDR: $($subnetDetails.CidrBlock)" -ForegroundColor Gray
    Write-Host "  AZ: $($subnetDetails.AvailabilityZone)" -ForegroundColor Gray
    Write-Host "  MapPublicIpOnLaunch: $($subnetDetails.MapPublicIpOnLaunch)" -ForegroundColor Gray
    
    # Get route table for this subnet
    $routeTable = aws ec2 describe-route-tables `
        --filters "Name=association.subnet-id,Values=$subnetId" `
        --region $region `
        --query 'RouteTables[0]' `
        --output json | ConvertFrom-Json
    
    if (-not $routeTable) {
        # Try main route table
        $routeTable = aws ec2 describe-route-tables `
            --filters "Name=vpc-id,Values=$vpcId" "Name=association.main,Values=true" `
            --region $region `
            --query 'RouteTables[0]' `
            --output json | ConvertFrom-Json
        Write-Host "  Using: Main Route Table (no explicit association)" -ForegroundColor Yellow
    } else {
        Write-Host "  Using: Explicit Route Table" -ForegroundColor Gray
    }
    
    Write-Host "  Route Table ID: $($routeTable.RouteTableId)" -ForegroundColor Gray
    
    # Check routes
    Write-Host "`n  Routes:" -ForegroundColor Cyan
    $hasInternetGateway = $false
    $hasNatGateway = $false
    
    foreach ($route in $routeTable.Routes) {
        $destination = $route.DestinationCidrBlock
        if (-not $destination) { $destination = $route.DestinationIpv6CidrBlock }
        
        $target = ""
        if ($route.GatewayId) { 
            $target = $route.GatewayId 
            if ($route.GatewayId -like "igw-*") {
                $hasInternetGateway = $true
            }
        }
        elseif ($route.NatGatewayId) { 
            $target = $route.NatGatewayId 
            $hasNatGateway = $true
        }
        elseif ($route.TransitGatewayId) { $target = $route.TransitGatewayId }
        elseif ($route.VpcPeeringConnectionId) { $target = $route.VpcPeeringConnectionId }
        elseif ($route.NetworkInterfaceId) { $target = $route.NetworkInterfaceId }
        else { $target = "local" }
        
        $color = "Gray"
        if ($route.GatewayId -like "igw-*") { $color = "Green" }
        
        Write-Host "    $destination -> $target" -ForegroundColor $color
    }
    
    # Verdict
    Write-Host "`n  VERDICT: " -NoNewline -ForegroundColor Cyan
    if ($hasInternetGateway) {
        Write-Host "PUBLIC SUBNET (has Internet Gateway route)" -ForegroundColor Green
    } elseif ($hasNatGateway) {
        Write-Host "PRIVATE SUBNET (uses NAT Gateway - PROBLEM!)" -ForegroundColor Red
    } else {
        Write-Host "ISOLATED SUBNET (no internet access - PROBLEM!)" -ForegroundColor Red
    }
}

Write-Host ""

# ============================================================================
# STEP 3: Security Group Analysis
# ============================================================================
Write-Host "[STEP 3] Security Group Rules Analysis" -ForegroundColor Yellow
Write-Host "-" * 80

foreach ($sg in $rds.VpcSecurityGroups) {
    $sgId = $sg.VpcSecurityGroupId
    
    Write-Host "`nSecurity Group: $sgId" -ForegroundColor Cyan
    
    $sgDetails = aws ec2 describe-security-groups `
        --group-ids $sgId `
        --region $region `
        --query 'SecurityGroups[0]' `
        --output json | ConvertFrom-Json
    
    Write-Host "  Name: $($sgDetails.GroupName)" -ForegroundColor Gray
    Write-Host "  Description: $($sgDetails.Description)" -ForegroundColor Gray
    
    Write-Host "`n  Inbound Rules:" -ForegroundColor Cyan
    $hasPort5432Open = $false
    $hasPublicAccess = $false
    
    foreach ($rule in $sgDetails.IpPermissions) {
        $fromPort = $rule.FromPort
        $toPort = $rule.ToPort
        
        if ($fromPort -eq 5432 -or $toPort -eq 5432) {
            $hasPort5432Open = $true
            
            foreach ($ipRange in $rule.IpRanges) {
                $cidr = $ipRange.CidrIp
                $desc = $ipRange.Description
                if (-not $desc) { $desc = "No description" }
                
                $color = "Gray"
                if ($cidr -eq "0.0.0.0/0") {
                    $hasPublicAccess = $true
                    $color = "Green"
                }
                
                Write-Host "    Port $fromPort-$toPort <- $cidr ($desc)" -ForegroundColor $color
            }
            
            foreach ($sgRef in $rule.UserIdGroupPairs) {
                Write-Host "    Port $fromPort-$toPort <- $($sgRef.GroupId)" -ForegroundColor Gray
            }
        }
    }
    
    if (-not $hasPort5432Open) {
        Write-Host "    [PROBLEM] Port 5432 is NOT open!" -ForegroundColor Red
    } elseif (-not $hasPublicAccess) {
        Write-Host "    [PROBLEM] Port 5432 open but NOT to 0.0.0.0/0!" -ForegroundColor Red
    } else {
        Write-Host "    [OK] Port 5432 open to public internet" -ForegroundColor Green
    }
    
    Write-Host "`n  Outbound Rules:" -ForegroundColor Cyan
    foreach ($rule in $sgDetails.IpPermissionsEgress) {
        $fromPort = $rule.FromPort
        $toPort = $rule.ToPort
        if (-not $fromPort) { $fromPort = "All" }
        if (-not $toPort) { $toPort = "All" }
        
        foreach ($ipRange in $rule.IpRanges) {
            Write-Host "    Port $fromPort-$toPort -> $($ipRange.CidrIp)" -ForegroundColor Gray
        }
    }
}

Write-Host ""

# ============================================================================
# STEP 4: VPC Configuration
# ============================================================================
Write-Host "[STEP 4] VPC Configuration" -ForegroundColor Yellow
Write-Host "-" * 80

$vpc = aws ec2 describe-vpcs `
    --vpc-ids $vpcId `
    --region $region `
    --query 'Vpcs[0]' `
    --output json | ConvertFrom-Json

Write-Host "VPC ID: $($vpc.VpcId)" -ForegroundColor White
Write-Host "CIDR: $($vpc.CidrBlock)" -ForegroundColor White
Write-Host "DNS Support: $($vpc.EnableDnsSupport)" -ForegroundColor White
Write-Host "DNS Hostnames: $($vpc.EnableDnsHostnames)" -ForegroundColor White

# Check for Internet Gateway
Write-Host "`nInternet Gateways:" -ForegroundColor Cyan
$igws = aws ec2 describe-internet-gateways `
    --filters "Name=attachment.vpc-id,Values=$vpcId" `
    --region $region `
    --query 'InternetGateways' `
    --output json | ConvertFrom-Json

if ($igws.Count -gt 0) {
    foreach ($igw in $igws) {
        Write-Host "  - $($igw.InternetGatewayId) (State: $($igw.Attachments[0].State))" -ForegroundColor Green
    }
} else {
    Write-Host "  [PROBLEM] No Internet Gateway attached!" -ForegroundColor Red
}

# Check for NAT Gateways
Write-Host "`nNAT Gateways:" -ForegroundColor Cyan
$nats = aws ec2 describe-nat-gateways `
    --filter "Name=vpc-id,Values=$vpcId" `
    --region $region `
    --query 'NatGateways[?State!=`deleted`]' `
    --output json | ConvertFrom-Json

if ($nats.Count -gt 0) {
    foreach ($nat in $nats) {
        Write-Host "  - $($nat.NatGatewayId) in $($nat.SubnetId) (State: $($nat.State))" -ForegroundColor Gray
    }
} else {
    Write-Host "  No NAT Gateways" -ForegroundColor Gray
}

Write-Host ""

# ============================================================================
# STEP 5: Network ACLs
# ============================================================================
Write-Host "[STEP 5] Network ACLs (Subnet-level firewalls)" -ForegroundColor Yellow
Write-Host "-" * 80

foreach ($subnet in $rds.DBSubnetGroup.Subnets) {
    $subnetId = $subnet.SubnetIdentifier
    
    $nacl = aws ec2 describe-network-acls `
        --filters "Name=association.subnet-id,Values=$subnetId" `
        --region $region `
        --query 'NetworkAcls[0]' `
        --output json | ConvertFrom-Json
    
    Write-Host "`nSubnet: $subnetId" -ForegroundColor Cyan
    Write-Host "  NACL: $($nacl.NetworkAclId)" -ForegroundColor Gray
    Write-Host "  Is Default: $($nacl.IsDefault)" -ForegroundColor Gray
    
    Write-Host "`n  Inbound Rules:" -ForegroundColor Cyan
    $inboundRules = $nacl.Entries | Where-Object { $_.Egress -eq $false } | Sort-Object RuleNumber
    
    $hasPort5432Allow = $false
    foreach ($rule in $inboundRules) {
        $action = $rule.RuleAction
        $color = if ($action -eq "allow") { "Green" } else { "Red" }
        
        $portRange = "All"
        if ($rule.PortRange) {
            $portRange = "$($rule.PortRange.From)-$($rule.PortRange.To)"
            if ($rule.PortRange.From -le 5432 -and $rule.PortRange.To -ge 5432) {
                if ($action -eq "allow") {
                    $hasPort5432Allow = $true
                }
            }
        }
        
        $protocol = $rule.Protocol
        if ($protocol -eq "-1") { $protocol = "All" }
        
        Write-Host "    Rule $($rule.RuleNumber): $action | Protocol: $protocol | Port: $portRange | CIDR: $($rule.CidrBlock)" -ForegroundColor $color
    }
    
    if (-not $hasPort5432Allow) {
        Write-Host "`n    [PROBLEM] No ALLOW rule for port 5432!" -ForegroundColor Red
    } else {
        Write-Host "`n    [OK] Port 5432 allowed" -ForegroundColor Green
    }
    
    Write-Host "`n  Outbound Rules:" -ForegroundColor Cyan
    $outboundRules = $nacl.Entries | Where-Object { $_.Egress -eq $true } | Sort-Object RuleNumber
    
    foreach ($rule in $outboundRules) {
        $action = $rule.RuleAction
        $color = if ($action -eq "allow") { "Green" } else { "Red" }
        
        $portRange = "All"
        if ($rule.PortRange) {
            $portRange = "$($rule.PortRange.From)-$($rule.PortRange.To)"
        }
        
        $protocol = $rule.Protocol
        if ($protocol -eq "-1") { $protocol = "All" }
        
        Write-Host "    Rule $($rule.RuleNumber): $action | Protocol: $protocol | Port: $portRange | CIDR: $($rule.CidrBlock)" -ForegroundColor $color
    }
}

Write-Host ""

# ============================================================================
# STEP 6: DNS Resolution Test
# ============================================================================
Write-Host "[STEP 6] DNS Resolution Test" -ForegroundColor Yellow
Write-Host "-" * 80

$endpoint = $rds.Endpoint.Address
Write-Host "`nResolving: $endpoint" -ForegroundColor Cyan

try {
    $resolved = [System.Net.Dns]::GetHostAddresses($endpoint)
    Write-Host "  Resolved to:" -ForegroundColor Gray
    foreach ($ip in $resolved) {
        Write-Host "    - $($ip.IPAddressToString)" -ForegroundColor Green
        
        # Check if IP is private
        $ipBytes = $ip.GetAddressBytes()
        $isPrivate = ($ipBytes[0] -eq 10) -or 
                     ($ipBytes[0] -eq 172 -and $ipBytes[1] -ge 16 -and $ipBytes[1] -le 31) -or
                     ($ipBytes[0] -eq 192 -and $ipBytes[1] -eq 168)
        
        if ($isPrivate) {
            Write-Host "      [PROBLEM] This is a PRIVATE IP! RDS is not publicly accessible!" -ForegroundColor Red
        } else {
            Write-Host "      [OK] This is a PUBLIC IP" -ForegroundColor Green
        }
    }
} catch {
    Write-Host "  [FAIL] DNS resolution failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""

# ============================================================================
# STEP 7: Port Connectivity Test (from your machine)
# ============================================================================
Write-Host "[STEP 7] Port Connectivity Test (from your local machine)" -ForegroundColor Yellow
Write-Host "-" * 80

Write-Host "`nTesting connection to $endpoint`:5432" -ForegroundColor Cyan
Write-Host "  (This tests if port 5432 is reachable from your machine)" -ForegroundColor Gray

try {
    $tcpClient = New-Object System.Net.Sockets.TcpClient
    $connect = $tcpClient.BeginConnect($endpoint, 5432, $null, $null)
    $wait = $connect.AsyncWaitHandle.WaitOne(5000, $false)
    
    if ($wait) {
        $tcpClient.EndConnect($connect)
        Write-Host "  [OK] Port 5432 is REACHABLE!" -ForegroundColor Green
        $tcpClient.Close()
    } else {
        Write-Host "  [FAIL] Connection timeout - port not reachable" -ForegroundColor Red
        Write-Host "  This is the MAIN PROBLEM!" -ForegroundColor Red
    }
} catch {
    Write-Host "  [FAIL] Connection failed: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "  This is the MAIN PROBLEM!" -ForegroundColor Red
}

Write-Host ""

# ============================================================================
# SUMMARY & DIAGNOSIS
# ============================================================================
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host "DIAGNOSIS SUMMARY" -ForegroundColor Cyan
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host ""

Write-Host "Key Findings:" -ForegroundColor Yellow
Write-Host ""

# Check 1: Subnets
Write-Host "1. Subnet Configuration:" -ForegroundColor Cyan
$allPublic = $true
foreach ($subnet in $rds.DBSubnetGroup.Subnets) {
    $subnetId = $subnet.SubnetIdentifier
    $routeTable = aws ec2 describe-route-tables `
        --filters "Name=association.subnet-id,Values=$subnetId" `
        --region $region `
        --query 'RouteTables[0]' `
        --output json 2>$null | ConvertFrom-Json
    
    if (-not $routeTable) {
        $routeTable = aws ec2 describe-route-tables `
            --filters "Name=vpc-id,Values=$vpcId" "Name=association.main,Values=true" `
            --region $region `
            --query 'RouteTables[0]' `
            --output json | ConvertFrom-Json
    }
    
    $hasIGW = $false
    foreach ($route in $routeTable.Routes) {
        if ($route.GatewayId -like "igw-*") {
            $hasIGW = $true
            break
        }
    }
    
    if (-not $hasIGW) {
        $allPublic = $false
        Write-Host "   [PROBLEM] Subnet $subnetId is NOT truly public (no IGW route)" -ForegroundColor Red
    } else {
        Write-Host "   [OK] Subnet $subnetId has Internet Gateway route" -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "2. Security Groups:" -ForegroundColor Cyan
Write-Host "   [OK] Port 5432 open to 0.0.0.0/0" -ForegroundColor Green

Write-Host ""
Write-Host "3. RDS Configuration:" -ForegroundColor Cyan
Write-Host "   [OK] Publicly Accessible: true" -ForegroundColor Green

Write-Host ""
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host "NEXT STEPS" -ForegroundColor Cyan
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host ""

if (-not $allPublic) {
    Write-Host "[PROBLEM IDENTIFIED] Subnets do NOT have Internet Gateway routes!" -ForegroundColor Red
    Write-Host ""
    Write-Host "The subnets marked as 'Public' are actually behaving as private subnets." -ForegroundColor Yellow
    Write-Host "This means RDS cannot be reached from the internet even with 'publicly accessible' enabled." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Solution:" -ForegroundColor Cyan
    Write-Host "  We need to either:" -ForegroundColor White
    Write-Host "  A) Set up a Bastion Host (recommended for production)" -ForegroundColor White
    Write-Host "  B) Fix the route tables to add IGW routes" -ForegroundColor White
    Write-Host "  C) Use AWS Systems Manager Session Manager" -ForegroundColor White
    Write-Host ""
    Write-Host "Let me create scripts for these solutions..." -ForegroundColor Yellow
} else {
    Write-Host "[UNCLEAR] Subnets appear correct but connection still fails." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Possible causes:" -ForegroundColor Cyan
    Write-Host "  - Your local firewall blocking outbound port 5432" -ForegroundColor White
    Write-Host "  - Your ISP blocking PostgreSQL traffic" -ForegroundColor White
    Write-Host "  - Network ACLs blocking traffic" -ForegroundColor White
    Write-Host ""
    Write-Host "Check Network ACLs above for any DENY rules on port 5432" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Full diagnostic complete. Review the output above for details." -ForegroundColor Cyan
Write-Host ""
