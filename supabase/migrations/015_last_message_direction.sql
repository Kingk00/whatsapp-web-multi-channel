-- Migration: Add last message direction and status to chats
-- Enables showing delivery status (double tick) in chat list preview

-- =============================================================================
-- Add columns for last message direction and status
-- =============================================================================

ALTER TABLE chats
ADD COLUMN IF NOT EXISTS last_message_direction TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS last_message_status TEXT DEFAULT NULL;

-- Add index for efficient queries
CREATE INDEX IF NOT EXISTS idx_chats_last_message_direction
ON chats(last_message_direction)
WHERE last_message_direction IS NOT NULL;

-- =============================================================================
-- Update increment_chat_unread function to include direction/status
-- =============================================================================

CREATE OR REPLACE FUNCTION increment_chat_unread(
  chat_id UUID,
  preview_text TEXT DEFAULT NULL,
  message_time TIMESTAMPTZ DEFAULT NOW(),
  message_direction TEXT DEFAULT 'inbound',
  message_status TEXT DEFAULT NULL
)
RETURNS void AS $$
BEGIN
  UPDATE chats
  SET
    unread_count = unread_count + 1,
    last_message_preview = COALESCE(preview_text, last_message_preview),
    last_message_at = message_time,
    last_message_direction = message_direction,
    last_message_status = message_status,
    updated_at = NOW()
  WHERE id = chat_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Function: Update chat last message (for outbound messages, no unread increment)
-- =============================================================================

CREATE OR REPLACE FUNCTION update_chat_last_message(
  chat_id UUID,
  preview_text TEXT DEFAULT NULL,
  message_time TIMESTAMPTZ DEFAULT NOW(),
  message_direction TEXT DEFAULT 'outbound',
  message_status TEXT DEFAULT 'sent'
)
RETURNS void AS $$
BEGIN
  UPDATE chats
  SET
    last_message_preview = COALESCE(preview_text, last_message_preview),
    last_message_at = message_time,
    last_message_direction = message_direction,
    last_message_status = message_status,
    updated_at = NOW()
  WHERE id = chat_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Backfill existing chats with their last message direction/status
-- =============================================================================

-- Update each chat with its most recent message's direction and status
UPDATE chats c
SET
  last_message_direction = m.direction,
  last_message_status = m.status
FROM (
  SELECT DISTINCT ON (chat_id)
    chat_id,
    direction,
    status
  FROM messages
  ORDER BY chat_id, created_at DESC
) m
WHERE c.id = m.chat_id;
