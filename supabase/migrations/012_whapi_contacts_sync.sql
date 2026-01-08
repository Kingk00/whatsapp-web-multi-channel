-- Migration: Whapi Contacts Sync
-- Adds fields to track contacts synced from Whapi

-- Add columns to contacts table for Whapi tracking
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS whapi_contact_id TEXT,
  ADD COLUMN IF NOT EXISTS whapi_synced_at TIMESTAMPTZ;

-- Unique constraint for Whapi contact ID per workspace
-- This ensures we don't have duplicate Whapi contacts in the same workspace
CREATE UNIQUE INDEX IF NOT EXISTS contacts_whapi_id_unique
  ON contacts (workspace_id, whapi_contact_id)
  WHERE whapi_contact_id IS NOT NULL;

-- Add comment explaining the workspace settings usage
COMMENT ON COLUMN contacts.whapi_contact_id IS 'Whapi contact ID for synced contacts';
COMMENT ON COLUMN contacts.whapi_synced_at IS 'Last time this contact was synced with Whapi';

-- Note: Workspace sync settings are stored in workspaces.settings JSONB:
-- {
--   "whapi_contacts_sync": {
--     "sync_channel_id": "<uuid or null>",
--     "last_synced_at": "<timestamp or null>"
--   }
-- }
