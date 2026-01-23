#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BROKER_URL = process.env.BROKER_URL || "http://localhost:3210";
const PARTNER_NAME = process.env.PARTNER_NAME || "Claude";

// ID basé sur le dossier de travail (unique par projet)
const cwd = process.cwd();
const projectName = cwd.split(/[/\\]/).pop().toLowerCase().replace(/[^a-z0-9]/g, "_");
const myId = projectName || "partner";

let isRegistered = false;
let lastReceivedRequestId = null; // Pour savoir à quel message répondre

/**
 * Appel HTTP au broker
 */
async function brokerFetch(path, options = {}, timeoutMs = 0) {
  const url = `${BROKER_URL}${path}`;

  const fetchOptions = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  };

  if (timeoutMs > 0) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeoutMs);
    fetchOptions.signal = controller.signal;
  }

  const response = await fetch(url, fetchOptions);
  return response.json();
}

/**
 * S'enregistrer auprès du broker
 */
async function ensureRegistered() {
  if (!isRegistered) {
    await brokerFetch("/register", {
      method: "POST",
      body: JSON.stringify({ partnerId: myId, name: PARTNER_NAME }),
    });
    isRegistered = true;
    console.error(`[MCP-PARTNER] Registered as ${PARTNER_NAME} (${myId})`);
  }
}

// Créer le serveur MCP
const server = new Server(
  {
    name: "mcp-claude-duo-partner",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Liste des tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "register",
        description:
          "S'enregistre auprès du réseau de conversation. Utilise au début pour te connecter.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Ton nom/pseudo (optionnel)",
            },
          },
        },
      },
      {
        name: "talk",
        description:
          "Envoie un message à un partenaire et attend sa réponse. Pour initier ou continuer une conversation.",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Le message à envoyer",
            },
            to: {
              type: "string",
              description: "L'ID du destinataire (optionnel si un seul partenaire)",
            },
          },
          required: ["message"],
        },
      },
      {
        name: "check_messages",
        description:
          "Vérifie s'il y a des messages en attente. Les messages sont bufferisés, donc pas besoin d'écouter en permanence.",
        inputSchema: {
          type: "object",
          properties: {
            wait: {
              type: "boolean",
              description: "Si true, attend qu'un message arrive (long-polling). Sinon retourne immédiatement.",
            },
          },
        },
      },
      {
        name: "reply",
        description:
          "Répond au dernier message reçu. À utiliser après check_messages quand quelqu'un attend ta réponse.",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Ta réponse",
            },
          },
          required: ["message"],
        },
      },
      {
        name: "listen",
        description:
          "Écoute en temps réel les messages entrants (long-polling). Bloque jusqu'à ce qu'un message arrive.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "list_partners",
        description: "Liste tous les partenaires connectés au réseau.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "history",
        description: "Récupère l'historique de conversation avec un partenaire.",
        inputSchema: {
          type: "object",
          properties: {
            partnerId: {
              type: "string",
              description: "L'ID du partenaire",
            },
            limit: {
              type: "number",
              description: "Nombre de messages max (défaut: 20)",
            },
          },
          required: ["partnerId"],
        },
      },
    ],
  };
});

