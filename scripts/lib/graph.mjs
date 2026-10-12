const PATH_BEARING_EDGES = new Set(["LEAKED_IN", "USED_IN"]);

export function all(db, sql) {
  const statement = db.prepare(sql);
  const out = [];
  while (statement.step()) {
    out.push(statement.getAsObject());
  }
  statement.free();
  return out;
}

function maskSecret(value) {
  const visible = value.slice(0, Math.min(6, Math.max(0, value.length - 4)));
  return visible.length > 0 ? `${visible}…••••` : "••••";
}

function parsedProps(row) {
  try {
    return JSON.parse(row.props ?? "{}");
  } catch {
    return {};
  }
}

function emitNode(row, { maintainerCounts }) {
  const base = {
    type: row.type,
    severity: row.severity,
    band: row.severity_band,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
  };
  if (row.type === "SECRET") {
    const props = parsedProps(row);
    const secret = { ...base, target: row.target, category: row.category,
      valid: row.valid === 1, validated: props.validated === true };
    return { ...secret, value: maskSecret(row.key) };
  }
  if (row.type === "REPOSITORY" || row.type === "OWNER") {
    const named = { ...base, label: row.label };
    return row.type === "REPOSITORY"
      ? { ...named, maintainers: maintainerCounts.get(row.id) ?? 0 }
      : named;
  }
  if (row.type === "PACKAGE") {
    return { ...base, target: row.target, label: row.label, popularity: row.popularity };
  }
  return { ...base, label: row.label };
}

function coOccurrence(db) {
  const rows = all(db, `
    SELECT a.target AS a, b.target AS b, COUNT(DISTINCT a.dst) AS repositories FROM
      (SELECT edge.dst, node.target FROM edge JOIN node ON node.id = edge.src
         WHERE edge.type='LEAKED_IN' AND node.type='SECRET') a
      JOIN
      (SELECT edge.dst, node.target FROM edge JOIN node ON node.id = edge.src
         WHERE edge.type='LEAKED_IN' AND node.type='SECRET') b
      ON a.dst = b.dst AND a.target < b.target
    GROUP BY a.target, b.target ORDER BY repositories DESC, a.target, b.target`);
  return rows.map((row) => ({ a: row.a, b: row.b, repositories: row.repositories }));
}

function credentials(db) {
  return all(db, `
    SELECT target,
      SUM(CASE WHEN json_extract(props,'$.validated')=1 AND valid=1 THEN 1 ELSE 0 END) AS validatedLive,
      SUM(CASE WHEN json_extract(props,'$.validated')=1 AND valid=0 THEN 1 ELSE 0 END) AS validatedDead,
      SUM(CASE WHEN json_extract(props,'$.validated')=1 THEN 0 ELSE 1 END) AS formatOnly
    FROM node WHERE type='SECRET' GROUP BY target ORDER BY target`)
    .map((row) => ({ target: row.target, validatedLive: row.validatedLive,
      validatedDead: row.validatedDead, formatOnly: row.formatOnly }));
}

function tally(items, keyOf) {
  const out = {};
  for (const item of items) {
    out[keyOf(item)] = (out[keyOf(item)] ?? 0) + 1;
  }
  return out;
}

export const compareText = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const earliest = (a, b) => (b < a ? b : a);
const latest = (a, b) => (b > a ? b : a);
const fileKey = (repository, path) => `${repository}\u0000${path}`;

function isFiled(row) {
  return PATH_BEARING_EDGES.has(row.type) && row.context !== "";
}

function deriveFiles(edgeRows) {
  const byKey = new Map();
  for (const row of edgeRows.filter(isFiled)) {
    const key = fileKey(row.dst, row.context);
    if (!byKey.has(key)) {
      byKey.set(key, { key, repository: row.dst, path: row.context, incoming: [] });
    }
    byKey.get(key).incoming.push(row);
  }
  return [...byKey.values()]
    .sort((a, b) => a.repository - b.repository || compareText(a.path, b.path));
}

