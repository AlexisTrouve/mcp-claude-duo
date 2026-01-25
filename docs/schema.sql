-- Schema de la base de données Claude Duo v3 (Conversations)
-- La base est créée automatiquement par broker/db.js

-- Partenaires (instances Claude Code)
CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  status TEXT DEFAULT 'online',
  status_message TEXT,
  notifications_enabled INTEGER DEFAULT 1
);

-- Conversations
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,                    -- direct_<a>_<b> ou group_<timestamp>_<random>
  name TEXT,                              -- Nom (null pour les direct)
  type TEXT NOT NULL DEFAULT 'direct',    -- 'direct' ou 'group'
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT,                        -- Créateur (pour les groupes)
  is_archived INTEGER DEFAULT 0,          -- Archivée quand plus de participants
  FOREIGN KEY (created_by) REFERENCES partners(id)
);

-- Participants aux conversations
CREATE TABLE IF NOT EXISTS conversation_participants (
  conversation_id TEXT NOT NULL,
  partner_id TEXT NOT NULL,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_read_at DATETIME,                  -- Pour calculer les messages non lus
  PRIMARY KEY (conversation_id, partner_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (partner_id) REFERENCES partners(id)
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id),
  FOREIGN KEY (from_id) REFERENCES partners(id)
);

-- Index
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_participants_partner ON conversation_participants(partner_id);
CREATE INDEX IF NOT EXISTS idx_conversations_archived ON conversations(is_archived);
