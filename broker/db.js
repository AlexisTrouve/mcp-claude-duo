import Database from "better-sqlite3";
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    status TEXT DEFAULT 'online'
  );

  -- Messages
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    content TEXT NOT NULL,
    request_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    delivered_at DATETIME,
    response_to INTEGER REFERENCES messages(id),
    FOREIGN KEY (from_id) REFERENCES partners(id),
    FOREIGN KEY (to_id) REFERENCES partners(id)
  );

  -- Index pour les requêtes fréquentes
  CREATE INDEX IF NOT EXISTS idx_messages_to_id ON messages(to_id, delivered_at);
  CREATE INDEX IF NOT EXISTS idx_messages_request_id ON messages(request_id);
`);

// Prepared statements
const stmts = {
  // Partners
  upsertPartner: db.prepare(`
    INSERT INTO partners (id, name, last_seen, status)
    VALUES (?, ?, CURRENT_TIMESTAMP, 'online')
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      last_seen = CURRENT_TIMESTAMP,
      status = 'online'
  `),

  getPartner: db.prepare(`SELECT * FROM partners WHERE id = ?`),

  getAllPartners: db.prepare(`SELECT * FROM partners ORDER BY last_seen DESC`),

  updatePartnerStatus: db.prepare(`
    UPDATE partners SET status = ?, last_seen = CURRENT_TIMESTAMP WHERE id = ?
  `),

  // Messages
  insertMessage: db.prepare(`
    INSERT INTO messages (from_id, to_id, content, request_id)
    VALUES (?, ?, ?, ?)
  `),

  getUndeliveredMessages: db.prepare(`
    SELECT * FROM messages
    WHERE to_id = ? AND delivered_at IS NULL
    ORDER BY created_at ASC
  `),

  markDelivered: db.prepare(`
    UPDATE messages SET delivered_at = CURRENT_TIMESTAMP WHERE id = ?
  `),

  getMessageByRequestId: db.prepare(`
    SELECT * FROM messages WHERE request_id = ?
  `),

  insertResponse: db.prepare(`
    INSERT INTO messages (from_id, to_id, content, response_to)
    VALUES (?, ?, ?, ?)
  `),

  getResponse: db.prepare(`
    SELECT * FROM messages WHERE response_to = ? AND delivered_at IS NULL
  `),

  markResponseDelivered: db.prepare(`
    UPDATE messages SET delivered_at = CURRENT_TIMESTAMP WHERE response_to = ?
  `),

  // Conversations history
  getConversation: db.prepare(`
    SELECT * FROM messages
    WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?)
    ORDER BY created_at DESC
    LIMIT ?
  `),
};

// API
export const DB = {
  // Partners
  registerPartner(id, name) {
    stmts.upsertPartner.run(id, name);
    return stmts.getPartner.get(id);
  },

  getPartner(id) {
    return stmts.getPartner.get(id);
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

  // Messages
  sendMessage(fromId, toId, content, requestId = null) {
    const result = stmts.insertMessage.run(fromId, toId, content, requestId);
    return result.lastInsertRowid;
  },

  getUndeliveredMessages(toId) {
    return stmts.getUndeliveredMessages.all(toId);
  },

  markDelivered(messageId) {
    stmts.markDelivered.run(messageId);
  },

  // Pour talk() qui attend une réponse
  sendAndWaitResponse(fromId, toId, content, requestId) {
    stmts.insertMessage.run(fromId, toId, content, requestId);
  },

  getMessageByRequestId(requestId) {
    return stmts.getMessageByRequestId.get(requestId);
  },

  sendResponse(fromId, toId, content, originalMessageId) {
    stmts.insertResponse.run(fromId, toId, content, originalMessageId);
  },

  getResponse(originalMessageId) {
    return stmts.getResponse.get(originalMessageId);
  },

  markResponseDelivered(originalMessageId) {
    stmts.markResponseDelivered.run(originalMessageId);
  },

  // History
  getConversation(partnerId1, partnerId2, limit = 50) {
    return stmts.getConversation.all(partnerId1, partnerId2, partnerId2, partnerId1, limit);
  },

  // Raw access for complex queries
  raw: db,
};

export default DB;
