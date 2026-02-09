// Shared utilities and state for MCP partner

const BROKER_URL = process.env.BROKER_URL || "http://localhost:3210";
const PARTNER_KEY = process.env.PARTNER_KEY || "";
const PARTNER_NAME = process.env.PARTNER_NAME || "Claude";

// ID base sur le dossier de travail (unique par projet)
const cwd = process.cwd();
const projectName = cwd.split(/[/\\]/).pop().toLowerCase().replace(/[^a-z0-9]/g, "_");
const myId = projectName || "partner";

let isRegistered = false;
let partnerKey = PARTNER_KEY;

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

    if (result.partner?.partnerKey) {
      partnerKey = result.partner.partnerKey;
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
