import express from "express";
import { DB } from "./db.js";

const app = express();
app.use(express.json());

const PORT = process.env.BROKER_PORT || 3210;

/**
 * Resolve partner from Bearer token
 * Returns partner object or null
 */
function resolvePartner(req) {
  const auth = req.headers.authorization || "";
  if (!auth.startsWith("Bearer ")) return null;
  const key = auth.slice(7);
  if (!key) return null;
  return DB.getPartnerByKey(key);
}

/**
 * Auth middleware — requires valid partner key
 */
function requireAuth(req, res, next) {
  const partner = resolvePartner(req);
  if (!partner) {
    return res.status(401).json({ error: "Unauthorized — invalid or missing partner key" });
  }
  req.partner = partner;
  next();
}

// Partenaires en ecoute (long-polling)
// { visitorId: { res, heartbeat, timeout, conversationId? } }
const waitingPartners = new Map();

/**
 * Notifie un partenaire en attente qu'il a des messages
 */
function notifyWaitingPartner(partnerId, conversationId = null) {
  if (waitingPartners.has(partnerId)) {
    const { res, heartbeat, timeout, conversationId: listeningConvId } = waitingPartners.get(partnerId);

    // Si le partenaire ecoute une conv specifique, ne notifier que pour celle-la
    if (listeningConvId && conversationId && listeningConvId !== conversationId) {
      return false;
    }

    clearInterval(heartbeat);
    if (timeout) clearTimeout(timeout);
    waitingPartners.delete(partnerId);

    // Recuperer les messages non lus
    let messages;
    if (listeningConvId) {
      messages = DB.getUnreadMessagesInConv(partnerId, listeningConvId);
      DB.markConversationRead(listeningConvId, partnerId);
    } else {
      messages = DB.getUnreadMessages(partnerId);
      // Marquer toutes les convs comme lues
      const convIds = [...new Set(messages.map(m => m.conversation_id))];
      for (const cid of convIds) {
        DB.markConversationRead(cid, partnerId);
      }
    }

    try {
      res.json({ hasMessages: true, messages });
    } catch {}

    return true;
  }
  return false;
}

// ============ ROUTES ============

/**
 * S'enregistrer
 * POST /register
 * - Nouveau partner (pas de Bearer) : cree le partner, retourne la cle
 * - Partner existant (Bearer) : met a jour name/projectPath
 */
app.post("/register", (req, res) => {
  const { partnerId, name, projectPath } = req.body;

  if (!partnerId) {
    return res.status(400).json({ error: "partnerId required" });
  }

  const existing = DB.getPartner(partnerId);

  if (existing) {
    // Partner exists — require Bearer to re-register
    const partner = resolvePartner(req);
    if (!partner || partner.id !== partnerId) {
      return res.status(401).json({ error: "Partner already exists — provide your partner key to re-register" });
    }
    // Update info
    const updated = DB.registerPartner(partnerId, name || existing.name, projectPath);
    console.log(`[BROKER] Re-registered: ${updated.name} (${partnerId})`);
    const { partner_key: pk1, ...safeUpdated } = updated;
    return res.json({ success: true, partner: { ...safeUpdated, partnerKey: pk1 } });
  }

  // New partner — open registration
  const partner = DB.registerPartner(partnerId, name || partnerId, projectPath);
  console.log(`[BROKER] New registration: ${partner.name} (${partnerId})`);
  const { partner_key: pk2, ...safePartner } = partner;
  res.json({ success: true, partner: { ...safePartner, partnerKey: pk2 } });
});

/**
 * Envoyer un message dans une conversation
 * POST /talk
 * Auth: Bearer sender key
 * Body: { to?, friendKey?, conversationId?, content }
 * - DM: requires friendKey (recipient's key)
 * - Existing conv: just needs to be participant
 */
