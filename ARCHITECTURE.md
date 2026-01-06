# Architecture Overview

This document describes the technical architecture of the WhatsApp Web Multi-Channel Platform.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Client (Browser)                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Next.js   │  │   Zustand   │  │ React Query │  │ Supabase Realtime  │ │
│  │   App       │  │   (UI State)│  │(Server State│  │   (Subscriptions)  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Next.js API Routes                                  │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────────────────┐ │
│  │  /api/chats    │  │ /api/channels  │  │  /api/webhooks/whapi/[id]     │ │
│  │  /api/messages │  │ /api/auth      │  │  /api/cron/process-outbox     │ │
│  └────────────────┘  └────────────────┘  └────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
          ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
          │    Supabase     │ │   Whapi.cloud   │ │  Vercel Cron    │
          │   (PostgreSQL)  │ │   (WhatsApp)    │ │   (Scheduler)   │
          └─────────────────┘ └─────────────────┘ └─────────────────┘
```

## Data Model

### Core Entities

```
┌────────────────┐       ┌────────────────┐       ┌────────────────┐
│   Workspaces   │───────│    Channels    │───────│     Chats      │
│                │ 1:N   │                │ 1:N   │                │
│ id             │       │ id             │       │ id             │
│ name           │       │ workspace_id   │       │ channel_id     │
│ created_at     │       │ phone_number   │       │ wa_chat_id     │
└────────────────┘       │ display_name   │       │ contact_name   │
        │                │ status         │       │ last_message   │
        │ 1:N            └────────────────┘       └────────────────┘
        ▼                        │                       │
┌────────────────┐               │ 1:N                   │ 1:N
│ Workspace      │               ▼                       ▼
│ Members        │       ┌────────────────┐       ┌────────────────┐
│                │       │ Channel Tokens │       │   Messages     │
│ id             │       │                │       │                │
│ workspace_id   │       │ channel_id     │       │ chat_id        │
│ user_id        │       │ encrypted_token│       │ wa_message_id  │
│ role           │       │ token_type     │       │ direction      │
└────────────────┘       └────────────────┘       │ text           │
                                                  │ status         │
                                                  └────────────────┘
```

### Outbox Pattern

```
┌────────────────────────────────────────────────────────────────────┐
│                        Outbox Messages                              │
│                                                                     │
│  id          │ UUID primary key                                    │
│  channel_id  │ Foreign key to channels                             │
│  chat_id     │ Foreign key to chats                                │
│  message_type│ text, image, video, document, audio                 │
│  payload     │ JSONB with message content                          │
│  status      │ queued → sending → sent | failed | paused           │
│  attempts    │ Retry counter                                       │
│  max_attempts│ Maximum retries (default: 5)                        │
│  priority    │ Higher = processed first                            │
│  next_attempt│ When to retry failed messages                       │
│  last_error  │ Error message from last attempt                     │
└────────────────────────────────────────────────────────────────────┘
```

## Message Flow

### Outbound Message Flow

```
User types message
        │
        ▼
┌───────────────────┐
│ POST /api/chats/  │
│ [id]/messages     │
└───────────────────┘
        │
        ├──────────────────────────────────────┐
        ▼                                      ▼
┌───────────────────┐               ┌───────────────────┐
│ Insert into       │               │ Insert into       │
│ messages table    │               │ outbox_messages   │
│ (status: pending) │               │ (status: queued)  │
└───────────────────┘               └───────────────────┘
        │                                      │
        │                                      │
        ▼                                      ▼
┌───────────────────┐               ┌───────────────────┐
│ Return to client  │               │ Cron picks up     │
│ (optimistic UI)   │               │ via get_pending   │
└───────────────────┘               │ _outbox_messages  │
                                    └───────────────────┘
                                            │
                                            ▼
                                    ┌───────────────────┐
                                    │ Send via Whapi    │
                                    │ API               │
                                    └───────────────────┘
                                            │
                            ┌───────────────┴───────────────┐
                            ▼                               ▼
                    ┌───────────────┐               ┌───────────────┐
                    │ Success:      │               │ Failure:      │
                    │ Update status │               │ Retry with    │
                    │ to 'sent'     │               │ exp backoff   │
                    └───────────────┘               └───────────────┘
```

### Inbound Message Flow

```
WhatsApp receives message
        │
        ▼
┌───────────────────────────┐
│ Whapi.cloud webhook       │
│ POST /api/webhooks/whapi/ │
│ [channelId]               │
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│ Validate channel exists   │
│ (verify ownership)        │
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│ processWebhookEvent()     │
│ - Route by event type     │
│ - Extract message data    │
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│ getOrCreateChat()         │
│ - Find existing chat      │
│ - Or create new chat      │
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│ Upsert message            │
│ ON CONFLICT               │
│ (channel_id, wa_message_id)│
│ DO UPDATE                 │
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│ Supabase Realtime         │
│ notifies subscribed       │
│ clients                   │
└───────────────────────────┘
        │
        ▼
┌───────────────────────────┐
│ React Query invalidates   │
│ cache, UI updates         │
└───────────────────────────┘
```

## State Management

### Client State Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Client State                                 │
│                                                                     │
│  ┌─────────────────────────────┐  ┌─────────────────────────────┐  │
│  │         Zustand             │  │       React Query           │  │
│  │       (UI State)            │  │     (Server State)          │  │
│  │                             │  │                             │  │
│  │ • Selected chat ID          │  │ • Chats list                │  │
│  │ • Selected channel ID       │  │ • Messages by chat          │  │
│  │ • Draft messages            │  │ • Channels list             │  │
│  │ • UI preferences            │  │ • User profile              │  │
│  │ • Pane configuration        │  │                             │  │
│  │ • Online/reconnecting state │  │ • Auto-refetch on focus     │  │
│  │                             │  │ • Stale time: 30 seconds    │  │
│  │ Persisted to localStorage   │  │ • Realtime invalidation     │  │
│  └─────────────────────────────┘  └─────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Query Keys

```typescript
queryKeys = {
  chats: {
    all: ['chats'],
    list: (channelId) => ['chats', 'list', channelId],
    detail: (id) => ['chats', 'detail', id],
  },
  messages: {
    all: ['messages'],
    list: (chatId) => ['messages', 'list', chatId],
  },
  channels: {
    all: ['channels'],
    list: ['channels', 'list'],
    detail: (id) => ['channels', 'detail', id],
  },
}
```

## Security Model

### Row Level Security (RLS)

```sql
-- Users can only see workspaces they belong to
CREATE POLICY "workspace_member_access" ON workspaces
  FOR SELECT USING (
    id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

-- Users can only see channels in their workspaces
CREATE POLICY "channel_workspace_access" ON channels
  FOR SELECT USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid()
    )
  );

