import { all, compareText } from "./graph.mjs";
import { extensionOf } from "./paths.mjs";

const DAY_MS = 86_400_000;

function startOfUtcDay(ms) {
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function toDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function defaultPolicy(now = Date.now()) {
  const cutoff = startOfUtcDay(now) - 30 * DAY_MS;
  return { delayDays: 30, minGroup: 5, cutoff, buildDate: toDate(now) };
}

/**
 * @remarks folds every bucket below the floor into "other", then drops "other" if it too is below the
 * floor, so a published total (the sum of survivors) can never be differenced to reveal a hidden one.
 */
function suppress(counts, floor) {
  const kept = [];
  let folded = 0;
  for (const [label, count] of [...counts.entries()].sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))) {
    if (count >= floor) {
      kept.push({ label, count });
    } else {
      folded += count;
    }
  }
  if (folded >= floor) {
    kept.push({ label: "other", count: folded });
  }
  return kept;
}

const floorOrZero = (value, floor) => (value >= floor ? value : 0);

function increment(map, key, by = 1) {
  map.set(key, (map.get(key) ?? 0) + by);
}

export function buildPublicGraph(db, policy) {
  const secrets = all(db, "SELECT id, target, valid, props, severity_band, first_seen FROM node WHERE type='SECRET'")
    .filter((row) => Date.parse(row.first_seen) <= policy.cutoff)
    .map((row) => ({ ...row, validated: parsedValidated(row.props) }));
  const eligible = new Set(secrets.map((row) => row.id));

  const leaks = all(db, "SELECT src, dst, context FROM edge WHERE type='LEAKED_IN'")
    .filter((row) => eligible.has(row.src) && row.context !== "");
  const extensionsBySecret = new Map();
  const repositories = new Set();
  for (const leak of leaks) {
    repositories.add(leak.dst);
    if (!extensionsBySecret.has(leak.src)) {
      extensionsBySecret.set(leak.src, new Set());
    }
    extensionsBySecret.get(leak.src).add(extensionOf(leak.context));
  }

  const owned = all(db, "SELECT src, dst FROM edge WHERE type='OWNED_BY'")
    .filter((row) => repositories.has(row.src));
  const owners = new Set(owned.map((row) => row.dst));

  const byBand = new Map();
  const byMonth = new Map();
  const credentialToExtension = new Map();
  const validity = { live: 0, dead: 0, formatOnly: 0 };

  for (const secret of secrets) {
    increment(byBand, secret.severity_band);
    increment(byMonth, secret.first_seen.slice(0, 7));
    validity[validityOf(secret)] += 1;
    for (const extension of extensionsBySecret.get(secret.id) ?? []) {
      increment(credentialToExtension, `${secret.target}\u0000${extension}`);
    }
  }

  /**
   * @remarks the credential and extension counts are the sums of their SURVIVING edges, not the true
   * totals, so neither a node count nor a published bucket can be differenced against the drawn edges
   * to recover a suppressed slice. The cost is that a thinly spread credential (no single extension
   * pairing reaching the floor) does not appear, which is the safe direction for a public file.
   */
  const edges = [...credentialToExtension.entries()].filter(([, weight]) => weight >= policy.minGroup);
  const byCredentialMap = new Map();
  const byExtensionMap = new Map();
  for (const [key, weight] of edges) {
    const [target, ext] = key.split("\u0000");
    increment(byCredentialMap, target, weight);
    increment(byExtensionMap, ext, weight);
  }
  const ranked = (map) => [...map.entries()]
    .sort((a, b) => b[1] - a[1] || compareText(a[0], b[0]))
    .map(([label, count]) => ({ label, count }));
  const credential = ranked(byCredentialMap);
  const extension = ranked(byExtensionMap);
  const band = suppress(byBand, policy.minGroup);
  const total = credential.reduce((sum, entry) => sum + entry.count, 0);

  const monthly = [...byMonth.entries()]
    .filter(([, count]) => count >= policy.minGroup)
    .sort((a, b) => compareText(a[0], b[0]))
    .map(([month, found]) => ({ month, found }));

  const stats = {
    byCredential: credential,
    byExtension: extension,
    byBand: band,
    validity: {
      live: floorOrZero(validity.live, policy.minGroup),
      dead: floorOrZero(validity.dead, policy.minGroup),
      formatOnly: floorOrZero(validity.formatOnly, policy.minGroup),
    },
    monthly,
    total,
    repositories: floorOrZero(repositories.size, policy.minGroup),
    owners: floorOrZero(owners.size, policy.minGroup),
    asOf: toDate(policy.cutoff),
  };

  const graph = categoryGraph(credential, extension, band, stats.repositories, edges);
  return { mode: "public", nodes: graph.nodes, edges: graph.edges, stats };
}

function categoryGraph(credential, extension, band, repositories, survivingPairs) {
  const nodes = [];
  const index = new Map();
  const add = (kind, label, count) => {
    index.set(`${kind}\u0000${label}`, nodes.length);
    nodes.push({ type: "CATEGORY", kind, label, count });
  };
  credential.forEach((entry) => add("credential", entry.label, entry.count));
  extension.forEach((entry) => add("extension", entry.label, entry.count));
  band.forEach((entry) => add("band", entry.label, entry.count));
  if (repositories > 0) {
    add("repositories", "repositories", repositories);
  }
  const edges = [];
  for (const [key, weight] of survivingPairs) {
    const [target, ext] = key.split("\u0000");
    const s = index.get(`credential\u0000${target}`);
    const t = index.get(`extension\u0000${ext}`);
    if (s !== undefined && t !== undefined) {
      edges.push({ s, t, weight });
    }
  }
  return { nodes, edges };
}

function parsedValidated(props) {
  try {
    return JSON.parse(props ?? "{}").validated === true;
  } catch {
    return false;
  }
}

function validityOf(secret) {
  if (!secret.validated) {
    return "formatOnly";
  }
  return secret.valid === 1 ? "live" : "dead";
}
