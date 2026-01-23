#!/usr/bin/env node

/**
 * Hook "Stop" pour Claude Code
 * Se déclenche quand Claude finit de répondre
 * Lit le transcript et envoie la dernière réponse au broker
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const BROKER_URL = process.env.BROKER_URL || "http://localhost:3210";

const __dirname = dirname(fileURLToPath(import.meta.url));
const stateDir = join(__dirname, "..", ".state");

async function main() {
  // Lire l'input du hook depuis stdin
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  let hookData;
  try {
    hookData = JSON.parse(input);
  } catch {
    // Pas de données valides
    process.exit(0);
  }

  const { transcript_path } = hookData;

  if (!transcript_path) {
    process.exit(0);
  }

  // Lire le fichier state unique
  const stateFile = join(stateDir, "current.json");
  let state = null;
  try {
    const content = readFileSync(stateFile, "utf-8");
    state = JSON.parse(content);
  } catch {
    // Pas de state, pas de partner connecté
    process.exit(0);
  }

  if (!state || !state.currentRequestId) {
    process.exit(0);
  }

  // Lire le transcript
  let transcript;
  try {
    transcript = JSON.parse(readFileSync(transcript_path, "utf-8"));
  } catch {
    process.exit(0);
  }

  // Trouver la dernière réponse de l'assistant
  let lastAssistantMessage = null;

  // Le transcript peut avoir différents formats, essayons de trouver les messages
  const messages = transcript.messages || transcript;

  if (Array.isArray(messages)) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === "assistant" && msg.content) {
        // Extraire le texte du contenu
        if (typeof msg.content === "string") {
          lastAssistantMessage = msg.content;
        } else if (Array.isArray(msg.content)) {
          // Chercher les blocs de texte
          const textBlocks = msg.content.filter((c) => c.type === "text");
          if (textBlocks.length > 0) {
            lastAssistantMessage = textBlocks.map((t) => t.text).join("\n");
          }
        }
        break;
      }
    }
  }

  if (!lastAssistantMessage) {
    process.exit(0);
  }

  // Envoyer la réponse au broker
  try {
    await fetch(`${BROKER_URL}/respond`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partnerId: state.partnerId,
        requestId: state.currentRequestId,
        content: lastAssistantMessage,
      }),
    });
  } catch (error) {
    console.error(`[HOOK] Error sending response: ${error.message}`);
  }

  process.exit(0);
}

main();
