-- Migration: View-Once Photos Support
-- Tracks per-agent viewing of view-once media messages

-- Table to track which users have viewed which view-once messages
CREATE TABLE IF NOT EXISTS message_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);

-- Index for quick lookup by message
CREATE INDEX IF NOT EXISTS message_views_message_idx ON message_views(message_id);

-- Index for quick lookup by user
CREATE INDEX IF NOT EXISTS message_views_user_idx ON message_views(user_id);

-- Enable RLS
ALTER TABLE message_views ENABLE ROW LEVEL SECURITY;

-- RLS: Users can view their own view records
CREATE POLICY message_views_select_own ON message_views FOR SELECT
  USING (user_id = auth.uid());

-- RLS: Users can insert their own view records (for messages they have access to)
CREATE POLICY message_views_insert_own ON message_views FOR INSERT
  WITH CHECK (
    user_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM messages m
      JOIN channels c ON c.id = m.channel_id
      WHERE m.id = message_id AND user_can_access_channel(c.id)
    )
  );

-- RLS: Users cannot update view records (immutable)
-- RLS: Users cannot delete view records (immutable)
