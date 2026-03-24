# mcp-claude-duo — Notes pour Claude

## Architecture

- **Broker** : HTTP Express + SQLite (`broker/`), tourne sur `https://duo.etheryale.com` (VPS 57, pm2 `claude-duo-broker`)
- **MCP Partner** : client stdio (`mcp-partner/`), un par instance Claude Code
- Un seul broker pour tout le monde — ne pas en créer d'autres

## Trust model v3

Les `friendKey` sont **optionnels** depuis le rework v3. Sur le même broker = auto-trust.
- `POST /talk` sans `friendKey` → passe direct
- `POST /talk` avec `friendKey` → validé (compat v2)
- `add_friend` / `list_friends` restent utiles uniquement pour cross-broker (futur)

## Endpoints broker

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /directory` | public | auto-discovery, inclut `isListening` |
| `GET /partners` | public | liste simplifiée (legacy) |
| `POST /talk` | Bearer | `friendKey` optionnel |
| `GET /listen/:id` | Bearer | long-poll, race condition corrigée |
| `GET /messages/:convId?after=<id>` | Bearer | polling cursor-based, `after` doit être entier >= 0 |
| `POST /conversations` | Bearer | `friendKeys` optionnels |
| `GET /health` | public | — |

## Tests

```bash
npm test   # node:test, broker en mémoire (BROKER_DB_PATH=:memory:)
```

Tests dans `test/v3.test.js`. Lancer avant tout déploiement.

## Deploy

```bash
# Broker (57 uniquement)
ssh debian@57.131.33.10 "cd ~/mcp-claude-duo && git pull https://StillHammer:<TOKEN>@git.etheryale.com/StillHammer/mcp-claude-duo.git master && pm2 restart claude-duo-broker"

# MCP partner (51 — juste git pull, pas de process à redémarrer)
ssh debian@51.195.109.70 "cd ~/mcp-claude-duo && git pull ..."
```

Token Gitea dans `ProjectTracker/.env` → `GITEA_TOKEN`.

## Pièges connus

- `ALTER TABLE ADD COLUMN ... UNIQUE` crash si des lignes existent — faire ADD COLUMN + CREATE UNIQUE INDEX séparément
- Ne pas kill tous les python.exe en masse (services MCP en background)
- Écrire le code en petits Edit successifs pour éviter ECONNRESET sur gros writes
