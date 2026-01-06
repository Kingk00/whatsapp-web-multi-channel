# WhatsApp Web Platform — Complete Product & Engineering Specification

> **Goal**: Build a WhatsApp-Web-like application supporting **2–50 WhatsApp Business channels** under one workspace. Features include channel toggling, **Unified Inbox**, **split view (up to 4 panes)**, **slash commands** for quick replies, and **Google Contacts integration**. The system must make it impossible for agents to accidentally reply from the wrong channel.

---

## 1) Glossary

| Term | Definition |
|------|------------|
| **Workspace** | One company/team using the system. Multi-tenant by design for future commercialization. |
| **Channel** | One connected WhatsApp Business account (phone number) via Whapi linked-device session. |
| **Chat** | A conversation thread inside a specific channel (1:1 contact or group). |
| **Pane** | One column in split view. Users can have 1–4 panes visible simultaneously. |
| **Unified Inbox** | Combined chat list across all accessible channels. Each chat still belongs to exactly one channel. |
| **Quick Reply** | Pre-configured response triggered via slash command (e.g., `/a`, `/hours`). Can include text and/or media. |

---

## 2) Non-Negotiable Product Rules

### 2.1 Channel Clarity (Anti-Mistake UX)

The UI must **always** show clearly:

- Which channel the user is viewing (chat list scope)
- Which channel the user is replying as (composer + header)
- In Unified Inbox: which channel each chat belongs to

**Required UI Signals (redundant by design):**

| Location | Signal |
|----------|--------|
| Chat header | `Replying as: Channel Name (+phone)` with channel color indicator |
| Composer | `Sending as: Channel Name` + channel avatar/badge |
| Unified chat list | Channel badge on each row with distinct color |
| Message bubble (Unified only) | Small "Sent from Channel X" footer on outbound messages |
| Pane header | Channel name + colored border/accent |

**Color System**: Each channel gets assigned a distinct color from a predefined palette. This color appears consistently across all UI elements for that channel.

### 2.2 Permission Model

- **Main Admin**: Full access to everything across the workspace
- **Admin**: Can manage channels, users, groups, quick replies (configurable per permission)
- **Agent**: Can respond within channels they have access to
- **Viewer** (optional): Read-only access to assigned channels

**Access Rules** (strictly enforced):

A user can access a channel if ANY of these conditions is true:
1. User is Main Admin, OR
2. User is in a group that has the channel assigned, OR
3. User has direct user-channel access granted

Users with no access to a channel cannot see it at all—no chats, no messages, no mention of its existence.

### 2.3 Split View (Up to 4 Panes)

Users can divide the interface into **1–4 panes**. Each pane:

- Can be pinned to one channel OR set to Unified Inbox
- Shows its own chat list + active chat
- Functions like a mini WhatsApp Web instance
- Has independent scroll position, selected chat, and draft state

---

## 3) Architecture Overview

### 3.1 Stack Selection Rationale

| Layer | Technology | Reason |
|-------|------------|--------|
| Frontend | Next.js 14+ (App Router) + TypeScript | Best Vercel integration, RSC for performance |
| Styling | Tailwind CSS + shadcn/ui | Rapid development, consistent design system |
| State | Zustand + React Query | Lightweight, excellent for real-time sync |
| Backend | Next.js Route Handlers (Vercel) | Serverless, scales automatically |
| Database | Supabase Postgres | RLS for security, excellent DX |
| Auth | Supabase Auth | JWT-based, integrates with RLS |
| Realtime | Supabase Realtime | Postgres Changes, Presence, Broadcast |
| Storage | Supabase Storage | Media files with 90-day retention |
| WhatsApp | Whapi.cloud | Linked-device API, webhook-based |

### 3.2 Why Supabase Realtime Over Alternatives

Vercel Functions are stateless and can't maintain persistent WebSocket connections. Vercel recommends using dedicated realtime providers. Supabase Realtime provides:

- **Postgres Changes**: Automatic updates when database rows change
- **Presence**: Track who's viewing/typing in each chat
- **Broadcast**: Ephemeral events (typing indicators) without database writes

---

## 4) Whapi Integration Constraints

### 4.1 Critical Limitations to Design Around

| Constraint | Implication | Solution |
|------------|-------------|----------|
| **Linked device limit**: 4 devices per WhatsApp Business | Connection may fail if limit reached | Show troubleshooting hint in UI |
| **No message queue**: Whapi sends immediately, doesn't retry | You must build your own outbox + retry logic | `outbox_messages` table + worker |
| **30-day media retention**: Files deleted after 30 days | Download and store media yourself | Supabase Storage with 90-day retention |
| **SYNC_ERROR mode**: GET endpoints fail, webhooks still work | Webhooks + your DB must be source of truth | Display channel health status to admins |
| **Webhook security**: Supports custom headers | Verify webhooks are actually from Whapi | Per-channel secret token verification |

### 4.2 WhatsApp Business Rules

| Rule | Detail |
|------|--------|
| **View Once media** | User can send/receive view-once photos and videos. Must handle specially in UI (show once, then mark as viewed). |
| **Inbound message editing** | WhatsApp supports edit within 15 minutes. Reflect edits from customers in your UI. |
| **Outbound message editing** | ⚠️ **NOT SUPPORTED** via linked-device APIs. Do not offer "Edit" for sent messages. |
| **Delete for everyone** | Supported for outbound messages. Show "This message was deleted" placeholder for deleted inbound. |

> **Future: Official WhatsApp API Compatibility**
> 
> If you later migrate to the official WhatsApp Business Platform (Meta Cloud API), you'll need to implement:
> - **24-hour messaging window**: Free-form messages only within 24 hours of customer's last message. After that, only approved message templates are allowed.
> - **Template management**: Pre-approved message templates for outbound initiation.
> 
> These rules do **not** apply to Whapi (linked-device API) in v1.

