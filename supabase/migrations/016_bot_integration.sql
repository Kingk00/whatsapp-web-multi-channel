-- Bot Integration Tables
-- Enables AI bot integration with Bloe Engine for automated responses

-- =============================================================================
-- 1. Channel Bot Configuration
-- =============================================================================
CREATE TABLE IF NOT EXISTS channel_bot_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,

  -- Bot mode: full, semi, watching, off
  bot_mode TEXT NOT NULL DEFAULT 'off'
    CHECK (bot_mode IN ('full', 'semi', 'watching', 'off')),

  -- Bloe Engine connection
  bloe_api_url TEXT NOT NULL DEFAULT 'http://localhost:8000',
  bloe_api_key_encrypted TEXT,  -- Never returned to client
  bloe_provider_id TEXT,

  -- Auto-reply hours (null = 24/7)
  auto_reply_start_minutes INTEGER CHECK (auto_reply_start_minutes IS NULL OR (auto_reply_start_minutes >= 0 AND auto_reply_start_minutes < 1440)),
  auto_reply_end_minutes INTEGER CHECK (auto_reply_end_minutes IS NULL OR (auto_reply_end_minutes >= 0 AND auto_reply_end_minutes < 1440)),
  auto_reply_timezone TEXT DEFAULT 'America/Sao_Paulo',

  -- Behavior
  auto_pause_on_escalate BOOLEAN NOT NULL DEFAULT true,
  reply_delay_ms INTEGER DEFAULT 1500,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(channel_id)
);

-- RLS: Only workspace admins can manage bot config
ALTER TABLE channel_bot_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage bot config" ON channel_bot_config
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM channels c
      JOIN profiles p ON p.workspace_id = c.workspace_id
      WHERE c.id = channel_bot_config.channel_id
      AND p.user_id = auth.uid()
      AND p.role IN ('main_admin', 'admin')
    )
  );

CREATE INDEX idx_channel_bot_config_channel ON channel_bot_config(channel_id);

-- =============================================================================
-- 2. Chat Bot State
-- =============================================================================
ALTER TABLE chats ADD COLUMN IF NOT EXISTS bot_paused BOOLEAN NOT NULL DEFAULT false;

-- Index for quick bot pause checks
CREATE INDEX IF NOT EXISTS idx_chats_bot_paused ON chats(bot_paused) WHERE bot_paused = true;

-- =============================================================================
-- 3. Bot Learning Log (created before chat_drafts for FK reference)
-- =============================================================================
CREATE TABLE IF NOT EXISTS bot_learning_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,

  -- Inbound message
  inbound_message_id TEXT NOT NULL,
  inbound_text TEXT NOT NULL,

  -- Bot analysis
  detected_intent TEXT,
  confidence FLOAT,
  suggested_action TEXT CHECK (suggested_action IN ('REPLY', 'ESCALATE', 'IGNORE', 'WAIT')),
  suggested_reply TEXT,
  escalate_reason TEXT,

  -- What actually happened (for learning)
  actual_reply_text TEXT,
  was_edited BOOLEAN DEFAULT false,
  edit_delta JSONB,
  was_approved BOOLEAN,
  was_escalated BOOLEAN DEFAULT false,

  -- Timing
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  response_time_ms INTEGER
);

ALTER TABLE bot_learning_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view learning log" ON bot_learning_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM channels c
      JOIN profiles p ON p.workspace_id = c.workspace_id
      WHERE c.id = bot_learning_log.channel_id
      AND p.user_id = auth.uid()
      AND p.role IN ('main_admin', 'admin')
    )
  );

CREATE POLICY "System can insert learning log" ON bot_learning_log
  FOR INSERT WITH CHECK (true);

CREATE POLICY "System can update learning log" ON bot_learning_log
  FOR UPDATE USING (true);

CREATE INDEX idx_bot_learning_channel ON bot_learning_log(channel_id);
CREATE INDEX idx_bot_learning_chat ON bot_learning_log(chat_id);
CREATE INDEX idx_bot_learning_intent ON bot_learning_log(detected_intent);
CREATE INDEX idx_bot_learning_edited ON bot_learning_log(was_edited) WHERE was_edited = true;
CREATE INDEX idx_bot_learning_created ON bot_learning_log(created_at);

-- =============================================================================
-- 4. Chat Drafts (for Semi Mode)
-- =============================================================================
CREATE TABLE IF NOT EXISTS chat_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  learning_log_id UUID REFERENCES bot_learning_log(id) ON DELETE SET NULL,

  draft_text TEXT NOT NULL,
  intent TEXT,
  confidence FLOAT,
  source_message_id TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),

  -- Only one active draft per chat (latest wins)
  UNIQUE(chat_id)
);

ALTER TABLE chat_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view drafts for their chats" ON chat_drafts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM chats c
      JOIN channels ch ON ch.id = c.channel_id
      JOIN profiles p ON p.workspace_id = ch.workspace_id
      WHERE c.id = chat_drafts.chat_id
      AND p.user_id = auth.uid()
    )
  );

CREATE POLICY "System can manage drafts" ON chat_drafts
  FOR ALL USING (true);

CREATE INDEX idx_chat_drafts_chat ON chat_drafts(chat_id);
CREATE INDEX idx_chat_drafts_expires ON chat_drafts(expires_at);

-- =============================================================================
-- 5. Bot Processed Messages (Idempotency)
-- =============================================================================
CREATE TABLE IF NOT EXISTS bot_processed_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  wa_message_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '5 minutes'),

  UNIQUE(channel_id, wa_message_id)
);

ALTER TABLE bot_processed_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "System can manage processed messages" ON bot_processed_messages
  FOR ALL USING (true);

-- Auto-cleanup indexes
CREATE INDEX idx_bot_processed_cleanup ON bot_processed_messages(processed_at);
CREATE INDEX idx_bot_processed_expires ON bot_processed_messages(expires_at)
  WHERE status = 'processing';

-- =============================================================================
-- 6. Helper function to clean up expired bot entries
-- =============================================================================
CREATE OR REPLACE FUNCTION cleanup_bot_processed_messages()
RETURNS void AS $$
BEGIN
  -- Delete completed entries older than 7 days
  DELETE FROM bot_processed_messages
  WHERE status = 'completed' AND processed_at < now() - interval '7 days';

  -- Delete stuck processing entries (expired TTL, allows retry)
  DELETE FROM bot_processed_messages
  WHERE status = 'processing' AND expires_at < now();

  -- Delete expired drafts
  DELETE FROM chat_drafts
  WHERE expires_at < now();
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- 7. Update timestamp trigger for bot config
-- =============================================================================
CREATE OR REPLACE FUNCTION update_channel_bot_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER channel_bot_config_updated_at
  BEFORE UPDATE ON channel_bot_config
  FOR EACH ROW
  EXECUTE FUNCTION update_channel_bot_config_updated_at();
