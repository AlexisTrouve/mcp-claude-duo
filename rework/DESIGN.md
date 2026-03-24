# Claude Duo v3 — Rework Design

## Problème v2

L'humain sert de facteur entre les agents. 6 étapes manuelles pour établir une connexion :
1. register A → copier clé A
2. register B → copier clé B
3. add_friend A→B avec clé B
4. add_friend B→A avec clé A
5. listen/talk manuels
6. Aucun auto-discovery

## Principes v3

1. **Zero-config local** — même broker = trust automatique, pas de clés
2. **Auto-register** — l'agent se register au démarrage, aucune action humaine
3. **Directory** — chaque agent publie son ID, nom, projet, capabilities → les autres le voient
4. **Talk direct** — `talk(to: "aria", message: "...")` fonctionne immédiatement si sur le même broker
5. **1 approbation max** — uniquement pour les agents cross-broker (remote trust)
6. **Background listen** — polling natif intégré, pas de commande manuelle

## Architecture

```
Broker HTTP (localhost:3210)
├── /register       POST  — auto au démarrage
├── /directory      GET   — liste agents connectés + metadata
├── /talk           POST  — envoyer un message (pas de friendKey si même broker)
├── /listen/:id     GET   — long-poll (gardé pour compat MCP)
├── /messages/:id   GET   — polling rapide pour clients natifs
├── /history/:conv  GET   — historique conversation
└── /ws             WS    — WebSocket push (optionnel, upgrade futur)
```

### Trust model

```
Même broker (local)     → trust automatique, talk direct
Cross-broker (remote)   → 1 approbation humaine/IA, puis trust permanent
Blocklist              → l'humain peut bloquer un agent à tout moment
```

### Clients

```
1. MCP stdio (existant, adapté) — pour Claude Code classiques
2. Client Dart natif           — pour Melodicode/Aria Flutter
   → shared/etheryale_duo/ package pure Dart
   → polling HTTP rapide (5-10s) ou WebSocket
   → Stream<DuoMessage> pour l'UI
```

### Flow v3

```
Agent démarre
  → auto-register sur broker
  → apparaît dans /directory
  → peut talk() à n'importe quel agent du même broker
  → reçoit les messages via listen (MCP) ou polling/WS (natif)
  → aucune intervention humaine
```

## Ce qui change vs v2

| Aspect | v2 | v3 |
|--------|----|----|
| Registration | Manuelle | Auto au démarrage |
| Friend keys | Obligatoires, échange manuel | Supprimées en local |
| Discovery | Aucune | /directory avec metadata |
| Talk | Besoin friendKey | Direct si même broker |
| Listen | Commande manuelle | Background automatique |
| Approbation humaine | 4-6 étapes | 0 en local, 1 max en remote |

## Migration

- Le broker garde la compat v2 (friendKey optionnelle dans /talk)
- Les MCP partners existants continuent de fonctionner
- Les nouveaux clients natifs utilisent le mode simplifié
- Les friends.json locaux deviennent optionnels (seulement pour cross-broker)

## Fichiers à modifier

### Broker (serveur)
- Ajouter `/directory` endpoint
- Rendre `friendKey` optionnel dans `/talk` (même broker = bypass)
- Ajouter `/messages/:id` polling endpoint (alternative à long-poll)
- Optionnel : WebSocket `/ws`

### MCP Partner (client existant)
- Simplifier : plus besoin de friends pour le local
- `talk()` sans friendKey si destinataire sur même broker
- Auto-register déjà en place

### Client Dart natif (nouveau)
- `shared/etheryale_duo/` — package pure Dart
- `DuoClient` : register, talk, poll, history, directory
- `DuoService` : background polling + Stream<DuoMessage>
- Intégration Melodicode : notifications + UI panel
