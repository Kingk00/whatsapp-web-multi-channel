# Deployment Guide

This guide covers deploying the WhatsApp Web Multi-Channel Platform to production.

## Prerequisites

- Supabase account with a production project
- Vercel account (recommended) or other hosting platform
- Whapi.cloud account with API tokens for each WhatsApp channel
- Domain name (optional but recommended)

## Supabase Setup

### 1. Create Production Project

1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Create a new project in your preferred region
3. Note down the project URL and keys

### 2. Configure Authentication

1. Go to **Authentication > Providers**
2. Enable **Email** provider
3. Configure **Email Templates** for magic links
4. (Optional) Enable **Google OAuth** for social login

### 3. Apply Database Migrations

Option A: Using Supabase CLI

```bash
# Install Supabase CLI
npm install -g supabase

# Login
supabase login

# Link to your project
supabase link --project-ref your-project-ref

# Push migrations
supabase db push
```

Option B: Manual SQL

1. Go to **SQL Editor** in Supabase Dashboard
2. Run each migration file in order:
   - `001_schema.sql`
   - `002_chat_helpers.sql`
   - `003_outbox_helpers.sql`

### 4. Enable Realtime

1. Go to **Database > Replication**
2. Enable replication for:
   - `messages` table
   - `chats` table
   - `channels` table

### 5. Configure Row Level Security

Ensure all RLS policies are enabled (migrations should handle this).

Verify in **Database > Tables > [table] > Policies**.

## Vercel Deployment

### 1. Connect Repository

1. Push code to GitHub
2. Go to [Vercel Dashboard](https://vercel.com/dashboard)
3. Click **Add New > Project**
4. Import your GitHub repository

### 2. Configure Environment Variables

Add the following environment variables in Vercel:

| Variable | Value | Notes |
|----------|-------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://xxx.supabase.co` | From Supabase settings |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJ...` | Public anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Service role key (keep secret!) |
| `ENCRYPTION_KEY` | Random 32+ char string | Generate: `openssl rand -hex 32` |
| `CRON_SECRET` | Random string | For authenticating cron jobs |

### 3. Configure Build Settings

Vercel should auto-detect Next.js settings:

- Framework Preset: **Next.js**
- Build Command: `npm run build`
- Output Directory: `.next`
- Install Command: `npm install`

### 4. Deploy

1. Click **Deploy**
2. Wait for build to complete
3. Access your deployment at the provided URL

### 5. Set Up Cron Jobs

Create `vercel.json` in project root:

```json
{
  "crons": [
    {
      "path": "/api/cron/process-outbox",
      "schedule": "* * * * *"
    }
  ]
}
```

Vercel Cron will automatically call this endpoint every minute.

**Note**: Vercel Cron requires a Pro plan. For free tier, use an external cron service.

## Alternative Cron Setup (Free Tier)

### Using cron-job.org

1. Sign up at [cron-job.org](https://cron-job.org)
2. Create a new cron job:
   - URL: `https://your-domain.vercel.app/api/cron/process-outbox`
   - Schedule: Every 1 minute
   - Request Method: GET
   - Headers: `Authorization: Bearer YOUR_CRON_SECRET`

### Using GitHub Actions

Create `.github/workflows/cron.yml`:

```yaml
name: Process Outbox

on:
  schedule:
    - cron: '* * * * *'  # Every minute

jobs:
  process:
    runs-on: ubuntu-latest
    steps:
      - name: Call outbox endpoint
        run: |
          curl -X GET \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            https://your-domain.vercel.app/api/cron/process-outbox
```

**Note**: GitHub Actions minimum cron interval is 5 minutes.

## Whapi.cloud Setup

### 1. Create Channel Instances

1. Log in to [Whapi.cloud](https://whapi.cloud)
2. Create a new channel instance for each WhatsApp number
3. Link your WhatsApp Business account by scanning QR code
4. Note the API token for each channel

### 2. Configure Webhooks

For each channel in Whapi.cloud:

1. Go to channel settings
2. Set webhook URL: `https://your-domain.vercel.app/api/webhooks/whapi/CHANNEL_ID`
3. Enable events:
   - Messages (incoming/outgoing)
   - Message status updates
   - Message edits
   - Message deletions

### 3. Add Channels in App

1. Log in to your deployed app as admin
2. Go to Settings > Channels
3. Click "Add Channel"
4. Enter:
   - Display name
   - Phone number
   - Whapi API token (will be encrypted)
5. Save channel

## Domain Configuration

### Custom Domain in Vercel

1. Go to Project Settings > Domains
2. Add your domain
3. Configure DNS:
   - Type: CNAME
   - Name: @ or www
   - Value: cname.vercel-dns.com

### SSL Certificate

Vercel automatically provisions SSL certificates.

### Supabase Custom Domain (Optional)

For production, consider using Supabase custom domains:

1. Go to Project Settings > General
2. Enable custom domain
3. Configure DNS as instructed

## Production Checklist

### Security

- [ ] All environment variables set correctly
- [ ] `ENCRYPTION_KEY` is unique and secure (32+ chars)
- [ ] `CRON_SECRET` is unique and secure
- [ ] Service role key is not exposed in client code
- [ ] RLS policies are enabled on all tables
- [ ] Webhook endpoints validate channel ownership

### Database

- [ ] All migrations applied
- [ ] Realtime enabled for required tables
- [ ] Indexes created for performance
- [ ] Connection pooling configured (Supabase handles this)

### Monitoring

- [ ] Error tracking set up (e.g., Sentry)
- [ ] Logging configured
- [ ] Uptime monitoring (e.g., Better Uptime)

### Performance

- [ ] Image optimization enabled (Next.js default)
- [ ] Edge functions enabled where applicable
- [ ] Database in same region as deployment

## Troubleshooting

### Messages Not Sending

1. Check outbox queue: `SELECT * FROM outbox_messages WHERE status != 'sent' LIMIT 10;`
2. Verify cron job is running
3. Check Whapi API token is valid
4. Review error messages in `last_error` field

### Webhooks Not Receiving

1. Verify webhook URL is correct in Whapi dashboard
2. Check channel exists in database
3. Review Vercel function logs
4. Test webhook manually with curl

### Realtime Not Working

1. Check Supabase Realtime is enabled for tables
2. Verify client subscriptions are set up correctly
3. Check browser console for WebSocket errors
4. Ensure auth token is valid

### Authentication Issues

1. Verify Supabase Auth is configured
2. Check email templates for magic links
3. Review auth callback URL settings
4. Check browser cookies are enabled

## Scaling Considerations

### Database

- Supabase automatically scales PostgreSQL
- Consider connection pooling for high traffic
- Monitor query performance in Supabase Dashboard

### Vercel Functions

- Functions auto-scale by default
- Consider Edge Functions for latency-sensitive routes
- Monitor function invocation counts

### Rate Limits

- Whapi.cloud has rate limits per channel
- Implement backoff in outbox processor
- Consider queuing during high-volume periods

## Backup & Recovery

### Database Backups

Supabase provides automatic backups:
- Daily backups retained for 7 days (Pro plan)
- Point-in-time recovery available

### Environment Variables

Store environment variables securely:
- Use Vercel's encrypted environment variables
- Keep a secure backup of ENCRYPTION_KEY
- Document all secrets in a password manager