app.post("/talk", requireAuth, (req, res) => {
  const sender = req.partner;
  const { to, friendKey, conversationId, content } = req.body;

  if (!content) {
    return res.status(400).json({ error: "content required" });
  }

  if (!to && !conversationId) {
    return res.status(400).json({ error: "Either 'to' or 'conversationId' required" });
  }

  let conv;
  let targetIds = [];

  if (conversationId) {
    // Envoyer dans une conv existante
    conv = DB.getConversation(conversationId);
    if (!conv) {
      return res.status(404).json({ error: "Conversation not found" });
    }
    if (!DB.isParticipant(conversationId, sender.id)) {
      return res.status(403).json({ error: "Not a participant of this conversation" });
    }
    targetIds = DB.getParticipants(conversationId).map(p => p.id).filter(id => id !== sender.id);
  } else {
    // Conversation directe — require friendKey
    if (!friendKey) {
      return res.status(403).json({ error: "friendKey required for direct messages" });
    }

    // Validate friendKey matches the recipient
    const recipient = DB.getPartner(to);
    if (!recipient) {
      return res.status(404).json({
        error: "Destinataire inconnu",
        message: `"${to}" n'est pas enregistre.`
      });
    }

    if (recipient.partner_key !== friendKey) {
      return res.status(403).json({ error: "Invalid friendKey — does not match recipient" });
    }

    conv = DB.getOrCreateDirectConversation(sender.id, to);
    targetIds = [to];
  }

  // Envoyer le message
  const msgId = DB.sendMessage(conv.id, sender.id, content);
  console.log(`[BROKER] ${sender.id} -> ${conv.id}: "${content.substring(0, 50)}..."`);

  // Notifier les participants
  let notifiedCount = 0;
  for (const targetId of targetIds) {
    if (notifyWaitingPartner(targetId, conv.id)) {
      notifiedCount++;
    }
  }

  res.json({
    success: true,
    conversationId: conv.id,
    messageId: msgId,
    notified: notifiedCount,
    queued: targetIds.length - notifiedCount
  });
});

/**
 * Ecouter les messages (long-polling)
 * GET /listen/:partnerId
 * Auth: Bearer must match partnerId
 */
app.get("/listen/:partnerId", requireAuth, (req, res) => {
  const { partnerId } = req.params;
  const { conversationId } = req.query;

  if (req.partner.id !== partnerId) {
    return res.status(403).json({ error: "Partner key does not match partnerId" });
  }

  // Timeout en minutes (min 10, max 60, defaut 30)
  let timeoutMinutes = parseInt(req.query.timeout) || 30;
  timeoutMinutes = Math.max(10, Math.min(60, timeoutMinutes));
  const timeoutMs = timeoutMinutes * 60 * 1000;

  DB.setPartnerOnline(partnerId);

  // Verifier s'il y a des messages non lus
  let messages;
  if (conversationId) {
    if (!DB.isParticipant(conversationId, partnerId)) {
      return res.status(403).json({ error: "Not a participant of this conversation" });
    }
    messages = DB.getUnreadMessagesInConv(partnerId, conversationId);
  } else {
    messages = DB.getUnreadMessages(partnerId);
  }

  if (messages.length > 0) {
    // Marquer comme lu
    const convIds = [...new Set(messages.map(m => m.conversation_id))];
    for (const cid of convIds) {
      DB.markConversationRead(cid, partnerId);
    }
    return res.json({ hasMessages: true, messages });
  }

  // Pas de messages, on attend
  if (waitingPartners.has(partnerId)) {
    const old = waitingPartners.get(partnerId);
    if (old.heartbeat) clearInterval(old.heartbeat);
    if (old.timeout) clearTimeout(old.timeout);
    try {
      old.res.json({ hasMessages: false, messages: [], reason: "reconnect" });
    } catch {}
  }

  const timeout = setTimeout(() => {
    if (waitingPartners.has(partnerId)) {
      const waiting = waitingPartners.get(partnerId);
      clearInterval(waiting.heartbeat);
      waitingPartners.delete(partnerId);
      try {
        res.json({ hasMessages: false, messages: [], reason: "timeout", timeoutMinutes });
      } catch {}
    }
  }, timeoutMs);

  const heartbeat = setInterval(() => {}, 30000);

  res.on("close", () => {
    clearInterval(heartbeat);
    clearTimeout(timeout);
    waitingPartners.delete(partnerId);
    DB.setPartnerOffline(partnerId);
    console.log(`[BROKER] ${partnerId} disconnected`);
  });

  waitingPartners.set(partnerId, { res, heartbeat, timeout, conversationId });
  console.log(`[BROKER] ${partnerId} is now listening${conversationId ? ` on ${conversationId}` : ""}`);
});

