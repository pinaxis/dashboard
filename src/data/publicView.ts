import type { PublicStats } from "./graph.ts";
import { compactNumber } from "../lib/format.ts";

const fewer = (value: number): string => (value === 0 ? "fewer than 5" : compactNumber(value));

export function describePublic(stats: PublicStats): { tiles: { label: string; value: string }[]; asOfNote: string } {
  // With no findings at all nothing is suppressed, so every tile reads "none" rather than pairing an
  // exact zero with the "fewer than 5" sentinel the other counts use.
  const empty = stats.total === 0;
  const count = (value: number): string => (empty ? "none" : fewer(value));
  return {
    tiles: [
      { label: "findings", value: empty ? "none" : compactNumber(stats.total) },
      { label: "confirmed live", value: count(stats.validity.live) },
      { label: "repositories affected", value: count(stats.repositories) },
      { label: "owners affected", value: count(stats.owners) },
    ],
    asOfNote: `Aggregates only, as of ${stats.asOf}. Findings appear here 30 days after they are first seen, `
      + `rounded to the day, with any group under five hidden.`,
  };
}
