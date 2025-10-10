# Domain and HTTPS Setup - soundclash.org

## Overview
Production domain configured with free SSL certificate from AWS Certificate Manager.

**Domain:** soundclash.org (registered via Namecheap - £5.56/year)
**SSL Certificate:** AWS ACM (free, auto-renewing)
**Certificate ARN:** `arn:aws:acm:us-east-1:381492257993:certificate/545b6731-5363-4c1d-873b-4eaaaffd69da`

## DNS Configuration (Namecheap)

### Validation Record (Required for SSL)
```
Type: CNAME
Host: _adcfa3d788ab1485dd1e175226cd19e1
Value: _5366633a774b6350d0a761a379e1deab.xlfgrmvvlj.acm-validations.aws.
TTL: Automatic
```

### API Subdomain (Backend)
```
Type: CNAME
Host: api
Value: sound-clash-alb-1979152152.us-east-1.elb.amazonaws.com
TTL: Automatic
```

### Frontend (WWW)
```
Type: CNAME
Host: www
Value: de6s05e4lozs6.cloudfront.net
TTL: Automatic
```

### Root Domain Redirect
```
Type: URL Redirect
Host: @
Value: https://www.soundclash.org
TTL: Automatic
```

## ALB Configuration

### Load Balancer
- **Name:** sound-clash-alb
- **ARN:** `arn:aws:elasticloadbalancing:us-east-1:381492257993:loadbalancer/app/sound-clash-alb/f358e74fb9ddd04f`
- **DNS:** sound-clash-alb-1979152152.us-east-1.elb.amazonaws.com

### Listeners
**HTTP Listener (Port 80):**
- ARN: `arn:aws:elasticloadbalancing:us-east-1:381492257993:listener/app/sound-clash-alb/f358e74fb9ddd04f/dae2f8e786a0a60c`
- Protocol: HTTP
- Port: 80
- Should redirect to HTTPS (TODO)

**HTTPS Listener (Port 443):**
- ARN: `arn:aws:elasticloadbalancing:us-east-1:381492257993:listener/app/sound-clash-alb/f358e74fb9ddd04f/001cbebe3bec5859`
- Protocol: HTTPS
- Port: 443
- Certificate: ACM certificate for soundclash.org
- Default action: Forward to song-service-final-tg

### Target Groups
**song-service-final-tg:**
- ARN: `arn:aws:elasticloadbalancing:us-east-1:381492257993:targetgroup/song-service-final-tg/f20bf1684415d7b7`
- Port: 8001
- Protocol: HTTP

**song-management-tg:**
- ARN: `arn:aws:elasticloadbalancing:us-east-1:381492257993:targetgroup/song-management-tg/635f964b42dd9e6e`
- Port: 8000
- Protocol: HTTP

## Production URLs

### Backend API
- **HTTPS:** https://api.soundclash.org
- **Status endpoint:** https://api.soundclash.org/api/songs/status
- **Health check:** https://api.soundclash.org/health

### Frontend
- **Primary:** https://www.soundclash.org
- **CloudFront:** https://de6s05e4lozs6.cloudfront.net (still works)
- **S3 Bucket:** sound-clash-frontend-381492257993-us-east-1

## Frontend Configuration Required

Update frontend API URL in configuration files:

**Before:**
```
http://sound-clash-alb-1979152152.us-east-1.elb.amazonaws.com
```

**After:**
```
https://api.soundclash.org
```

**Files to update:**
- `frontend/.env.production`
- `frontend/src/config/*.ts` (if exists)
- Any hardcoded API URLs

After updating, rebuild and redeploy frontend:
```powershell
cd C:\Users\galbenar\Sound-Clash\frontend
npm run build
aws s3 sync dist/ s3://sound-clash-frontend-381492257993-us-east-1/ --delete
aws cloudfront create-invalidation --distribution-id E3DNQ80BLT42Z2 --paths "/*"
```

## Testing Commands

```powershell
# Test HTTPS backend
curl https://api.soundclash.org/api/songs/status

# Test DNS resolution
nslookup api.soundclash.org
nslookup www.soundclash.org

# Test SSL certificate
curl -v https://api.soundclash.org/health 2>&1 | Select-String "SSL"

# Check certificate in browser
Start-Process "https://api.soundclash.org/api/songs/status"
```

## Troubleshooting

### Certificate Not Validating
- Check DNS CNAME record is correct in Namecheap
- Wait 15-30 minutes for DNS propagation
- Verify record: `nslookup -type=CNAME _adcfa3d788ab1485dd1e175226cd19e1.soundclash.org`

### Domain Not Resolving
- Check CNAME records in Namecheap Advanced DNS
- Wait 5-10 minutes for DNS propagation
- Clear local DNS cache: `ipconfig /flushdns`

### Mixed Content Errors
- Ensure frontend API URL uses `https://` not `http://`
- Rebuild and redeploy frontend after changing config
- Check browser console for blocked requests

## Costs

- **Domain (Namecheap):** £5.56/year (renews at £9.65/year)
- **SSL Certificate (AWS ACM):** Free
- **CloudFront (existing):** Pay-as-you-go (minimal)
- **ALB (existing):** ~$16/month (no change)

**Total additional cost:** ~£6/year (~$0.50/month)

## Security Notes

- SSL certificate auto-renews (no manual action needed)
- Certificate covers both `soundclash.org` and `*.soundclash.org` (wildcard)
- HTTPS enforced via browser security (mixed content blocked)
- Recommend: Add HTTP to HTTPS redirect on port 80 listener

## Next Steps

1. Add DNS records in Namecheap (api, www, root redirect)
2. Update frontend configuration to use https://api.soundclash.org
3. Rebuild and redeploy frontend
4. Test all endpoints over HTTPS
5. Optional: Configure HTTP to HTTPS redirect on ALB
6. Optional: Add Route 53 for better DNS management (not required)