/**
 * Creer une conversation de groupe
 * POST /conversations
 * Auth: Bearer creator key
 * Body: { name, participants: [], friendKeys: [] }
 * friendKeys[i] = partner key of participants[i]
 */
app.post("/conversations", requireAuth, (req, res) => {
  const creator = req.partner;
  const { name, participants, friendKeys } = req.body;

  if (!name || !participants?.length) {
    return res.status(400).json({ error: "name and participants required" });
  }

  if (!friendKeys || friendKeys.length !== participants.length) {
    return res.status(400).json({ error: "friendKeys required — one key per participant" });
  }

  // Verify all participants exist and friendKeys match
  for (let i = 0; i < participants.length; i++) {
    const pid = participants[i];
    if (pid === creator.id) continue; // skip self
    const p = DB.getPartner(pid);
    if (!p) {
      return res.status(404).json({ error: `Partner "${pid}" not found` });
    }
    if (p.partner_key !== friendKeys[i]) {
      return res.status(403).json({ error: `Invalid friendKey for participant "${pid}"` });
    }
  }

  const conv = DB.createGroupConversation(name, creator.id, participants);
  console.log(`[BROKER] Group conversation created: ${conv.id} by ${creator.id}`);

  res.json({ success: true, conversation: conv });
});

/**
 * Lister les conversations d'un partenaire
 * GET /conversations/:partnerId
 * Auth: Bearer must match partnerId
 */
app.get("/conversations/:partnerId", requireAuth, (req, res) => {
  const { partnerId } = req.params;

  if (req.partner.id !== partnerId) {
    return res.status(403).json({ error: "Partner key does not match partnerId" });
  }

  const conversations = DB.getConversationsByPartner(partnerId);

  // Ajouter les participants a chaque conversation
  const convsWithParticipants = conversations.map(conv => ({
    ...conv,
    participants: DB.getParticipants(conv.id).map(p => ({ id: p.id, name: p.name }))
  }));

  res.json({ conversations: convsWithParticipants });
});

/**
 * Quitter une conversation
 * POST /conversations/:conversationId/leave
 * Auth: Bearer identifies the partner (no partnerId in body needed)
 */
app.post("/conversations/:conversationId/leave", requireAuth, (req, res) => {
  const { conversationId } = req.params;
  const partnerId = req.partner.id;

  const result = DB.leaveConversation(conversationId, partnerId);

  if (result.error) {
    return res.status(400).json({ error: result.error });
  }

  console.log(`[BROKER] ${partnerId} left ${conversationId}${result.archived ? " (archived)" : ""}`);
  res.json({ success: true, ...result });
});

/**
 * Obtenir l'historique d'une conversation
 * GET /conversations/:conversationId/messages?limit=50
 * Auth: Bearer must be a participant
 */
app.get("/conversations/:conversationId/messages", requireAuth, (req, res) => {
  const { conversationId } = req.params;
  const limit = parseInt(req.query.limit) || 50;

  const conv = DB.getConversation(conversationId);
  if (!conv) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  if (!DB.isParticipant(conversationId, req.partner.id)) {
    return res.status(403).json({ error: "Not a participant of this conversation" });
  }

  const messages = DB.getMessages(conversationId, limit);
  res.json({ conversation: conv, messages });
});