### 4.3 WhatsApp Groups (Optional Feature)

WhatsApp groups are atypical for Business accounts but some users may need them.

**Admin Toggle**: `workspace_settings.allow_whatsapp_groups` (default: false)

When enabled:
- Groups appear in chat list with group icon
- Show participant count and list
- Handle group-specific events (join, leave, admin changes)
- Respect group admin permissions for message deletion

---

## 5) Complete Feature Specification

### 5.1 Authentication & Session Management

**Auth Flow**:
1. Email/password OR magic link (Supabase Auth)
2. Invite-only registration (Admin sends invite)
3. JWT stored in httpOnly cookie
4. Session refresh handled automatically

**Offline & Reconnection Handling**:

| State | UI Behavior |
|-------|-------------|
| Disconnected | Yellow banner: "Reconnecting..." with spinner |
| Reconnecting | Auto-retry with exponential backoff (1s, 2s, 4s, 8s, max 30s) |
| Reconnected | Green banner: "Connected" (auto-dismiss after 3s) |
| State recovery | Restore: open chats, draft messages, scroll positions, selected pane |

**Implementation**: Store UI state in `localStorage` with workspace/user key. On reconnect, rehydrate from storage + fetch latest data.

### 5.2 Notification System

**Notification Triggers** (when user is NOT in that specific chat):

| Event | Notification |
|-------|-------------|
| New message in accessible channel | Toast (top-right) + sound + browser notification |
| New message in current channel, different chat | Unread badge on chat row + sound |
| New message in different channel | Channel unread count increases + sound |

**Notification Behavior**:

- **Sound**: Configurable per user (on/off/custom sound). Mute option per channel.
- **Browser notifications**: Request permission on first login. Show sender name + preview (truncated).
- **Toast**: Stack up to 3, auto-dismiss after 5s, click to open chat.
- **Clear logic**:
  - Channel unread clears when any chat in that channel is opened
  - Chat unread clears only when that specific chat is opened
  - Toast dismisses on click or timeout

**Do Not Disturb Mode**: User can enable DND which suppresses sounds and toasts but keeps badges.

### 5.3 Inbox Modes

#### Mode A: Single-Pane (WhatsApp Web Style)

```
┌─────────────────────────────────────────────────────────────┐
│ [Channel Selector ▾] [Search] [Settings]                    │
├──────────────┬──────────────────────────┬───────────────────┤
│ Chat List    │ Active Chat              │ Details Panel     │
│              │                          │ (collapsible)     │
│ • Chat 1     │ ┌──────────────────────┐ │                   │
│ • Chat 2     │ │ Messages             │ │ Contact Info      │
│ • Chat 3     │ │                      │ │ Internal Notes    │
│   ...        │ │                      │ │ Tags              │
│              │ └──────────────────────┘ │                   │
│              │ [Composer]               │                   │
└──────────────┴──────────────────────────┴───────────────────┘
```

#### Mode B: Split View (2–4 Panes)

```
┌─────────────────────────────────────────────────────────────┐
│ [Add Pane +] [Layout: 2|3|4]                    [Settings]  │
├─────────────────────────────┬───────────────────────────────┤
│ Pane 1: Support UK ▾        │ Pane 2: Unified Inbox ▾       │
│ ● Active  [3 unread]        │ ● Active  [12 unread]         │
├─────────────────────────────┼───────────────────────────────┤
│ Chat List    │ Active Chat  │ Chat List    │ Active Chat    │
│              │              │              │                │
│              │              │              │                │
│              │ [Composer]   │              │ [Composer]     │
└──────────────┴──────────────┴──────────────┴────────────────┘
```

**Pane Behavior**:

