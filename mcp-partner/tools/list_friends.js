import { listFriends } from "../friends.js";
import { brokerFetch } from "../shared.js";

export const definition = {
  name: "list_friends",
  description: "Liste tes amis locaux avec leur statut en ligne.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

export async function handler() {
  try {
    const friends = listFriends();
    const ids = Object.keys(friends);

    if (!ids.length) {
      return {
        content: [{ type: "text", text: "Aucun ami enregistre. Utilise `add_friend` pour en ajouter." }],
      };
    }

    // Fetch online status from broker
    let partnersMap = {};
    try {
      const { partners } = await brokerFetch("/partners");
      if (partners) {
        for (const p of partners) {
          partnersMap[p.id] = p;
        }
      }
    } catch {}

    let text = "**Amis:**\n\n";
    for (const id of ids) {
      const friend = friends[id];
      const partner = partnersMap[id];
      const status = partner?.status === "online" ? "🟢" : "⚫";
      const listening = partner?.isListening ? " 👂" : "";
      const statusMsg = partner?.status_message ? ` — _${partner.status_message}_` : "";
      text += `${status}${listening} **${friend.name}** (${id})${statusMsg}\n`;
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
