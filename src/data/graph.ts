import type { Band } from "../lib/palette";

export type NodeType = "SECRET" | "REPOSITORY" | "OWNER" | "PACKAGE" | "MAINTAINER" | "PLATFORM" | "FILE";
export type EdgeType =
  | "LEAKED_IN"
  | "USED_IN"
  | "OWNED_BY"
  | "MAINTAINS"
  | "CO_MAINTAINS"
  | "HOSTED_ON"
  | "CONTAINS"
  | "FOLLOWS";

interface BaseNode {
  type: NodeType;
  severity: number;
  band: Band;
  firstSeen: string;
  lastSeen: string;
  x?: number;
  y?: number;
}

export interface SecretNode extends BaseNode {
  type: "SECRET";
  target: string;
  category: string | null;
  valid: boolean;
  validated: boolean;
  value?: string;
}

export interface RepositoryNode extends BaseNode {
  type: "REPOSITORY";
  label: string;
  maintainers: number;
}

export interface OwnerNode extends BaseNode {
  type: "OWNER";
  label: string;
}

export interface PackageNode extends BaseNode {
  type: "PACKAGE";
  target: string;
  label: string;
  popularity: number | null;
}

export interface MaintainerNode extends BaseNode {
  type: "MAINTAINER";
  label: string;
}

export interface PlatformNode extends BaseNode {
  type: "PLATFORM";
  label: string;
}

export interface FileNode extends BaseNode {
  type: "FILE";
  label: string;
  path?: string;
}

export type GraphNode =
  | SecretNode
  | RepositoryNode
  | OwnerNode
  | PackageNode
  | MaintainerNode
  | PlatformNode
  | FileNode;

export interface GraphEdge {
  s: number;
  t: number;
  type: EdgeType;
  weight: number;
  severity: number;
  context?: string;
}

export interface Credential {
  target: string;
  validatedLive: number;
  validatedDead: number;
  formatOnly: number;
}

export interface CoOccurrence {
  a: string;
  b: string;
  repositories: number;
}

export interface Stats {
  nodes: Record<string, number>;
  edges: Record<string, number>;
  bands: Record<string, number>;
  credentials: Credential[];
  coOccurrence: CoOccurrence[];
  lastSeen: string | null;
}

export interface CrawlTargetRow {
  target: string;
  discovered: number;
  pending: number;
  complete: boolean;
}

export interface CrawlSourceRow {
  source: string;
  pending: number;
}

export interface CrawlRun {
  at: string;
  workflow: "scan" | "resume";
  conclusion: string | null;
  url: string;
  stored: number;
}

export interface Crawl {
  dataset: string;
  since: string;
  targets: CrawlTargetRow[];
  sources: CrawlSourceRow[];
  runs: CrawlRun[];
}

export interface GraphDocument {
  mode: "public" | "private";
  schema: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: Stats;
  crawl?: Crawl;
  dataset?: string;
  generatedAt?: string;
}

export function nodeName(node: GraphNode): string {
  return node.type === "SECRET" ? node.target : node.label;
}

export async function loadGraph(url: string, options?: RequestInit): Promise<GraphDocument> {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`could not load the graph (HTTP ${response.status})`);
  }
  return (await response.json()) as GraphDocument;
}
