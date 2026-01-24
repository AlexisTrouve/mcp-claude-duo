import { brokerFetch, myId, ensureRegistered } from "../shared.js";

export const definition = {
  name: "notifications",
  description: "Active ou désactive les notifications dans CLAUDE.md.",
  inputSchema: {
    type: "object",
    properties: {
      enabled: {
        type: "boolean",
        description: "true pour activer, false pour désactiver",
      },
    },
    required: ["enabled"],
  },
};

export async function handler(args) {
  try {
    await ensureRegistered();

    await brokerFetch(`/partners/${myId}/notifications`, {
      method: "POST",
      body: JSON.stringify({ enabled: args.enabled }),
    });

    const status = args.enabled ? "activées" : "désactivées";
    return {
      content: [{ type: "text", text: `Notifications ${status}.` }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur: ${error.message}` }],
      isError: true,
    };
  }
}
