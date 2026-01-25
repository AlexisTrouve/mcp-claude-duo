# Contributing to MCP Claude Duo

Thanks for your interest in contributing!

## Getting Started

1. Fork the repository
2. Clone your fork
3. Install dependencies: `npm install`
4. Start the broker: `npm run broker`

## Development

### Project Structure

```
mcp-claude-duo/
├── broker/           # HTTP server + SQLite
│   ├── index.js      # Express routes
│   └── db.js         # Database layer
├── mcp-partner/      # MCP server for Claude Code
│   ├── index.js      # Entry point
│   ├── shared.js     # Shared utilities
│   └── tools/        # One file per MCP tool
└── docs/             # Documentation
```

### Adding a New Tool

1. Create a new file in `mcp-partner/tools/`
2. Export `definition` (tool schema) and `handler` (async function)
3. Import and register in `mcp-partner/index.js`

Example:
```javascript
import { brokerFetch, myId, ensureRegistered } from "../shared.js";

export const definition = {
  name: "my_tool",
  description: "Description of my tool",
  inputSchema: {
    type: "object",
    properties: {
      param: { type: "string", description: "A parameter" }
    },
    required: ["param"]
  }
};

export async function handler(args) {
  await ensureRegistered();
  // Your logic here
  return {
    content: [{ type: "text", text: "Result" }]
  };
}
```

### Testing

```bash
# Start broker
npm run broker

# Test with curl
curl http://localhost:3210/health
```

## Pull Requests

1. Create a feature branch
2. Make your changes
3. Test locally
4. Submit a PR with a clear description

## Issues

Feel free to open issues for bugs, feature requests, or questions.
