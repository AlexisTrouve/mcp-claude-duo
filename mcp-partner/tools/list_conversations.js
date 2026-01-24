import { brokerFetch, myId, ensureRegistered } from "../shared.js";

export const definition = {
  name: "list_conversations",
  description: "Liste toutes tes conversations actives.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

export async function handler() {
  try {
    await ensureRegistered();

    const { conversations } = await brokerFetch(`/conversations/${myId}`);

    if (!conversations?.length) {
      return {
        content: [{ type: "text", text: "Aucune conversation." }],
      };
    }

    let text = "**Conversations:**\n\n";
    for (const conv of conversations) {
      const type = conv.type === "direct" ? "💬" : "👥";
      const unread = conv.unread_count > 0 ? ` (${conv.unread_count} non lu${conv.unread_count > 1 ? "s" : ""})` : "";
      const participants = conv.participants.map((p) => p.name).join(", ");
      const name = conv.name || participants;
      text += `${type} **${name}**${unread}\n   ID: \`${conv.id}\`\n   Participants: ${participants}\n\n`;
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
