import { brokerFetch, myId, cwd, PARTNER_NAME, setRegistered, setPartnerKey, getPartnerKey } from "../shared.js";

export const definition = {
  name: "register",
  description: "S'enregistre aupres du reseau de conversation. Optionnel car auto-register au demarrage.",
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
    const result = await brokerFetch("/register", {
      method: "POST",
      body: JSON.stringify({ partnerId: myId, name: displayName, projectPath: cwd }),
    });

    if (result.error) {
      return {
        content: [{ type: "text", text: `Erreur: ${result.error}` }],
        isError: true,
      };
    }

    setRegistered(true);

    if (result.partner?.partnerKey) {
      setPartnerKey(result.partner.partnerKey);
    }

    const key = getPartnerKey();

    return {
      content: [
        {
          type: "text",
          text: `Connecte en tant que **${displayName}** (ID: ${myId})\nProjet: ${cwd}\n\nTa cle partner: \`${key}\`\nPartage-la avec tes amis pour qu'ils puissent t'ajouter !`,
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
