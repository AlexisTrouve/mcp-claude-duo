import { brokerFetch, myId, cwd, PARTNER_NAME, setRegistered } from "../shared.js";

export const definition = {
  name: "register",
  description: "S'enregistre auprès du réseau de conversation. Optionnel car auto-register au démarrage.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Ton nom/pseudo (optionnel)",
      },
    },
  },
};

export async function handler(args) {
  try {
    const displayName = args.name || PARTNER_NAME;
    await brokerFetch("/register", {
      method: "POST",
      body: JSON.stringify({ partnerId: myId, name: displayName, projectPath: cwd }),
    });
    setRegistered(true);

    return {
      content: [
        {
          type: "text",
          text: `Connecté en tant que **${displayName}** (ID: ${myId})\nProjet: ${cwd}`,
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
