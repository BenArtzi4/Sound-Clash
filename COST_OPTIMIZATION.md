# Sound Clash - Cost Optimization Report

## Current Monthly Costs (Estimated: ~$105/month)

### Breakdown
| Resource | Type | Monthly Cost | Notes |
|----------|------|--------------|-------|
| **ECS EC2 Instances** | 2x t3.small | ~$30 | Running 24/7 |
| **NAT Gateway** | Single AZ | ~$45 | Most expensive component |
| **Application Load Balancer** | ALB | ~$16 | Necessary for routing |
| **RDS PostgreSQL** | db.t4g.micro | **Free tier*** | First 12 months |
| **ElastiCache Redis** | cache.t3.micro | ~$12 | Caching layer |
| **CloudFront** | Pay-as-you-go | ~$1 | CDN for frontend |
| **DynamoDB** | Pay-per-request | ~$1 | Minimal usage |
| **ECR Storage** | Docker images | ~$0.50 | **Can be optimized** |
| **CloudWatch Logs** | Log retention | ~$0.50 | **Can be optimized** |

*Note: RDS free tier expires after 12 months - will add ~$15/month*

---

## ✅ Safe Cost Optimizations (Run Now)

### 1. Clean Up Old Docker Images
**Savings: ~$2-5/month**

**Current State:**
- `sound-clash/websocket-service`: 15 images (14 untagged/old)
- `sound-clash/song-management`: 9 images (7 untagged/old)
- `sound-clash/game-management`: 4 images (2 untagged/old)
- `sound-clash-song-management`: **60 images** (duplicate repo!)

**Action:**
```bash
# Run the automated cleanup script
bash scripts/cost-optimization/cleanup-resources.sh
```

**What it does:**
- Deletes all old/untagged Docker images (keeps only `latest`)
- Removes duplicate ECR repository `sound-clash-song-management`
- **Total images to delete: ~50-60**
- **Storage saved: ~5-10 GB**

**Impact on Game:** ✅ **NONE** - Only active images with `latest` tag are kept

---

### 2. Reduce CloudWatch Logs Retention
**Savings: ~$1-2/month**

**Current State:**
- Active logs: 7-day retention
- Empty/unused log groups: Never expire
- Lambda logs from CDK: Never expire

**Action:**
```bash
# Included in cleanup script
bash scripts/cost-optimization/cleanup-resources.sh
```

**What it does:**
- Reduces retention: 7 days → 3 days (still enough for debugging)
- Deletes unused log groups:
  - `/ecs/sound-clash/game-api` (not deployed)
  - `/ecs/sound-clash/manager-console` (not deployed)
  - `/ecs/sound-clash/public-display` (not deployed)
  - `/ecs/sound-clash-song-management` (duplicate)

**Impact on Game:** ✅ **NONE** - Running services keep their logs, just shorter retention

---

## 💰 Total Immediate Savings: ~$3-7/month

Run this command to apply all safe optimizations:
```bash
bash scripts/cost-optimization/cleanup-resources.sh
```

---

## 🤔 Additional Optimization Opportunities (Requires Changes)

### 3. Stop ECS Instances When Not Playing (Manual)
**Potential Savings: ~$20-25/month (if game runs 8 hours/day)**

**Current:** EC2 instances run 24/7 even when no games active

**Option A: Manual Stop/Start**
```bash
# Stop when not playing (saves ~$15/month if off 12hrs/day)
aws ecs update-service --cluster sound-clash-cluster --service websocket-service --desired-count 0
aws ecs update-service --cluster sound-clash-cluster --service game-management --desired-count 0
aws ecs update-service --cluster sound-clash-cluster --service song-management --desired-count 0

# Start when ready to play
aws ecs update-service --cluster sound-clash-cluster --service websocket-service --desired-count 1
aws ecs update-service --cluster sound-clash-cluster --service game-management --desired-count 1
aws ecs update-service --cluster sound-clash-cluster --service song-management --desired-count 1
```

**Trade-off:** 2-3 minute startup time when you want to play

---

### 4. Switch to Fargate Spot (Requires Code Changes)
**Potential Savings: ~$15-20/month**

