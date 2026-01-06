-- WhatsApp Web Multi-Channel Platform - Initial Schema
-- This migration creates the foundational database structure for the platform
-- including workspaces, channels, chats, messages, and access control

-- =============================================================================
-- Core: Workspaces
-- =============================================================================

CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  settings JSONB DEFAULT '{
    "allow_whatsapp_groups": false,
    "google_contacts_visibility": "workspace",
    "auto_resume_paused_channels": true,
    "auto_resume_delay_minutes": 15
  }'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- Core: Users & Profiles
-- =============================================================================

CREATE TABLE profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'agent',  -- main_admin, admin, agent, viewer
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  notification_settings JSONB DEFAULT '{"sound": true, "desktop": true}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX profiles_workspace_idx ON profiles(workspace_id);

-- =============================================================================
-- Core: Permissions
-- =============================================================================

CREATE TABLE role_permissions (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  enabled BOOLEAN DEFAULT false,
  PRIMARY KEY (workspace_id, role, permission_key)
);

CREATE TABLE user_permissions (
  user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, permission_key)
);

-- =============================================================================
-- Access Control: Groups
-- =============================================================================

CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX groups_workspace_idx ON groups(workspace_id);

CREATE TABLE group_members (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX group_members_user_idx ON group_members(user_id);

-- =============================================================================
-- Channels
-- =============================================================================

CREATE TABLE channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone_number TEXT,  -- E.164 format
  status TEXT NOT NULL DEFAULT 'pending_qr',  -- pending_qr, active, needs_reauth, sync_error, degraded, stopped
  color TEXT,  -- Hex color for UI
  webhook_secret TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX channels_workspace_idx ON channels(workspace_id);

-- Channel tokens: Server-only table (no RLS read access for clients)
CREATE TABLE channel_tokens (
  channel_id UUID PRIMARY KEY REFERENCES channels(id) ON DELETE CASCADE,
  token_encrypted TEXT NOT NULL,  -- Encrypted with server-side key
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- Access Control: Channel Assignments
-- =============================================================================

CREATE TABLE group_channels (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, channel_id)
);

CREATE INDEX group_channels_channel_idx ON group_channels(channel_id);

CREATE TABLE user_channels (
  user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX user_channels_channel_idx ON user_channels(channel_id);

-- =============================================================================
-- Chats
-- =============================================================================

CREATE TABLE chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  wa_chat_id TEXT NOT NULL,  -- WhatsApp's chat ID

  -- Contact/group info
  is_group BOOLEAN DEFAULT false,
  display_name TEXT,
  phone_number TEXT,  -- E.164 format, null for groups
  profile_photo_url TEXT,

  -- Group-specific
  group_participants JSONB,  -- Array of participant objects

  -- State
  last_message_at TIMESTAMPTZ,
  last_message_preview TEXT,
  unread_count INTEGER DEFAULT 0,
  is_archived BOOLEAN DEFAULT false,

  -- Linked contact (for Google Contacts integration)
  contact_id UUID,  -- References contacts(id), added later

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (channel_id, wa_chat_id)
);

CREATE INDEX chats_channel_idx ON chats(channel_id, last_message_at DESC);
CREATE INDEX chats_workspace_idx ON chats(workspace_id, last_message_at DESC);

-- =============================================================================
-- Messages
-- =============================================================================

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  wa_message_id TEXT NOT NULL,

  -- Content
  direction TEXT NOT NULL,  -- 'inbound', 'outbound'
  message_type TEXT NOT NULL,  -- 'text', 'image', 'video', 'document', 'audio', 'sticker', 'location', 'contact'
  text TEXT,
  media_url TEXT,  -- Original Whapi URL (expires after 30 days)
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
  sender_user_id UUID REFERENCES profiles(user_id) ON DELETE SET NULL,  -- null for inbound
  sender_wa_id TEXT,  -- WhatsApp ID of sender (for inbound/groups)
  sender_name TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),

  -- Full-text search
  search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', coalesce(text, ''))) STORED,

  -- CRITICAL: Idempotency constraint for webhook deduplication
  UNIQUE (channel_id, wa_message_id)
);

CREATE INDEX messages_chat_idx ON messages(chat_id, created_at DESC);
CREATE INDEX messages_search_idx ON messages USING GIN(search_vector);
CREATE INDEX messages_status_idx ON messages(status) WHERE direction = 'outbound';

-- =============================================================================
-- Outbox (Reliable Message Sending)
-- =============================================================================

CREATE TABLE outbox_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,

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
  created_by UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  wa_message_id TEXT  -- Populated after successful send
);

CREATE INDEX outbox_pending_idx ON outbox_messages(next_attempt_at)
  WHERE status IN ('queued', 'sending');
CREATE INDEX outbox_channel_idx ON outbox_messages(channel_id, status);

-- =============================================================================
-- Quick Replies
-- =============================================================================

CREATE TABLE quick_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'global',  -- 'global' or 'channel'
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,  -- null if global

  shortcut TEXT NOT NULL,  -- 'a', 'hours', etc.
  title TEXT,
  reply_type TEXT NOT NULL,  -- 'text', 'media', 'mixed'
  text_body TEXT,

  created_by UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (workspace_id, scope, COALESCE(channel_id, '00000000-0000-0000-0000-000000000000'::uuid), shortcut)
);

CREATE INDEX quick_replies_workspace_idx ON quick_replies(workspace_id);
CREATE INDEX quick_replies_channel_idx ON quick_replies(channel_id) WHERE channel_id IS NOT NULL;

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

CREATE INDEX quick_reply_attachments_qr_idx ON quick_reply_attachments(quick_reply_id);

-- =============================================================================
-- Collaboration: Internal Notes
-- =============================================================================

CREATE TABLE chat_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  mentions JSONB,  -- Array of mentioned user IDs
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX chat_notes_chat_idx ON chat_notes(chat_id, created_at DESC);

-- =============================================================================
-- Google Contacts Integration
-- =============================================================================

CREATE TABLE workspace_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  integration_type TEXT NOT NULL,  -- 'google_contacts'
  credentials_encrypted JSONB NOT NULL,  -- refresh_token, etc.
  settings JSONB DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (workspace_id, integration_type)
);

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Google data
  google_resource_name TEXT,
  display_name TEXT NOT NULL,
  phone_numbers JSONB,  -- Array of {number, type, normalized}
  email_addresses JSONB,
  photo_url TEXT,

  -- Custom fields
  tags JSONB DEFAULT '[]'::jsonb,
  custom_fields JSONB DEFAULT '{}'::jsonb,

  synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (workspace_id, google_resource_name)
);

CREATE INDEX contacts_workspace_idx ON contacts(workspace_id);
CREATE INDEX contacts_phone_idx ON contacts USING GIN(phone_numbers);

-- Add foreign key to chats.contact_id now that contacts table exists
ALTER TABLE chats ADD CONSTRAINT chats_contact_id_fkey
  FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;

-- =============================================================================
-- Audit Log
-- =============================================================================

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(user_id) ON DELETE SET NULL,

  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,

  ip_address INET,
  user_agent TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX audit_logs_workspace_idx ON audit_logs(workspace_id, created_at DESC);
CREATE INDEX audit_logs_user_idx ON audit_logs(user_id, created_at DESC);
CREATE INDEX audit_logs_resource_idx ON audit_logs(resource_type, resource_id);

-- =============================================================================
-- Webhook Events (Debugging)
-- =============================================================================

CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX webhook_events_channel_idx ON webhook_events(channel_id, created_at DESC);
CREATE INDEX webhook_events_created_idx ON webhook_events(created_at DESC);
