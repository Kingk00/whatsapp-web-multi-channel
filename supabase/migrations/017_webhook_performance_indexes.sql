-- ============================================================================
-- Webhook Performance Optimization Indexes
-- ============================================================================
-- These indexes optimize the hot paths in webhook processing:
-- 1. Channel verification (webhook secret lookup)
-- 2. Message upsert (channel_id + wa_message_id lookup)
-- 3. Chat upsert (channel_id + wa_chat_id lookup)
-- 4. Webhook events cleanup

-- Composite index for fast webhook verification
-- Covers: SELECT ... FROM channels WHERE id = $1 (with webhook_secret in result)
CREATE INDEX  IF NOT EXISTS idx_channels_webhook_verify
  ON channels(id) INCLUDE (workspace_id, status, webhook_secret);

-- Message lookup by WhatsApp message ID (for deduplication and status updates)
-- Covers: SELECT/UPDATE ... FROM messages WHERE channel_id = $1 AND wa_message_id = $2
CREATE INDEX  IF NOT EXISTS idx_messages_wa_lookup
  ON messages(channel_id, wa_message_id) INCLUDE (id, chat_id, status, direction);

-- Chat lookup by WhatsApp chat ID (for getOrCreateChat)
-- Covers: SELECT/UPDATE ... FROM chats WHERE channel_id = $1 AND wa_chat_id = $2
CREATE INDEX  IF NOT EXISTS idx_chats_wa_lookup
  ON chats(channel_id, wa_chat_id) INCLUDE (id, workspace_id, display_name);

-- Webhook events table optimization
-- Index for efficient cleanup of old processed events
CREATE INDEX  IF NOT EXISTS idx_webhook_events_cleanup
  ON webhook_events(created_at)
  WHERE processed_at IS NOT NULL;

-- Index for recent webhook events by channel (for debugging)
CREATE INDEX  IF NOT EXISTS idx_webhook_events_channel_recent
  ON webhook_events(channel_id, created_at DESC);

-- Partial index for pending outbox messages (used by cron processor)
-- Only indexes messages that need to be processed
CREATE INDEX  IF NOT EXISTS idx_outbox_pending_priority
  ON outbox_messages(next_attempt_at, priority DESC)
  WHERE status IN ('queued', 'sending');

-- Index for channel tokens lookup (used in webhook media fetch)
CREATE INDEX  IF NOT EXISTS idx_channel_tokens_lookup
  ON channel_tokens(channel_id, token_type);

-- ============================================================================
-- Analyze tables to update statistics after index creation
-- ============================================================================
ANALYZE channels;
ANALYZE messages;
ANALYZE chats;
ANALYZE webhook_events;
ANALYZE outbox_messages;
ANALYZE channel_tokens;
