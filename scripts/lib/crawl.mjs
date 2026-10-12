import { all, compareText } from "./graph.mjs";

const RUN_LIMIT = 50;

function countsBy(db, sql) {
  return new Map(all(db, sql).map((row) => [row.key, row.total]));
}

/**
 * @remarks timestamps are compared as instants, not strings: the engine writes nanosecond fractions
 * and GitHub writes none, and "...26.03Z" sorts before "...26Z" as text.
 */
function withStored(db, runs) {
  const seen = all(db, "SELECT first_seen FROM node").map((row) => Date.parse(row.first_seen));
  const newestFirst = [...runs].sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, RUN_LIMIT);
  return newestFirst.map((entry, index) => {
    const from = Date.parse(entry.at);
    const until = index === 0 ? Infinity : Date.parse(newestFirst[index - 1].at);
    return { ...entry, stored: seen.filter((instant) => instant >= from && instant < until).length };
  });
}

export function buildCrawl(db, { dataset, since, runs }) {
  const pending = countsBy(db, "SELECT target AS key, COUNT(*) AS total FROM pending GROUP BY target");
  const found = countsBy(db, "SELECT target AS key, COUNT(*) AS total FROM node WHERE target <> '' GROUP BY target");
  const targets = [...new Set([...pending.keys(), ...found.keys()])].sort(compareText).map((target) => {
    const queued = pending.get(target) ?? 0;
    return { target, discovered: found.get(target) ?? 0, pending: queued, complete: queued === 0 };
  });
  const sources = all(db, "SELECT source, COUNT(*) AS total FROM pending GROUP BY source ORDER BY source")
    .map((row) => ({ source: row.source, pending: row.total }));
  return { dataset, since, targets, sources, runs: withStored(db, runs) };
}
