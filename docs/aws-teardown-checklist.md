# AWS Teardown Checklist (Phase 7)

The exact, ordered list of AWS resources to destroy after the new Supabase/Render/Pages stack is live and stable. Follow top-to-bottom. Each item has a verification step; don't move on without confirming.

**Pre-conditions** (must all be true before starting):
- [ ] New `Sound-Clash` deployed at `https://soundclash.org` and `https://api.soundclash.org`
- [ ] Smoke test passing: a real game session was played end-to-end on the new stack
- [ ] At least 24 hours of green metrics on the new stack
- [ ] All songs verified in Supabase (`SELECT count(*) FROM songs` matches legacy count)
- [ ] DNS already cut over (apex `soundclash.org` points at Cloudflare Pages, not CloudFront)

**Estimated total time**: 60–90 minutes (CloudFront disable alone is ~15 min).

**Estimated cost saved**: ~$1–2/month at idle, ~$15/month if the legacy on-demand stack was being run; up to $105/month if always-on was reactivated.

---

## Step 0: Snapshot before destroying

- [ ] Export legacy songs CSV one last time as a belt-and-suspenders backup:
  ```bash
  aws s3 cp s3://soundclash-songs-data/songs.csv ./backups/songs-$(date +%Y%m%d).csv
  ```
  Store this file outside AWS (e.g., in a private GitHub gist or the planning directory). After teardown, the S3 bucket is gone; this is your last copy from AWS.
- [ ] Note current AWS bill ($/month) for comparison: AWS Console → Billing → "Bills".

## Step 1: Destroy Fargate + ALB stacks (legacy on-demand)

These are cheap to recreate but have ongoing cost while up. Tear down first.

- [ ] In `Sound-Clash-legacy/scripts/ondemand/`:
  ```bash
  ./destroy-all.sh
  ```
  This invokes `cdk destroy` on the on-demand ALB and Fargate stacks. Takes ~8–10 min.
- [ ] **Verify**: AWS Console → ECS → Clusters; the `ondemand` cluster either gone or shows no running tasks.
- [ ] **Verify**: AWS Console → EC2 → Load Balancers; no on-demand ALB present.

## Step 2: Destroy any remaining always-on stacks

If the always-on `infrastructure/` stack was ever deployed (it may not have been used recently), destroy it now.

- [ ] In `Sound-Clash-legacy/infrastructure/`:
  ```bash
  cdk list                 # see what's deployed
  cdk destroy --all        # destroy what's there; will prompt
  ```
- [ ] **Verify**: `cdk list` after destroy shows no deployed stacks.
- [ ] **Verify**: AWS Console → CloudFormation → Stacks; no `Sound-Clash-*` stacks remaining.

## Step 3: Empty + delete S3 buckets

CDK won't delete S3 buckets that contain objects. Empty them first.

- [ ] List buckets to confirm targets:
  ```bash
  aws s3 ls | grep -E '(ondemand-frontend|soundclash-songs-data|soundclash-)'
  ```
- [ ] Empty + delete the on-demand frontend bucket:
  ```bash
  aws s3 rm s3://ondemand-frontend-381492257993-us-east-1 --recursive
  aws s3 rb s3://ondemand-frontend-381492257993-us-east-1
  ```
- [ ] Empty + delete the songs CSV bucket (you already saved a local copy in Step 0):
  ```bash
  aws s3 rm s3://soundclash-songs-data --recursive
  aws s3 rb s3://soundclash-songs-data
  ```
- [ ] Check for any other `soundclash-*` buckets (deploy logs, CloudFront access logs, CDK staging buckets):
  ```bash
  aws s3 ls | grep -i soundclash
  ```
  Empty + delete any that come up.
- [ ] **Verify**: `aws s3 ls | grep -i soundclash` returns nothing.

## Step 4: Disable + delete CloudFront distribution

This is the slow one. CloudFront takes ~15 min to fully disable before it can be deleted.

- [ ] Identify the distribution:
  ```bash
  aws cloudfront list-distributions --query 'DistributionList.Items[?contains(Aliases.Items[0], `soundclash`)].{Id:Id,Status:Status,Aliases:Aliases.Items[0]}'
  ```
  Expected ID: `E2NIDUY011R5N4` (verify before destroying).
- [ ] Disable it (Console is easier than CLI here):
  AWS Console → CloudFront → select the distribution → "Disable" → confirm.
- [ ] Wait ~15 minutes. The status moves from `InProgress` to `Deployed` (still disabled).
- [ ] Delete it: AWS Console → CloudFront → select distribution → "Delete".
- [ ] **Verify**: `aws cloudfront list-distributions` no longer shows a distribution for `soundclash.org`.

## Step 5: Delete ECR repositories

Container image registry; small but not zero cost when you have many images.

- [ ] List the legacy repos:
  ```bash
  aws ecr describe-repositories --query 'repositories[?contains(repositoryName, `ondemand`) || contains(repositoryName, `soundclash`)].repositoryName'
  ```
- [ ] Delete each (the `--force` flag deletes the repo even with images present):
  ```bash
  aws ecr delete-repository --repository-name ondemand/game-management   --force
  aws ecr delete-repository --repository-name ondemand/song-management   --force
  aws ecr delete-repository --repository-name ondemand/websocket-service --force
  ```
- [ ] **Verify**: `aws ecr describe-repositories` shows no `ondemand/*` or `soundclash*` repos.