- Each pane has: dropdown (channel/unified), unread count, status dot
- Opening a chat "locks" it to its channel (can't switch channel while chat is open)
- Attempting to switch channel with open chat shows confirmation dialog
- Each pane maintains independent state (scroll, draft, selection)

> **Clarification**: Pane channel selection controls the **chat list scope**; individual chats always lock to their **owning channel** regardless of pane setting. A Unified Inbox pane shows chats from all channels, but when you open a chat, replies go through that chat's specific channel.

#### Unified Inbox Behavior

- Merges **chat lists**, not message threads
- Each chat shows channel badge
- Sorting: by `last_message_at` across all accessible channels
- Clicking a chat opens it in that pane, locked to its channel
- Search scopes to all accessible channels

### 5.4 Mobile & Tablet UX

**Responsive Breakpoints**:

| Breakpoint | Layout | Max Panes |
|------------|--------|-----------|
| Desktop XL (≥1440px) | Full split view support | 4 |
| Desktop (1200–1439px) | Split view with narrower panes | 3 |
| Desktop SM (1024–1199px) | Limited split view | 2 |
| Tablet (768–1023px) | Single pane with slide-over details | 1 |
| Mobile (<768px) | Single view with navigation stack | 1 |

> **Rationale**: 4 panes on small laptops creates unreadable UI. Enforce these limits automatically based on viewport width.

**Mobile Navigation Stack**:

```
[Channels] → [Chat List] → [Chat View] → [Details]
     ←            ←             ←
```

- Swipe gestures for navigation
- Pull-to-refresh on chat list
- Bottom navigation: Inbox, Channels, Settings
- FAB for quick actions (new chat, search)

**Mobile-Specific Features**:

- Haptic feedback on message send
- Share sheet integration for media
- Voice message recording with hold-to-record
- Keyboard-aware composer (adjusts for on-screen keyboard)

### 5.5 Collaboration Features

#### Presence ("Who's Here")

Show when another user:
- Is viewing the same chat
- Is typing a reply

**Implementation**:

```typescript
// Supabase Realtime Presence channel per chat
const channel = supabase.channel(`chat:${chatId}`)
  .on('presence', { event: 'sync' }, () => {
    const state = channel.presenceState()
    // Resolve user names from cached profile data client-side
    const activeUsers = Object.values(state).flat().map(p => ({
      ...p,
      displayName: profileCache.get(p.user_id)?.display_name
    }))
  })
  .subscribe(async (status) => {
    if (status === 'SUBSCRIBED') {
      await channel.track({
        user_id: currentUser.id,
        // ⚠️ Only broadcast user_id — resolve names client-side
        // This avoids PII exposure in Realtime logs/debug tools
        status: 'viewing' // or 'typing'
      })
    }
  })
```

> ⚠️ **Privacy**: Only broadcast `user_id` in presence state. Resolve display names and avatars client-side from cached profile data to avoid accidental PII exposure in logs.

#### Soft Reply Lock

When a user focuses the composer:

1. Set their presence state to `typing`
2. Other users see: "Sara is replying..." below the composer
3. If another user tries to type, show warning: "Sara is currently typing. Send anyway?"
4. **Do NOT hard block**—just warn

**Typing Indicator Throttling**: Broadcast `typing_start` on first keystroke, `typing_stop` after 3s of inactivity. Don't spam events.

#### Internal Notes

Per-chat notes visible only to team members:

- Displayed in right-side details panel
- Supports @mentions (notifies mentioned user)
- Markdown formatting
- Timestamps and author attribution

### 5.6 Quick Replies (Slash Commands)

#### Quick Reply Structure

```typescript
interface QuickReply {
  id: string
  workspace_id: string
  scope: 'global' | 'channel'
  channel_id: string | null  // null if global
  shortcut: string           // e.g., 'a', 'hours', 'promo1'
  title: string              // Human-readable label
  type: 'text' | 'media' | 'mixed'
  text_body: string | null
  attachments: QuickReplyAttachment[]
  created_by: string
  created_at: timestamp
  updated_at: timestamp
}

interface QuickReplyAttachment {
  id: string
  quick_reply_id: string
  kind: 'image' | 'video' | 'document' | 'audio'
  storage_path: string
  filename: string
  mime_type: string
  size_bytes: number
}
```

#### Resolution Priority

When user types `/a` in a chat belonging to Channel X:

1. Check for channel-specific quick reply with shortcut `a` for Channel X → use if found
2. Else check for global quick reply with shortcut `a` → use if found
3. Else show "No quick reply found for '/a'"

#### Composer UX

```
User types: /
→ Opens quick reply menu (filterable list)
→ Shows: shortcut, title, preview (text truncated, media thumbnails)

User types: /hou
→ Filters to matching shortcuts (e.g., 'hours')

User presses Enter or clicks:
→ Inserts text into composer (editable before send)
→ Adds attachment chips (removable before send)
→ Does NOT auto-send
```

#### Send Behavior

| Type | Behavior |
|------|----------|
| Text only | Send text message |
| Media only | Send each attachment as separate message |
| Mixed | Send text first, then attachments (configurable order in v2) |

### 5.7 Google Contacts Integration

#### OAuth Flow

1. Admin connects Google account in Settings → Integrations
2. Request `https://www.googleapis.com/auth/contacts.readonly` scope
3. Store refresh token encrypted in `workspace_integrations` table
4. Sync contacts on connect + periodic refresh (every 6 hours)

#### Contact Sync

```typescript
interface GoogleContact {
  resource_name: string      // Google's ID
  display_name: string
  phone_numbers: string[]    // Normalized E.164 format
  email_addresses: string[]
  photo_url: string | null
  synced_at: timestamp
}
```

**Phone Number Normalization**:

| Rule | Implementation |
|------|----------------|
| Library | Use `libphonenumber` (Google's official library) |
| Country fallback | Default to channel's phone number country code |
| Storage | Store both `raw` (as entered) and `normalized` (E.164) |
| Matching | Always match on normalized E.164 format |

```typescript
import { parsePhoneNumber } from 'libphonenumber-js'

function normalizePhone(raw: string, defaultCountry: string): string | null {
  try {
    const parsed = parsePhoneNumber(raw, defaultCountry)
    return parsed?.isValid() ? parsed.format('E.164') : null
  } catch {
    return null
  }
}
```

**Sync Logic**:

1. Fetch contacts from Google People API (paginated)
2. Normalize phone numbers to E.164 format
3. Upsert into `contacts` table
4. Match against existing chats by phone number
5. Update chat display names where matched

#### Contact Display

- In chat list: Show Google contact name if matched, else WhatsApp profile name
- In chat header: Show both names if different (e.g., "John Smith (WhatsApp: John S)")
- Contact card: Merge Google data + WhatsApp data

#### Privacy & Permissions

- **Consent scope**: Google OAuth consent is granted by an individual user, not a workspace. Be explicit about data sharing in your consent screen.
- **Visibility setting**: `workspace_settings.google_contacts_visibility`:
  - `workspace` — All workspace users see contacts (default only when connected by Main Admin)
  - `owner_only` — Only the user who connected sees their contacts
- Contacts are read-only (no write-back to Google)
- Individual users can connect their own Google account for personal contacts (uses `owner_only` visibility)

> ⚠️ **Commercial deployment**: If you go commercial, clearly disclose in OAuth consent screen that contacts may be shared with team members when `workspace` visibility is enabled.

### 5.8 Search

#### Search Scopes

| Scope | Description |
|-------|-------------|
| Chat list search | Filter chats by contact name, phone number |
| Message search | Full-text search across message content |
| Global search | Search across all accessible chats and messages |

#### Implementation (Postgres Full-Text Search)

```sql
-- Add tsvector column to messages
ALTER TABLE messages ADD COLUMN search_vector tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED;

CREATE INDEX messages_search_idx ON messages USING GIN(search_vector);

-- Search query
SELECT m.*, ts_rank(search_vector, query) as rank
FROM messages m, to_tsquery('english', 'hello & world') query
WHERE m.search_vector @@ query
  AND m.channel_id IN (/* user's accessible channels */)
ORDER BY rank DESC, created_at DESC
LIMIT 50;
```

#### Search UX

- Debounced input (300ms)
- Results grouped by chat with message previews
- Highlight matching terms
- Click result to open chat at that message (scroll to + highlight)

### 5.9 Audit Logging

Track security and compliance-relevant events:

```typescript
interface AuditLog {
  id: string
  workspace_id: string
  user_id: string
  action: AuditAction
  resource_type: 'channel' | 'chat' | 'message' | 'user' | 'group' | 'quick_reply'
  resource_id: string
  metadata: Record<string, any>  // Action-specific details
  ip_address: string
  user_agent: string
  created_at: timestamp
}

type AuditAction =
  // Messages (high value)
  | 'message.sent'
  | 'message.deleted'
  // Channels (security relevant)
  | 'channel.connected'
  | 'channel.disconnected'
  | 'channel.paused'
  | 'channel.resumed'
  // Users & Permissions (compliance)
  | 'user.invited'
  | 'user.removed'
  | 'user.role_changed'
  | 'permission.granted'
  | 'permission.revoked'
  // Quick replies (operational)
  | 'quick_reply.created'
  | 'quick_reply.updated'
  | 'quick_reply.deleted'
  // Data export (compliance)
  | 'export.requested'

// ⚠️ Intentionally EXCLUDED to avoid log explosion:
// - 'chat.viewed' (too high volume, low value)
// - 'message.read' (duplicates WhatsApp's own read receipts)
```

**Retention**: 1 year (configurable per workspace)

**Admin UI**: Filterable log viewer with export to CSV

---

## 6) Channel Management

### 6.1 V1 Flow: Customer Brings Whapi Token

#### Add Channel

1. Admin opens: Settings → Channels → "Add Channel"
2. Inputs:
   - Channel name (e.g., "Support UK")
   - Whapi API token (from their Whapi dashboard)
3. Backend:
   - Validates token with `GET /health`
   - Stores token encrypted (server-only, no client access)
   - Creates channel record with status `PENDING_QR`
4. UI shows QR code (fetched from `GET /users/login/image`)
5. Admin scans QR on WhatsApp Business phone
6. Webhook confirms connection → status becomes `ACTIVE`
7. Initial sync: fetch existing chats + recent messages

#### Channel Health States

| Status | Meaning | Admin Action |
|--------|---------|--------------|
| `ACTIVE` | Fully operational | None |
| `NEEDS_REAUTH` | Session expired, needs QR scan | Re-authenticate |
| `SYNC_ERROR` | GET endpoints failing, webhooks work | Monitor, may auto-resolve |
| `DEGRADED` | High error rate, still partially working | Check Whapi dashboard |
| `STOPPED` | Disconnected or banned | Re-authenticate or contact Whapi |

#### Troubleshooting Hints

Display in UI when connection fails:

- "If QR won't connect: check Linked Devices limit in WhatsApp Business (max 4)"
- "Session expired: scan QR code again to reconnect"
- "SYNC_ERROR: messages still send/receive via webhooks. Historical data temporarily unavailable."

#### Channel Pause UX

When a channel is paused (due to rate limiting or errors):

| UI Element | Display |
|------------|---------|
| Channel badge | 🟠 Orange dot with "Paused" label |
| Channel list row | Dimmed with warning icon |
| Tooltip on hover | "Paused due to rate limiting — admin action required" |
| Admin action | "Resume Channel" button in channel settings |
| Agent view | Banner in chat: "This channel is paused. Messages are queued but not sending." |

**Automatic resume**: Optionally auto-resume after 15 minutes if the pause was due to temporary rate limiting (configurable).

> Without this UX, agents will think messages are broken and may try workarounds that make things worse.

### 6.2 V2 Flow: Partner Mode (Future)

For commercial deployment where you manage Whapi accounts:

1. Create channels via Partner API (`projectId` required)
2. Allocate days from prepaid balance
3. Change channel mode (Trial → Sandbox → Live)
4. Auto-provision tokens without customer Whapi dashboard access

**Note**: Trial/Sandbox modes have message/day and chat/month limits. Production channels should be in Live mode.

---

## 7) Webhook Architecture

### 7.1 Webhook Endpoint

```
POST /api/webhooks/whapi/[channelId]
```

**Headers**:
- `X-Webhook-Token`: Per-channel secret (verify against stored value)
- `Content-Type`: application/json

**Handler Flow**:

```typescript
export async function POST(req: Request, { params }: { params: { channelId: string } }) {
  // 1. Verify webhook token
  const token = req.headers.get('X-Webhook-Token')
  const channel = await getChannel(params.channelId)
  if (!channel || channel.webhook_secret !== token) {
    return new Response('Unauthorized', { status: 401 })
  }

  // 2. Parse event
  const event = await req.json()
  
  // 3. Store raw event for debugging (optional but recommended)
  await storeRawWebhookEvent(params.channelId, event)

  // 4. Process by event type (idempotency handled per-type)
  switch (event.type) {
    case 'message':
      // Idempotency key: (channel_id, wa_message_id)
      await handleIncomingMessage(channel, event)
      break
    case 'message.status':
      // Idempotency key: (channel_id, wa_message_id, status)
      await handleMessageStatus(channel, event)
      break
    case 'chat':
      // Idempotency key: (channel_id, wa_chat_id, event_type)
      await handleChatEvent(channel, event)
      break
    // ... other event types
  }

  return new Response('OK', { status: 200 })
}
```

> ⚠️ **Idempotency Warning**: Do NOT rely on `event.id` for deduplication — Whapi does not guarantee stable unique IDs across retries. Use domain-specific keys instead.
```

### 7.2 Event Types to Handle

| Event Type | Action |
|------------|--------|
| `message` (inbound) | Upsert chat, insert message, trigger realtime + notification |
| `message` (outbound) | Update outbox status, insert message record |
| `message.status` | Update message status (sent, delivered, read, failed) |
| `message.edit` | Update message text, set `edited_at` timestamp |
| `message.delete` | Set message `deleted_at`, update UI to show placeholder |
| `chat.archive` | Update chat `is_archived` flag |
| `group.join` / `group.leave` | Update group participants |
| `channel.status` | Update channel health status |

### 7.3 Idempotency Rules

Webhooks may be duplicated or retried. **Do NOT use `event.id`** — use domain-specific keys:

| Event Type | Idempotency Key | Implementation |
|------------|-----------------|----------------|
| Message | `(channel_id, wa_message_id)` | Upsert with unique constraint |
| Status update | `(channel_id, wa_message_id, status)` | Only update if status progresses (pending→sent→delivered→read) |
| Chat event | `(channel_id, wa_chat_id)` | Upsert with unique constraint |
| Message edit | `(channel_id, wa_message_id)` | Update existing message row |
| Message delete | `(channel_id, wa_message_id)` | Set `deleted_at` if not already set |

**Additional rules**:
- Store raw webhook payloads for debugging (separate table, 30-day retention)
- Use idempotent operations only (set absolute values, not increments)
- Handle out-of-order delivery (status update before message creation)

---

## 8) Outbound Message Queue

### 8.1 Why Build Your Own Queue

Whapi sends immediately and does not retry. If their API is down or rate-limited, your message is lost. Your outbox provides:

- Persistence (message won't be lost)
- Retry with exponential backoff
- Rate limiting to avoid WhatsApp bans
- Status tracking for UI feedback

### 8.2 Outbox Table

```sql
CREATE TABLE outbox_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  channel_id UUID NOT NULL REFERENCES channels(id),
  chat_id UUID NOT NULL REFERENCES chats(id),
  
  -- Message content
  message_type TEXT NOT NULL,  -- 'text', 'image', 'video', 'document', 'audio'
  payload JSONB NOT NULL,      -- Type-specific payload
  
  -- Queue management
  status TEXT NOT NULL DEFAULT 'queued',  -- queued, sending, sent, failed, paused
  priority INTEGER DEFAULT 0,  -- Higher = process first
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 5,
  last_error TEXT,
  next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Tracking
  created_by UUID NOT NULL REFERENCES profiles(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  wa_message_id TEXT  -- Populated after successful send
);

CREATE INDEX outbox_pending_idx ON outbox_messages (next_attempt_at)
  WHERE status IN ('queued', 'sending');
CREATE INDEX outbox_channel_idx ON outbox_messages (channel_id, status);
```

### 8.3 Worker Process

```typescript
// Vercel Cron: runs every minute
// GET /api/cron/process-outbox

export async function GET(req: Request) {
  // Verify cron secret
  if (req.headers.get('Authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Lock and fetch pending messages (FOR UPDATE SKIP LOCKED)
  const messages = await db.query(`
    UPDATE outbox_messages
    SET status = 'sending', attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM outbox_messages
      WHERE status = 'queued'
        AND next_attempt_at <= NOW()
      ORDER BY priority DESC, created_at ASC
      LIMIT 10
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `)

  for (const msg of messages) {
    try {
      const result = await sendViaWhapi(msg)
      await markSent(msg.id, result.wa_message_id)
    } catch (error) {
      await handleSendError(msg, error)
    }
  }

  return new Response('OK')
}

async function handleSendError(msg: OutboxMessage, error: Error) {
  const isRateLimit = error.status === 429
  const isRetryable = error.status >= 500 || isRateLimit

  if (isRateLimit) {
    // Pause entire channel to prevent ban spiral
    await pauseChannel(msg.channel_id, 'Rate limited by WhatsApp')
  } else if (isRetryable && msg.attempts < msg.max_attempts) {
    // Exponential backoff: 1min, 2min, 4min, 8min, 16min
    const backoffMinutes = Math.pow(2, msg.attempts - 1)
    await reschedule(msg.id, backoffMinutes)
  } else {
    await markFailed(msg.id, error.message)
  }
}
```

### 8.4 Rate Limiting Strategy

| Level | Limit | Action on Exceed |
|-------|-------|------------------|
| Per channel | 30 messages/minute | Queue delays, process next channel |
| Per workspace | 100 messages/minute | Queue delays, warn admin |
| 429 from Whapi | N/A | Pause channel, require admin resume |

---

## 9) Media Handling

### 9.1 Inbound Media Flow

```
Webhook received → Save message (media_url from Whapi)
                         ↓
              Create media_download job
                         ↓
              Worker fetches from Whapi
                         ↓
              Upload to Supabase Storage
                         ↓
              Update message.storage_path
                         ↓
              Delete job (or mark complete)
```

**View Once Media**:

- Download immediately (before user views on phone)
- Store with `is_view_once: true` flag
- UI shows thumbnail with "View once" badge
- After user views in app, show "Photo has been viewed" placeholder
- Actual file retained for compliance (configurable per workspace)

### 9.2 Outbound Media Flow

```
User selects file → Upload to Supabase Storage (temp bucket)
                          ↓
              Generate signed URL or read file
                          ↓
              Upload to Whapi /media endpoint
                          ↓
              Send message with Whapi media ID
                          ↓
              Move to permanent storage bucket
```

### 9.3 Quick Reply Media

Quick reply attachments stored in Supabase Storage at:

```
/workspaces/{workspace_id}/quick-replies/{quick_reply_id}/{filename}
```

On send:
1. Generate short-lived signed URL (or stream from server)
2. Upload to Whapi `/media`
3. Send message with media ID

### 9.4 Retention & Cleanup

| Content | Retention | Cleanup Job |
|---------|-----------|-------------|
| Messages | 90 days | Daily: delete messages older than 90 days |
| Media files | 90 days | Daily: delete storage files older than 90 days |
| Audit logs | 1 year | Monthly: archive to cold storage, delete originals |
| Webhook events | 30 days | Daily: delete old events |

---

## 10) Data Model

### 10.1 Core Tables

```sql
-- Workspace
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  settings JSONB DEFAULT '{
    "allow_whatsapp_groups": false,
    "google_contacts_visibility": "workspace",
    "auto_resume_paused_channels": true,
    "auto_resume_delay_minutes": 15
  }',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users
CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  role TEXT NOT NULL DEFAULT 'agent',  -- main_admin, admin, agent, viewer
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  notification_settings JSONB DEFAULT '{"sound": true, "desktop": true}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Role permissions (workspace defaults)
CREATE TABLE role_permissions (
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  role TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  enabled BOOLEAN DEFAULT false,
  PRIMARY KEY (workspace_id, role, permission_key)
);

-- User permission overrides
CREATE TABLE user_permissions (
  user_id UUID NOT NULL REFERENCES profiles(user_id),
  permission_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, permission_key)
);
```

### 10.2 Groups & Access Control

```sql
CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE group_members (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  phone_number TEXT,  -- E.164 format
  status TEXT NOT NULL DEFAULT 'pending_qr',
  color TEXT,  -- Hex color for UI
  webhook_secret TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Server-only: no RLS read access for clients
CREATE TABLE channel_tokens (
  channel_id UUID PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  token_encrypted TEXT NOT NULL,  -- Encrypt with server-side key
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE group_channels (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, channel_id)
);

CREATE TABLE user_channels (
  user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, channel_id)
);
```

### 10.3 Chats & Messages

```sql
CREATE TABLE chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  channel_id UUID NOT NULL REFERENCES channels(id),
  wa_chat_id TEXT NOT NULL,  -- WhatsApp's chat ID
  
  -- Contact/group info
  is_group BOOLEAN DEFAULT false,
  display_name TEXT,
  phone_number TEXT,  -- E.164, null for groups
  profile_photo_url TEXT,
  
  -- Group-specific
  group_participants JSONB,  -- Array of participant objects
  
  -- State
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_count INTEGER DEFAULT 0,
  is_archived BOOLEAN DEFAULT false,
  
  -- Linked contact
  contact_id UUID REFERENCES contacts(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (channel_id, wa_chat_id)
);

CREATE INDEX chats_channel_idx ON chats (channel_id, last_message_at DESC);
CREATE INDEX chats_workspace_idx ON chats (workspace_id, last_message_at DESC);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  channel_id UUID NOT NULL REFERENCES channels(id),
  chat_id UUID NOT NULL REFERENCES chats(id),
  wa_message_id TEXT NOT NULL,
  
  -- Content
  direction TEXT NOT NULL,  -- 'inbound', 'outbound'
  message_type TEXT NOT NULL,  -- 'text', 'image', 'video', 'document', 'audio', 'sticker', 'location', 'contact'
  text TEXT,
  media_url TEXT,  -- Original Whapi URL (expires)
  storage_path TEXT,  -- Our Supabase Storage path
  media_metadata JSONB,  -- mime_type, size, dimensions, duration, etc.
  
  -- View once
  is_view_once BOOLEAN DEFAULT false,
  viewed_at TIMESTAMPTZ,
  
  -- Edit/delete
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  
  -- Status (outbound only)
  status TEXT,  -- 'pending', 'sent', 'delivered', 'read', 'failed'
  
  -- Sender info
  sender_user_id UUID REFERENCES profiles(user_id),  -- null for inbound
  sender_wa_id TEXT,  -- WhatsApp ID of sender (for inbound/groups)
  sender_name TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Full-text search
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED,
  
  UNIQUE (channel_id, wa_message_id)
);

CREATE INDEX messages_chat_idx ON messages (chat_id, created_at DESC);
CREATE INDEX messages_search_idx ON messages USING GIN(search_vector);
```

### 10.4 Quick Replies

```sql
CREATE TABLE quick_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  scope TEXT NOT NULL DEFAULT 'global',  -- 'global' or 'channel'
  channel_id UUID REFERENCES channels(id),  -- null if global
  
  shortcut TEXT NOT NULL,  -- 'a', 'hours', etc.
  title TEXT,
  reply_type TEXT NOT NULL,  -- 'text', 'media', 'mixed'
  text_body TEXT,
  
  created_by UUID NOT NULL REFERENCES profiles(user_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (workspace_id, scope, channel_id, shortcut)
);

CREATE TABLE quick_reply_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quick_reply_id UUID NOT NULL REFERENCES quick_replies(id) ON DELETE CASCADE,
  
  kind TEXT NOT NULL,  -- 'image', 'video', 'document', 'audio'
  storage_path TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT,
  sort_order INTEGER DEFAULT 0,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### 10.5 Collaboration

```sql
CREATE TABLE chat_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES profiles(user_id),
  body TEXT NOT NULL,
  mentions JSONB,  -- Array of mentioned user IDs
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX chat_notes_chat_idx ON chat_notes (chat_id, created_at DESC);
```

### 10.6 Google Contacts

```sql
CREATE TABLE workspace_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  integration_type TEXT NOT NULL,  -- 'google_contacts'
  credentials_encrypted JSONB NOT NULL,  -- refresh_token, etc.
  settings JSONB DEFAULT '{}',
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (workspace_id, integration_type)
);

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  
  -- Google data
  google_resource_name TEXT,
  display_name TEXT NOT NULL,
  phone_numbers JSONB,  -- Array of {number, type, normalized}
  email_addresses JSONB,
  photo_url TEXT,
  
  -- Custom fields
  tags JSONB DEFAULT '[]',
  custom_fields JSONB DEFAULT '{}',
  
  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE (workspace_id, google_resource_name)
);

CREATE INDEX contacts_phone_idx ON contacts USING GIN(phone_numbers);
```

### 10.7 Audit Log

```sql
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID REFERENCES profiles(user_id),
  
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata JSONB DEFAULT '{}',
  
  ip_address INET,
  user_agent TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX audit_logs_workspace_idx ON audit_logs (workspace_id, created_at DESC);
CREATE INDEX audit_logs_user_idx ON audit_logs (user_id, created_at DESC);
CREATE INDEX audit_logs_resource_idx ON audit_logs (resource_type, resource_id);
```

---

## 11) Row Level Security (RLS)

### 11.1 Core Policy: Channel Access

```sql
-- Helper function: check if user can access a channel
CREATE OR REPLACE FUNCTION user_can_access_channel(channel_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = auth.uid()
      AND (
        -- Main admin sees all
        p.role = 'main_admin'
        -- Direct user-channel access
        OR EXISTS (
          SELECT 1 FROM user_channels uc
          WHERE uc.user_id = auth.uid() AND uc.channel_id = $1
        )
        -- Group-based access
        OR EXISTS (
          SELECT 1 FROM group_members gm
          JOIN group_channels gc ON gc.group_id = gm.group_id
          WHERE gm.user_id = auth.uid() AND gc.channel_id = $1
        )
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 11.2 Table Policies

```sql
-- Channels: user sees only accessible channels
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY channels_select ON channels FOR SELECT
  USING (user_can_access_channel(id));

-- Chats: user sees only chats in accessible channels
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY chats_select ON chats FOR SELECT
  USING (user_can_access_channel(channel_id));

-- Messages: same as chats
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY messages_select ON messages FOR SELECT
  USING (user_can_access_channel(channel_id));

-- Channel tokens: NO ACCESS from client
ALTER TABLE channel_tokens ENABLE ROW LEVEL SECURITY;
-- No policies = no access

-- Quick replies: workspace members can read
ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;

CREATE POLICY quick_replies_select ON quick_replies FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM profiles WHERE user_id = auth.uid()
    )
  );