// Handler des tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "register": {
      try {
        const displayName = args.name || PARTNER_NAME;
        await brokerFetch("/register", {
          method: "POST",
          body: JSON.stringify({ partnerId: myId, name: displayName }),
        });
        isRegistered = true;

        return {
          content: [
            {
              type: "text",
              text: `Connecté en tant que **${displayName}** (ID: ${myId})`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Erreur: ${error.message}` }],
          isError: true,
        };
      }
    }

    case "talk": {
      try {
        await ensureRegistered();

        // Trouver le destinataire
        let toId = args.to;
        if (!toId) {
          const { partners } = await brokerFetch("/partners");
          const other = partners?.find((p) => p.id !== myId);
          if (!other) {
            return {
              content: [
                {
                  type: "text",
                  text: "Aucun partenaire connecté. Attends qu'un autre Claude se connecte.",
                },
              ],
            };
          }
          toId = other.id;
        }

        const response = await brokerFetch("/talk", {
          method: "POST",
          body: JSON.stringify({
            fromId: myId,
            toId,
            content: args.message,
          }),
        });

        if (response.error) {
          return {
            content: [{ type: "text", text: `Erreur: ${response.error}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `**${toId}:** ${response.content}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Erreur: ${error.message}` }],
          isError: true,
        };
      }
    }

    case "check_messages": {
      try {
        await ensureRegistered();

        let response;
        if (args.wait) {
          // Long-polling
          response = await brokerFetch(`/wait/${myId}`);
        } else {
          // Récupération immédiate
          response = await brokerFetch(`/messages/${myId}`);
          response = { messages: response.messages, hasMessages: response.messages?.length > 0 };
        }

        if (!response.hasMessages || !response.messages?.length) {
          return {
            content: [
              {
                type: "text",
                text: "Pas de nouveaux messages.",
              },
            ],
          };
        }

        // Formater les messages
        let text = `**${response.messages.length} message(s) reçu(s):**\n\n`;
        for (const msg of response.messages) {
          text += `**${msg.from_id}:** ${msg.content}\n`;
          // Garder le request_id du dernier message pour pouvoir y répondre
          if (msg.request_id) {
            lastReceivedRequestId = msg.request_id;
          }
        }

        if (lastReceivedRequestId) {
          text += `\n_Utilise \`reply\` pour répondre._`;
        }

        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Erreur: ${error.message}` }],
          isError: true,
        };
      }
    }

    case "reply": {
      try {
        await ensureRegistered();

        if (!lastReceivedRequestId) {
          return {
            content: [
              {
                type: "text",
                text: "Aucun message en attente de réponse. Utilise `check_messages` d'abord.",
              },
            ],
          };
        }

        // Trouver le destinataire original
        const { partners } = await brokerFetch("/partners");
        const other = partners?.find((p) => p.id !== myId);
        const toId = other?.id || "unknown";

        await brokerFetch("/respond", {
          method: "POST",
          body: JSON.stringify({
            fromId: myId,
            toId,
            content: args.message,
            requestId: lastReceivedRequestId,
          }),
        });

        lastReceivedRequestId = null;

        return {
          content: [
            {
              type: "text",
              text: "Réponse envoyée.",
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Erreur: ${error.message}` }],
          isError: true,
        };
      }
    }

    case "listen": {
      try {
        await ensureRegistered();

        // Long-polling - attend qu'un message arrive
        console.error("[MCP-PARTNER] Listening...");
        const response = await brokerFetch(`/wait/${myId}`);

        if (!response.hasMessages || !response.messages?.length) {
          return {
            content: [
              {
                type: "text",
                text: "Timeout. Rappelle `listen` pour continuer à écouter.",
              },
            ],
          };
        }

        // Formater les messages
        let text = "";
        for (const msg of response.messages) {
          text += `**${msg.from_id}:** ${msg.content}\n`;
          if (msg.request_id) {
            lastReceivedRequestId = msg.request_id;
          }
        }

        if (lastReceivedRequestId) {
          text += `\n_Utilise \`reply\` pour répondre._`;
        }

        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Erreur: ${error.message}` }],
          isError: true,
        };
      }
    }

    case "list_partners": {
      try {
        const { partners } = await brokerFetch("/partners");

        if (!partners?.length) {
          return {
            content: [{ type: "text", text: "Aucun partenaire enregistré." }],
          };
        }

        let text = "**Partenaires:**\n\n";
        for (const p of partners) {
          const status = p.status === "online" ? "🟢" : "⚫";
          const isMe = p.id === myId ? " (toi)" : "";
          text += `${status} **${p.name}** (${p.id})${isMe}\n`;
        }

        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Erreur: ${error.message}` }],
          isError: true,
        };
      }
    }

    case "history": {
      try {
        const limit = args.limit || 20;
        const response = await brokerFetch(
          `/history/${myId}/${args.partnerId}?limit=${limit}`
        );

        if (!response.messages?.length) {
          return {
            content: [
              {
                type: "text",
                text: `Pas d'historique avec ${args.partnerId}.`,
              },
            ],
          };
        }

        let text = `**Historique avec ${args.partnerId}:**\n\n`;
        // Inverser pour avoir l'ordre chronologique
        const messages = response.messages.reverse();
        for (const msg of messages) {
          const date = new Date(msg.created_at).toLocaleString();
          text += `[${date}] **${msg.from_id}:** ${msg.content}\n\n`;
        }

        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Erreur: ${error.message}` }],
          isError: true,
        };
      }
    }

    default:
      return {
        content: [{ type: "text", text: `Tool inconnu: ${name}` }],
        isError: true,
      };
  }
});

// Démarrer
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[MCP-PARTNER] Started (ID: ${myId})`);
}

main().catch(console.error);
