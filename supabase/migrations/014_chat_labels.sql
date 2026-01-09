-- Migration: Chat Labels
-- Adds ability to label chats for organization

-- =============================================================================
-- Labels Table
-- =============================================================================

-- Create labels table (workspace-level labels)
CREATE TABLE IF NOT EXISTS chat_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6b7280',  -- Default gray
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, name)
);

-- Index for workspace lookup
CREATE INDEX IF NOT EXISTS chat_labels_workspace_idx ON chat_labels(workspace_id);

-- =============================================================================
-- Label Assignments Table
-- =============================================================================

-- Create junction table for chat-label assignments
CREATE TABLE IF NOT EXISTS chat_label_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES chat_labels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, label_id)
);

-- Indexes for efficient lookups
CREATE INDEX IF NOT EXISTS chat_label_assignments_chat_idx ON chat_label_assignments(chat_id);
CREATE INDEX IF NOT EXISTS chat_label_assignments_label_idx ON chat_label_assignments(label_id);

-- =============================================================================
-- Row Level Security
-- =============================================================================

ALTER TABLE chat_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_label_assignments ENABLE ROW LEVEL SECURITY;

-- Users can view labels in their workspace
CREATE POLICY chat_labels_select ON chat_labels FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.workspace_id = chat_labels.workspace_id
        AND p.user_id = auth.uid()
    )
  );

-- Users can create labels in their workspace
CREATE POLICY chat_labels_insert ON chat_labels FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.workspace_id = chat_labels.workspace_id
        AND p.user_id = auth.uid()
    )
  );

-- Users can update labels in their workspace
CREATE POLICY chat_labels_update ON chat_labels FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.workspace_id = chat_labels.workspace_id
        AND p.user_id = auth.uid()
    )
  );

-- Only admins can delete labels
CREATE POLICY chat_labels_delete ON chat_labels FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.workspace_id = chat_labels.workspace_id
        AND p.user_id = auth.uid()
        AND p.role IN ('main_admin', 'admin')
    )
  );

-- Label assignments follow chat access
CREATE POLICY chat_label_assignments_select ON chat_label_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM chats c
      JOIN profiles p ON p.workspace_id = c.workspace_id
      WHERE c.id = chat_label_assignments.chat_id
        AND p.user_id = auth.uid()
    )
  );

-- Users can assign labels to chats in their workspace
CREATE POLICY chat_label_assignments_insert ON chat_label_assignments FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM chats c
      JOIN profiles p ON p.workspace_id = c.workspace_id
      WHERE c.id = chat_label_assignments.chat_id
        AND p.user_id = auth.uid()
    )
  );

-- Users can remove label assignments from chats in their workspace
CREATE POLICY chat_label_assignments_delete ON chat_label_assignments FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM chats c
      JOIN profiles p ON p.workspace_id = c.workspace_id
      WHERE c.id = chat_label_assignments.chat_id
        AND p.user_id = auth.uid()
    )
  );