```

---

## 12) UI Pages & Routes

### 12.1 Authentication

| Route | Page |
|-------|------|
| `/login` | Email/password or magic link |
| `/invite/[token]` | Accept invitation, set password |
| `/reset-password` | Password reset flow |

### 12.2 Main Application

| Route | Page |
|-------|------|
| `/` | Redirect to `/inbox` |
| `/inbox` | Main inbox (single or split view) |
| `/inbox/chat/[chatId]` | Deep link to specific chat |
| `/search` | Global search results |

### 12.3 Settings (Admin)

| Route | Page |
|-------|------|
| `/settings` | Settings overview |
| `/settings/channels` | Channel management |
| `/settings/channels/[id]` | Single channel config |
| `/settings/channels/new` | Add new channel (token + QR) |
| `/settings/groups` | Group management |
| `/settings/users` | User management |
| `/settings/users/invite` | Invite new user |
| `/settings/quick-replies` | Quick reply management |
| `/settings/integrations` | Google Contacts, etc. |
| `/settings/audit-log` | Audit log viewer |
| `/settings/workspace` | Workspace settings |

---

## 13) API Routes

### 13.1 Webhooks

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/webhooks/whapi/[channelId]` | POST | Receive Whapi events |

### 13.2 Channels

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/channels` | GET | List user's accessible channels |
| `/api/channels` | POST | Create channel (admin) |
| `/api/channels/[id]` | GET | Get channel details |
| `/api/channels/[id]` | PATCH | Update channel |
| `/api/channels/[id]` | DELETE | Disconnect channel |
| `/api/channels/[id]/qr` | GET | Get QR code for linking |
| `/api/channels/[id]/health` | GET | Get channel health status |
| `/api/channels/[id]/resume` | POST | Resume paused channel |

### 13.3 Chats & Messages

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/chats` | GET | List chats (filterable by channel) |
| `/api/chats/[id]` | GET | Get chat with recent messages |
| `/api/chats/[id]/messages` | GET | Paginated messages |
| `/api/chats/[id]/messages` | POST | Send message (adds to outbox) |
| `/api/chats/[id]/read` | POST | Mark chat as read |
| `/api/chats/[id]/notes` | GET | Get internal notes |
| `/api/chats/[id]/notes` | POST | Add internal note |