## Step 6: Delete ACM certificates

- [ ] List wildcard cert(s) for the domain:
  ```bash
  aws acm list-certificates --region us-east-1 \
    --query 'CertificateSummaryList[?contains(DomainName, `soundclash.org`)].{Arn:CertificateArn,Domain:DomainName}'
  ```
  Note: ACM certs used by CloudFront must be in `us-east-1`.
- [ ] Delete each ARN. Note: ACM will refuse to delete a cert still attached to a CloudFront distribution; if you skipped Step 4, do that first.
  ```bash
  aws acm delete-certificate --certificate-arn <arn> --region us-east-1
  ```
- [ ] **Verify**: list command above returns empty.

## Step 7: Delete CloudWatch log groups

Free at idle but they accumulate over time and can incur cost.

- [ ] List relevant log groups:
  ```bash
  aws logs describe-log-groups \
    --query 'logGroups[?contains(logGroupName, `ondemand`) || contains(logGroupName, `soundclash`) || contains(logGroupName, `game-management`) || contains(logGroupName, `song-management`) || contains(logGroupName, `websocket-service`)].logGroupName'
  ```
- [ ] Delete each:
  ```bash
  aws logs delete-log-group --log-group-name <name>
  ```
- [ ] **Verify**: list command returns empty.

## Step 8: Check for stragglers

These may or may not exist depending on what was ever deployed. Check each:

- [ ] **RDS**: `aws rds describe-db-instances --query 'DBInstances[?contains(DBInstanceIdentifier, `soundclash`) || contains(DBInstanceIdentifier, `sound-clash`)].DBInstanceIdentifier'`: if any, take a final snapshot then delete.
- [ ] **DynamoDB**: `aws dynamodb list-tables --query 'TableNames[?contains(@, `soundclash`) || contains(@, `sound-clash`)]'`: delete each.
- [ ] **ElastiCache**: `aws elasticache describe-cache-clusters --query 'CacheClusters[?contains(CacheClusterId, `soundclash`)].CacheClusterId'`: delete each.
- [ ] **Route 53**: any hosted zones for `soundclash.org`? Domain DNS lives at Cloudflare now, so any Route 53 zone is unused. AWS Console → Route 53 → Hosted zones.
- [ ] **Secrets Manager / SSM Parameter Store**: any `/soundclash/*` entries? Console → Systems Manager → Parameter Store; Console → Secrets Manager.
- [ ] **VPC**: a custom VPC for the legacy stack? If everything used the default VPC, skip. Otherwise: Console → VPC → confirm any custom VPC has no remaining ENIs/instances/load balancers, then delete.
- [ ] **EIPs**: `aws ec2 describe-addresses`: any unattached Elastic IPs charge $0.005/hour. Release.
- [ ] **NAT Gateways**: `aws ec2 describe-nat-gateways --filter Name=state,Values=available`: these are $32/mo each. Should be none, but verify.

## Step 9: Verify $0

- [ ] Wait at least one hour after Step 8 for the AWS bill to update.
- [ ] AWS Console → Billing → "Cost Explorer" → set range to "next month" forecast.
- [ ] **Forecast should be $0** (or within a few cents for trailing line items like cross-region data transfer).
- [ ] If forecast is non-zero, drill into the report to find what's still running. Common culprits: an EIP not released, a Route 53 hosted zone, a CloudWatch alarm with a Lambda destination.

## Step 10: Final cleanup

- [ ] Update `Sound-Clash-legacy/README.md` with a teardown notice: "AWS resources for this codebase were torn down on YYYY-MM-DD. The deploy scripts no longer function."
- [ ] Add `LEGACY.md` (template at `Sound-Clash-Plan/templates/LEGACY.md`) to the legacy repo's root.
- [ ] In the new `Sound-Clash` repo, mark all `DEPLOY-09` checkboxes complete in the project tracker.
- [ ] Take a screenshot of the AWS Cost Explorer "$0 forecast" and save it in the new repo at `docs/teardown-evidence-YYYY-MM-DD.png`. Closes the loop.

---

## What CAN'T be deleted (and that's fine)

- **AWS account itself**: keep it; it's free at $0 spend. May be useful for future projects.
- **CloudTrail logs older than 90 days**: auto-prune unless you've configured a long retention. No cost concern.
- **IAM users/roles created during legacy**: review and remove unused ones for security hygiene, but they don't cost anything.

## Rollback (don't actually do this without strong reason)

If you're in the middle of teardown and decide you need the legacy stack back:

1. Stop teardown immediately.
2. From `Sound-Clash-legacy/scripts/ondemand/`: `./deploy-all.sh` re-creates the on-demand stack. ~15–20 min.
3. DNS revert: Cloudflare → `soundclash.org` apex → CNAME back to the new CloudFront distribution that was just recreated.

This works **only** if you stop before Step 4 (CloudFront delete). After Step 4, the original distribution ID is gone; you'd get a new one and need to update other references. After Step 5 (ECR), the deploy scripts also fail because the image registry is gone; you'd need to rebuild + push images first.

In short: Steps 1–3 are reversible in ~30 min. Steps 4+ are not practically reversible.

## Sign-off

- Started: __________ (date, time, operator)
- Completed: __________ (date, time)
- AWS Cost Explorer forecast: __________ ($X.XX/mo)
- Anomalies: __________ (any line items that took investigation)
