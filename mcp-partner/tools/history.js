import { brokerFetch, ensureRegistered } from "../shared.js";

export const definition = {
  name: "history",
  description: "Récupère l'historique d'une conversation.",
  inputSchema: {
    type: "object",
    properties: {
      conversation: {
        type: "string",
        description: "ID de la conversation",
      },
      limit: {
        type: "number",
        description: "Nombre de messages max (défaut: 50)",
      },
    },
    required: ["conversation"],
  },
};

export async function handler(args) {
  try {
    await ensureRegistered();

    const limit = args.limit || 50;
    const response = await brokerFetch(
      `/conversations/${args.conversation}/messages?limit=${limit}`
    );

    if (response.error) {
      return {
        content: [{ type: "text", text: `Erreur: ${response.error}` }],
        isError: true,
      };
    }

    if (!response.messages?.length) {
      return {
        content: [{ type: "text", text: `Pas de messages dans cette conversation.` }],
      };
    }

    const convName = response.conversation.name || response.conversation.id;
    let text = `**Historique: ${convName}**\n\n`;

    for (const msg of response.messages) {
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