**Current:** EC2 instances with ECS
**Alternative:** Fargate Spot (serverless containers, 70% cheaper)

**Trade-off:**
- Spot instances can be interrupted (rare but possible)
- Requires infrastructure code changes
- Suitable for non-critical workloads like games

---

### 5. Remove NAT Gateway (Requires Architecture Change)
**Potential Savings: ~$45/month (BIGGEST SAVINGS)**

**Current:** NAT Gateway allows private subnets to access internet

**Why It's There:**
- ECS tasks need to pull Docker images from ECR
- Services might need to call external APIs

**Alternatives:**
1. **VPC Endpoints for ECR** (~$7/month) - Saves $38/month
2. **Move ECS to Public Subnets** (Free) - Security trade-off

**Trade-off:** Requires infrastructure changes, testing

---

### 6. Use Aurora Serverless v2 Instead of RDS (After Free Tier Expires)
**Potential Savings: ~$5-10/month**

**Current:** RDS PostgreSQL (will be ~$15/month after free tier)
**Alternative:** Aurora Serverless v2 (scales to zero when not in use)

**Best For:** Games that aren't running 24/7

---

## 📊 Cost Optimization Summary

### Apply Now (Safe, No Impact)
| Optimization | Savings | Effort | Impact |
|--------------|---------|--------|--------|
| Clean up Docker images | $2-5/month | 1 min | ✅ None |
| Reduce logs retention | $1-2/month | 1 min | ✅ None |
| **Total Immediate** | **$3-7/month** | **1 min** | ✅ **None** |

### Future Considerations (Requires Changes)
| Optimization | Savings | Effort | Trade-off |
|--------------|---------|--------|-----------|
| Manual stop/start services | $15-20/month | Low | 2-3min startup |
| Switch to Fargate Spot | $15-20/month | Medium | Rare interruptions |
| Remove NAT Gateway | $38-45/month | High | Architecture change |
| Aurora Serverless | $5-10/month | Medium | After free tier |

---

## 🎯 Recommended Action Plan

### Phase 1: Immediate (Today)
```bash
bash scripts/cost-optimization/cleanup-resources.sh
```
**Savings:** $3-7/month | **Time:** 1 minute | **Risk:** None

### Phase 2: When Not Playing (Optional)
```bash
# Stop all services
aws ecs update-service --cluster sound-clash-cluster --service websocket-service --desired-count 0
aws ecs update-service --cluster sound-clash-cluster --service game-management --desired-count 0
aws ecs update-service --cluster sound-clash-cluster --service song-management --desired-count 0
```
**Savings:** $15-20/month (if off 50% of the time) | **Startup:** 2-3 minutes

### Phase 3: Long-term (Future Project)
- Evaluate NAT Gateway removal with VPC Endpoints
- Consider Fargate Spot for cost savings
- Plan Aurora Serverless migration before free tier expires

---

## 🚀 How to Run Cleanup

### Option 1: AWS CloudShell (Recommended)
1. Open AWS Console → CloudShell
2. Run:
```bash
curl -o cleanup.sh https://raw.githubusercontent.com/BenArtzi4/Sound-Clash/main/scripts/cost-optimization/cleanup-resources.sh
chmod +x cleanup.sh
bash cleanup.sh
```

### Option 2: Local (Requires AWS CLI)
```bash
cd Sound-Clash
bash scripts/cost-optimization/cleanup-resources.sh
```

---

## 📈 Expected Results

**Before Cleanup:**
- ECR: ~60 Docker images, ~10GB storage
- CloudWatch: 7-day retention, 19 log groups
- Monthly cost: ~$105

**After Cleanup:**
- ECR: ~4 Docker images (latest only), ~1GB storage
- CloudWatch: 3-day retention, 14 log groups
- Monthly cost: ~$98-102

**Reduction: 3-7%** with zero impact on game functionality

---

## ⚠️ What This Does NOT Affect

✅ Running game services (websocket, game-management, song-management)
✅ Current Docker images (tagged as `latest`)
✅ Active games and player connections
✅ Database data (RDS, DynamoDB)
✅ Frontend hosting (CloudFront, S3)
✅ Recent logs (last 3 days still available)

---

*Last Updated: 2025-10-18*
