-- WhatsApp Web Multi-Channel Platform - Initial Schema
-- This migration creates the foundational database structure for the platform
-- including workspaces, channels, chats, messages, and access control

-- =============================================================================
-- Core: Workspaces
-- =============================================================================

CREATE TABLE IF NOT EXISTS workspaces (
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

CREATE TABLE IF NOT EXISTS profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'agent',  -- main_admin, admin, agent, viewer
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  notification_settings JSONB DEFAULT '{"sound": true, "desktop": true}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS profiles_workspace_idx ON profiles(workspace_id);

-- =============================================================================
-- Core: Permissions
-- =============================================================================

CREATE TABLE IF NOT EXISTS role_permissions (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  enabled BOOLEAN DEFAULT false,
  PRIMARY KEY (workspace_id, role, permission_key)
);

CREATE TABLE IF NOT EXISTS user_permissions (
  user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  permission_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL,
  PRIMARY KEY (user_id, permission_key)
);

-- =============================================================================
-- Access Control: Groups
-- =============================================================================

CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS groups_workspace_idx ON groups(workspace_id);

CREATE TABLE IF NOT EXISTS group_members (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS group_members_user_idx ON group_members(user_id);

-- =============================================================================
-- Channels
-- =============================================================================

CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone_number TEXT,  -- E.164 format
  status TEXT NOT NULL DEFAULT 'pending_qr',  -- pending_qr, active, needs_reauth, sync_error, degraded, stopped
  health_status JSONB,  -- Health metrics from Whapi API checks
  last_synced_at TIMESTAMPTZ,  -- Last successful health check
  color TEXT,  -- Hex color for UI
  webhook_secret TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS channels_workspace_idx ON channels(workspace_id);

-- Channel tokens: Server-only table (no RLS read access for clients)
CREATE TABLE IF NOT EXISTS channel_tokens (
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  token_type TEXT NOT NULL DEFAULT 'whapi',  -- 'whapi', 'webhook', etc.
  encrypted_token TEXT NOT NULL,  -- Encrypted with server-side key
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (channel_id, token_type)
);

-- =============================================================================
-- Access Control: Channel Assignments
-- =============================================================================

CREATE TABLE IF NOT EXISTS group_channels (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, channel_id)
);

CREATE INDEX IF NOT EXISTS group_channels_channel_idx ON group_channels(channel_id);

CREATE TABLE IF NOT EXISTS user_channels (
  user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS user_channels_channel_idx ON user_channels(channel_id);

-- =============================================================================
-- Chats
-- =============================================================================

CREATE TABLE IF NOT EXISTS chats (
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

CREATE INDEX IF NOT EXISTS chats_channel_idx ON chats(channel_id, last_message_at DESC);
CREATE INDEX IF NOT EXISTS chats_workspace_idx ON chats(workspace_id, last_message_at DESC);

-- =============================================================================
-- Messages
-- =============================================================================

CREATE TABLE IF NOT EXISTS messages (
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

CREATE INDEX IF NOT EXISTS messages_chat_idx ON messages(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_search_idx ON messages USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS messages_status_idx ON messages(status) WHERE direction = 'outbound';

-- =============================================================================
-- Outbox (Reliable Message Sending)
-- =============================================================================

CREATE TABLE IF NOT EXISTS outbox_messages (
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

CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox_messages(next_attempt_at)
  WHERE status IN ('queued', 'sending');
CREATE INDEX IF NOT EXISTS outbox_channel_idx ON outbox_messages(channel_id, status);

-- =============================================================================
-- Quick Replies
-- =============================================================================

CREATE TABLE IF NOT EXISTS quick_replies (
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
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Use partial unique indexes instead of COALESCE in UNIQUE constraint
-- Global quick replies: unique per workspace+shortcut when channel_id IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS quick_replies_global_unique
  ON quick_replies(workspace_id, shortcut)
  WHERE scope = 'global' AND channel_id IS NULL;

-- Channel quick replies: unique per workspace+channel+shortcut
CREATE UNIQUE INDEX IF NOT EXISTS quick_replies_channel_unique
  ON quick_replies(workspace_id, channel_id, shortcut)
  WHERE scope = 'channel' AND channel_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS quick_replies_workspace_idx ON quick_replies(workspace_id);
CREATE INDEX IF NOT EXISTS quick_replies_channel_idx ON quick_replies(channel_id) WHERE channel_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS quick_reply_attachments (
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

CREATE INDEX IF NOT EXISTS quick_reply_attachments_qr_idx ON quick_reply_attachments(quick_reply_id);

-- =============================================================================
-- Collaboration: Internal Notes
-- =============================================================================

CREATE TABLE IF NOT EXISTS chat_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  author_user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  mentions JSONB,  -- Array of mentioned user IDs
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS chat_notes_chat_idx ON chat_notes(chat_id, created_at DESC);

-- =============================================================================
-- Google Contacts Integration
-- =============================================================================

CREATE TABLE IF NOT EXISTS workspace_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  integration_type TEXT NOT NULL,  -- 'google_contacts'
  credentials_encrypted JSONB NOT NULL,  -- refresh_token, etc.
  settings JSONB DEFAULT '{}'::jsonb,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (workspace_id, integration_type)
);

CREATE TABLE IF NOT EXISTS contacts (
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

CREATE INDEX IF NOT EXISTS contacts_workspace_idx ON contacts(workspace_id);
CREATE INDEX IF NOT EXISTS contacts_phone_idx ON contacts USING GIN(phone_numbers);

-- Add foreign key to chats.contact_id now that contacts table exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'chats_contact_id_fkey'
  ) THEN
    ALTER TABLE chats ADD CONSTRAINT chats_contact_id_fkey
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
  END IF;
END $$;

-- =============================================================================
-- Audit Log
-- =============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (
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

CREATE INDEX IF NOT EXISTS audit_logs_workspace_idx ON audit_logs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_user_idx ON audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs(resource_type, resource_id);

-- =============================================================================
-- Webhook Events (Debugging)
-- =============================================================================

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhook_events_channel_idx ON webhook_events(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS webhook_events_created_idx ON webhook_events(created_at DESC);

-- =============================================================================
-- Row Level Security (RLS)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Helper Functions
-- -----------------------------------------------------------------------------

-- Check if current user can access a specific channel
-- Returns true if:
-- 1. User is a main_admin (sees all channels)
-- 2. User has direct channel access (user_channels)
-- 3. User belongs to a group with channel access (group_members + group_channels)
CREATE OR REPLACE FUNCTION user_can_access_channel(channel_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.user_id = auth.uid()
      AND (
        p.role = 'main_admin'
        OR EXISTS (
          SELECT 1 FROM user_channels uc
          WHERE uc.user_id = auth.uid() AND uc.channel_id = $1
        )
        OR EXISTS (
          SELECT 1 FROM group_members gm
          JOIN group_channels gc ON gc.group_id = gm.group_id
          WHERE gm.user_id = auth.uid() AND gc.channel_id = $1
        )
      )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Get current user's workspace_id
CREATE OR REPLACE FUNCTION user_workspace_id()
RETURNS UUID AS $$
BEGIN
  RETURN (
    SELECT workspace_id FROM profiles
    WHERE user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check if current user is main_admin
CREATE OR REPLACE FUNCTION user_is_main_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid() AND role = 'main_admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -----------------------------------------------------------------------------
-- Enable RLS on All Tables
-- -----------------------------------------------------------------------------

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbox_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE quick_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE quick_reply_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- Workspaces: Users see only their own workspace
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS workspaces_select ON workspaces;
CREATE POLICY workspaces_select ON workspaces FOR SELECT
  USING (id = user_workspace_id());

DROP POLICY IF EXISTS workspaces_update ON workspaces;
CREATE POLICY workspaces_update ON workspaces FOR UPDATE
  USING (id = user_workspace_id() AND user_is_main_admin());

-- -----------------------------------------------------------------------------
-- Profiles: Users see profiles in their workspace
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT
  USING (workspace_id = user_workspace_id());

DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Permissions: Users see permissions in their workspace
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS role_permissions_select ON role_permissions;
CREATE POLICY role_permissions_select ON role_permissions FOR SELECT
  USING (workspace_id = user_workspace_id());

DROP POLICY IF EXISTS role_permissions_all ON role_permissions;
CREATE POLICY role_permissions_all ON role_permissions FOR ALL
  USING (workspace_id = user_workspace_id() AND user_is_main_admin());

DROP POLICY IF EXISTS user_permissions_select ON user_permissions;
CREATE POLICY user_permissions_select ON user_permissions FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS user_permissions_all ON user_permissions;
CREATE POLICY user_permissions_all ON user_permissions FOR ALL
  USING (user_id = auth.uid() OR user_is_main_admin());

-- -----------------------------------------------------------------------------
-- Groups: Users see groups in their workspace
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS groups_select ON groups;
CREATE POLICY groups_select ON groups FOR SELECT
  USING (workspace_id = user_workspace_id());

DROP POLICY IF EXISTS groups_all ON groups;
CREATE POLICY groups_all ON groups FOR ALL
  USING (workspace_id = user_workspace_id() AND user_is_main_admin());

DROP POLICY IF EXISTS group_members_select ON group_members;
CREATE POLICY group_members_select ON group_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_members.group_id
        AND g.workspace_id = user_workspace_id()
    )
  );

DROP POLICY IF EXISTS group_members_all ON group_members;
CREATE POLICY group_members_all ON group_members FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_members.group_id
        AND g.workspace_id = user_workspace_id()
        AND user_is_main_admin()
    )
  );

-- -----------------------------------------------------------------------------
-- Channels: Users see only accessible channels
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS channels_select ON channels;
CREATE POLICY channels_select ON channels FOR SELECT
  USING (user_can_access_channel(id));

DROP POLICY IF EXISTS channels_insert ON channels;
CREATE POLICY channels_insert ON channels FOR INSERT
  WITH CHECK (workspace_id = user_workspace_id() AND user_is_main_admin());

DROP POLICY IF EXISTS channels_update ON channels;
CREATE POLICY channels_update ON channels FOR UPDATE
  USING (user_can_access_channel(id) AND user_is_main_admin());

DROP POLICY IF EXISTS channels_delete ON channels;
CREATE POLICY channels_delete ON channels FOR DELETE
  USING (workspace_id = user_workspace_id() AND user_is_main_admin());

-- -----------------------------------------------------------------------------
-- Channel Tokens: NO CLIENT ACCESS (server-only via service role)
-- -----------------------------------------------------------------------------

-- No policies = no client access. Only service role can read/write.

-- -----------------------------------------------------------------------------
-- Channel Access Assignments
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS group_channels_select ON group_channels;
CREATE POLICY group_channels_select ON group_channels FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_channels.group_id
        AND g.workspace_id = user_workspace_id()
    )
  );

DROP POLICY IF EXISTS group_channels_all ON group_channels;
CREATE POLICY group_channels_all ON group_channels FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM groups g
      WHERE g.id = group_channels.group_id
        AND g.workspace_id = user_workspace_id()
        AND user_is_main_admin()
    )
  );

DROP POLICY IF EXISTS user_channels_select ON user_channels;
CREATE POLICY user_channels_select ON user_channels FOR SELECT
  USING (
    user_id = auth.uid()
    OR user_is_main_admin()
  );

DROP POLICY IF EXISTS user_channels_all ON user_channels;
CREATE POLICY user_channels_all ON user_channels FOR ALL
  USING (user_is_main_admin());

-- -----------------------------------------------------------------------------
-- Chats: Users see chats from accessible channels
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS chats_select ON chats;
CREATE POLICY chats_select ON chats FOR SELECT
  USING (user_can_access_channel(channel_id));

DROP POLICY IF EXISTS chats_insert ON chats;
CREATE POLICY chats_insert ON chats FOR INSERT
  WITH CHECK (user_can_access_channel(channel_id));

DROP POLICY IF EXISTS chats_update ON chats;
CREATE POLICY chats_update ON chats FOR UPDATE
  USING (user_can_access_channel(channel_id));

-- -----------------------------------------------------------------------------
-- Messages: Users see messages from accessible channels
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS messages_select ON messages;
CREATE POLICY messages_select ON messages FOR SELECT
  USING (user_can_access_channel(channel_id));

DROP POLICY IF EXISTS messages_insert ON messages;
CREATE POLICY messages_insert ON messages FOR INSERT
  WITH CHECK (user_can_access_channel(channel_id));

DROP POLICY IF EXISTS messages_update ON messages;
CREATE POLICY messages_update ON messages FOR UPDATE
  USING (user_can_access_channel(channel_id));

-- -----------------------------------------------------------------------------
-- Outbox: Users see their own outbox messages and messages from accessible channels
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS outbox_messages_select ON outbox_messages;
CREATE POLICY outbox_messages_select ON outbox_messages FOR SELECT
  USING (
    created_by = auth.uid()
    OR user_can_access_channel(channel_id)
  );

DROP POLICY IF EXISTS outbox_messages_insert ON outbox_messages;
CREATE POLICY outbox_messages_insert ON outbox_messages FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND user_can_access_channel(channel_id)
  );

DROP POLICY IF EXISTS outbox_messages_update ON outbox_messages;
CREATE POLICY outbox_messages_update ON outbox_messages FOR UPDATE
  USING (user_can_access_channel(channel_id));

-- -----------------------------------------------------------------------------
-- Quick Replies: Users see quick replies from their workspace
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS quick_replies_select ON quick_replies;
CREATE POLICY quick_replies_select ON quick_replies FOR SELECT
  USING (
    workspace_id = user_workspace_id()
    AND (
      scope = 'global'
      OR (scope = 'channel' AND user_can_access_channel(channel_id))
    )
  );

DROP POLICY IF EXISTS quick_replies_insert ON quick_replies;
CREATE POLICY quick_replies_insert ON quick_replies FOR INSERT
  WITH CHECK (
    workspace_id = user_workspace_id()
    AND created_by = auth.uid()
    AND (
      scope = 'global'
      OR (scope = 'channel' AND user_can_access_channel(channel_id))
    )
  );

DROP POLICY IF EXISTS quick_replies_update ON quick_replies;
CREATE POLICY quick_replies_update ON quick_replies FOR UPDATE
  USING (
    workspace_id = user_workspace_id()
    AND (
      created_by = auth.uid()
      OR user_is_main_admin()
    )
  );

DROP POLICY IF EXISTS quick_replies_delete ON quick_replies;
CREATE POLICY quick_replies_delete ON quick_replies FOR DELETE
  USING (
    workspace_id = user_workspace_id()
    AND (
      created_by = auth.uid()
      OR user_is_main_admin()
    )
  );

DROP POLICY IF EXISTS quick_reply_attachments_select ON quick_reply_attachments;
CREATE POLICY quick_reply_attachments_select ON quick_reply_attachments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM quick_replies qr
      WHERE qr.id = quick_reply_attachments.quick_reply_id
        AND qr.workspace_id = user_workspace_id()
    )
  );

