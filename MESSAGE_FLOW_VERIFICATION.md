# Message Flow Verification Checklist

This document verifies the end-to-end message flow implementation for the WhatsApp Web Multi-Channel Platform.

## Components Overview

### Core Files Verified

| Category | File | Status |
|----------|------|--------|
| **API Routes** |
| Chats List | `app/api/chats/route.ts` | ✅ |
| Messages CRUD | `app/api/chats/[id]/messages/route.ts` | ✅ |
| Webhook Handler | `app/api/webhooks/whapi/[channelId]/route.ts` | ✅ |
| Outbox Processor | `app/api/cron/process-outbox/route.ts` | ✅ |
| Channel Health | `app/api/cron/channel-health/route.ts` | ✅ |
| Channels CRUD | `app/api/channels/route.ts` | ✅ |
| **Library Functions** |
| Webhook Processor | `lib/webhook-processor.ts` | ✅ |
| Whapi Client | `lib/whapi-client.ts` | ✅ |
| Chat Helpers | `lib/chat-helpers.ts` | ✅ |
| Encryption | `lib/encryption.ts` | ✅ |
| Date Utils | `lib/date-utils.ts` | ✅ |
| **Components** |
| Chat List | `components/chat-list.tsx` | ✅ |
| Chat View | `components/chat-view.tsx` | ✅ |
| Channel Selector | `components/channel-selector.tsx` | ✅ |
| Connection Banner | `components/connection-banner.tsx` | ✅ |
| Error Boundary | `components/error-boundary.tsx` | ✅ |
| Loading Skeletons | `components/loading-skeletons.tsx` | ✅ |
| **Hooks** |
| Auth Hook | `hooks/use-auth.ts` | ✅ |
| Realtime Hook | `hooks/use-realtime.ts` | ✅ |
| **State** |
| UI Store | `store/ui-store.ts` | ✅ |
| Query Client | `lib/query-client.tsx` | ✅ |

## Outbound Message Flow Verification

### Step 1: User Sends Message
- [ ] User types in `MessageComposer` component in `chat-view.tsx`
- [ ] Draft saved to Zustand store (`store/ui-store.ts`)
- [ ] Submit triggers `POST /api/chats/[id]/messages`

### Step 2: API Creates Records
- [ ] API validates authentication via `use-auth.ts`
- [ ] Chat lookup verifies user has access
- [ ] Message inserted to `messages` table (status: `pending`)
- [ ] Outbox entry created in `outbox_messages` table (status: `queued`)
- [ ] Response returned with optimistic message data

### Step 3: UI Updates Optimistically
- [ ] React Query adds message to cache
- [ ] Chat list updated with new last message
- [ ] Message appears in chat view with pending indicator

### Step 4: Cron Processes Outbox
- [ ] `/api/cron/process-outbox` called every minute
- [ ] `get_pending_outbox_messages()` uses FOR UPDATE SKIP LOCKED
- [ ] Messages status changed to `sending`
- [ ] Whapi token decrypted from `channel_tokens`
- [ ] `WhapiClient.sendText()` called

### Step 5: Send Success
- [ ] Whapi returns message ID
- [ ] Outbox status updated to `sent`
- [ ] Message status updated to `sent`
- [ ] `wa_message_id` stored for deduplication

### Step 6: Send Failure (Retry)
- [ ] Error caught in `processMessage()`
- [ ] If retryable: calculate exponential backoff
- [ ] Status set back to `queued` with new `next_attempt_at`
- [ ] After max attempts: status set to `failed`

### Step 7: Rate Limit (429)
- [ ] `isRateLimitError()` detects 429
- [ ] Channel status set to `degraded`
- [ ] All queued messages for channel set to `paused`
- [ ] Admin notified to resume manually

## Inbound Message Flow Verification

### Step 1: Webhook Received
- [ ] Whapi sends POST to `/api/webhooks/whapi/[channelId]`
- [ ] Channel ID extracted from URL
- [ ] Channel existence verified in database

### Step 2: Event Processing
- [ ] `processWebhookEvent()` routes by event type
- [ ] Message events → `processMessageEvent()`
- [ ] Status events → `processStatusEvent()`
- [ ] Edit events → `processEditEvent()`
- [ ] Delete events → `processDeleteEvent()`

### Step 3: Message Deduplication
- [ ] `wa_message_id` extracted from payload
- [ ] Upsert uses `ON CONFLICT (channel_id, wa_message_id)`
- [ ] Duplicate webhooks update existing record
- [ ] **NOT using event.id** - per spec requirement

### Step 4: Chat Management
- [ ] `getOrCreateChat()` finds or creates chat
- [ ] Chat `last_message_text` updated
- [ ] Chat `last_message_at` updated
- [ ] Inbound: `unread_count` incremented

### Step 5: Realtime Broadcast
- [ ] Supabase triggers realtime on INSERT/UPDATE
- [ ] Subscribed clients receive notification
- [ ] React Query invalidates relevant cache

