#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BROKER_URL = process.env.BROKER_URL || "http://localhost:3210";

/**
 * Appel HTTP au broker
 */
async function brokerFetch(path, options = {}) {
  const url = `${BROKER_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  return response.json();
}

// Créer le serveur MCP
const server = new Server(
  {
    name: "mcp-claude-duo-master",
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
        name: "talk",
        description:
          "Envoie un message à ton partenaire Claude et attend sa réponse. Utilise ceci pour avoir une conversation.",
        inputSchema: {
          type: "object",
          properties: {
            message: {
              type: "string",
              description: "Le message à envoyer à ton partenaire",
            },
            partnerId: {
              type: "string",
              description:
                "L'ID du partenaire (optionnel si un seul partenaire connecté)",
            },
          },
          required: ["message"],
        },
      },
      {
        name: "list_partners",
        description: "Liste tous les partenaires Claude connectés et disponibles",
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
    case "talk": {
      try {
        // Récupérer la liste des slaves si pas de partnerId spécifié
        let partnerId = args.partnerId;

        if (!partnerId) {
          const { partners } = await brokerFetch("/partners");
          if (!partners || partners.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "Aucun partenaire connecté. Demande à ton partenaire de se connecter d'abord.",
                },
              ],
            };
          }
          partnerId = partners[0].id;
        }

        const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const response = await brokerFetch("/send", {
          method: "POST",
          body: JSON.stringify({
            partnerId,
            content: args.message,
            requestId,
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
              text: `**Partenaire:** ${response.content}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Erreur de communication avec le broker: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    case "list_partners": {
      try {
        const { partners } = await brokerFetch("/partners");

        if (!partners || partners.length === 0) {
          return {
            content: [
              {
                type: "text",
                text: "Aucun partenaire connecté pour le moment.",
              },
            ],
          };
        }

        let text = "**Partenaires connectés:**\n\n";
        for (const partner of partners) {
          const connectedSince = Math.round(
            (Date.now() - partner.connectedAt) / 1000
          );
          text += `- **${partner.name}** (ID: ${partner.id}) - connecté depuis ${connectedSince}s\n`;
        }

        return {
          content: [{ type: "text", text }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Erreur: ${error.message}. Le broker est-il lancé ?`,
            },
          ],
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
  console.error("[MCP-MASTER] Started");
}

main().catch(console.error);