DROP POLICY IF EXISTS quick_reply_attachments_all ON quick_reply_attachments;
CREATE POLICY quick_reply_attachments_all ON quick_reply_attachments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM quick_replies qr
      WHERE qr.id = quick_reply_attachments.quick_reply_id
        AND qr.workspace_id = user_workspace_id()
        AND (qr.created_by = auth.uid() OR user_is_main_admin())
    )
  );

-- -----------------------------------------------------------------------------
-- Chat Notes: Users see notes from accessible chats
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS chat_notes_select ON chat_notes;
CREATE POLICY chat_notes_select ON chat_notes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = chat_notes.chat_id
        AND user_can_access_channel(c.channel_id)
    )
  );

DROP POLICY IF EXISTS chat_notes_insert ON chat_notes;
CREATE POLICY chat_notes_insert ON chat_notes FOR INSERT
  WITH CHECK (
    author_user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM chats c
      WHERE c.id = chat_notes.chat_id
        AND user_can_access_channel(c.channel_id)
    )
  );

DROP POLICY IF EXISTS chat_notes_update ON chat_notes;
CREATE POLICY chat_notes_update ON chat_notes FOR UPDATE
  USING (author_user_id = auth.uid());

DROP POLICY IF EXISTS chat_notes_delete ON chat_notes;
CREATE POLICY chat_notes_delete ON chat_notes FOR DELETE
  USING (author_user_id = auth.uid() OR user_is_main_admin());

