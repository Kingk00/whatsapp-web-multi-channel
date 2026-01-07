-- Migration: Chat Helper Functions
-- Adds database functions for atomic chat operations

-- =============================================================================
-- Function: Increment chat unread count atomically
-- =============================================================================

CREATE OR REPLACE FUNCTION increment_chat_unread(
  chat_id UUID,
  preview_text TEXT DEFAULT NULL,
  message_time TIMESTAMPTZ DEFAULT NOW()
)
RETURNS void AS $$
BEGIN
  UPDATE chats
  SET
    unread_count = unread_count + 1,
    last_message_preview = COALESCE(preview_text, last_message_preview),
    last_message_at = message_time,
    updated_at = NOW()
  WHERE id = chat_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Function: Reset chat unread count
-- =============================================================================

-- Drop existing function if parameter names differ
DROP FUNCTION IF EXISTS reset_chat_unread(UUID);

CREATE OR REPLACE FUNCTION reset_chat_unread(chat_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE chats
  SET
    unread_count = 0,
    updated_at = NOW()
  WHERE id = chat_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Function: Get total unread count for a channel
-- =============================================================================

-- Drop existing function if parameter names differ
DROP FUNCTION IF EXISTS get_channel_unread_count(UUID);

CREATE OR REPLACE FUNCTION get_channel_unread_count(channel_id UUID)
RETURNS INTEGER AS $$
DECLARE
  total INTEGER;
BEGIN
  SELECT COALESCE(SUM(unread_count), 0)
  INTO total
  FROM chats
  WHERE chats.channel_id = $1;

  RETURN total;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Trigger: Update channel updated_at when chats change
-- =============================================================================

CREATE OR REPLACE FUNCTION update_channel_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE channels
  SET updated_at = NOW()
  WHERE id = NEW.channel_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if it doesn't exist
DROP TRIGGER IF EXISTS chats_update_channel_trigger ON chats;
CREATE TRIGGER chats_update_channel_trigger
  AFTER INSERT OR UPDATE ON chats
  FOR EACH ROW
  EXECUTE FUNCTION update_channel_timestamp();

-- =============================================================================
-- Trigger: Auto-update updated_at timestamp on messages
-- =============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to chats table if not exists
DROP TRIGGER IF EXISTS chats_updated_at_trigger ON chats;
CREATE TRIGGER chats_updated_at_trigger
  BEFORE UPDATE ON chats
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
