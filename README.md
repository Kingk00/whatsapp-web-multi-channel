# WhatsApp Web Multi-Channel Platform

A WhatsApp Web-like application that supports 2-50 WhatsApp Business channels under one workspace, with features including channel toggling, unified inbox, split view (up to 4 panes), slash commands for quick replies, and future Google Contacts integration.

## Features

- **Multi-Channel Support**: Connect and manage 2-50 WhatsApp Business channels
- **Unified Inbox**: View all conversations across channels in one place
- **Channel Switching**: Toggle between individual channels or unified view
- **Real-time Messaging**: Instant message delivery and status updates
- **WhatsApp Web UI**: Familiar interface with chat list, message view, and composer
- **Team Collaboration**: Role-based access control (Admin, Member roles)
- **Message Queue**: Reliable outbox pattern with retry logic
- **Webhook Integration**: Receive real-time updates from WhatsApp via Whapi.cloud

## Tech Stack

- **Frontend**: Next.js 14+ (App Router), React 18, TypeScript
- **UI**: Tailwind CSS, shadcn/ui components, Radix UI primitives
- **Backend**: Next.js API Routes (serverless)
- **Database**: Supabase (PostgreSQL)
- **Auth**: Supabase Auth with magic links
- **State Management**: Zustand (UI state), React Query (server state)
- **Real-time**: Supabase Realtime subscriptions
- **WhatsApp API**: Whapi.cloud (linked-device API)

## Prerequisites

- Node.js 18+
- npm or pnpm
- Supabase account and project
- Whapi.cloud account with API token(s)

## Getting Started

### 1. Clone and Install

```bash
git clone <repository-url>
cd whatsapp-web
npm install
```

### 2. Environment Setup

Copy the example environment file and configure:

```bash
cp .env.example .env.local
```

Required environment variables:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Encryption (32+ characters for AES-256)
ENCRYPTION_KEY=your-secret-encryption-key-32chars

# Cron Secret (for protected cron endpoints)
CRON_SECRET=your-cron-secret
```

### 3. Database Setup

Apply migrations to your Supabase project:

```bash
# Using Supabase CLI
supabase db push

# Or apply migrations manually via Supabase Dashboard
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the application.

## Project Structure

```
.
├── app/                    # Next.js App Router pages and API routes
│   ├── api/               # API endpoints
│   │   ├── chats/        # Chat CRUD operations
│   │   ├── channels/     # Channel management
│   │   ├── cron/         # Scheduled jobs (outbox processor)
│   │   └── webhooks/     # Whapi webhook handlers
│   ├── inbox/            # Main inbox page
│   ├── login/            # Authentication pages
│   └── settings/         # Settings and channel management
├── components/            # React components
│   ├── ui/               # shadcn/ui base components
│   ├── chat-list.tsx     # Conversation list
│   ├── chat-view.tsx     # Message view with composer
│   └── ...
├── hooks/                 # Custom React hooks
├── lib/                   # Utilities and clients
│   ├── supabase/         # Supabase client factories
│   ├── encryption.ts     # Token encryption utilities
│   ├── whapi-client.ts   # Whapi API wrapper
│   └── webhook-processor.ts
├── store/                 # Zustand stores
├── supabase/             # Database migrations
├── __tests__/            # Unit and integration tests
└── e2e/                  # Playwright E2E tests
```

## Key Concepts

### Message Flow

1. **Outbound Messages**:
   - User sends message via UI
   - Message added to `messages` table (status: `pending`)
   - Entry created in `outbox_messages` queue
   - Cron job processes queue, sends via Whapi
   - Status updated to `sent` on success

2. **Inbound Messages**:
   - Whapi sends webhook to `/api/webhooks/whapi/[channelId]`
   - Webhook processor validates and processes event
   - Message upserted using `(channel_id, wa_message_id)` for idempotency
   - Chat updated with last message info
   - Realtime subscription triggers UI update

### Idempotency

Webhook deduplication uses composite key `(channel_id, wa_message_id)` NOT `event.id`. This ensures:
- Duplicate webhooks don't create duplicate messages
- Messages can be safely reprocessed
- Status updates are properly applied

### Security

- All API tokens encrypted at rest using AES-256-GCM
- Row Level Security (RLS) enforces workspace isolation
- Service role client used only for webhook processing
- Webhook endpoints verify channel ownership

## Scripts

```bash
# Development
npm run dev          # Start dev server

# Building
npm run build        # Production build
npm run start        # Start production server

# Testing
npm run test         # Run unit tests
npm run test:integration  # Run integration tests
npm run test:e2e     # Run E2E tests with Playwright

# Linting
npm run lint         # Run ESLint
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | Yes |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Yes |
| `ENCRYPTION_KEY` | 32+ char key for token encryption | Yes |
| `CRON_SECRET` | Secret for authenticating cron requests | Yes |

## Deployment

### Vercel (Recommended)

1. Push to GitHub
2. Import project in Vercel
3. Configure environment variables
4. Deploy

### Cron Jobs

Set up Vercel Cron or external scheduler to call:
- `GET /api/cron/process-outbox` every 1 minute

Include `Authorization: Bearer ${CRON_SECRET}` header.

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is private and proprietary.
