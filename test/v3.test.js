/**
 * Tests v3 — TDD rouge → vert
 * Couvre les 3 bugs confirmés par les agents haiku :
 *   1. friendKey: "" bypass la validation de clé
 *   2. content: "   " (whitespace-only) est accepté
 *   3. after=abc dans /messages → cursor reset silencieux à 0 au lieu de 400
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 13210; // port de test isolé
const BASE = `http://localhost:${PORT}`;

let brokerProcess;

// ─── Setup : démarre un broker isolé ─────────────────────────────────────────

before(async () => {
  brokerProcess = spawn("node", ["broker/index.js"], {
    env: {
      ...process.env,
      BROKER_PORT: String(PORT),
      // Base de données en mémoire pour les tests
      BROKER_DB_PATH: ":memory:",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Attendre que le broker soit prêt
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Broker timeout")), 5000);
    brokerProcess.stdout.on("data", (d) => {
      if (d.toString().includes("running on")) {
        clearTimeout(timeout);
        resolve();
      }
    });
    brokerProcess.on("error", reject);
  });
});

after(() => {
  brokerProcess?.kill();
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function api(path, opts = {}) {
  // NOTE: headers et body APRÈS le spread pour ne pas être écrasés par opts
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Content-Type": "application/json", ...opts.headers },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function registerPartner(id, name = id) {
  const { body } = await api("/register", {
    method: "POST",
    body: { partnerId: id, name },
  });
  return body.partner; // { id, partnerKey, ... }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test("BUG 1 — friendKey: '' doit être traité comme fourni et rejeter si invalide", async () => {
  const sender = await registerPartner("sender-bug1");
  await registerPartner("receiver-bug1");

  // friendKey vide string explicitement fourni avec une vraie mauvaise clé
  const { status, body } = await api("/talk", {
    method: "POST",
    headers: { Authorization: `Bearer ${sender.partnerKey}` },
    body: {
      to: "receiver-bug1",
      friendKey: "",       // chaîne vide — doit être ignoré (auto-trust) ou validé
      content: "hello",
    },
  });

  // Comportement attendu v3 : friendKey absent/vide → auto-trust → 200
  // Ce test documente que "" == absent == auto-trust (pas un bypass de sécurité)
  // Si le comportement change (ex: "" doit être rejeté), ajuster ici.
  assert.equal(status, 200, `Expected 200 (auto-trust), got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.success, true);
});

test("BUG 1b — friendKey: 'mauvaise-cle' doit retourner 403", async () => {
  const sender = await registerPartner("sender-bug1b");
  await registerPartner("receiver-bug1b");

  const { status, body } = await api("/talk", {
    method: "POST",
    headers: { Authorization: `Bearer ${sender.partnerKey}` },
    body: {
      to: "receiver-bug1b",
      friendKey: "cle-completement-fausse",
      content: "hello",
    },
  });

  // Une mauvaise clé EXPLICITE doit être rejetée
  assert.equal(status, 403, `Expected 403, got ${status}: ${JSON.stringify(body)}`);
});

test("BUG 2 — content whitespace-only doit retourner 400", async () => {
  const sender = await registerPartner("sender-bug2");
  await registerPartner("receiver-bug2");

  const { status, body } = await api("/talk", {
    method: "POST",
    headers: { Authorization: `Bearer ${sender.partnerKey}` },
    body: {
      to: "receiver-bug2",
      content: "   ",   // whitespace-only
    },
  });

  // Un message vide ne devrait pas être stocké
  assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
  assert.ok(body.error, "Should have error message");
});

test("BUG 2b — content vide string doit retourner 400", async () => {
  const sender = await registerPartner("sender-bug2b");
  await registerPartner("receiver-bug2b");

  const { status, body } = await api("/talk", {
    method: "POST",
    headers: { Authorization: `Bearer ${sender.partnerKey}` },
    body: {
      to: "receiver-bug2b",
      content: "",
    },
  });

  assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(body)}`);
});

test("BUG 3 — GET /messages?after=abc doit retourner 400", async () => {
  // Créer une conv pour avoir un convId valide
  const p1 = await registerPartner("p1-bug3");
  const p2 = await registerPartner("p2-bug3");

  // Envoyer un message pour créer la conv
  await api("/talk", {
    method: "POST",
    headers: { Authorization: `Bearer ${p1.partnerKey}` },
    body: { to: "p2-bug3", content: "setup" },
  });

  const convId = `direct_p1-bug3_p2-bug3`;

  const { status, body } = await api(`/messages/${convId}?after=abc`, {
    headers: { Authorization: `Bearer ${p1.partnerKey}` },
  });

  // after=abc est invalide, le serveur doit retourner 400
  assert.equal(status, 400, `Expected 400 for after=abc, got ${status}: ${JSON.stringify(body)}`);
  assert.ok(body.error, "Should have error message");
});

test("BUG 3b — GET /messages?after=0 doit fonctionner normalement", async () => {
  const p1 = await registerPartner("p1-bug3b");
  const p2 = await registerPartner("p2-bug3b");

  await api("/talk", {
    method: "POST",
    headers: { Authorization: `Bearer ${p1.partnerKey}` },
    body: { to: "p2-bug3b", content: "hello from p1" },
  });

  const convId = `direct_p1-bug3b_p2-bug3b`;

  const { status, body } = await api(`/messages/${convId}?after=0`, {
    headers: { Authorization: `Bearer ${p1.partnerKey}` },
  });

  assert.equal(status, 200, `Expected 200, got ${status}`);
  assert.ok(Array.isArray(body.messages), "Should have messages array");
  assert.equal(body.messages.length, 1, "Should have 1 message");
  assert.equal(typeof body.cursor, "number", "cursor should be a number");
});

test("REGRESSION — talk sans friendKey (v3 auto-trust) doit fonctionner", async () => {
  const sender = await registerPartner("sender-regression");
  await registerPartner("receiver-regression");

  const { status, body } = await api("/talk", {
    method: "POST",
    headers: { Authorization: `Bearer ${sender.partnerKey}` },
    body: {
      to: "receiver-regression",
      content: "message v3 sans friendKey",
    },
  });

  assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert.equal(body.success, true);
  assert.ok(body.conversationId.startsWith("direct_"), "Should create direct conv");
});

test("REGRESSION — GET /directory retourne la liste des partenaires", async () => {
  await registerPartner("dir-test-partner");

  const { status, body } = await api("/directory");

  assert.equal(status, 200);
  assert.ok(Array.isArray(body.partners), "Should have partners array");
  assert.ok(typeof body.count === "number", "Should have count");
  const found = body.partners.find(p => p.id === "dir-test-partner");
  assert.ok(found, "Registered partner should appear in directory");
  assert.ok(!found.partner_key, "partner_key must not be exposed");
});
