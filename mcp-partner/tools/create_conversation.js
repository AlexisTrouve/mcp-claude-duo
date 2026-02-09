import { brokerFetch, myId, ensureRegistered } from "../shared.js";
import { getFriendKey } from "../friends.js";

export const definition = {
  name: "create_conversation",
  description: "Cree une nouvelle conversation de groupe.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Nom de la conversation",
      },
      participants: {
        type: "string",
        description: "IDs des participants separes par des virgules",
      },
    },
    required: ["name", "participants"],
  },
};

export async function handler(args) {
  try {
    await ensureRegistered();

    const participantIds = args.participants.split(",").map((s) => s.trim());

    // Lookup friendKeys for each participant
    const friendKeys = [];
    for (const pid of participantIds) {
      if (pid === myId) {
        friendKeys.push("self");
        continue;
      }
      const key = getFriendKey(pid);
      if (!key) {
        return {
          content: [
            {
              type: "text",
              text: `"${pid}" n'est pas dans ta liste d'amis. Utilise \`add_friend\` pour l'ajouter d'abord.`,
            },
          ],
          isError: true,
        };
      }
      friendKeys.push(key);
    }

    const response = await brokerFetch("/conversations", {
      method: "POST",
      body: JSON.stringify({
        name: args.name,
        participants: participantIds,
        friendKeys,
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
          text: `Conversation creee: **${args.name}**\nID: \`${response.conversation.id}\`\nParticipants: ${participantIds.join(", ")}`,
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
