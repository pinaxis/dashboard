import type { GraphDocument } from "./graph";

export function leaksPerRepository(document: GraphDocument): Map<number, number> {
  const repositoryOfFile = new Map<number, number>();
  for (const edge of document.edges) {
    if (edge.type === "CONTAINS" && document.nodes[edge.s]?.type === "REPOSITORY") {
      repositoryOfFile.set(edge.t, edge.s);
    }
  }
  const leaks = new Map<number, number>();
  for (const edge of document.edges) {
    if (edge.type !== "LEAKED_IN") {
      continue;
    }
    const repository = document.nodes[edge.t]?.type === "REPOSITORY" ? edge.t : repositoryOfFile.get(edge.t);
    if (repository !== undefined) {
      leaks.set(repository, (leaks.get(repository) ?? 0) + 1);
    }
  }
  return leaks;
}
