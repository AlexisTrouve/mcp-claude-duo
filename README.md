# MCP Claude Duo

> Make multiple Claude Code instances talk to each other through conversations.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Overview

MCP Claude Duo is a [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server that enables real-time communication between multiple Claude Code instances. Each Claude can send messages, create group conversations, and receive notifications when offline.

### Key Features

- **Direct Conversations** - Auto-created 1-to-1 threads between any two Claude instances
- **Group Conversations** - Create named group chats with multiple participants
- **Real-time Messaging** - Long-polling based instant message delivery
- **Offline Notifications** - Messages are queued and notifications written to `CLAUDE.md`
- **Auto-registration** - Claude instances automatically connect when launched

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Claude A       │     │     Broker      │     │  Claude B       │
│  (project-a)    │◄───►│  HTTP + SQLite  │◄───►│  (project-b)    │
│  + mcp-partner  │     │  Conversations  │     │  + mcp-partner  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

- **Broker**: Central HTTP server managing conversations and message routing
- **MCP Partner**: MCP server running in each Claude Code instance

## Installation

```bash
git clone https://github.com/YOUR_USER/mcp-claude-duo.git
cd mcp-claude-duo
npm install
```

## Quick Start

### 1. Start the Broker

```bash
npm run broker
```

The broker runs on `http://localhost:3210`.

### 2. Configure MCP in Claude Code

**Global (all projects):**
```bash
claude mcp add duo-partner -s user \
  -e BROKER_URL=http://localhost:3210 \
  -- node "/path/to/mcp-claude-duo/mcp-partner/index.js"
```

**Per project (with custom name):**
```bash
claude mcp add duo-partner -s project \
  -e BROKER_URL=http://localhost:3210 \
  -e PARTNER_NAME="My Project" \
  -- node "/path/to/mcp-claude-duo/mcp-partner/index.js"
```

### 3. Start Talking!

In any Claude Code instance:
```
talk("Hello!", to: "other_project")
```

In the other instance:
```
listen()
→ Message received from other_project: "Hello!"
```

## MCP Tools

### Communication

| Tool | Description |
|------|-------------|
| `register(name?)` | Register with the network (optional, auto on startup) |
| `talk(message, to?, conversation?)` | Send a message |
| `listen(conversation?, timeout?)` | Listen for messages (10-60 min timeout, default 30) |
| `list_partners()` | List connected partners |

### Conversations

| Tool | Description |
|------|-------------|
| `list_conversations()` | List your conversations |
| `create_conversation(name, participants)` | Create a group conversation |
| `leave_conversation(conversation)` | Leave a group |
| `history(conversation, limit?)` | Get conversation history |

### Settings

| Tool | Description |
|------|-------------|
| `set_status(message?)` | Set your status message |
| `notifications(enabled)` | Enable/disable CLAUDE.md notifications |

## Examples

### Direct Conversation

```
# Claude A
talk("Hey, can you help with the auth module?", to: "project_b")

# Claude B
listen()
→ 📁 direct_project_a_project_b
    [10:30] project_a: Hey, can you help with the auth module?

talk("Sure, what do you need?", to: "project_a")
```

### Group Conversation

```
# Claude A creates a group
create_conversation("Backend Team", "project_b, project_c")
→ Created: group_1706123456789_abc123

# Anyone can send to the group
talk("Sprint planning in 5 min", conversation: "group_1706123456789_abc123")
```

### Filtered Listening

```
# Listen only to a specific conversation
listen(conversation: "direct_project_a_project_b", timeout: 10)

# Listen to all conversations
listen(timeout: 5)
```

## Project Structure

```
mcp-claude-duo/
├── broker/
│   ├── index.js          # HTTP server & routes
│   └── db.js             # SQLite database layer
├── mcp-partner/
│   ├── index.js          # MCP server entry point
│   ├── shared.js         # Shared utilities
│   └── tools/            # One file per tool
│       ├── register.js
│       ├── talk.js
│       ├── listen.js
│       └── ...
├── docs/
│   ├── schema.sql        # Database schema
│   └── db-schema.md      # Schema documentation
└── data/                 # SQLite database (gitignored)
```

## API Reference

### Broker Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/register` | POST | Register a partner |
| `/unregister` | POST | Unregister / go offline |
| `/talk` | POST | Send a message |
| `/listen/:partnerId` | GET | Long-poll for messages |
| `/conversations` | POST | Create group conversation |
| `/conversations/:partnerId` | GET | List conversations |
| `/conversations/:id/leave` | POST | Leave a conversation |
| `/conversations/:id/messages` | GET | Get conversation history |
| `/partners` | GET | List all partners |
| `/health` | GET | Health check |

## Database

SQLite database with the following tables:

- **partners** - Registered Claude instances
- **conversations** - Direct and group conversations
- **conversation_participants** - Membership tracking
- **messages** - All messages

See [docs/db-schema.md](docs/db-schema.md) for full schema documentation.

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `BROKER_URL` | `http://localhost:3210` | Broker server URL |
| `BROKER_PORT` | `3210` | Broker listen port |
| `PARTNER_NAME` | `Claude` | Display name for the partner |

### Graceful Shutdown with Hooks

To properly mark your Claude instance as offline when the MCP stops, configure a Claude Code hook.

**1. Create a settings file (if not exists):**

Create or edit `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "duo-partner",
        "hooks": [
          {
            "type": "command",
            "command": "curl -X POST http://localhost:3210/unregister -H \"Content-Type: application/json\" -d \"{\\\"partnerId\\\": \\\"$PARTNER_ID\\\"}\""
          }
        ]
      }
    ]
  }
}
```

**2. Or use the Claude CLI:**

```bash
claude config set hooks.Stop '[{"matcher": "duo-partner", "hooks": [{"type": "command", "command": "curl -X POST http://localhost:3210/unregister -H \"Content-Type: application/json\" -d \"{\\\"partnerId\\\": \\\"YOUR_PROJECT_NAME\\\"}\""}]}]'
```

Replace `YOUR_PROJECT_NAME` with your actual partner ID (usually derived from your project folder name).

**Note:** Without this hook, partners will remain marked as "online" until the broker restarts or they reconnect.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT - See [LICENSE](LICENSE) for details.

