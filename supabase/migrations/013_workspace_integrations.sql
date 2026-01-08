-- Workspace Integrations table
-- Stores OAuth tokens and configuration for third-party integrations like Google Contacts

CREATE TABLE IF NOT EXISTS workspace_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(workspace_id, provider)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_workspace_integrations_workspace
  ON workspace_integrations(workspace_id);

-- RLS policies
ALTER TABLE workspace_integrations ENABLE ROW LEVEL SECURITY;

-- Admins can view integrations for their workspace
CREATE POLICY "Admins can view workspace integrations"
  ON workspace_integrations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
      AND profiles.workspace_id = workspace_integrations.workspace_id
      AND profiles.role IN ('main_admin', 'admin')
    )
  );

-- Only main_admin can manage integrations
CREATE POLICY "Main admin can manage integrations"
  ON workspace_integrations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.user_id = auth.uid()
      AND profiles.workspace_id = workspace_integrations.workspace_id
      AND profiles.role = 'main_admin'
    )
  );

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_workspace_integrations_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workspace_integrations_updated_at
  BEFORE UPDATE ON workspace_integrations
  FOR EACH ROW
  EXECUTE FUNCTION update_workspace_integrations_updated_at();
