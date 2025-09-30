# CloudShell Scripts for RDS Access

This directory contains scripts for managing the RDS database from AWS CloudShell, which bypasses local ISP/firewall restrictions on port 5432.

## Why CloudShell?

Your local ISP/firewall blocks PostgreSQL port 5432, preventing direct RDS access from your development machine. AWS CloudShell provides a free, browser-based terminal that can access RDS directly.

## Scripts

### `load-songs.sh`
Loads sample songs into the RDS database.

**What it does:**
1. Retrieves database password from AWS Secrets Manager
2. Tests connection to RDS
3. Checks current database state
4. Loads 10 sample songs with genres
5. Creates song-genre relationships

**Usage:**
```bash
# In AWS CloudShell
cd ~
git clone https://github.com/YOUR_USERNAME/Sound-Clash.git
cd Sound-Clash
chmod +x scripts/cloudshell/load-songs.sh
./scripts/cloudshell/load-songs.sh
```

## How to Use CloudShell

1. **Open CloudShell:**
   - Go to AWS Console: https://console.aws.amazon.com/
   - Click the terminal icon in the top-right toolbar
   - Wait 30 seconds for initialization

2. **Clone Repository:**
   ```bash
   cd ~
   git clone https://github.com/YOUR_USERNAME/Sound-Clash.git
   cd Sound-Clash
   ```

3. **Run Script:**
   ```bash
   chmod +x scripts/cloudshell/load-songs.sh
   ./scripts/cloudshell/load-songs.sh
   ```

## Database Connection Details

All scripts use these environment variables:
- **Host:** `soundclash-db-public.c0hq0io4a87a.us-east-1.rds.amazonaws.com`
- **Port:** `5432`
- **Database:** `soundclash`
- **User:** `postgres`
- **Password:** Retrieved from Secrets Manager

## For Future Development

### Option 1: Continue Using CloudShell (FREE)
- Clone repo to CloudShell
- Make changes
- Push back to GitHub
- No additional costs

**Limitations:**
- Sessions timeout after ~20 minutes inactivity
- Not ideal for active development
- Need to upload/download files

### Option 2: SSM Bastion (~$3/month)
- One-time setup creates EC2 instance
- Port forward through HTTPS (bypasses ISP block)
- Full local development experience
- Run: `.\scripts\setup-ssm-bastion.ps1`

**Benefits:**
- Seamless local development
- No session timeouts
- Full IDE support
- Worth it for regular development

## Troubleshooting

### "Permission denied" error
```bash
chmod +x scripts/cloudshell/*.sh
```

### "asyncpg not found" error
The script auto-installs dependencies. If it fails:
```bash
pip3 install --user asyncpg
```

### Connection timeout
CloudShell should never timeout to RDS. If it does, check:
```bash
# Test basic connectivity
python3 -c "import socket; s=socket.socket(); s.settimeout(5); s.connect(('soundclash-db-public.c0hq0io4a87a.us-east-1.rds.amazonaws.com', 5432)); print('OK')"
```

## Cost Comparison

| Solution | Cost | Setup Time | Use Case |
|----------|------|------------|----------|
| CloudShell | FREE | 2 minutes | Occasional database operations |
| SSM Bastion | ~$3/month | 10 minutes | Regular development |
| Public RDS | FREE | N/A | Blocked by ISP |

## Notes

- CloudShell storage persists in home directory (`~`)
- Scripts are idempotent (safe to run multiple times)
- Songs use `ON CONFLICT` to avoid duplicates
- All passwords retrieved securely from Secrets Manager
