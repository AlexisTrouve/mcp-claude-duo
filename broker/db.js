import Database from "better-sqlite3";
import { randomUUID } from "crypto";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { mkdirSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");

// Créer le dossier data
try {
  mkdirSync(dataDir, { recursive: true });
} catch {}

const dbPath = join(dataDir, "duo.db");
const db = new Database(dbPath);

// Activer les foreign keys
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Créer les tables
db.exec(`
  -- Partenaires
  CREATE TABLE IF NOT EXISTS partners (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    partner_key TEXT UNIQUE,
    project_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'online',
    status_message TEXT,
    notifications_enabled INTEGER DEFAULT 1
  );

  -- Conversations
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT NOT NULL DEFAULT 'direct',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_by TEXT,
    is_archived INTEGER DEFAULT 0,
    FOREIGN KEY (created_by) REFERENCES partners(id)
  );

  -- Participants aux conversations
  CREATE TABLE IF NOT EXISTS conversation_participants (
    conversation_id TEXT NOT NULL,
    partner_id TEXT NOT NULL,
    joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_read_at DATETIME,
    PRIMARY KEY (conversation_id, partner_id),
    FOREIGN KEY (conversation_id) REFERENCES conversations(id),
    FOREIGN KEY (partner_id) REFERENCES partners(id)
  );

  -- Messages (maintenant liés aux conversations)
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
`);

// Migration: ajouter partner_key si la colonne n'existe pas encore
try {
  db.exec(`ALTER TABLE partners ADD COLUMN partner_key TEXT UNIQUE`);
} catch {
  // Column already exists
}

// Génère un ID de conversation directe (déterministe, trié alphabétiquement)
function getDirectConversationId(partnerId1, partnerId2) {
  const sorted = [partnerId1, partnerId2].sort();
  return `direct_${sorted[0]}_${sorted[1]}`;
}

// Prepared statements
const stmts = {
  // Partners
  upsertPartner: db.prepare(`
    INSERT INTO partners (id, name, partner_key, project_path, last_seen, status)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 'online')
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      project_path = excluded.project_path,
      last_seen = CURRENT_TIMESTAMP,
      status = 'online'
  `),

  getPartner: db.prepare(`SELECT * FROM partners WHERE id = ?`),
  getPartnerByKey: db.prepare(`SELECT * FROM partners WHERE partner_key = ?`),
  getAllPartners: db.prepare(`SELECT id, name, project_path, created_at, last_seen, status, status_message, notifications_enabled FROM partners ORDER BY last_seen DESC`),
  updatePartnerStatus: db.prepare(`UPDATE partners SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?`),
  updatePartnerNotifications: db.prepare(`UPDATE partners SET notifications_enabled = ? WHERE id = ?`),
  updatePartnerStatusMessage: db.prepare(`UPDATE partners SET status_message = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?`),

  // Conversations
  createConversation: db.prepare(`
    INSERT INTO conversations (id, name, type, created_by)
    VALUES (?, ?, ?, ?)
  `),

  getConversation: db.prepare(`SELECT * FROM conversations WHERE id = ?`),

  getConversationsByPartner: db.prepare(`
    SELECT c.*,
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id
            AND m.created_at > COALESCE(cp.last_read_at, '1970-01-01')) as unread_count
    FROM conversations c
    JOIN conversation_participants cp ON c.id = cp.conversation_id
    WHERE cp.partner_id = ? AND c.is_archived = 0
    ORDER BY c.created_at DESC
  `),

  archiveConversation: db.prepare(`UPDATE conversations SET is_archived = 1 WHERE id = ?`),

  // Participants
  addParticipant: db.prepare(`
    INSERT OR IGNORE INTO conversation_participants (conversation_id, partner_id)
    VALUES (?, ?)
  `),

  removeParticipant: db.prepare(`
    DELETE FROM conversation_participants WHERE conversation_id = ? AND partner_id = ?
  `),

  getParticipants: db.prepare(`
    SELECT p.id, p.name, p.project_path, p.created_at, p.last_seen, p.status, p.status_message, p.notifications_enabled
    FROM partners p
    JOIN conversation_participants cp ON p.id = cp.partner_id
    WHERE cp.conversation_id = ?
  `),

  countParticipants: db.prepare(`
    SELECT COUNT(*) as count FROM conversation_participants WHERE conversation_id = ?
  `),

  isParticipant: db.prepare(`
    SELECT 1 FROM conversation_participants WHERE conversation_id = ? AND partner_id = ?
  `),

  updateLastRead: db.prepare(`
    UPDATE conversation_participants SET last_read_at = CURRENT_TIMESTAMP
    WHERE conversation_id = ? AND partner_id = ?
  `),

  getLastRead: db.prepare(`
    SELECT last_read_at FROM conversation_participants
    WHERE conversation_id = ? AND partner_id = ?
  `),

  // Messages
  insertMessage: db.prepare(`
    INSERT INTO messages (conversation_id, from_id, content)
    VALUES (?, ?, ?)
  `),

  getMessages: db.prepare(`
    SELECT * FROM messages WHERE conversation_id = ?
    ORDER BY created_at ASC
    LIMIT ?
  `),

  getMessagesSince: db.prepare(`
    SELECT * FROM messages
    WHERE conversation_id = ? AND created_at > ?
    ORDER BY created_at ASC
  `),

  getUnreadMessages: db.prepare(`
    SELECT m.* FROM messages m
    JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id
    WHERE cp.partner_id = ? AND m.from_id != ?
      AND m.created_at > COALESCE(cp.last_read_at, '1970-01-01')
    ORDER BY m.created_at ASC
  `),

  getUnreadMessagesInConv: db.prepare(`
    SELECT m.* FROM messages m
    JOIN conversation_participants cp ON m.conversation_id = cp.conversation_id
    WHERE cp.partner_id = ? AND m.conversation_id = ? AND m.from_id != ?
      AND m.created_at > COALESCE(cp.last_read_at, '1970-01-01')
    ORDER BY m.created_at ASC
  `),
};

// API
export const DB = {
  // Partners
  registerPartner(id, name, projectPath = null) {
    const partnerKey = randomUUID();
    stmts.upsertPartner.run(id, name, partnerKey, projectPath);
    return stmts.getPartner.get(id);
  },

  getPartner(id) {
    return stmts.getPartner.get(id);
  },

  getPartnerByKey(key) {
    return stmts.getPartnerByKey.get(key);
  },

  getAllPartners() {
    return stmts.getAllPartners.all();
  },

  setPartnerOffline(id) {
    stmts.updatePartnerStatus.run("offline", id);
  },

  setPartnerOnline(id) {
    stmts.updatePartnerStatus.run("online", id);
  },

  setNotificationsEnabled(id, enabled) {
    stmts.updatePartnerNotifications.run(enabled ? 1 : 0, id);
  },

  setStatusMessage(id, message) {
    stmts.updatePartnerStatusMessage.run(message, id);
  },

  // Conversations
  getOrCreateDirectConversation(partnerId1, partnerId2) {
    const convId = getDirectConversationId(partnerId1, partnerId2);
    let conv = stmts.getConversation.get(convId);

    if (!conv) {
      stmts.createConversation.run(convId, null, "direct", partnerId1);
      stmts.addParticipant.run(convId, partnerId1);
      stmts.addParticipant.run(convId, partnerId2);
      conv = stmts.getConversation.get(convId);
    }

    return conv;
  },

  createGroupConversation(name, creatorId, participantIds) {
    const convId = `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    stmts.createConversation.run(convId, name, "group", creatorId);

    // Ajouter le créateur et tous les participants
    stmts.addParticipant.run(convId, creatorId);
    for (const pid of participantIds) {
      if (pid !== creatorId) {
        stmts.addParticipant.run(convId, pid);
      }
    }

    return stmts.getConversation.get(convId);
  },

  getConversation(convId) {
    return stmts.getConversation.get(convId);
  },

  getConversationsByPartner(partnerId) {
    return stmts.getConversationsByPartner.all(partnerId);
  },

  getParticipants(convId) {
    return stmts.getParticipants.all(convId);
  },

  isParticipant(convId, partnerId) {
    return !!stmts.isParticipant.get(convId, partnerId);
  },

  addParticipant(convId, partnerId) {
    stmts.addParticipant.run(convId, partnerId);
  },

  leaveConversation(convId, partnerId) {
    const conv = stmts.getConversation.get(convId);
    if (!conv) return { error: "Conversation not found" };
    if (conv.type === "direct") return { error: "Cannot leave a direct conversation" };

    stmts.removeParticipant.run(convId, partnerId);

    // Vérifier s'il reste des participants
    const count = stmts.countParticipants.get(convId).count;
    if (count === 0) {
      stmts.archiveConversation.run(convId);
      return { left: true, archived: true };
    }

    return { left: true, archived: false };
  },

  // Messages
  sendMessage(convId, fromId, content) {
    const result = stmts.insertMessage.run(convId, fromId, content);
    return result.lastInsertRowid;
  },

  getMessages(convId, limit = 50) {
    return stmts.getMessages.all(convId, limit);
  },

  getUnreadMessages(partnerId) {
    return stmts.getUnreadMessages.all(partnerId, partnerId);
  },

  getUnreadMessagesInConv(partnerId, convId) {
    return stmts.getUnreadMessagesInConv.all(partnerId, convId, partnerId);
  },

  markConversationRead(convId, partnerId) {
    stmts.updateLastRead.run(convId, partnerId);
  },

  // Raw access
  raw: db,
};

export default DB;
