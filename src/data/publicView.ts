import type { PublicStats } from "./graph.ts";
import { compactNumber } from "../lib/format.ts";

const fewer = (value: number): string => (value === 0 ? "fewer than 5" : compactNumber(value));

export function describePublic(stats: PublicStats): { tiles: { label: string; value: string }[]; asOfNote: string } {
  return {
    tiles: [
      { label: "findings", value: compactNumber(stats.total) },
      { label: "confirmed live", value: fewer(stats.validity.live) },
      { label: "repositories affected", value: fewer(stats.repositories) },
      { label: "owners affected", value: fewer(stats.owners) },
    ],
    asOfNote: `Aggregates only, as of ${stats.asOf}. Findings appear here 30 days after they are first seen, `
      + `rounded to the day, with any group under five hidden.`,
  };
}
