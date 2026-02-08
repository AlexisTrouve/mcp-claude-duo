// Shared utilities and state for MCP partner

const BROKER_URL = process.env.BROKER_URL || "http://localhost:3210";
const BROKER_API_KEY = process.env.BROKER_API_KEY;
const PARTNER_NAME = process.env.PARTNER_NAME || "Claude";

// ID basé sur le dossier de travail (unique par projet)
const cwd = process.cwd();
const projectName = cwd.split(/[/\\]/).pop().toLowerCase().replace(/[^a-z0-9]/g, "_");
const myId = projectName || "partner";

let isRegistered = false;

/**
 * Appel HTTP au broker
 */
async function brokerFetch(path, options = {}) {
  const url = `${BROKER_URL}${path}`;

  const fetchOptions = {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(BROKER_API_KEY ? { Authorization: `Bearer ${BROKER_API_KEY}` } : {}),
      ...options.headers,
    },
  };

  const response = await fetch(url, fetchOptions);
  return response.json();
}

/**
 * S'enregistrer auprès du broker
 */
async function ensureRegistered() {
  if (!isRegistered) {
    await brokerFetch("/register", {
      method: "POST",
      body: JSON.stringify({ partnerId: myId, name: PARTNER_NAME, projectPath: cwd }),
    });
    isRegistered = true;
    console.error(`[MCP-PARTNER] Registered as ${PARTNER_NAME} (${myId}) at ${cwd}`);
  }
}

function setRegistered(value) {
  isRegistered = value;
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
};
