import express from "express";
import { DB } from "./db.js";

const app = express();
app.use(express.json());

const PORT = process.env.BROKER_PORT || 3210;

// Réponses en attente (pour talk qui attend une réponse)
// { requestId: { resolve, fromId, toId } }
const pendingResponses = new Map();

// Long-polling en attente (pour check_messages)
// { partnerId: { res, heartbeat } }
const waitingPartners = new Map();

/**
 * S'enregistrer
 * POST /register
 */
app.post("/register", (req, res) => {
  const { partnerId, name } = req.body;

  if (!partnerId) {
    return res.status(400).json({ error: "partnerId required" });
  }

  const partner = DB.registerPartner(partnerId, name || partnerId);
  console.log(`[BROKER] Registered: ${partner.name} (${partnerId})`);

  res.json({ success: true, partner });
});

/**
 * Envoyer un message et attendre la réponse
 * POST /talk
 */
app.post("/talk", (req, res) => {
  const { fromId, toId, content } = req.body;

  if (!fromId || !toId || !content) {
    return res.status(400).json({ error: "fromId, toId, and content required" });
  }

  const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  // Enregistrer le message en DB
  const messageId = DB.sendMessage(fromId, toId, content, requestId);

  console.log(`[BROKER] ${fromId} -> ${toId}: "${content.substring(0, 50)}..."`);

  // Notifier le destinataire s'il est en attente
  notifyWaitingPartner(toId);

  // Attendre la réponse (pas de timeout)
  const responsePromise = new Promise((resolve) => {
    pendingResponses.set(requestId, { resolve, fromId, toId, messageId });
  });

  responsePromise.then((response) => {
    res.json(response);
  });
});

/**
 * Récupérer les messages non lus
 * GET /messages/:partnerId
 */
app.get("/messages/:partnerId", (req, res) => {
  const { partnerId } = req.params;

  const messages = DB.getUndeliveredMessages(partnerId);

  // Marquer comme délivrés
  for (const msg of messages) {
    DB.markDelivered(msg.id);
  }

  res.json({ messages });
});

/**
 * Attendre des messages (long-polling)
 * GET /wait/:partnerId
 */
app.get("/wait/:partnerId", (req, res) => {
  const { partnerId } = req.params;

  // Mettre à jour le status
  DB.setPartnerOnline(partnerId);

  // Check s'il y a des messages en attente
  const messages = DB.getUndeliveredMessages(partnerId);
  if (messages.length > 0) {
    // Marquer comme délivrés
    for (const msg of messages) {
      DB.markDelivered(msg.id);
    }
    return res.json({ hasMessages: true, messages });
  }

  // Annuler l'ancien waiting s'il existe
  if (waitingPartners.has(partnerId)) {
    const old = waitingPartners.get(partnerId);
    if (old.heartbeat) clearInterval(old.heartbeat);
    old.res.json({ hasMessages: false, messages: [], reason: "reconnect" });
  }

  // Heartbeat toutes les 30s
  const heartbeat = setInterval(() => {
    try {
      res.write(": heartbeat\n\n");
    } catch (e) {
      clearInterval(heartbeat);
    }
  }, 30000);

  // Nettoyer quand la connexion se ferme
  res.on("close", () => {
    clearInterval(heartbeat);
    waitingPartners.delete(partnerId);
    DB.setPartnerOffline(partnerId);
    console.log(`[BROKER] ${partnerId} disconnected`);
  });

  waitingPartners.set(partnerId, { res, heartbeat });
});

/**
 * Répondre à un message
 * POST /respond
 */
app.post("/respond", (req, res) => {
  const { fromId, toId, content, requestId } = req.body;

  console.log(`[BROKER] ${fromId} responded to ${toId}: "${content.substring(0, 50)}..."`);

  // Trouver la requête en attente
  if (requestId && pendingResponses.has(requestId)) {
    const { resolve, messageId } = pendingResponses.get(requestId);
    pendingResponses.delete(requestId);

    // Enregistrer la réponse en DB
    DB.sendResponse(fromId, toId, content, messageId);

    resolve({ success: true, content });
  } else {
    // Pas de requête en attente, juste enregistrer comme message normal
    DB.sendMessage(fromId, toId, content, null);
    notifyWaitingPartner(toId);
  }

  res.json({ success: true });
});

/**
 * Liste les partenaires
 * GET /partners
 */
app.get("/partners", (req, res) => {
  const partners = DB.getAllPartners();
  res.json({ partners });
});

/**
 * Historique de conversation
 * GET /history/:partner1/:partner2
 */
app.get("/history/:partner1/:partner2", (req, res) => {
  const { partner1, partner2 } = req.params;
  const limit = parseInt(req.query.limit) || 50;

  const messages = DB.getConversation(partner1, partner2, limit);
  res.json({ messages });
});

/**
 * Health check
 */
app.get("/health", (req, res) => {
  const partners = DB.getAllPartners();
  const online = partners.filter((p) => p.status === "online").length;
  res.json({ status: "ok", partners: partners.length, online });
});

/**
 * Notifie un partenaire en attente qu'il a des messages
 */
function notifyWaitingPartner(partnerId) {
  if (waitingPartners.has(partnerId)) {
    const { res, heartbeat } = waitingPartners.get(partnerId);
    clearInterval(heartbeat);
    waitingPartners.delete(partnerId);

    const messages = DB.getUndeliveredMessages(partnerId);
    for (const msg of messages) {
      DB.markDelivered(msg.id);
    }

    res.json({ hasMessages: true, messages });
  }
}

app.listen(PORT, () => {
  console.log(`[BROKER] Claude Duo Broker v2 running on http://localhost:${PORT}`);
  console.log(`[BROKER] Database: data/duo.db`);
});
