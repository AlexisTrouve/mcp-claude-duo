import { brokerFetch, myId, ensureRegistered } from "../shared.js";

export const definition = {
  name: "talk",
  description: "Envoie un message dans une conversation. Crée automatiquement une conv directe si besoin.",
  inputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "Le message à envoyer",
      },
      to: {
        type: "string",
        description: "L'ID du destinataire (pour conv directe)",
      },
      conversation: {
        type: "string",
        description: "L'ID de la conversation (pour conv existante)",
      },
    },
    required: ["message"],
  },
};

export async function handler(args) {
  try {
    await ensureRegistered();

    if (!args.to && !args.conversation) {
      // Essayer de trouver un partenaire unique
      const { partners } = await brokerFetch("/partners");
      const others = partners?.filter((p) => p.id !== myId);
      if (!others?.length) {
        return {
          content: [{ type: "text", text: "Aucun partenaire enregistré. Précise `to` ou `conversation`." }],
          isError: true,
        };
      }
      if (others.length === 1) {
        args.to = others[0].id;
      } else {
        return {
          content: [
            {
              type: "text",
              text: `Plusieurs partenaires: ${others.map((p) => p.id).join(", ")}. Précise \`to\` ou \`conversation\`.`,
            },
          ],
          isError: true,
        };
      }
    }

    const response = await brokerFetch("/talk", {
      method: "POST",
      body: JSON.stringify({
        fromId: myId,
        to: args.to,
        conversationId: args.conversation,
        content: args.message,
      }),
    });

    if (response.error) {
      return {
        content: [{ type: "text", text: `Erreur: ${response.error}\n${response.message || ""}` }],
        isError: true,
      };
    }

    const status = response.notified > 0
      ? `${response.notified} notifié(s) en temps réel`
      : `${response.queued} en file d'attente`;

    return {
      content: [
        {
          type: "text",
          text: `Message envoyé dans ${response.conversationId}\n${status}`,
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