/**
 * Obtenir les participants d'une conversation
 * GET /conversations/:conversationId/participants
 * Auth: Bearer must be a participant
 */
app.get("/conversations/:conversationId/participants", requireAuth, (req, res) => {
  const { conversationId } = req.params;

  if (!DB.isParticipant(conversationId, req.partner.id)) {
    return res.status(403).json({ error: "Not a participant of this conversation" });
  }

  const participants = DB.getParticipants(conversationId);
  res.json({ participants });
});

/**
 * Liste les partenaires (public, sans keys)
 * GET /partners?search=xxx
 */
app.get("/partners", (req, res) => {
  let partners = DB.getAllPartners().map((p) => ({
    ...p,
    isListening: waitingPartners.has(p.id),
  }));

  const search = req.query.search;
  if (search) {
    const q = search.toLowerCase();
    partners = partners.filter(p =>
      p.id.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)
    );
  }

  res.json({ partners });
});

/**
 * Definir le status message d'un partenaire
 * POST /partners/:partnerId/status
 * Auth: Bearer must match partnerId
 */
app.post("/partners/:partnerId/status", requireAuth, (req, res) => {
  const { partnerId } = req.params;

  if (req.partner.id !== partnerId) {
    return res.status(403).json({ error: "Partner key does not match partnerId" });
  }

  const { message } = req.body;
  DB.setStatusMessage(partnerId, message || null);
  res.json({ success: true });
});

/**
 * Activer/desactiver les notifications
 * POST /partners/:partnerId/notifications
 * Auth: Bearer must match partnerId
 */
app.post("/partners/:partnerId/notifications", requireAuth, (req, res) => {
  const { partnerId } = req.params;

  if (req.partner.id !== partnerId) {
    return res.status(403).json({ error: "Partner key does not match partnerId" });
  }

  const { enabled } = req.body;
  DB.setNotificationsEnabled(partnerId, enabled);
  res.json({ success: true });
});

/**
 * Se desenregistrer / passer offline
 * POST /unregister
 * Auth: Bearer identifies the partner
 */
app.post("/unregister", requireAuth, (req, res) => {
  const partnerId = req.partner.id;

  // Fermer la connexion long-polling si active
  if (waitingPartners.has(partnerId)) {
    const { res: waitingRes, heartbeat, timeout } = waitingPartners.get(partnerId);
    clearInterval(heartbeat);
    if (timeout) clearTimeout(timeout);
    waitingPartners.delete(partnerId);
    try {
      waitingRes.json({ hasMessages: false, messages: [], reason: "unregistered" });
    } catch {}
  }

  DB.setPartnerOffline(partnerId);
  console.log(`[BROKER] Unregistered: ${partnerId}`);

  res.json({ success: true });
});

/**
 * Notifications non lues pour un partner
 * GET /notifications/:partnerId
 * Auth: Bearer must match partnerId
 */
app.get("/notifications/:partnerId", requireAuth, (req, res) => {
  const { partnerId } = req.params;

  if (req.partner.id !== partnerId) {
    return res.status(403).json({ error: "Partner key does not match partnerId" });
  }

  const messages = DB.getUnreadMessages(partnerId);
  if (!messages.length) {
    return res.json({ notifications: [] });
  }

  const notifications = messages.map((m) => ({
    from_id: m.from_id,
    conversation_id: m.conversation_id,
    content: m.content.substring(0, 200) + (m.content.length > 200 ? "..." : ""),
    created_at: m.created_at,
  }));

  res.json({ notifications });
});

/**
 * Health check (public)
 */
app.get("/health", (req, res) => {
  const partners = DB.getAllPartners();
  const online = partners.filter((p) => p.status === "online").length;
  const listening = waitingPartners.size;
  res.json({ status: "ok", partners: partners.length, online, listening });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[BROKER] Claude Duo Broker v4 (Partner Keys) running on 0.0.0.0:${PORT}`);
});