-- Admin-only operations
CREATE POLICY "admin_channel_manage" ON channels
  FOR ALL USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );
```

### Token Encryption

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Token Encryption Flow                             │
│                                                                     │
│  Plaintext Token ──► PBKDF2 Key Derivation ──► AES-256-GCM ──► DB  │
│                      (100,000 iterations)                           │
│                                                                     │
│  Stored format: salt:iv:authTag:encryptedData                       │
│                 (all hex encoded)                                   │
│                                                                     │
│  Decryption requires ENCRYPTION_KEY environment variable            │
└─────────────────────────────────────────────────────────────────────┘
```

## Webhook Processing

### Idempotency Strategy

**CRITICAL**: Message deduplication uses `(channel_id, wa_message_id)`, NOT `event.id`.

```sql
-- Unique constraint for idempotent upserts
ALTER TABLE messages
  ADD CONSTRAINT messages_channel_wa_unique
  UNIQUE (channel_id, wa_message_id);
```

```typescript
// Upsert operation
await supabase
  .from('messages')
  .upsert(messageRecord, {
    onConflict: 'channel_id,wa_message_id',
    ignoreDuplicates: false, // Update on conflict
  })
```

### Event Type Routing

| Event Type | Handler | Action |
|------------|---------|--------|
| `message` / `messages` | `processMessageEvent` | Upsert message |
| `message.status` / `ack` | `processStatusEvent` | Update delivery status |
| `message.edit` | `processEditEvent` | Update message text |
| `message.revoked` / `delete` | `processDeleteEvent` | Soft delete |
| `chat` | `processChatEvent` | Update chat metadata |
| `channel.status` | `processChannelStatusEvent` | Update channel status |

## Outbox Processing

### Retry Strategy

```
Attempt 1: Immediate
Attempt 2: 1 minute delay
Attempt 3: 2 minute delay
Attempt 4: 4 minute delay
Attempt 5: 8 minute delay
Attempt 6+: 16 minute delay (capped)
```

### Rate Limit Handling

On HTTP 429:
1. Pause all outbox messages for the channel
2. Update channel status to `degraded`
3. Wait for Retry-After header duration
4. Resume processing

## Realtime Architecture

### Subscription Channels

```typescript
// Chat messages subscription
supabase.channel(`chat:${chatId}`)
  .on('postgres_changes', {
    event: 'INSERT',
    table: 'messages',
    filter: `chat_id=eq.${chatId}`
  }, handleNewMessage)
  .subscribe()

// Inbox updates subscription
supabase.channel('inbox')
  .on('postgres_changes', {
    event: '*',
    table: 'chats',
    filter: `channel_id=in.(${channelIds})`
  }, handleChatUpdate)
  .subscribe()
```

### Reconnection Strategy

1. Monitor connection status
2. On disconnect: start reconnection timer
3. Exponential backoff with jitter
4. Max 10 reconnection attempts
5. Re-subscribe to all channels on reconnect
6. Show connection banner to user

## Performance Considerations

### Database Indexes

```sql
-- Optimize message queries
CREATE INDEX messages_chat_created_idx
  ON messages (chat_id, created_at DESC);

-- Optimize outbox processing
CREATE INDEX outbox_pending_priority_idx
  ON outbox_messages (priority DESC, created_at ASC)
  WHERE status = 'queued';

-- Optimize chat list
CREATE INDEX chats_channel_updated_idx
  ON chats (channel_id, last_message_at DESC);
```

### Caching Strategy

- React Query caches server state
- Stale time: 30 seconds for chat list
- Stale time: 5 minutes for messages
- Realtime invalidates on changes
- Local storage persists UI state
