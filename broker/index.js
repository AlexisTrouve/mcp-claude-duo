import express from "express";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(express.json());

const PORT = process.env.BROKER_PORT || 3210;

// Dossier pour sauvegarder les conversations
const __dirname = dirname(fileURLToPath(import.meta.url));
const conversationsDir = join(__dirname, "..", "conversations");
try {
  mkdirSync(conversationsDir, { recursive: true });
} catch {}

// Conversations actives: { visitorId: { date, messages: [] } }
const activeConversations = new Map();

/**
 * Génère l'ID de conversation basé sur les deux partners et la date
 */
function getConversationId(partnerId) {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  return `${partnerId}_${today}`;
}

/**
 * Sauvegarde un message dans la conversation
 */
function saveMessage(partnerId, from, content) {
  const convId = getConversationId(partnerId);
  const convFile = join(conversationsDir, `${convId}.json`);

  let conversation;
  if (existsSync(convFile)) {
    conversation = JSON.parse(readFileSync(convFile, "utf-8"));
  } else {
    conversation = {
      id: convId,
      partnerId,
      startedAt: new Date().toISOString(),
      messages: [],
    };
  }

  conversation.messages.push({
    from,
    content,
    timestamp: new Date().toISOString(),
  });

  writeFileSync(convFile, JSON.stringify(conversation, null, 2));
  return conversation;
}

// Slaves connectés: { id: { name, connectedAt, waitingResponse } }
const partners = new Map();

// Messages en attente pour chaque slave: { partnerId: [{ from, content, timestamp }] }
const pendingMessages = new Map();

// Réponses en attente pour le master: { requestId: { resolve, timeout } }
const pendingResponses = new Map();

// Long-polling requests en attente: { partnerId: { res, timeout } }
const waitingPartners = new Map();

/**
 * Slave s'enregistre
 * POST /register
 * Body: { partnerId, name }
 */
app.post("/register", (req, res) => {
  const { partnerId, name } = req.body;

  if (!partnerId) {
    return res.status(400).json({ error: "partnerId required" });
  }

  partners.set(partnerId, {
    name: name || partnerId,
    connectedAt: Date.now(),
    lastSeen: Date.now(),
    status: "connected",
  });

  pendingMessages.set(partnerId, []);

  console.log(`[BROKER] Slave registered: ${name || partnerId} (${partnerId})`);

  res.json({ success: true, message: "Registered" });
});

/**
 * Slave attend un message (long-polling)
 * GET /wait/:partnerId
 */
app.get("/wait/:partnerId", (req, res) => {
  const { partnerId } = req.params;

  if (!partners.has(partnerId)) {
    return res.status(404).json({ error: "Slave not registered" });
  }

  // Check s'il y a déjà un message en attente
  const messages = pendingMessages.get(partnerId) || [];
  if (messages.length > 0) {
    const msg = messages.shift();
    return res.json({ hasMessage: true, message: msg });
  }

  // Annuler l'ancien waiting s'il existe
  if (waitingPartners.has(partnerId)) {
    const old = waitingPartners.get(partnerId);
    if (old.heartbeat) clearInterval(old.heartbeat);
    old.res.json({ hasMessage: false, message: null, reason: "reconnect" });
  }

  // Heartbeat toutes les 30 secondes pour garder la connexion vivante (bug Claude Code)
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
    // Marquer le partner comme déconnecté (mais garder dans la liste pour permettre reconnexion)
    if (partners.has(partnerId)) {
      const info = partners.get(partnerId);
      info.lastSeen = Date.now();
      info.status = "disconnected";
    }
    console.log(`[BROKER] Connection closed for ${partnerId}`);
  });

  waitingPartners.set(partnerId, { res, heartbeat });

  // Mettre à jour le status
  if (partners.has(partnerId)) {
    const info = partners.get(partnerId);
    info.lastSeen = Date.now();
    info.status = "waiting";
  }
});

/**
 * Master envoie un message à un slave
 * POST /send
 * Body: { partnerId, content, requestId }
 */