### Step 6: UI Updates
- [ ] `useChatRealtime` hook receives new message
- [ ] Message added to local state
- [ ] Chat list re-sorts by last message time
- [ ] Unread badge updates

## Status Update Flow Verification

### Progression: pending → sent → delivered → read
- [ ] Status only progresses forward
- [ ] `mapWhapiStatus()` handles numeric (0-4) and string values
- [ ] Only outbound messages have status

| Whapi Status | Mapped Status |
|--------------|---------------|
| 0 / "pending" / "clock" | `pending` |
| 1 / "sent" / "server" | `sent` |
| 2 / "delivered" / "device" | `delivered` |
| 3 / "read" / "seen" / "played" | `read` |
| "failed" / "error" | `failed` |

## Connection Status Verification

### Browser Online/Offline
- [ ] `ConnectionBanner` monitors `navigator.onLine`
- [ ] Shows "No internet connection" when offline
- [ ] Shows "Connected" briefly when back online

### Supabase Realtime
- [ ] `useConnectionStatus` monitors WebSocket
- [ ] Auto-reconnect with exponential backoff
- [ ] Max 10 reconnection attempts
- [ ] Shows "Reconnecting (attempt X)..." during retry

### Re-subscription
- [ ] On reconnect, all channels re-subscribed
- [ ] Missed messages fetched via API refresh
- [ ] React Query re-validates stale data

## Security Verification

### Authentication
- [ ] All API routes check `supabase.auth.getUser()`
- [ ] Unauthorized returns 401
- [ ] Session token in cookies/headers

### Authorization
- [ ] RLS policies enforce workspace isolation
- [ ] Users only see their workspace data
- [ ] Admin actions check role in `workspace_members`

### Token Encryption
- [ ] Whapi tokens encrypted with AES-256-GCM
- [ ] PBKDF2 key derivation (100,000 iterations)
- [ ] Unique salt and IV per encryption
- [ ] Auth tag prevents tampering

### Webhook Security
- [ ] Channel ID from URL must exist in database
- [ ] Channel must belong to valid workspace
- [ ] Service role client for database writes

## Test Coverage

### Unit Tests
- [x] `__tests__/lib/encryption.test.ts`
- [x] `__tests__/lib/date-utils.test.ts`
- [x] `__tests__/lib/whapi-client.test.ts`
- [x] `__tests__/lib/webhook-processor.test.ts`

### Integration Tests
- [x] `__tests__/integration/api/chats.test.ts`
- [x] `__tests__/integration/api/messages.test.ts`
- [x] `__tests__/integration/api/webhooks.test.ts`

### E2E Tests
- [x] `e2e/auth.spec.ts`
- [x] `e2e/inbox.spec.ts`
- [x] `e2e/settings.spec.ts`

## Database Schema Verification

### Required Tables
- [ ] `workspaces`
- [ ] `workspace_members`
- [ ] `channels`
- [ ] `channel_tokens`
- [ ] `chats`
- [ ] `messages`
- [ ] `outbox_messages`

### Required Indexes
- [ ] `messages_channel_wa_unique` (channel_id, wa_message_id)
- [ ] `outbox_messages_pending_priority_idx`
- [ ] `chats_channel_updated_idx`

### Required Functions
- [ ] `get_pending_outbox_messages(batch_size)`
- [ ] `resume_channel_messages(channel_uuid)`
- [ ] `get_channel_outbox_stats(channel_uuid)`
- [ ] `cleanup_old_outbox_messages(older_than_days)`
- [ ] `increment_chat_unread(chat_uuid)`
- [ ] `reset_chat_unread(chat_uuid)`

## Final Verification Checklist

Before marking complete:

1. [ ] All API endpoints respond correctly
2. [ ] Messages flow in both directions
3. [ ] Status updates propagate
4. [ ] Realtime subscriptions work
5. [ ] Error handling works (retry, rate limit)
6. [ ] UI shows loading/error states
7. [ ] Connection status banner works
8. [ ] Authentication enforced
9. [ ] Tests pass locally

## Manual Testing Steps

1. **Setup**
   - Start dev server: `npm run dev`
   - Ensure Supabase is running
   - Configure at least one test channel

2. **Test Outbound**
   - Login as admin
   - Select a chat
   - Send a message
   - Verify appears with pending indicator
   - Check outbox table has entry
   - Trigger cron manually or wait
   - Verify status updates to sent

3. **Test Inbound**
   - Send WhatsApp message to linked number
   - Webhook should trigger
   - Message appears in inbox
   - Unread count updates
   - Chat sorts to top

4. **Test Reconnection**
   - Open inbox
   - Disconnect network (browser DevTools)
   - Verify "No internet" banner
   - Reconnect network
   - Verify "Connected" shows briefly
   - Send/receive messages work

5. **Test Error States**
   - Remove API token from channel
   - Send message
   - Verify retry logic
   - Check failed status after max attempts