function emitFile(file, { rowsById }) {
  const worst = file.incoming.reduce((a, b) => (b.severity > a.severity ? b : a));
  const sources = file.incoming.map((row) => rowsById.get(row.src));
  return {
    type: "FILE",
    severity: worst.severity,
    band: rowsById.get(worst.src).severity_band,
    firstSeen: sources.map((row) => row.first_seen).reduce(earliest),
    lastSeen: sources.map((row) => row.last_seen).reduce(latest),
    label: file.path,
    path: file.path,
  };
}

function derivePlatforms(rows) {
  const byName = new Map();
  for (const row of rows.filter((candidate) => candidate.type === "REPOSITORY" && candidate.platform)) {
    if (!byName.has(row.platform)) {
      byName.set(row.platform, []);
    }
    byName.get(row.platform).push(row);
  }
  if (byName.size < 2) {
    return [];
  }
  return [...byName.entries()]
    .sort(([a], [b]) => compareText(a, b))
    .map(([name, repositories]) => ({ name, repositories }));
}

function emitPlatform(platform) {
  return {
    type: "PLATFORM",
    severity: 0,
    band: "LOW",
    firstSeen: platform.repositories.map((row) => row.first_seen).reduce(earliest),
    lastSeen: platform.repositories.map((row) => row.last_seen).reduce(latest),
    label: platform.name,
  };
}

function emitEdge(row, { indexById, fileIndex }) {
  const edge = { s: indexById.get(row.src), t: indexById.get(row.dst), type: row.type,
    weight: row.weight, severity: row.severity };
  if (isFiled(row)) {
    return { ...edge, t: fileIndex.get(fileKey(row.dst, row.context)) };
  }
  return row.context === "" ? edge : { ...edge, context: row.context };
}

/**
 * @remarks builds the private document only. Public disclosure lives entirely in `buildPublicGraph`
 * (aggregates only) and the public gate, so there is no second public path here to drift.
 */
export function buildGraph(db, { schemaVersion }) {
  const maintainerCounts = new Map(
    all(db, "SELECT dst, COUNT(*) AS total FROM edge WHERE type='MAINTAINS' GROUP BY dst")
      .map((row) => [row.dst, row.total]));

  const rows = all(db, "SELECT * FROM node ORDER BY id");
  const indexById = new Map(rows.map((row, index) => [row.id, index]));
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  const edgeRows = all(db, "SELECT * FROM edge ORDER BY id")
    .filter((row) => indexById.has(row.src) && indexById.has(row.dst));
  const files = deriveFiles(edgeRows);
  const fileIndex = new Map(files.map((file, offset) => [file.key, rows.length + offset]));
  const platforms = derivePlatforms(rows);
  const platformStart = rows.length + files.length;

  const nodes = [
    ...rows.map((row) => emitNode(row, { maintainerCounts })),
    ...files.map((file) => emitFile(file, { rowsById })),
    ...platforms.map(emitPlatform),
  ];

  const edges = [
    ...edgeRows.map((row) => emitEdge(row, { indexById, fileIndex })),
    ...files.map((file) => {
      const t = fileIndex.get(file.key);
      return { s: indexById.get(file.repository), t, type: "CONTAINS", weight: 1, severity: nodes[t].severity };
    }),
    ...platforms.flatMap((platform, offset) => platform.repositories.map((row) => ({
      s: indexById.get(row.id), t: platformStart + offset, type: "HOSTED_ON", weight: 1, severity: 0 }))),
  ];

  return {
    mode: "private",
    schema: schemaVersion,
    nodes,
    edges,
    stats: {
      nodes: tally(nodes, (node) => node.type),
      edges: tally(edges, (edge) => edge.type),
      bands: tally(nodes, (node) => node.band),
      credentials: credentials(db),
      coOccurrence: coOccurrence(db),
      lastSeen: nodes.length === 0 ? null : nodes.map((node) => node.lastSeen).reduce(latest),
    },
  };
}
