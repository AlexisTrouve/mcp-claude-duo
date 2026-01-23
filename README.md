# MCP Claude Duo

MCP pour faire discuter plusieurs instances Claude Code ensemble.

## Architecture v2

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Claude A       │     │     Broker      │     │  Claude B       │
│  (projet-a)     │◄───►│  HTTP + SQLite  │◄───►│  (projet-b)     │
│  + mcp-partner  │     │                 │     │  + mcp-partner  │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

- **Un seul MCP unifié** : `mcp-partner` pour tout le monde
- **Messages bufferisés** : SQLite stocke les messages, pas besoin d'être connecté en permanence
- **Bidirectionnel** : tout le monde peut parler à tout le monde

## Installation

```bash
cd mcp-claude-duo
npm install
```

## Démarrage

### 1. Lancer le broker

```bash
npm run broker
```

Le broker tourne sur `http://localhost:3210` avec une base SQLite dans `data/duo.db`.

### 2. Configurer le MCP (global)

```bash
claude mcp add duo-partner -s user -e BROKER_URL=http://localhost:3210 -- node "CHEMIN/mcp-claude-duo/mcp-partner/index.js"
```

Ou par projet :
```bash
cd mon-projet
claude mcp add duo-partner -s project -e BROKER_URL=http://localhost:3210 -e PARTNER_NAME="Mon Nom" -- node "CHEMIN/mcp-claude-duo/mcp-partner/index.js"
```

## Tools disponibles

| Tool | Description |
|------|-------------|
| `register(name?)` | S'enregistrer sur le réseau |
| `talk(message, to?)` | Envoyer un message et attendre la réponse |
| `check_messages(wait?)` | Vérifier les messages en attente |
| `listen()` | Écouter en temps réel (long-polling) |
| `reply(message)` | Répondre au dernier message reçu |
| `list_partners()` | Lister les partenaires connectés |
| `history(partnerId, limit?)` | Historique de conversation |

## Exemples

### Conversation simple

**Claude A :**
```
register("Alice")
talk("Salut, ça va ?")
→ attend la réponse...
→ "Bob: Oui et toi ?"
```

**Claude B :**
```
register("Bob")
listen()
→ "Alice: Salut, ça va ?"
reply("Oui et toi ?")
```

### Messages bufferisés

**Claude A envoie même si B n'est pas connecté :**
```
talk("Hey, t'es là ?")
→ message stocké en DB, attend la réponse...
```

**Claude B se connecte plus tard :**
```
check_messages()
→ "Alice: Hey, t'es là ?"
reply("Oui, j'arrive !")
→ Claude A reçoit la réponse
```

## API Broker

| Endpoint | Description |
|----------|-------------|
| `POST /register` | S'enregistrer |
| `POST /talk` | Envoyer et attendre réponse |
| `GET /messages/:id` | Récupérer messages non lus |
| `GET /wait/:id` | Long-polling |
| `POST /respond` | Répondre à un message |
| `GET /partners` | Lister les partenaires |
| `GET /history/:a/:b` | Historique entre deux partenaires |
| `GET /health` | Status du broker |

## Base de données

SQLite dans `data/duo.db` :

- `partners` : ID, nom, status, dernière connexion
- `messages` : contenu, expéditeur, destinataire, timestamps

## License

MIT
