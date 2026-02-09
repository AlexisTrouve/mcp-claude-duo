import { brokerFetch, ensureRegistered } from "../shared.js";

export const definition = {
  name: "leave_conversation",
  description: "Quitte une conversation de groupe. Impossible de quitter une conv directe.",
  inputSchema: {
    type: "object",
    properties: {
      conversation: {
        type: "string",
        description: "ID de la conversation a quitter",
      },
    },
    required: ["conversation"],
  },
};

export async function handler(args) {
  try {
    await ensureRegistered();

    const response = await brokerFetch(`/conversations/${args.conversation}/leave`, {
      method: "POST",
      body: JSON.stringify({}),
    });

    if (response.error) {
      return {
        content: [{ type: "text", text: `Erreur: ${response.error}` }],
        isError: true,
      };
    }

    const archived = response.archived ? " (conversation archivee car plus de participants)" : "";
    return {
      content: [{ type: "text", text: `Tu as quitte la conversation.${archived}` }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur: ${error.message}` }],
      isError: true,
    };
  }
}
