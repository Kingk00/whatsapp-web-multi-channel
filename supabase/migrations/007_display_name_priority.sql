-- Migration: Display Name Priority
-- Adds wa_display_name column to store original WhatsApp name separately
-- so display_name can show contact name > phone number

-- Store original WhatsApp display name
ALTER TABLE chats ADD COLUMN IF NOT EXISTS wa_display_name TEXT;

-- Copy current display_name to wa_display_name for existing chats
-- (This is a one-time data migration)
UPDATE chats
SET wa_display_name = display_name
WHERE wa_display_name IS NULL AND display_name IS NOT NULL;

-- Comment explaining the display priority:
-- When rendering, use: contact.display_name > chat.phone_number > chat.wa_display_name
-- The display_name column on chats table will be deprecated in favor of wa_display_name
-- UI should use helper function to compute display name based on linked contact
