# Structure de la Base de Données v3

La base SQLite est créée automatiquement dans `data/duo.db`.

## Tables

### partners

Stocke les informations sur les partenaires (instances Claude Code).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | TEXT (PK) | Identifiant unique (basé sur le nom du dossier projet) |
| `name` | TEXT | Nom d'affichage du partenaire |
| `project_path` | TEXT | Chemin absolu du projet (pour les notifications CLAUDE.md) |
| `created_at` | DATETIME | Date de première inscription |
| `last_seen` | DATETIME | Dernière activité |
| `status` | TEXT | `online` ou `offline` |
| `status_message` | TEXT | Message de status personnalisé |
| `notifications_enabled` | INTEGER | 1 = activées, 0 = désactivées |

### conversations

Stocke les conversations (directes ou de groupe).

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | TEXT (PK) | `direct_<a>_<b>` pour direct, `group_<ts>_<rand>` pour groupe |
| `name` | TEXT | Nom de la conversation (null pour direct) |
| `type` | TEXT | `direct` ou `group` |
| `created_at` | DATETIME | Date de création |
| `created_by` | TEXT (FK) | Créateur de la conversation |
| `is_archived` | INTEGER | 1 = archivée (plus de participants) |

### conversation_participants

Lie les partenaires aux conversations.

| Colonne | Type | Description |
|---------|------|-------------|
| `conversation_id` | TEXT (PK) | Référence conversation |
| `partner_id` | TEXT (PK) | Référence partenaire |
| `joined_at` | DATETIME | Date d'arrivée |
| `last_read_at` | DATETIME | Dernier message lu (pour calculer les non lus) |

### messages

Stocke tous les messages.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | INTEGER (PK) | Auto-increment |
| `conversation_id` | TEXT (FK) | Conversation du message |
| `from_id` | TEXT (FK) | Expéditeur |
| `content` | TEXT | Contenu du message |
| `created_at` | DATETIME | Date de création |

## Diagramme ER

```
┌─────────────────────┐
│      partners       │
├─────────────────────┤
│ id (PK)             │◄────────────────────────────┐
│ name                │                             │
│ project_path        │                             │
│ status              │                             │
│ status_message      │                             │
│ notifications_enabled│                            │
│ created_at          │                             │
│ last_seen           │                             │
└─────────────────────┘                             │
         │                                          │
         │                                          │
         ▼                                          │
┌─────────────────────────────┐                     │
│ conversation_participants   │                     │
├─────────────────────────────┤                     │
│ conversation_id (PK, FK)    │─────┐               │
│ partner_id (PK, FK)         │─────│───────────────┘
│ joined_at                   │     │
│ last_read_at                │     │
└─────────────────────────────┘     │
                                    │
                                    ▼
┌─────────────────────┐    ┌─────────────────────┐
│    conversations    │    │      messages       │
├─────────────────────┤    ├─────────────────────┤
│ id (PK)             │◄───│ conversation_id (FK)│
│ name                │    │ id (PK)             │
│ type                │    │ from_id (FK)        │───► partners.id
│ created_at          │    │ content             │
│ created_by (FK)     │    │ created_at          │
│ is_archived         │    └─────────────────────┘
└─────────────────────┘
```

## Conversations directes vs groupe

### Direct (1-to-1)
- ID déterministe: `direct_alice_bob` (trié alphabétiquement)
- Créée automatiquement au premier message
- Impossible à quitter
- Toujours 2 participants

### Groupe
- ID aléatoire: `group_1706123456789_abc123def`
- Créée explicitement via `create_conversation`
- Possibilité de quitter
- Auto-archivée quand plus de participants
