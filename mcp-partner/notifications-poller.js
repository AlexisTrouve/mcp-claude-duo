// Notification poller — polls the broker for unread messages and writes/clears
// the notification section in the local CLAUDE.md file.

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { brokerFetch, myId, cwd } from "./shared.js";

const NOTIFICATION_MARKER = "<!-- CLAUDE-DUO-NOTIFICATIONS -->";
const END_MARKER = "<!-- /CLAUDE-DUO-NOTIFICATIONS -->";
const POLL_INTERVAL_MS = 60_000;

let pollTimer = null;

function getClaudeMdPath() {
  return join(cwd, "CLAUDE.md");
}

/**
 * Write notification section into the local CLAUDE.md
 */
function writeNotifications(notifications) {
  const claudeMdPath = getClaudeMdPath();

  const lines = notifications.map((n) => {
    const timestamp = new Date(n.created_at).toLocaleString();
    const convLabel = n.conversation_id.startsWith("direct_")
      ? `DM de ${n.from_id}`
      : `[${n.conversation_id}]`;
    return `- **[${timestamp}] ${convLabel}:** ${n.content}`;
  });

  const notificationsSection = `
${NOTIFICATION_MARKER}
## PRIORITE: Messages en attente (Claude Duo)

**ACTION REQUISE: Tu as des messages non lus. Utilise \`listen\` pour les lire.**

${lines.join("\n")}

${END_MARKER}`;

  let content = "";
  if (existsSync(claudeMdPath)) {
    content = readFileSync(claudeMdPath, "utf-8");
  }

  const startIdx = content.indexOf(NOTIFICATION_MARKER);
  const endIdx = content.indexOf(END_MARKER);

  if (startIdx !== -1 && endIdx !== -1) {
    const before = content.substring(0, startIdx);
    const after = content.substring(endIdx + END_MARKER.length);
    content = before.trimEnd() + "\n" + notificationsSection + after;
  } else {
    content = content.trimEnd() + "\n" + notificationsSection;
  }

  try {
    writeFileSync(claudeMdPath, content);
    console.error(`[MCP-PARTNER] Notifications written to CLAUDE.md (${notifications.length} unread)`);
  } catch (err) {
    console.error(`[MCP-PARTNER] Failed to write notifications: ${err.message}`);
  }
}

/**
 * Clear the notification section from the local CLAUDE.md
 */
export function clearLocalNotifications() {
  const claudeMdPath = getClaudeMdPath();
  if (!existsSync(claudeMdPath)) return;

  let content = readFileSync(claudeMdPath, "utf-8");
  const startIdx = content.indexOf(NOTIFICATION_MARKER);
  const endIdx = content.indexOf(END_MARKER);

  if (startIdx !== -1 && endIdx !== -1) {
    const before = content.substring(0, startIdx);
    const after = content.substring(endIdx + END_MARKER.length);
    content = (before.trimEnd() + after).trim() + "\n";
    writeFileSync(claudeMdPath, content);
    console.error("[MCP-PARTNER] Notifications cleared from CLAUDE.md");
  }
}

/**
 * Single poll tick — fetch unread notifications from broker and update CLAUDE.md
 */
async function pollTick() {
  try {
    const response = await brokerFetch(`/notifications/${myId}`);
    // Only act if the response explicitly contains a notifications array
    // (avoids clearing notifications on auth errors or broker failures)
    if (!Array.isArray(response.notifications)) return;

    if (response.notifications.length > 0) {
      writeNotifications(response.notifications);
    } else {
      clearLocalNotifications();
    }
  } catch (err) {
    // Silently ignore poll errors (broker might be temporarily unreachable)
    console.error(`[MCP-PARTNER] Notification poll failed: ${err.message}`);
  }
}

/**
 * Start the notification poller (every 60 seconds)
 */
export function startNotificationPoller() {
  if (pollTimer) return;
  pollTimer = setInterval(pollTick, POLL_INTERVAL_MS);
  console.error("[MCP-PARTNER] Notification poller started (60s interval)");
  // Run immediately on start
  pollTick();
}

/**
 * Stop the notification poller
 */
export function stopNotificationPoller() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    console.error("[MCP-PARTNER] Notification poller stopped");
  }
}
