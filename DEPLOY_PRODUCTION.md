# Deploy Song Management Service to AWS ECS

## 🚀 Deployment Steps

### Prerequisites
- AWS CLI configured
- Docker Desktop running
- ECR repository exists

### Step 1: Build Docker Image

```bash
# Navigate to song-management directory
cd backend/song-management

# Build Docker image
docker build -t sound-clash-song-management .
```

### Step 2: Tag and Push to ECR

```bash
# Login to ECR (replace with your AWS account ID and region)
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Tag image
docker tag sound-clash-song-management:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/sound-clash-song-management:latest

# Push to ECR
docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/sound-clash-song-management:latest
```

### Step 3: Update ECS Service

```bash
# Force new deployment with updated image
aws ecs update-service \
  --cluster sound-clash-cluster \
  --service song-management-service \
  --force-new-deployment \
  --region us-east-1
```

### Step 4: Wait for Deployment

```bash
# Check service status
aws ecs describe-services \
  --cluster sound-clash-cluster \
  --services song-management-service \
  --region us-east-1 \
  --query 'services[0].deployments'
```

Wait until `runningCount` equals `desiredCount`

### Step 5: Test Backend in Production

```bash
# Get ALB DNS name
aws elbv2 describe-load-balancers \
  --query 'LoadBalancers[?contains(LoadBalancerName, `sound-clash`)].DNSName' \
  --output text

# Test health endpoint
curl http://YOUR_ALB_DNS/api/songs/status
```

Should return:
```json
{
  "service": "operational",
  "database": "connected"
}
```

---

## 🎨 Update Frontend to Use Production Backend

### Option A: Use ALB Directly (Development)

Update frontend `.env`:
```env
VITE_SONG_MANAGEMENT_URL=http://YOUR_ALB_DNS
VITE_ADMIN_PASSWORD=admin123
```

### Option B: Deploy Frontend to Production (Best)

Deploy frontend to:
- **AWS S3 + CloudFront** (static hosting)
- **Amplify** (easy deployment)
- **Vercel/Netlify** (quickest)

Then set:
```env
VITE_SONG_MANAGEMENT_URL=http://YOUR_ALB_DNS
VITE_ADMIN_PASSWORD=your_secure_password
```

---

## 🧪 Test Import in Production

Once deployed:

1. **Access Admin** (production frontend or local with prod backend):
   ```
   http://localhost:3000/admin/login
   ```

2. **Login** with password

3. **Import Songs**:
   - Go to Bulk Import
   - Upload `data/sample/songs_converted.csv`
   - Click Import
   - Should see: "✓ Successfully imported: 127 songs"

4. **Verify**:
   - Dashboard shows 127 songs
   - Database has all songs
   - Admin works from anywhere!

---

## 🔒 Security Considerations

### Production Setup:
- ✅ Database in private subnet
- ✅ Only ECS can access database
- ✅ ALB provides public endpoint
- ✅ Security groups properly configured

### What's Secure:
- Database NOT publicly accessible
- Backend runs in same VPC as database
- Frontend calls backend via ALB
- Admin password protected

---

## 📝 Quick Commands Summary

```bash
# 1. Build and push Docker image
cd backend/song-management
docker build -t sound-clash-song-management .
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com
docker tag sound-clash-song-management:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/sound-clash-song-management:latest
docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/sound-clash-song-management:latest

# 2. Update ECS service
aws ecs update-service --cluster sound-clash-cluster --service song-management-service --force-new-deployment --region us-east-1

# 3. Check deployment
aws ecs describe-services --cluster sound-clash-cluster --services song-management-service --region us-east-1

# 4. Test
curl http://YOUR_ALB_DNS/api/songs/status
```

---

## 🎯 Next Steps

1. **Deploy backend to ECS** (steps above)
2. **Test database connection** works from ECS
3. **Update frontend** `.env` with ALB URL
4. **Import songs** via admin interface
5. **Success!** 127 songs in production database

---

**Status:** Ready to deploy to production  
**Why:** Local PC can't access VPC (by design)  
**Solution:** Deploy backend to ECS within VPC
