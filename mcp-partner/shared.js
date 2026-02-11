// Shared utilities and state for MCP partner

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const BROKER_URL = process.env.BROKER_URL || "http://localhost:3210";
const PARTNER_KEY = process.env.PARTNER_KEY || "";
const PARTNER_NAME = process.env.PARTNER_NAME || "Claude";

// ID: env var if set, otherwise derived from cwd
const cwd = process.cwd();
const projectName = cwd.split(/[/\\]/).pop().toLowerCase().replace(/[^a-z0-9]/g, "_");
const myId = process.env.PARTNER_ID || projectName || "partner";

// Persist key to a local file so it survives MCP restarts
const keyFilePath = join(cwd, ".claude-duo-key");

function loadPersistedKey() {
  if (PARTNER_KEY) return PARTNER_KEY; // env var takes priority
  try {
    const data = JSON.parse(readFileSync(keyFilePath, "utf-8"));
    if (data.id === myId && data.key) return data.key;
  } catch {}
  return "";
}

function persistKey(key) {
  try {
    writeFileSync(keyFilePath, JSON.stringify({ id: myId, key }));
  } catch (err) {
    console.error(`[MCP-PARTNER] Failed to persist key: ${err.message}`);
  }
}

let isRegistered = false;
let partnerKey = loadPersistedKey();

/**
 * Appel HTTP au broker
 */
async function brokerFetch(path, options = {}) {
  const url = `${BROKER_URL}${path}`;

  const fetchOptions = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(partnerKey ? { Authorization: `Bearer ${partnerKey}` } : {}),
      ...options.headers,
    },
  };

  const response = await fetch(url, fetchOptions);
  return response.json();
}

/**
 * S'enregistrer aupres du broker
 */
async function ensureRegistered() {
  if (!isRegistered) {
    const result = await brokerFetch("/register", {
      method: "POST",
      body: JSON.stringify({ partnerId: myId, name: PARTNER_NAME, projectPath: cwd }),
    });

    if (result.error) {
      console.error(`[MCP-PARTNER] Registration failed: ${result.error}`);
      return;
    }

    if (result.partner?.partnerKey) {
      partnerKey = result.partner.partnerKey;
      persistKey(partnerKey);
    }

    isRegistered = true;
    console.error(`[MCP-PARTNER] Registered as ${PARTNER_NAME} (${myId}) at ${cwd}`);
  }
}

function setRegistered(value) {
  isRegistered = value;
}

function setPartnerKey(key) {
  partnerKey = key;
  persistKey(key);
}

function getPartnerKey() {
  return partnerKey;
}

export {
  BROKER_URL,
  PARTNER_NAME,
  cwd,
  myId,
  isRegistered,
  brokerFetch,
  ensureRegistered,
  setRegistered,
  setPartnerKey,
  getPartnerKey,
};
