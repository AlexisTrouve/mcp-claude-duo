import { removeFriend } from "../friends.js";

export const definition = {
  name: "remove_friend",
  description: "Supprime un ami de ta liste locale.",
  inputSchema: {
    type: "object",
    properties: {
      partner_id: {
        type: "string",
        description: "L'ID du partenaire a supprimer",
      },
    },
    required: ["partner_id"],
  },
};

export async function handler(args) {
  try {
    const removed = removeFriend(args.partner_id);

    if (!removed) {
      return {
        content: [{ type: "text", text: `"${args.partner_id}" n'est pas dans ta liste d'amis.` }],
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Ami supprime: ${args.partner_id}`,
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
