#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const BROKER_URL = process.env.BROKER_URL || "http://localhost:3210";
const PARTNER_NAME = process.env.PARTNER_NAME || process.env.SLAVE_NAME || "Partner";

// ID persistant basé sur le dossier de travail (unique par projet)
const cwd = process.cwd();
const projectName = cwd.split(/[/\\]/).pop().toLowerCase().replace(/[^a-z0-9]/g, "_");
const partnerId = projectName || PARTNER_NAME.toLowerCase().replace(/[^a-z0-9]/g, "_");

// Fichier state unique pour le hook
const __dirname = dirname(fileURLToPath(import.meta.url));
const stateDir = join(__dirname, "..", ".state");
const stateFile = join(stateDir, "current.json"); // Fichier unique, pas basé sur l'ID

// Créer le dossier state
try {
  mkdirSync(stateDir, { recursive: true });
} catch {}

let isConnected = false;
let currentRequestId = null;

/**
 * Appel HTTP au broker
 * @param {string} path - endpoint
 * @param {object} options - fetch options
 * @param {number} timeoutMs - timeout en ms (défaut: 30s, 0 = pas de timeout)
 */
async function brokerFetch(path, options = {}, timeoutMs = 30000) {
  const url = `${BROKER_URL}${path}`;

  const fetchOptions = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  };

  // Ajouter un AbortController pour le timeout si spécifié
  if (timeoutMs > 0) {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), timeoutMs);
    fetchOptions.signal = controller.signal;
  }

  const response = await fetch(url, fetchOptions);
  return response.json();
}

/**
 * Sauvegarde l'état pour le hook
 */
function saveState() {
  const state = {
    partnerId,
    partnerName: PARTNER_NAME,
    currentRequestId,
    brokerUrl: BROKER_URL,
  };
  writeFileSync(stateFile, JSON.stringify(state, null, 2));
}

// Créer le serveur MCP
const server = new Server(
  {
    name: "mcp-claude-duo-slave",
    version: "1.0.0",
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
        name: "connect",
        description:
          "Se connecte en tant que partenaire et attend les messages. Utilise cet outil pour te connecter puis pour attendre chaque nouveau message de ton interlocuteur.",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Ton nom/pseudo pour cette conversation (optionnel)",
            },
          },
        },
      },
      {
        name: "respond",
        description:
          "Envoie ta réponse à ton interlocuteur. Utilise cet outil après avoir reçu un message pour lui répondre.",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Ta réponse à envoyer",
            },
          },
          required: ["message"],
        },
      },
      {
        name: "disconnect",
        description: "Se déconnecte de la conversation",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

// Handler des tools
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "connect": {
      try {
        // S'enregistrer si pas encore fait
        if (!isConnected) {
          const name = args.name || PARTNER_NAME;
          await brokerFetch("/register", {
            method: "POST",
            body: JSON.stringify({ partnerId, name }),
          });
          isConnected = true;
          console.error(`[MCP-SLAVE] Registered as ${name} (${partnerId})`);
        }

        // Attendre un message (long-polling sans timeout)
        console.error("[MCP-SLAVE] Waiting for message...");
        const response = await brokerFetch(`/wait/${partnerId}`, {}, 0);

        if (response.disconnected) {
          isConnected = false;
          return {
            content: [{ type: "text", text: "Déconnecté." }],
          };
        }

        if (!response.hasMessage) {
          // Timeout, pas de message - réessayer
          return {
            content: [
              {
                type: "text",
                text: "Pas de nouveau message. Rappelle `connect` pour continuer à attendre.",
              },
            ],
          };
        }

        // Message reçu !
        currentRequestId = response.message.requestId;
        saveState(); // Sauvegarder pour le hook

        return {
          content: [
            {
              type: "text",
              text: `**Message reçu:** ${response.message.content}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Erreur de connexion au broker: ${error.message}. Le broker est-il lancé ?`,
            },
          ],
          isError: true,
        };
      }
    }

    case "respond": {
      try {
        if (!currentRequestId) {
          return {
            content: [
              {
                type: "text",
                text: "Aucun message en attente de réponse. Utilise `connect` d'abord pour recevoir un message.",
              },
            ],
          };
        }

        // Envoyer la réponse au broker
        await brokerFetch("/respond", {
          method: "POST",
          body: JSON.stringify({
            partnerId,
            requestId: currentRequestId,
            content: args.message,
          }),
        });

        const oldRequestId = currentRequestId;
        currentRequestId = null;
        saveState();

        return {
          content: [
            {
              type: "text",
              text: `Réponse envoyée. Utilise \`connect\` pour attendre le prochain message.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Erreur d'envoi: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    case "disconnect": {
      try {
        if (isConnected) {
          await brokerFetch("/disconnect", {
            method: "POST",
            body: JSON.stringify({ partnerId }),
          });
          isConnected = false;
        }
        return {
          content: [{ type: "text", text: "Déconnecté." }],
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
  console.error(`[MCP-SLAVE] Started (ID: ${partnerId})`);
}

main().catch(console.error);
