-- Migration: Enhanced Contacts System
-- Adds source tracking, phone lookup table, and auto-linking

-- Add source tracking to contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
-- Valid values: 'manual', 'google', 'csv_import'

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS source_metadata JSONB DEFAULT '{}';
-- For CSV: { filename, imported_at, imported_by }
-- For Google: { sync_id, last_sync }

-- Create phone lookup table for efficient matching
-- Uses SHA-256 hash of normalized E.164 phone number
CREATE TABLE IF NOT EXISTS contact_phone_lookup (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  phone_e164 TEXT NOT NULL, -- The actual E.164 phone number
  phone_e164_hash TEXT NOT NULL, -- SHA-256 hash for lookups
  phone_type TEXT, -- 'mobile', 'home', 'work', etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(contact_id, phone_e164_hash)
);

-- Index for efficient phone lookups
CREATE INDEX IF NOT EXISTS contact_phone_hash_idx ON contact_phone_lookup(phone_e164_hash);

-- Index for finding contacts by workspace
CREATE INDEX IF NOT EXISTS contact_phone_workspace_idx ON contact_phone_lookup(contact_id);

-- Enable RLS on phone lookup
ALTER TABLE contact_phone_lookup ENABLE ROW LEVEL SECURITY;

-- RLS: Users can view phone lookups for contacts in their workspace
CREATE POLICY contact_phone_lookup_select ON contact_phone_lookup FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM contacts c
      JOIN profiles p ON p.workspace_id = c.workspace_id
      WHERE c.id = contact_id AND p.user_id = auth.uid()
    )
  );

-- RLS: Users can insert phone lookups for contacts they can access
CREATE POLICY contact_phone_lookup_insert ON contact_phone_lookup FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM contacts c
      JOIN profiles p ON p.workspace_id = c.workspace_id
      WHERE c.id = contact_id AND p.user_id = auth.uid()
    )
  );

-- RLS: Users can delete phone lookups for contacts they can access
CREATE POLICY contact_phone_lookup_delete ON contact_phone_lookup FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM contacts c
      JOIN profiles p ON p.workspace_id = c.workspace_id
      WHERE c.id = contact_id AND p.user_id = auth.uid()
    )
  );

-- Add phone_e164_hash to chats for auto-linking
ALTER TABLE chats ADD COLUMN IF NOT EXISTS phone_e164_hash TEXT;

-- Index for chat phone lookups
CREATE INDEX IF NOT EXISTS chats_phone_hash_idx ON chats(phone_e164_hash)
  WHERE phone_e164_hash IS NOT NULL;

-- Function to auto-link chat to contact based on phone hash
CREATE OR REPLACE FUNCTION auto_link_chat_to_contact()
RETURNS TRIGGER AS $$
BEGIN
  -- Only try to link if we have a phone hash and no contact yet
  IF NEW.phone_e164_hash IS NOT NULL AND NEW.contact_id IS NULL THEN
    NEW.contact_id := (
      SELECT c.id FROM contacts c
      JOIN contact_phone_lookup cpl ON cpl.contact_id = c.id
      WHERE c.workspace_id = NEW.workspace_id
        AND cpl.phone_e164_hash = NEW.phone_e164_hash
      LIMIT 1
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-link on chat insert/update
DROP TRIGGER IF EXISTS auto_link_chat_trigger ON chats;
CREATE TRIGGER auto_link_chat_trigger
  BEFORE INSERT OR UPDATE OF phone_e164_hash ON chats
  FOR EACH ROW
  EXECUTE FUNCTION auto_link_chat_to_contact();

-- RLS policy for contacts - users can view contacts in their workspace
DROP POLICY IF EXISTS contacts_select ON contacts;
CREATE POLICY contacts_select ON contacts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.workspace_id = contacts.workspace_id AND p.user_id = auth.uid()
    )
  );

-- RLS policy for contacts - any workspace member can create manual contacts
DROP POLICY IF EXISTS contacts_insert ON contacts;
CREATE POLICY contacts_insert ON contacts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.workspace_id = contacts.workspace_id AND p.user_id = auth.uid()
    )
  );

-- RLS policy for contacts - any workspace member can update contacts
DROP POLICY IF EXISTS contacts_update ON contacts;
CREATE POLICY contacts_update ON contacts FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.workspace_id = contacts.workspace_id AND p.user_id = auth.uid()
    )
  );

-- RLS policy for contacts - only admins can delete (enforced at API level)
DROP POLICY IF EXISTS contacts_delete ON contacts;
CREATE POLICY contacts_delete ON contacts FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.workspace_id = contacts.workspace_id
        AND p.user_id = auth.uid()
        AND p.role IN ('main_admin', 'admin')
    )
  );
