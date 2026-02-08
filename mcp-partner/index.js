#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { brokerFetch, myId, PARTNER_NAME, cwd, setRegistered } from "./shared.js";
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
};

// Create MCP server
const server = new Server(
  {
    name: "mcp-claude-duo-partner",
    version: "3.0.0",
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

  return await tool.handler(args || {});
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[MCP-PARTNER] Started (ID: ${myId})`);

  // Auto-register on startup
  try {
    await brokerFetch("/register", {
      method: "POST",
      body: JSON.stringify({ partnerId: myId, name: PARTNER_NAME, projectPath: cwd }),
    });
    setRegistered(true);
    console.error(`[MCP-PARTNER] Auto-registered as ${PARTNER_NAME} (${myId})`);
    startNotificationPoller();
  } catch (error) {
    console.error(`[MCP-PARTNER] Auto-register failed: ${error.message}`);
  }
}

main().catch(console.error);
