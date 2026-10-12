import { test } from "node:test";
import assert from "node:assert/strict";
import { accessKeys, verifyAccess } from "../worker/access.ts";

const ALGORITHM = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
const pair = await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
const stranger = await crypto.subtle.generateKey(ALGORITHM, true, ["sign", "verify"]);
const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "k1" };
const NOW = 1_800_000_000_000;
const TEAM = "team.cloudflareaccess.com";

const segment = (value) => Buffer.from(typeof value === "string" ? value : new Uint8Array(value)).toString("base64url");

async function sign(payload, { kid = "k1", alg = "RS256", key = pair.privateKey } = {}) {
  const head = segment(JSON.stringify({ alg, kid }));
  const body = segment(JSON.stringify(payload));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${segment(signature)}`;
}

const claims = (overrides = {}) => ({ aud: ["aud-1"], exp: NOW / 1000 + 60, iss: `https://${TEAM}`, ...overrides });
const config = (overrides = {}) => ({ teamDomain: TEAM, audience: "aud-1", keys: async () => [{ kid: "k1", jwk }],
  now: () => NOW, ...overrides });

test("a token signed by the team key for this application passes", async () => {
  assert.equal(await verifyAccess(await sign(claims()), config()), true);
});

test("a missing or malformed token fails", async () => {
  assert.equal(await verifyAccess(null, config()), false);
  assert.equal(await verifyAccess("a.b", config()), false);
  assert.equal(await verifyAccess("not.a.jwt", config()), false);
});

test("a token signed by another key fails", async () => {
  assert.equal(await verifyAccess(await sign(claims(), { key: stranger.privateKey }), config()), false);
});

test("a token for another application fails", async () => {
  assert.equal(await verifyAccess(await sign(claims({ aud: ["aud-2"] })), config()), false);
});

test("a single-string audience is accepted when it matches", async () => {
  assert.equal(await verifyAccess(await sign(claims({ aud: "aud-1" })), config()), true);
});

test("an expired token fails", async () => {
  assert.equal(await verifyAccess(await sign(claims({ exp: NOW / 1000 - 1 })), config()), false);
});

test("a token from another team fails", async () => {
  assert.equal(await verifyAccess(await sign(claims({ iss: "https://other.cloudflareaccess.com" })), config()), false);
});

test("a token that is not RS256 fails", async () => {
  assert.equal(await verifyAccess(await sign(claims(), { alg: "none" }), config()), false);
});

test("an unknown key id refreshes the keys once, and a rotated key then passes", async () => {
  const asked = [];
  const keys = async (refresh) => {
    asked.push(refresh);
    return refresh ? [{ kid: "k1", jwk }] : [];
  };
  assert.equal(await verifyAccess(await sign(claims()), config({ keys })), true);
  assert.deepEqual(asked, [false, true]);
});

test("the team keys are fetched once and reused until a refresh", async () => {
  let fetched = 0;
  const fetcher = async (url) => {
    fetched += 1;
    assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify({ keys: [jwk] }));
  };
  const keys = accessKeys(TEAM, fetcher);
  await keys(false);
  await keys(false);
  assert.equal(fetched, 1);
  assert.deepEqual((await keys(true)).map((key) => key.kid), ["k1"]);
  assert.equal(fetched, 2);
});

test("a failed key fetch fails verification rather than throwing", async () => {
  const keys = accessKeys(TEAM, async () => new Response("down", { status: 500 }));
  assert.equal(await verifyAccess(await sign(claims()), config({ keys })), false);
});
