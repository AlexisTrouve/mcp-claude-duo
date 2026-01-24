import { brokerFetch, myId, ensureRegistered } from "../shared.js";

export const definition = {
  name: "create_conversation",
  description: "Crée une nouvelle conversation de groupe.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Nom de la conversation",
      },
      participants: {
        type: "string",
        description: "IDs des participants séparés par des virgules",
      },
    },
    required: ["name", "participants"],
  },
};

export async function handler(args) {
  try {
    await ensureRegistered();

    const participantIds = args.participants.split(",").map((s) => s.trim());

    const response = await brokerFetch("/conversations", {
      method: "POST",
      body: JSON.stringify({
        creatorId: myId,
        name: args.name,
        participants: participantIds,
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
          text: `Conversation créée: **${args.name}**\nID: \`${response.conversation.id}\`\nParticipants: ${participantIds.join(", ")}`,
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