-- -----------------------------------------------------------------------------
-- Workspace Integrations: Main admin only
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS workspace_integrations_select ON workspace_integrations;
CREATE POLICY workspace_integrations_select ON workspace_integrations FOR SELECT
  USING (workspace_id = user_workspace_id() AND user_is_main_admin());

DROP POLICY IF EXISTS workspace_integrations_all ON workspace_integrations;
CREATE POLICY workspace_integrations_all ON workspace_integrations FOR ALL
  USING (workspace_id = user_workspace_id() AND user_is_main_admin());

-- -----------------------------------------------------------------------------
-- Contacts: Users see contacts from their workspace
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT
  USING (workspace_id = user_workspace_id());

DROP POLICY IF EXISTS contacts_insert ON contacts;
CREATE POLICY contacts_insert ON contacts FOR INSERT
  WITH CHECK (workspace_id = user_workspace_id());

DROP POLICY IF EXISTS contacts_update ON contacts;
CREATE POLICY contacts_update ON contacts FOR UPDATE
  USING (workspace_id = user_workspace_id());

-- -----------------------------------------------------------------------------
-- Audit Logs: Users see logs from their workspace
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS audit_logs_select ON audit_logs;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT
  USING (workspace_id = user_workspace_id());

DROP POLICY IF EXISTS audit_logs_insert ON audit_logs;
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT
  WITH CHECK (workspace_id = user_workspace_id());

-- -----------------------------------------------------------------------------
-- Webhook Events: Admin only (for debugging)
-- -----------------------------------------------------------------------------

DROP POLICY IF EXISTS webhook_events_select ON webhook_events;
CREATE POLICY webhook_events_select ON webhook_events FOR SELECT
  USING (
    user_is_main_admin()
    AND user_can_access_channel(channel_id)
  );

-- No insert/update/delete policies - only server can write via service role