app.post("/send", (req, res) => {
  const { partnerId, content, requestId } = req.body;

  if (!partnerId || !content) {
    return res.status(400).json({ error: "partnerId and content required" });
  }

  if (!partners.has(partnerId)) {
    return res.status(404).json({ error: "Slave not found" });
  }

  const message = {
    content,
    requestId,
    timestamp: Date.now(),
  };

  console.log(`[BROKER] Master -> ${partnerId}: "${content.substring(0, 50)}..."`);

  // Sauvegarder le message du master
  saveMessage(partnerId, "master", content);

  // Si le slave est en attente (long-polling), lui envoyer directement
  if (waitingPartners.has(partnerId)) {
    const { res: partnerRes, heartbeat } = waitingPartners.get(partnerId);
    if (heartbeat) clearInterval(heartbeat);
    waitingPartners.delete(partnerId);
    partnerRes.json({ hasMessage: true, message });
  } else {
    // Sinon, mettre en queue
    const messages = pendingMessages.get(partnerId) || [];
    messages.push(message);
    pendingMessages.set(partnerId, messages);
  }

  // Attendre la réponse du slave (pas de timeout)
  const responsePromise = new Promise((resolve) => {
    pendingResponses.set(requestId, { resolve, timeout: null });
  });

  responsePromise.then((response) => {
    res.json(response);
  });
});

/**
 * Slave envoie sa réponse (appelé par le hook Stop)
 * POST /respond
 * Body: { partnerId, requestId, content }
 */
app.post("/respond", (req, res) => {
  const { partnerId, requestId, content } = req.body;

  console.log(`[BROKER] ${partnerId} responded: "${content.substring(0, 50)}..."`);

  // Sauvegarder la réponse du partner
  if (partnerId && content) {
    saveMessage(partnerId, partnerId, content);
  }

  if (requestId && pendingResponses.has(requestId)) {
    const { resolve, timeout } = pendingResponses.get(requestId);
    clearTimeout(timeout);
    pendingResponses.delete(requestId);
    resolve({ success: true, content });
  }

  res.json({ success: true });
});

/**
 * Liste les partners connectés
 * GET /partners
 */
app.get("/partners", (req, res) => {
  const list = [];
  for (const [id, info] of partners) {
    list.push({ id, ...info });
  }
  res.json({ partners: list });
});

/**
 * Slave se déconnecte
 * POST /disconnect
 */
app.post("/disconnect", (req, res) => {
  const { partnerId } = req.body;

  if (partners.has(partnerId)) {
    partners.delete(partnerId);
    pendingMessages.delete(partnerId);

    if (waitingPartners.has(partnerId)) {
      const { res: partnerRes, timeout } = waitingPartners.get(partnerId);
      if (timeout) clearTimeout(timeout);
      partnerRes.json({ hasMessage: false, disconnected: true });
      waitingPartners.delete(partnerId);
    }

    console.log(`[BROKER] Slave disconnected: ${partnerId}`);
  }

  res.json({ success: true });
});

/**
 * Liste les conversations sauvegardées
 * GET /conversations
 */
app.get("/conversations", (req, res) => {
  try {
    const files = readdirSync(conversationsDir).filter((f) => f.endsWith(".json"));
    const conversations = files.map((f) => {
      const conv = JSON.parse(readFileSync(join(conversationsDir, f), "utf-8"));
      return {
        id: conv.id,
        partnerId: conv.partnerId,
        startedAt: conv.startedAt,
        messageCount: conv.messages.length,
      };
    });
    res.json({ conversations });
  } catch (error) {
    res.json({ conversations: [] });
  }
});

/**
 * Récupère une conversation spécifique
 * GET /conversations/:id
 */
app.get("/conversations/:id", (req, res) => {
  const { id } = req.params;
  const convFile = join(conversationsDir, `${id}.json`);

  if (!existsSync(convFile)) {
    return res.status(404).json({ error: "Conversation not found" });
  }

  const conversation = JSON.parse(readFileSync(convFile, "utf-8"));
  res.json(conversation);
});

/**
 * Health check
 */
app.get("/health", (req, res) => {
  res.json({ status: "ok", partners: partners.size });
});

app.listen(PORT, () => {
  console.log(`[BROKER] Claude Duo Broker running on http://localhost:${PORT}`);
});
