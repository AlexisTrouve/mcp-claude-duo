import { addFriend } from "../friends.js";

export const definition = {
  name: "add_friend",
  description: "Ajoute un ami en stockant son ID et sa cle partner. Necessaire pour pouvoir lui envoyer des messages.",
  inputSchema: {
    type: "object",
    properties: {
      partner_id: {
        type: "string",
        description: "L'ID du partenaire a ajouter",
      },
      name: {
        type: "string",
        description: "Le nom/pseudo de l'ami (optionnel, pour reference)",
      },
      key: {
        type: "string",
        description: "La cle partner de l'ami (obtenue hors-bande)",
      },
    },
    required: ["partner_id", "key"],
  },
};

export async function handler(args) {
  try {
    const name = args.name || args.partner_id;
    addFriend(args.partner_id, name, args.key);

    return {
      content: [
        {
          type: "text",
          text: `Ami ajoute: **${name}** (${args.partner_id})\nTu peux maintenant lui envoyer des messages avec \`talk\`.`,
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
