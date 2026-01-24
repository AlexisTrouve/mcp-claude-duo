import { brokerFetch, myId } from "../shared.js";

export const definition = {
  name: "list_partners",
  description: "Liste tous les partenaires connectés au réseau.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

export async function handler() {
  try {
    const { partners } = await brokerFetch("/partners");

    if (!partners?.length) {
      return {
        content: [{ type: "text", text: "Aucun partenaire enregistré." }],
      };
    }

    let text = "**Partenaires:**\n\n";
    for (const p of partners) {
      const status = p.status === "online" ? "🟢" : "⚫";
      const listening = p.isListening ? " 👂" : "";
      const isMe = p.id === myId ? " (toi)" : "";
      const statusMsg = p.status_message ? ` — _${p.status_message}_` : "";
      text += `${status}${listening} **${p.name}** (${p.id})${isMe}${statusMsg}\n`;
    }

    text += "\n_Légende: 🟢 en ligne, ⚫ hors ligne, 👂 en écoute_";

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