### 13.4 Quick Replies

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/quick-replies` | GET | List quick replies |
| `/api/quick-replies` | POST | Create quick reply |
| `/api/quick-replies/[id]` | PATCH | Update quick reply |
| `/api/quick-replies/[id]` | DELETE | Delete quick reply |
| `/api/quick-replies/resolve` | GET | Resolve shortcut for channel |

### 13.5 Contacts

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/contacts` | GET | List contacts |
| `/api/contacts/sync` | POST | Trigger Google sync |

### 13.6 Cron Jobs

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/cron/process-outbox` | GET | Process pending messages |
| `/api/cron/download-media` | GET | Download pending media |
| `/api/cron/sync-contacts` | GET | Sync Google contacts |
| `/api/cron/cleanup` | GET | Retention cleanup |
| `/api/cron/health-check` | GET | Check all channel health |

---

## 14) Whapi Endpoints Reference

### 14.1 Authentication & Connection

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Check channel status |
| `GET /users/login/image` | Get QR code as image |
| `GET /users/login` | Get QR code as base64 |
| `POST /users/logout` | Disconnect session |

### 14.2 Data Retrieval (Backfill)

| Endpoint | Purpose |
|----------|---------|
| `GET /chats` | List all chats |
| `GET /chats/{chatId}` | Get single chat |
| `GET /messages/list` | List messages |
| `GET /messages/{messageId}` | Get single message |

### 14.3 Sending

| Endpoint | Purpose |
|----------|---------|
| `POST /messages/text` | Send text message |
| `POST /messages/image` | Send image |
| `POST /messages/video` | Send video |
| `POST /messages/document` | Send document |
| `POST /messages/audio` | Send audio |
| `POST /media` | Upload media (get ID for sending) |
| `DELETE /messages/{messageId}` | Delete message |

### 14.4 Settings

| Endpoint | Purpose |
|----------|---------|
| `GET /settings` | Get channel settings |
| `PATCH /settings` | Update webhook URL, etc. |
| `POST /settings/webhook_test` | Test webhook delivery |

---

## 15) Development Roadmap

### Core (Ship First)

### Milestone 1: Foundation (Weeks 1-3)

**Goal**: Single-channel WhatsApp Web clone

- [ ] Auth + workspace setup
- [ ] Add channel (token input + QR display)
- [ ] Webhook ingestion → messages in DB
- [ ] Basic chat list + chat view
- [ ] Send text messages
- [ ] Realtime updates via Supabase

**Deliverable**: Can connect one WhatsApp, see incoming messages, send replies

### Milestone 2: Multi-Channel + Access Control (Weeks 4-5)

**Goal**: Multiple channels with proper permissions

- [ ] Groups + user grants CRUD
- [ ] Channel assignment UX
- [ ] RLS policies enforced
- [ ] Unified Inbox view
- [ ] "Replying as" UI guardrails everywhere
- [ ] Channel health status display
- [ ] Channel pause/resume UX

**Deliverable**: Multiple channels, users only see what they should

### Milestone 3: Split View + Collaboration (Weeks 6-7)

**Goal**: Power user features

- [ ] Split view (2-4 panes, screen-size aware limits)
- [ ] Pane state management
- [ ] Presence (who's viewing/typing)
- [ ] Soft reply lock
- [ ] Internal notes

**Deliverable**: Teams can work efficiently without stepping on each other

### Milestone 4: Quick Replies + Media (Weeks 8-9)

**Goal**: Slash commands and full media support

- [ ] Quick replies CRUD
- [ ] Slash command UI in composer
- [ ] Media attachments on quick replies
- [ ] Per-channel overrides
- [ ] Media sending (image/video/doc/audio)
- [ ] View once handling

**Deliverable**: Agents can respond quickly with canned responses + media

### Optional / Phase 2

### Milestone 5: Mobile + Polish (Weeks 10-11) *(Optional for v1)*

**Goal**: Responsive design and notifications

- [ ] Mobile-responsive layouts
- [ ] Touch gestures
- [ ] Push notifications
- [ ] Sound + desktop notifications
- [ ] Offline state recovery
- [ ] Message deletion (outbound)

**Deliverable**: Works great on phone and tablet

### Milestone 6: Integrations + Reliability (Weeks 12-13) *(Optional for v1)*

**Goal**: Google Contacts + production hardening

- [ ] Google Contacts OAuth + sync
- [ ] Contact matching to chats
- [ ] Outbox retry improvements
- [ ] Media download worker
- [ ] 90-day cleanup jobs
- [ ] Audit logging

**Deliverable**: Production-ready with integrations

### Milestone 7: Search + Analytics (Week 14) *(Optional for v1)*

**Goal**: Discoverability and insights

- [ ] Full-text message search
- [ ] Search results UI
- [ ] Basic analytics dashboard
- [ ] Export functionality

**Deliverable**: Users can find past conversations easily

> **V1 Recommendation**: Ship Milestones 1-4 first. Mobile polish, Google Contacts, and advanced search can follow based on user feedback.

---

## 16) Success Criteria

| Metric | Target |
|--------|--------|
| Wrong-channel replies | Near zero (measured via audit log) |
| Channel connection time | < 2 minutes from token input to active |
| Message delivery latency | < 3 seconds from send to delivered |
| Webhook processing time | < 500ms p99 |
| UI responsiveness | < 100ms for all interactions |
| Mobile usability | Works on iOS Safari + Android Chrome |
| Uptime | 99.9% (excluding Whapi outages) |

---

## 17) Security Considerations

### 17.1 Data Protection

- Whapi tokens encrypted at rest (AES-256)
- No tokens exposed to client (RLS blocks all access)
- All API routes verify JWT + permissions
- Webhook endpoints verify per-channel secret

### 17.2 Rate Limiting

- API routes: 100 req/min per user
- Webhook endpoints: 1000 req/min per channel
- Outbox: configurable per channel to avoid WhatsApp limits

### 17.3 Audit Trail

- All message sends logged with user ID
- Permission changes logged
- Channel connects/disconnects logged
- Exportable for compliance

---

## 18) Appendix: Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Encryption
ENCRYPTION_KEY=  # For token encryption

# Cron
CRON_SECRET=  # Verify cron requests

# Google (for Contacts)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Optional: Whapi Partner Mode
WHAPI_PARTNER_TOKEN=
WHAPI_PROJECT_ID=
```

---

## 19) Appendix: Whapi Webhook Event Examples

### Incoming Message

```json
{
  "event": "message",
  "data": {
    "id": "true_1234567890@c.us_ABCD1234",
    "type": "text",
    "from": "1234567890@c.us",
    "to": "0987654321@c.us",
    "body": "Hello!",
    "timestamp": 1704067200,
    "fromMe": false
  }
}
```

### Message Status Update

```json
{
  "event": "message.status",
  "data": {
    "id": "true_1234567890@c.us_ABCD1234",
    "status": "read",
    "timestamp": 1704067260
  }
}
```

### Message Deleted

```json
{
  "event": "message.revoked",
  "data": {
    "id": "true_1234567890@c.us_ABCD1234",
    "timestamp": 1704067300
  }
}
```

---

*Living Document — Updated as requirements evolve*
*Initial Version: January 2025*
