# Infrastructure Management Scripts

Quick commands to start/stop your Sound Clash infrastructure to save costs when not playing.

## 🛑 Shutdown (When Not Playing)

**Saves: ~$30-45/month**

```bash
bash scripts/deployment/shutdown-infrastructure.sh
```

**What it does:**
- Stops all ECS services (websocket, game-management, song-management)
- Stops RDS PostgreSQL database
- Stops EC2 instances (ECS cluster nodes)
- Leaves running: NAT Gateway, ALB, ElastiCache (cannot be stopped)

**Monthly cost while shutdown: ~$60-75**

---

## 🚀 Startup (Ready to Play)

**Takes: 2-5 minutes**

```bash
bash scripts/deployment/startup-infrastructure.sh
```

**What it does:**
- Starts EC2 instances
- Starts RDS database
- Starts all ECS services
- Waits for everything to be ready

**Monthly cost while running: ~$105**

---

## 📊 Status Check

Check if services are running:

```bash
# Check ECS services
aws ecs describe-services \
  --cluster sound-clash-cluster \
  --services websocket-service game-management song-management \
  --query "services[*].[serviceName,runningCount,desiredCount]" \
  --output table

# Check EC2 instances
aws ec2 describe-instances \
  --filters "Name=tag:aws:cloudformation:stack-name,Values=SoundClashEcsStack" \
  --query "Reservations[*].Instances[*].[InstanceId,State.Name]" \
  --output table

# Check RDS
aws rds describe-db-instances \
  --query "DBInstances[?contains(DBInstanceIdentifier, 'soundclash')].[DBInstanceIdentifier,DBInstanceStatus]" \
  --output table
```

---

## 💰 Cost Breakdown

### Running (Full Cost)
| Resource | Monthly Cost |
|----------|--------------|
| ECS EC2 (2x t3.small) | ~$30 |
| NAT Gateway | ~$45 |
| RDS PostgreSQL | $0-15* |
| ElastiCache Redis | ~$12 |
| ALB | ~$16 |
| Others (CloudFront, DynamoDB) | ~$2 |
| **Total** | **~$90-105** |

*Free tier for 12 months

### Shutdown (Stopped)
| Resource | Monthly Cost |
|----------|--------------|
| ECS EC2 (stopped) | ~$0 |
| NAT Gateway | ~$45 |
| RDS PostgreSQL (stopped) | ~$0 |
| ElastiCache Redis | ~$12 |
| ALB (no traffic) | ~$16 |
| Others | ~$2 |
| **Total** | **~$60-75** |

---

## ⚠️ Important Notes

1. **Startup Time**: Allow 2-5 minutes for everything to be ready
2. **Data Safety**: Your data is preserved (RDS stopped, not deleted)
3. **Cannot Stop**:
   - NAT Gateway (delete manually if needed)
   - ElastiCache Redis (delete manually if needed)
   - ALB (minimal cost without traffic)

4. **Frontend**: Always available at https://www.soundclash.org (CloudFront/S3)

---

## 🗑️ Complete Teardown (Delete Everything)

**Only do this if you want to permanently delete the infrastructure!**

```bash
# This will DELETE everything and you'll need to redeploy from scratch
cd infrastructure
cdk destroy --all
```

**Warning:** This deletes:
- All services
- Database (data loss!)
- All infrastructure
- You'll need to run `cdk deploy --all` to recreate everything

---

## 🔄 Recommended Usage Patterns

### Playing Weekly
```bash
# Monday evening (ready to play)
bash scripts/deployment/startup-infrastructure.sh

# After game night
bash scripts/deployment/shutdown-infrastructure.sh

# Savings: ~$100-120/month (compared to 24/7)
```

### Playing Monthly
```bash
# Before game day
bash scripts/deployment/startup-infrastructure.sh

# After playing
bash scripts/deployment/shutdown-infrastructure.sh

# Savings: ~$110-130/month (only paying for ~1 day)
```

### Always Available (Current)
- No scripts needed
- Monthly cost: ~$105
- Game ready instantly

---

## 📞 Troubleshooting

### Services Won't Start
```bash
# Check ECS cluster capacity
aws ecs describe-clusters --clusters sound-clash-cluster

# Check for failed tasks
aws ecs list-tasks --cluster sound-clash-cluster --desired-status STOPPED

# View task logs
aws logs tail /ecs/websocket-service --follow
```

### Database Connection Issues
```bash
# Verify RDS is running
aws rds describe-db-instances --query "DBInstances[*].[DBInstanceIdentifier,DBInstanceStatus]"

# Check security groups allow connections
```

### Still Being Charged After Shutdown
- Check for running EC2 instances
- Verify RDS is stopped (not just stopping)
- Remember: NAT Gateway, ALB, Redis cannot be stopped (only deleted)

---

*Last Updated: 2025-10-18*
