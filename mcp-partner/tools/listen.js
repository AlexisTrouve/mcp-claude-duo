import { brokerFetch, myId, ensureRegistered } from "../shared.js";

export const definition = {
  name: "listen",
  description: "Écoute les messages entrants. Retourne immédiatement s'il y a des messages non lus, sinon attend.",
  inputSchema: {
    type: "object",
    properties: {
      conversation: {
        type: "string",
        description: "ID de la conversation à écouter (optionnel, toutes par défaut)",
      },
      timeout: {
        type: "number",
        description: "Timeout en minutes (min: 2, max: 60, défaut: 30)",
      },
    },
  },
};

export async function handler(args) {
  try {
    await ensureRegistered();

    let timeoutMinutes = args.timeout || 30;
    timeoutMinutes = Math.max(2, Math.min(60, timeoutMinutes));

    let url = `/listen/${myId}?timeout=${timeoutMinutes}`;
    if (args.conversation) {
      url += `&conversationId=${encodeURIComponent(args.conversation)}`;
    }

    console.error(`[MCP-PARTNER] Listening (timeout: ${timeoutMinutes}min)...`);
    const response = await brokerFetch(url);

    if (response.error) {
      return {
        content: [{ type: "text", text: `Erreur: ${response.error}` }],
        isError: true,
      };
    }

    if (!response.hasMessages || !response.messages?.length) {
      return {
        content: [
          {
            type: "text",
            text: `Timeout après ${response.timeoutMinutes || timeoutMinutes} minutes. Rappelle \`listen\` pour continuer.`,
          },
        ],
      };
    }

    // Grouper par conversation
    const byConv = {};
    for (const msg of response.messages) {
      if (!byConv[msg.conversation_id]) {
        byConv[msg.conversation_id] = [];
      }
      byConv[msg.conversation_id].push(msg);
    }

    let text = `**${response.messages.length} message(s) reçu(s):**\n\n`;
    for (const [convId, msgs] of Object.entries(byConv)) {
      text += `📁 **${convId}**\n`;
      for (const msg of msgs) {
        const time = new Date(msg.created_at).toLocaleTimeString();
        text += `  [${time}] **${msg.from_id}:** ${msg.content}\n`;
      }
      text += "\n";
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
