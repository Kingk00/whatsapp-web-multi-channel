-- ============================================================================
-- Media Fetch Queue
-- ============================================================================
-- Background queue for fetching media from Whapi without blocking webhooks.
-- Media messages are stored immediately with placeholder data, then a cron job
-- processes this queue to fetch actual media URLs and store in Supabase Storage.

CREATE TABLE IF NOT EXISTS media_fetch_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- References
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- WhatsApp identifiers
  wa_message_id TEXT NOT NULL,
  media_id TEXT,  -- Whapi media ID if available

  -- Media info
  media_type TEXT NOT NULL,  -- image, video, audio, document, sticker, voice, ptt
  is_view_once BOOLEAN DEFAULT FALSE,

  -- Processing state
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, processing, completed, failed
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  last_error TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  next_attempt_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT valid_status CHECK (status IN ('pending', 'processing', 'completed', 'failed'))
);

-- Index for cron job to find pending items
CREATE INDEX idx_media_queue_pending
  ON media_fetch_queue(next_attempt_at, created_at)
  WHERE status = 'pending';

-- Index for finding items by message
CREATE INDEX idx_media_queue_message
  ON media_fetch_queue(message_id);

-- Index for channel-based queries
CREATE INDEX idx_media_queue_channel
  ON media_fetch_queue(channel_id, status);

-- ============================================================================
-- Helper function to queue media fetch
-- ============================================================================
CREATE OR REPLACE FUNCTION queue_media_fetch(
  p_channel_id UUID,
  p_message_id UUID,
  p_workspace_id UUID,
  p_wa_message_id TEXT,
  p_media_id TEXT,
  p_media_type TEXT,
  p_is_view_once BOOLEAN DEFAULT FALSE
) RETURNS UUID AS $$
DECLARE
  v_queue_id UUID;
BEGIN
  INSERT INTO media_fetch_queue (
    channel_id,
    message_id,
    workspace_id,
    wa_message_id,
    media_id,
    media_type,
    is_view_once
  ) VALUES (
    p_channel_id,
    p_message_id,
    p_workspace_id,
    p_wa_message_id,
    p_media_id,
    p_media_type,
    p_is_view_once
  )
  ON CONFLICT DO NOTHING  -- Prevent duplicates
  RETURNING id INTO v_queue_id;

  RETURN v_queue_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Function to claim items for processing (with locking)
-- ============================================================================
CREATE OR REPLACE FUNCTION claim_media_fetch_jobs(
  p_limit INTEGER DEFAULT 10
) RETURNS SETOF media_fetch_queue AS $$
BEGIN
  RETURN QUERY
  UPDATE media_fetch_queue
  SET
    status = 'processing',
    attempts = attempts + 1,
    next_attempt_at = NOW() + INTERVAL '5 minutes'  -- Retry after 5 min if processing fails
  WHERE id IN (
    SELECT id
    FROM media_fetch_queue
    WHERE status = 'pending'
      AND next_attempt_at <= NOW()
      AND attempts < max_attempts
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Function to mark job as completed
-- ============================================================================
CREATE OR REPLACE FUNCTION complete_media_fetch_job(
  p_job_id UUID,
  p_media_url TEXT,
  p_storage_path TEXT,
  p_metadata JSONB
) RETURNS VOID AS $$
BEGIN
  -- Update the queue item
  UPDATE media_fetch_queue
  SET
    status = 'completed',
    processed_at = NOW()
  WHERE id = p_job_id;

  -- Update the message with media info
  UPDATE messages
  SET
    media_url = p_media_url,
    storage_path = p_storage_path,
    media_metadata = COALESCE(media_metadata, '{}'::JSONB) || p_metadata
  WHERE id = (SELECT message_id FROM media_fetch_queue WHERE id = p_job_id);
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Function to mark job as failed
-- ============================================================================
CREATE OR REPLACE FUNCTION fail_media_fetch_job(
  p_job_id UUID,
  p_error TEXT
) RETURNS VOID AS $$
DECLARE
  v_attempts INTEGER;
  v_max_attempts INTEGER;
BEGIN
  SELECT attempts, max_attempts INTO v_attempts, v_max_attempts
  FROM media_fetch_queue WHERE id = p_job_id;

  IF v_attempts >= v_max_attempts THEN
    -- Max attempts reached, mark as permanently failed
    UPDATE media_fetch_queue
    SET
      status = 'failed',
      last_error = p_error,
      processed_at = NOW()
    WHERE id = p_job_id;
  ELSE
    -- Put back in pending state with backoff
    UPDATE media_fetch_queue
    SET
      status = 'pending',
      last_error = p_error,
      next_attempt_at = NOW() + (INTERVAL '1 minute' * POWER(2, v_attempts))  -- Exponential backoff
    WHERE id = p_job_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Cleanup old completed/failed jobs (run periodically)
-- ============================================================================
CREATE OR REPLACE FUNCTION cleanup_media_fetch_queue(
  p_retention_days INTEGER DEFAULT 7
) RETURNS INTEGER AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM media_fetch_queue
  WHERE processed_at < NOW() - (p_retention_days || ' days')::INTERVAL
    AND status IN ('completed', 'failed');

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$ LANGUAGE plpgsql;

-- Add RLS policies
ALTER TABLE media_fetch_queue ENABLE ROW LEVEL SECURITY;

-- Service role can do anything
CREATE POLICY "Service role full access" ON media_fetch_queue
  FOR ALL
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE media_fetch_queue IS 'Queue for background media fetching from Whapi. Webhook stores message immediately, cron job processes media later.';
