import express from "express";
import { timingSafeEqual } from "crypto";
import { DB } from "./db.js";

const app = express();
app.use(express.json());

const PORT = process.env.BROKER_PORT || 3210;
const BROKER_API_KEY = process.env.BROKER_API_KEY;

// Auth middleware — si BROKER_API_KEY est défini, toutes les requêtes doivent l'envoyer
if (BROKER_API_KEY) {
  const expectedHeader = `Bearer ${BROKER_API_KEY}`;
  app.use((req, res, next) => {
    const auth = req.headers.authorization || "";
    if (auth.length !== expectedHeader.length ||
        !timingSafeEqual(Buffer.from(auth), Buffer.from(expectedHeader))) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  });
  console.log("[BROKER] API key authentication enabled");
}

// Partenaires en écoute (long-polling)
// { visitorId: { res, heartbeat, timeout, conversationId? } }
const waitingPartners = new Map();

/**
 * Notifie un partenaire en attente qu'il a des messages
 */
function notifyWaitingPartner(partnerId, conversationId = null) {
  if (waitingPartners.has(partnerId)) {
    const { res, heartbeat, timeout, conversationId: listeningConvId } = waitingPartners.get(partnerId);

    // Si le partenaire écoute une conv spécifique, ne notifier que pour celle-là
    if (listeningConvId && conversationId && listeningConvId !== conversationId) {
      return false;
    }

    clearInterval(heartbeat);
    if (timeout) clearTimeout(timeout);
    waitingPartners.delete(partnerId);

    // Récupérer les messages non lus
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
 */
app.post("/register", (req, res) => {
  const { partnerId, name, projectPath } = req.body;

  if (!partnerId) {
    return res.status(400).json({ error: "partnerId required" });
  }

  const partner = DB.registerPartner(partnerId, name || partnerId, projectPath);
  console.log(`[BROKER] Registered: ${partner.name} (${partnerId})`);

  res.json({ success: true, partner });
});

/**
 * Envoyer un message dans une conversation
 * POST /talk
 * Body: { fromId, to?, conversationId?, content }
 * - to: pour créer/trouver une conv directe
 * - conversationId: pour envoyer dans une conv existante
 */
app.post("/talk", (req, res) => {
  const { fromId, to, conversationId, content } = req.body;

  if (!fromId || !content) {
    return res.status(400).json({ error: "fromId and content required" });
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
    if (!DB.isParticipant(conversationId, fromId)) {
      return res.status(403).json({ error: "Not a participant of this conversation" });
    }
    targetIds = DB.getParticipants(conversationId).map(p => p.id).filter(id => id !== fromId);
  } else {
    // Conversation directe
    const recipient = DB.getPartner(to);
    if (!recipient) {
      return res.status(404).json({
        error: "Destinataire inconnu",
        message: `"${to}" n'est pas enregistré. Il doit se register d'abord.`
      });
    }
    conv = DB.getOrCreateDirectConversation(fromId, to);
    targetIds = [to];
  }

  // Envoyer le message
  const msgId = DB.sendMessage(conv.id, fromId, content);
  console.log(`[BROKER] ${fromId} -> ${conv.id}: "${content.substring(0, 50)}..."`);

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
 * Écouter les messages (long-polling)
 * GET /listen/:partnerId?conversationId=xxx&timeout=5
 */
app.get("/listen/:partnerId", (req, res) => {
  const { partnerId } = req.params;
  const { conversationId } = req.query;

  // Timeout en minutes (min 10, max 60, défaut 30)
  let timeoutMinutes = parseInt(req.query.timeout) || 30;
  timeoutMinutes = Math.max(10, Math.min(60, timeoutMinutes));
  const timeoutMs = timeoutMinutes * 60 * 1000;

  DB.setPartnerOnline(partnerId);

  // Vérifier s'il y a des messages non lus
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
 * Créer une conversation de groupe
 * POST /conversations
 * Body: { creatorId, name, participants: [] }
 */
app.post("/conversations", (req, res) => {
  const { creatorId, name, participants } = req.body;

  if (!creatorId || !name || !participants?.length) {
    return res.status(400).json({ error: "creatorId, name, and participants required" });
  }

  // Vérifier que tous les participants existent
  for (const pid of participants) {
    if (!DB.getPartner(pid)) {
      return res.status(404).json({ error: `Partner "${pid}" not found` });
    }
  }

  const conv = DB.createGroupConversation(name, creatorId, participants);
  console.log(`[BROKER] Group conversation created: ${conv.id} by ${creatorId}`);

  res.json({ success: true, conversation: conv });
});

/**
 * Lister les conversations d'un partenaire
 * GET /conversations/:partnerId
 */
app.get("/conversations/:partnerId", (req, res) => {
  const { partnerId } = req.params;
  const conversations = DB.getConversationsByPartner(partnerId);

  // Ajouter les participants à chaque conversation
  const convsWithParticipants = conversations.map(conv => ({
    ...conv,
    participants: DB.getParticipants(conv.id).map(p => ({ id: p.id, name: p.name }))
  }));

  res.json({ conversations: convsWithParticipants });
});

/**
 * Quitter une conversation
 * POST /conversations/:conversationId/leave
 * Body: { partnerId }
 */
app.post("/conversations/:conversationId/leave", (req, res) => {
  const { conversationId } = req.params;
  const { partnerId } = req.body;

  if (!partnerId) {
    return res.status(400).json({ error: "partnerId required" });
  }

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
 */
app.get("/conversations/:conversationId/messages", (req, res) => {
  const { conversationId } = req.params;
  const limit = parseInt(req.query.limit) || 50;

  const conv = DB.getConversation(conversationId);
  if (!conv) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  const messages = DB.getMessages(conversationId, limit);
  res.json({ conversation: conv, messages });
});

/**
 * Obtenir les participants d'une conversation
 * GET /conversations/:conversationId/participants
 */
app.get("/conversations/:conversationId/participants", (req, res) => {
  const { conversationId } = req.params;
  const participants = DB.getParticipants(conversationId);
  res.json({ participants });
});

/**
 * Liste les partenaires
 * GET /partners
 */
app.get("/partners", (req, res) => {
  const partners = DB.getAllPartners().map((p) => ({
    ...p,
    isListening: waitingPartners.has(p.id),
  }));
  res.json({ partners });
});

/**
 * Définir le status message d'un partenaire
 * POST /partners/:partnerId/status
 */
app.post("/partners/:partnerId/status", (req, res) => {
  const { partnerId } = req.params;
  const { message } = req.body;
  DB.setStatusMessage(partnerId, message || null);
  res.json({ success: true });
});

/**
 * Activer/désactiver les notifications
 * POST /partners/:partnerId/notifications
 */
app.post("/partners/:partnerId/notifications", (req, res) => {
  const { partnerId } = req.params;
  const { enabled } = req.body;
  DB.setNotificationsEnabled(partnerId, enabled);
  res.json({ success: true });
});

/**
 * Se désenregistrer / passer offline
 * POST /unregister
 * Body: { partnerId }
 */
app.post("/unregister", (req, res) => {
  const { partnerId } = req.body;

  if (!partnerId) {
    return res.status(400).json({ error: "partnerId required" });
  }

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
 * Notifications non lues pour un partner (utilisé par le poller côté partner)
 * GET /notifications/:partnerId
 */
app.get("/notifications/:partnerId", (req, res) => {
  const { partnerId } = req.params;

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
 * Health check
 */
app.get("/health", (req, res) => {
  const partners = DB.getAllPartners();
  const online = partners.filter((p) => p.status === "online").length;
  const listening = waitingPartners.size;
  res.json({ status: "ok", partners: partners.length, online, listening });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[BROKER] Claude Duo Broker v3 (Conversations) running on 0.0.0.0:${PORT}`);
  if (!BROKER_API_KEY) {
    console.warn("[BROKER] WARNING: No BROKER_API_KEY set — broker is accessible without authentication on all interfaces");
  }
});
