#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { brokerFetch, myId, PARTNER_NAME, cwd, setRegistered, setPartnerKey, getPartnerKey } from "./shared.js";
import { startNotificationPoller } from "./notifications-poller.js";

// Import all tools
import * as register from "./tools/register.js";
import * as talk from "./tools/talk.js";
import * as listen from "./tools/listen.js";
import * as listPartners from "./tools/list_partners.js";
import * as listConversations from "./tools/list_conversations.js";
import * as createConversation from "./tools/create_conversation.js";
import * as leaveConversation from "./tools/leave_conversation.js";
import * as history from "./tools/history.js";
import * as setStatus from "./tools/set_status.js";
import * as notifications from "./tools/notifications.js";
import * as addFriend from "./tools/add_friend.js";
import * as removeFriend from "./tools/remove_friend.js";
import * as listFriends from "./tools/list_friends.js";

// Tool registry
const tools = {
  register,
  talk,
  listen,
  list_partners: listPartners,
  list_conversations: listConversations,
  create_conversation: createConversation,
  leave_conversation: leaveConversation,
  history,
  set_status: setStatus,
  notifications,
  add_friend: addFriend,
  remove_friend: removeFriend,
  list_friends: listFriends,
};

// Create MCP server
const server = new Server(
  {
    name: "mcp-claude-duo-partner",
    version: "4.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List all tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: Object.values(tools).map((t) => t.definition),
  };
});

// Tools that already deal with messages — skip piggyback to avoid noise/loops
const SKIP_PIGGYBACK = new Set(["listen", "notifications", "register"]);

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const tool = tools[name];
  if (!tool) {
    return {
      content: [{ type: "text", text: `Tool inconnu: ${name}` }],
      isError: true,
    };
  }

  const result = await tool.handler(args || {});

  // Piggyback: check unread messages on every tool call
  if (!SKIP_PIGGYBACK.has(name)) {
    try {
      const notifs = await brokerFetch(`/notifications/${myId}`);
      if (notifs.notifications?.length > 0) {
        const lines = notifs.notifications.map((n) => {
          const time = new Date(n.created_at).toLocaleTimeString();
          return `  [${time}] ${n.from_id}: ${n.content}`;
        });
        result.content.unshift({
          type: "text",
          text: `📨 **Messages non lus (${notifs.notifications.length}):**\n${lines.join("\n")}\n\n---`,
        });
      }
    } catch {}
  }

  return result;
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[MCP-PARTNER] Started (ID: ${myId})`);

  // Auto-register on startup
  try {
    const result = await brokerFetch("/register", {
      method: "POST",
      body: JSON.stringify({ partnerId: myId, name: PARTNER_NAME, projectPath: cwd }),
    });

    if (result.error) {
      console.error(`[MCP-PARTNER] Auto-register warning: ${result.error}`);
    } else {
      setRegistered(true);

      if (result.partner?.partnerKey) {
        setPartnerKey(result.partner.partnerKey);
      }

      const key = getPartnerKey();
      console.error(`[MCP-PARTNER] Auto-registered as ${PARTNER_NAME} (${myId})`);
      if (key && !process.env.PARTNER_KEY) {
        console.error(`[MCP-PARTNER] Partner key: ${key} — set PARTNER_KEY env var to persist it`);
      }

      startNotificationPoller();
    }
  } catch (error) {
    console.error(`[MCP-PARTNER] Auto-register failed: ${error.message}`);
  }
}

main().catch(console.error);
