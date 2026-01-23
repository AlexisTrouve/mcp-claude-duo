# MCP Claude Duo

Fait discuter deux instances Claude Code ensemble via MCP.

## Architecture

```
Terminal 1 (Master)                              Terminal 2 (Slave)
┌─────────────────┐                            ┌─────────────────┐
│  Claude Code    │                            │  Claude Code    │
│  + MCP Master   │         ┌───────┐          │  + MCP Slave    │
│                 │         │Broker │          │  + Hook Stop    │
│  talk("yo") ────┼────────►│ HTTP  │─────────►│                 │
│                 │         │       │          │  reçoit "yo"    │
│                 │         │       │          │  répond "salut" │
│  reçoit "salut"◄┼─────────│       │◄─────────┼── (hook envoie) │
└─────────────────┘         └───────┘          └─────────────────┘
```

## Installation

```bash
cd mcp-claude-duo
npm install
```

## Démarrage

### 1. Lancer le broker (dans un terminal séparé)

```bash
npm run broker
```

Le broker tourne sur `http://localhost:3210` par défaut.

### 2. Configurer le Master (Terminal 1)

Ajoute dans ta config MCP Claude Code (`~/.claude.json` ou settings):

```json
{
  "mcpServers": {
    "duo-master": {
      "command": "node",
      "args": ["C:/Users/alexi/Documents/projects/mcp-claude-duo/mcp-master/index.js"],
      "env": {
        "BROKER_URL": "http://localhost:3210"
      }
    }
  }
}
```

### 3. Configurer le Slave (Terminal 2)

Config MCP:

```json
{
  "mcpServers": {
    "duo-slave": {
      "command": "node",
      "args": ["C:/Users/alexi/Documents/projects/mcp-claude-duo/mcp-slave/index.js"],
      "env": {
        "BROKER_URL": "http://localhost:3210",
        "SLAVE_NAME": "Bob"
      }
    }
  }
}
```

Config Hook (dans `.claude/settings.json` du projet ou `~/.claude/settings.json`):

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": {},
        "hooks": [
          {
            "type": "command",
            "command": "node C:/Users/alexi/Documents/projects/mcp-claude-duo/hooks/on-stop.js"
          }
        ]
      }
    ]
  }
}
```

## Utilisation

### Terminal 2 (Slave) - Se connecter

```
Toi: "Connecte-toi en tant que partenaire"
Claude: *utilise connect()* → "Connecté, en attente de messages..."
```

### Terminal 1 (Master) - Parler

```
Toi: "Parle à mon partenaire, dis lui salut"
Claude: *utilise talk("Salut !")*
→ attend la réponse...
→ "Partenaire: Hey ! Ça va ?"
```

### Terminal 2 (Slave) - Reçoit et répond

```
Claude: "Message reçu: Salut !"
Claude: "Je lui réponds..." → écrit sa réponse
→ Le hook capture et envoie au broker
Claude: *utilise connect()* → attend le prochain message
```

## Tools disponibles

### MCP Master
| Tool | Description |
|------|-------------|
| `talk(message)` | Envoie un message et attend la réponse |
| `list_partners()` | Liste les partenaires connectés |

### MCP Slave
| Tool | Description |
|------|-------------|
| `connect(name?)` | Se connecte et attend les messages |
| `disconnect()` | Se déconnecte |

## Variables d'environnement

| Variable | Description | Défaut |
|----------|-------------|--------|
| `BROKER_URL` | URL du broker | `http://localhost:3210` |
| `BROKER_PORT` | Port du broker | `3210` |
| `SLAVE_NAME` | Nom du slave | `Partner` |

## Flow détaillé

1. **Slave** appelle `connect()` → s'enregistre au broker, attend (long-polling)
2. **Master** appelle `talk("message")` → envoie au broker
3. **Broker** transmet au slave → `connect()` retourne le message
4. **Slave** Claude voit le message et répond naturellement
5. **Hook Stop** se déclenche → lit le transcript, extrait la réponse, envoie au broker
6. **Broker** retourne la réponse au master
7. **Master** `talk()` retourne avec la réponse
8. **Slave** rappelle `connect()` pour le prochain message

## License

MIT
