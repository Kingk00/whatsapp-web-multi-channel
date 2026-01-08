-- Add is_pinned column to chats table for pinning chats to the top

ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN DEFAULT false;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

-- Index for efficient sorting (pinned first, then by last_message_at)
CREATE INDEX IF NOT EXISTS chats_pinned_idx ON chats(workspace_id, is_pinned DESC, pinned_at DESC NULLS LAST, last_message_at DESC);
