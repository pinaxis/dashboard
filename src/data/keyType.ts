import type { TargetInfo } from "./catalog.ts";
import type { GraphDocument } from "./graph.ts";

export interface KeyTypeTally {
  live: number;
  dead: number;
  formatOnly: number;
  total: number;
}

export interface KeyTypeView {
  name: string;
  known: boolean;
  info: TargetInfo | null;
  tally: KeyTypeTally;
}

export interface TargetFindings {
  repos: { label: string; count: number }[];
  owners: string[];
  bands: Record<string, number>;
}

const BANDS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];

// Traces a credential type through the graph to the repositories and owners it reaches: its secrets
// leak into files (LEAKED_IN), repositories contain those files (CONTAINS) and are owned by owners
// (OWNED_BY). Also tallies the type's secrets by severity band.
export function targetFindings(document: GraphDocument, name: string): TargetFindings {
  const bands: Record<string, number> = Object.fromEntries(BANDS.map((band) => [band, 0]));
  const secrets = new Set<number>();
  document.nodes.forEach((node, index) => {
    if (node.type === "SECRET" && (node as { target?: string }).target === name) {
      secrets.add(index);
      bands[node.band] = (bands[node.band] ?? 0) + 1;
    }
  });

  const files = new Set<number>();
  for (const edge of document.edges) {
    if (edge.type === "LEAKED_IN" && secrets.has(edge.s)) {
      files.add(edge.t);
    }
  }

  const repoCounts = new Map<number, number>();
  for (const edge of document.edges) {
    if (edge.type === "CONTAINS" && files.has(edge.t)) {
      repoCounts.set(edge.s, (repoCounts.get(edge.s) ?? 0) + 1);
    }
  }

  const owners = new Set<string>();
  for (const edge of document.edges) {
    if (edge.type === "OWNED_BY" && repoCounts.has(edge.s)) {
      const owner = document.nodes[edge.t];
      if (owner && "label" in owner) {
        owners.add(owner.label as string);
      }
    }
  }

  const repos = [...repoCounts.entries()]
    .map(([index, count]) => ({ label: (document.nodes[index] as { label?: string }).label ?? String(index), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return { repos, owners: [...owners].sort(), bands };
}

export function keyTypeView(name: string, catalog: Map<string, TargetInfo>, document: GraphDocument): KeyTypeView {
  const row = document.stats.credentials.find((entry) => entry.target === name);
  const tally: KeyTypeTally = row
    ? { live: row.validatedLive, dead: row.validatedDead, formatOnly: row.formatOnly,
        total: row.validatedLive + row.validatedDead + row.formatOnly }
    : { live: 0, dead: 0, formatOnly: 0, total: 0 };
  const info = catalog.get(name) ?? null;
  return { name, known: info !== null, info, tally };
}
