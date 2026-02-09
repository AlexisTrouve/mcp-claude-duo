import { brokerFetch, myId } from "../shared.js";
import { isFriend } from "../friends.js";

export const definition = {
  name: "list_partners",
  description: "Liste tous les partenaires connectes au reseau.",
  inputSchema: {
    type: "object",
    properties: {
      search: {
        type: "string",
        description: "Filtrer par nom ou ID (optionnel)",
      },
    },
  },
};

export async function handler(args) {
  try {
    const params = args.search ? `?search=${encodeURIComponent(args.search)}` : "";
    const { partners } = await brokerFetch(`/partners${params}`);

    if (!partners?.length) {
      return {
        content: [{ type: "text", text: "Aucun partenaire enregistre." }],
      };
    }

    let text = "**Partenaires:**\n\n";
    for (const p of partners) {
      const status = p.status === "online" ? "🟢" : "⚫";
      const listening = p.isListening ? " 👂" : "";
      const isMe = p.id === myId ? " (toi)" : "";
      const friend = !isMe && isFriend(p.id) ? " ⭐" : "";
      const statusMsg = p.status_message ? ` — _${p.status_message}_` : "";
      text += `${status}${listening}${friend} **${p.name}** (${p.id})${isMe}${statusMsg}\n`;
    }

    text += "\n_Legende: 🟢 en ligne, ⚫ hors ligne, 👂 en ecoute, ⭐ ami_";

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
