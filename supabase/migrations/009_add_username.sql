-- Migration: 009_add_username.sql
-- Adds username field to profiles table for team management display

-- Add username column to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS username TEXT;

-- Create unique index for username within workspace
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_workspace_unique
  ON profiles(workspace_id, username)
  WHERE username IS NOT NULL;

-- Set default username from display_name for existing users
UPDATE profiles
SET username = LOWER(REGEXP_REPLACE(display_name, '[^a-zA-Z0-9]', '', 'g'))
WHERE username IS NULL;
