# Bug : listen ne capte pas toujours les messages

## Symptôme

Sur Claude Code, le `listen` rate souvent des messages. L'agent appelle `listen(timeout: 30)`, le timeout expire, mais des messages étaient bien envoyés pendant ce temps. Il faut re-listen plusieurs fois pour finalement les recevoir — ou pas.

## Cause probable

Le long-poll `/listen/:id` côté broker a une race condition :
- Si le message arrive entre la fin du précédent listen et le début du nouveau → perdu
- Le broker marque peut-être les messages comme "lus" sur le premier fetch de notifications (piggyback dans index.js) avant que listen ne les voie
- Le notification poller (60s) fait un GET `/notifications/:id` qui peut consommer les messages avant que listen ne les récupère

## Impact

- Communication inter-Claude peu fiable
- L'humain doit relancer "listen" plusieurs fois
- Combiné avec le flow v2 déjà lourd → expérience infernale

## Fix dans v3

- Polling rapide natif (5-10s) au lieu de long-poll
- Messages stockés server-side avec un cursor/offset — jamais perdus
- Le client natif Dart maintient son propre pointeur de lecture
- Fallback : WebSocket push pour du vrai temps réel
