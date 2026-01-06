-- Migration: Outbox Helper Functions
-- Adds database functions for atomic outbox message processing

-- =============================================================================
-- Function: Get pending outbox messages with locking
-- Uses FOR UPDATE SKIP LOCKED for concurrent safety
-- =============================================================================

CREATE OR REPLACE FUNCTION get_pending_outbox_messages(batch_size INTEGER DEFAULT 10)
RETURNS SETOF outbox_messages AS $$
DECLARE
  result outbox_messages;
BEGIN
  -- Update and return messages atomically
  FOR result IN
    UPDATE outbox_messages
    SET
      status = 'sending',
      attempts = attempts + 1
    WHERE id IN (
      SELECT id
      FROM outbox_messages
      WHERE status = 'queued'
        AND next_attempt_at <= NOW()
      ORDER BY priority DESC, created_at ASC
      LIMIT batch_size
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  LOOP
    RETURN NEXT result;
  END LOOP;

  RETURN;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Function: Resume paused channel messages
-- Called when admin resumes a paused channel
-- =============================================================================

CREATE OR REPLACE FUNCTION resume_channel_messages(channel_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE outbox_messages
  SET
    status = 'queued',
    next_attempt_at = NOW()
  WHERE channel_id = channel_uuid
    AND status = 'paused';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Function: Get outbox statistics for a channel
-- =============================================================================

CREATE OR REPLACE FUNCTION get_channel_outbox_stats(channel_uuid UUID)
RETURNS TABLE (
  status TEXT,
  count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    outbox_messages.status,
    COUNT(*)::BIGINT
  FROM outbox_messages
  WHERE channel_id = channel_uuid
  GROUP BY outbox_messages.status;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Function: Clean up old sent/failed outbox messages
-- Should be called periodically to prevent table bloat
-- =============================================================================

CREATE OR REPLACE FUNCTION cleanup_old_outbox_messages(older_than_days INTEGER DEFAULT 7)
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM outbox_messages
  WHERE status IN ('sent', 'failed')
    AND created_at < NOW() - (older_than_days || ' days')::INTERVAL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Index: Improve outbox query performance
-- =============================================================================

-- Create partial index for pending messages (most common query)
CREATE INDEX IF NOT EXISTS outbox_messages_pending_priority_idx
  ON outbox_messages (priority DESC, created_at ASC)
  WHERE status = 'queued';

-- Create index for channel stats queries
CREATE INDEX IF NOT EXISTS outbox_messages_channel_status_idx
  ON outbox_messages (channel_id, status);
