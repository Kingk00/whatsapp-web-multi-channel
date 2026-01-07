-- Migration: Chat Actions (Archive, Mute, Delete)
-- Adds muting functionality and improves chat action support

-- Add mute functionality to chats
ALTER TABLE chats ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;

-- Index for finding muted chats efficiently
CREATE INDEX IF NOT EXISTS chats_muted_idx ON chats(muted_until)
  WHERE muted_until IS NOT NULL;

-- Index for archived chats lookup
CREATE INDEX IF NOT EXISTS chats_archived_idx ON chats(workspace_id, is_archived, last_message_at DESC);

-- NOTE: Access control is handled in API routes via user_can_access_channel()
-- We don't create SECURITY DEFINER helper functions to avoid bypassing RLS

-- RLS policy for chat updates (archive, mute)
-- Users can update chats they have access to
DROP POLICY IF EXISTS chats_update_own ON chats;
CREATE POLICY chats_update_own ON chats FOR UPDATE
  USING (user_can_access_channel(channel_id))
  WITH CHECK (user_can_access_channel(channel_id));

-- RLS policy for chat deletion
-- Users can delete chats they have access to
DROP POLICY IF EXISTS chats_delete_own ON chats;
CREATE POLICY chats_delete_own ON chats FOR DELETE
  USING (user_can_access_channel(channel_id));
