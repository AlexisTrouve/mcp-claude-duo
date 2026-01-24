import { brokerFetch, myId, ensureRegistered } from "../shared.js";

export const definition = {
  name: "set_status",
  description: "Définit ton status visible par les autres partenaires.",
  inputSchema: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "Ton status (ex: 'Working on auth module'). Vide pour effacer.",
      },
    },
  },
};

export async function handler(args) {
  try {
    await ensureRegistered();

    await brokerFetch(`/partners/${myId}/status`, {
      method: "POST",
      body: JSON.stringify({ message: args.message || null }),
    });

    if (args.message) {
      return {
        content: [{ type: "text", text: `Status: _${args.message}_` }],
      };
    } else {
      return {
        content: [{ type: "text", text: "Status effacé." }],
      };
    }
  } catch (error) {
    return {
      content: [{ type: "text", text: `Erreur: ${error.message}` }],
      isError: true,
    };
  }
}
