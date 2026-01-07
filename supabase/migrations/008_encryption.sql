-- Migration: Data Encryption Enhancement
-- Per-workspace Data Encryption Keys (DEKs) for encrypting sensitive PII
-- Master key (ENCRYPTION_KEY env) encrypts workspace DEKs

-- =============================================================================
-- Workspace Encryption Keys
-- =============================================================================

-- Store encrypted workspace-specific DEKs
-- The DEK is randomly generated per workspace and encrypted with the master key
CREATE TABLE IF NOT EXISTS workspace_encryption_keys (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  encrypted_dek TEXT NOT NULL,  -- AES-256 key encrypted with master ENCRYPTION_KEY
  key_version INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  rotated_at TIMESTAMPTZ
);

-- No RLS - only server (service role) can access encryption keys
ALTER TABLE workspace_encryption_keys ENABLE ROW LEVEL SECURITY;
-- No policies = no client access

-- =============================================================================
-- Phone Number Hashing for Matching
-- =============================================================================

-- Add hash column to chats for efficient phone matching
ALTER TABLE chats ADD COLUMN IF NOT EXISTS phone_e164_hash TEXT;
CREATE INDEX IF NOT EXISTS chats_phone_hash_idx ON chats(workspace_id, phone_e164_hash)
  WHERE phone_e164_hash IS NOT NULL;

-- =============================================================================
-- Encrypted Field Columns (alongside originals during migration)
-- =============================================================================

-- Contacts: encrypted sensitive fields
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS display_name_enc TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone_numbers_enc TEXT;

-- Chats: encrypted sensitive fields
ALTER TABLE chats ADD COLUMN IF NOT EXISTS display_name_enc TEXT;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS last_message_preview_enc TEXT;

-- Messages: encrypted content
ALTER TABLE messages ADD COLUMN IF NOT EXISTS text_enc TEXT;

-- =============================================================================
-- Updated Auto-Link Trigger
-- =============================================================================

-- Update auto-link function to use phone hash
CREATE OR REPLACE FUNCTION auto_link_chat_to_contact()
RETURNS TRIGGER AS $$
BEGIN
  -- Only try to link if we have a phone hash and no contact linked yet
  IF NEW.phone_e164_hash IS NOT NULL AND NEW.contact_id IS NULL THEN
    -- Find matching contact via phone lookup table
    NEW.contact_id := (
      SELECT c.id
      FROM contacts c
      JOIN contact_phone_lookup cpl ON cpl.contact_id = c.id
      WHERE c.workspace_id = NEW.workspace_id
        AND cpl.phone_e164_hash = NEW.phone_e164_hash
      LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure trigger exists
DROP TRIGGER IF EXISTS chat_auto_link_contact ON chats;
CREATE TRIGGER chat_auto_link_contact
  BEFORE INSERT OR UPDATE OF phone_e164_hash ON chats
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_chat_to_contact();

-- =============================================================================
-- Note: Encryption Implementation
-- =============================================================================
--
-- The encryption system works as follows:
--
-- 1. Each workspace gets a unique 256-bit DEK (Data Encryption Key)
-- 2. The DEK is encrypted with the master ENCRYPTION_KEY and stored in workspace_encryption_keys
-- 3. When reading/writing sensitive data, the API:
--    a. Retrieves the encrypted DEK for the workspace
--    b. Decrypts the DEK with the master key
--    c. Uses the DEK to encrypt/decrypt the actual data
--
-- This provides:
-- - Key isolation: compromising one workspace's DEK doesn't affect others
-- - Key rotation: workspace DEKs can be rotated independently
-- - Audit: key version tracking for compliance
--
-- Sensitive fields that should use encryption:
-- - contacts.display_name, contacts.phone_numbers (PII)
-- - chats.display_name, chats.last_message_preview (PII)
-- - messages.text (message content)
--
-- Non-sensitive fields (use hashing for lookups):
-- - chats.phone_e164_hash (for matching contacts)
-- - contact_phone_lookup.phone_e164_hash (for matching)
