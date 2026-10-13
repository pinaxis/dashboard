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

export function keyTypeView(name: string, catalog: Map<string, TargetInfo>, document: GraphDocument): KeyTypeView {
  const row = document.stats.credentials.find((entry) => entry.target === name);
  const tally: KeyTypeTally = row
    ? { live: row.validatedLive, dead: row.validatedDead, formatOnly: row.formatOnly,
        total: row.validatedLive + row.validatedDead + row.formatOnly }
    : { live: 0, dead: 0, formatOnly: 0, total: 0 };
  const info = catalog.get(name) ?? null;
  return { name, known: info !== null, info, tally };
}
