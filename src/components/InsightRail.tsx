import type { GraphDocument, GraphNode } from "../data/graph";
import { nodeName } from "../data/graph";
import { BAND_ORDER, BAND_COLOR, TYPE_ORDER, TYPE_COLOR, STATUS, INK } from "../lib/palette";
import { compactNumber, relativeTime } from "../lib/format";

const RELATION_LABEL: Record<string, string> = {
  LEAKED_IN: "leaked in",
  USED_IN: "used in",
  OWNED_BY: "owned by",
  MAINTAINS: "maintains",
  CO_MAINTAINS: "co-maintains",
  HOSTED_ON: "hosted on",
  CONTAINS: "contains",
  FOLLOWS: "follows",
};

function visitLink(document: GraphDocument, index: number): { url: string; label: string } | null {
  if (document.mode !== "private") {
    return null;
  }
  const node = document.nodes[index];
  if (node.type === "OWNER" || node.type === "MAINTAINER" || node.type === "REPOSITORY") {
    return { url: `https://github.com/${node.label}`, label: "View on GitHub" };
  }
  if (node.type === "FILE" && node.path) {
    const containing = document.edges.find((edge) =>
      edge.type === "CONTAINS" && edge.t === index && document.nodes[edge.s]?.type === "REPOSITORY");
    const repository = containing && document.nodes[containing.s];
    if (repository && repository.type === "REPOSITORY") {
      return { url: `https://github.com/${repository.label}/blob/HEAD/${node.path}`, label: "View file on GitHub" };
    }
  }
  return null;
}

function BandBar({ bands }: { bands: Record<string, number> }) {
  const total = BAND_ORDER.reduce((sum, band) => sum + (bands[band] ?? 0), 0) || 1;
  return (
    <div>
      <div className="bar">
        {BAND_ORDER.map((band) => {
          const share = ((bands[band] ?? 0) / total) * 100;
          return share > 0 ? (
            <span key={band} style={{ width: `${share}%`, background: BAND_COLOR[band] }} title={`${band.toLowerCase()} ${bands[band]}`} />
          ) : null;
        })}
      </div>
      <ul className="legend">
        {BAND_ORDER.map((band) => (
          <li key={band}>
            <span className="swatch" style={{ background: BAND_COLOR[band] }} />
            {band.toLowerCase()}
            <span className="legend-count">{bands[band] ?? 0}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Credentials({ document }: { document: GraphDocument }) {
  const totals = document.stats.credentials.reduce(
    (sum, row) => ({
      live: sum.live + row.validatedLive,
      dead: sum.dead + row.validatedDead,
      format: sum.format + row.formatOnly,
    }),
    { live: 0, dead: 0, format: 0 },
  );
  return (
    <div className="readouts">
      <div className="readout">
        <span className="readout-value" style={{ color: totals.live > 0 ? STATUS.critical : INK.primary }}>
          {compactNumber(totals.live)}
        </span>
        <span className="readout-label">confirmed live</span>
      </div>
      <div className="readout">
        <span className="readout-value">{compactNumber(totals.dead)}</span>
        <span className="readout-label">validated dead</span>
      </div>
      <div className="readout">
        <span className="readout-value">{compactNumber(totals.format)}</span>
        <span className="readout-label">format only</span>
      </div>
    </div>
  );
}

function CoOccurrence({ document }: { document: GraphDocument }) {
  const pairs = document.stats.coOccurrence.slice(0, 6);
  if (pairs.length === 0) {
    return <p className="empty">No secret types share a repository yet.</p>;
  }
  const widest = pairs[0].repositories || 1;
  return (
    <ul className="pairs">
      {pairs.map((pair) => (
        <li key={`${pair.a}-${pair.b}`}>
          <span className="pair-names">{pair.a} + {pair.b}</span>
          <span className="pair-track">
            <span className="pair-fill" style={{ width: `${(pair.repositories / widest) * 100}%` }} />
          </span>
          <span className="pair-count">{pair.repositories}</span>
        </li>
      ))}
    </ul>
  );
}

function TypeLegend({ document }: { document: GraphDocument }) {
  return (
    <ul className="legend legend-types">
      {TYPE_ORDER.filter((type) => (document.stats.nodes[type] ?? 0) > 0).map((type) => (
        <li key={type}>
          <span className="ring" style={{ borderColor: TYPE_COLOR[type] }} />
          {type.toLowerCase()}
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rail-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Stats({ document }: { document: GraphDocument }) {
  return (
    <>
      <Section title="Severity">
        <BandBar bands={document.stats.bands} />
      </Section>
      <Section title="Credentials">
        <Credentials document={document} />
      </Section>
      <Section title="Types that leak together">
        <CoOccurrence document={document} />
      </Section>
      <Section title="Node types">
        <TypeLegend document={document} />
      </Section>
    </>
  );
}

function typeFacts(node: GraphNode): [string, string][] {
  switch (node.type) {
    case "SECRET":
      return [
        ["Verification", node.validated ? (node.valid ? "confirmed live" : "validated dead") : "format only"],
        ...(node.category ? [["Category", node.category] as [string, string]] : []),
        ...(node.value ? [["Value", node.value] as [string, string]] : []),
      ];
    case "REPOSITORY":
      return [["Maintainers", String(node.maintainers)]];
    case "PACKAGE":
      return node.popularity == null ? [] : [["Reach", `${compactNumber(node.popularity)} files`]];
    case "FILE":
      return node.path ? [["Path", node.path]] : [];
    default:
      return [];
  }
}

function NodeFacts({ node, connections }: { node: GraphNode; connections: number }) {
  const facts: [string, string][] = [
    ["Severity", `${Math.round(node.severity)} of 100`],
    ["Blast radius", `${connections} connection${connections === 1 ? "" : "s"}`],
    ...typeFacts(node),
    ["First seen", relativeTime(node.firstSeen)],
    ["Last seen", relativeTime(node.lastSeen)],
  ];
  return (
    <dl className="facts">
      {facts.map(([term, value]) => (
        <div className="fact" key={term}>
          <dt>{term}</dt>
          <dd className={term === "Value" ? "mono" : undefined}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Relations({ document, index, onSelect }: { document: GraphDocument; index: number; onSelect: (index: string) => void }) {
  const relations = document.edges
    .filter((edge) => edge.s === index || edge.t === index)
    .map((edge) => {
      const otherIndex = edge.s === index ? edge.t : edge.s;
      return { type: edge.type, otherIndex, node: document.nodes[otherIndex] };
    })
    .filter((relation) => relation.node)
    .slice(0, 60);

  if (relations.length === 0) {
    return <p className="empty">No connections recorded.</p>;
  }
  return (
    <ul className="relations">
      {relations.map((relation, position) => (
        <li key={position}>
          <button type="button" className="relation" onClick={() => onSelect(String(relation.otherIndex))}>
            <span className="relation-kind">{RELATION_LABEL[relation.type] ?? relation.type.toLowerCase()}</span>
            <span className="relation-name" style={{ color: TYPE_COLOR[relation.node.type] }}>
              {nodeName(relation.node)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function NodeDetail({ document, index, onClear, onSelect }: { document: GraphDocument; index: number; onClear: () => void; onSelect: (index: string) => void }) {
  const node = document.nodes[index];
  const connections = document.edges.filter((edge) => edge.s === index || edge.t === index).length;
  const visit = visitLink(document, index);
  return (
    <div className="detail">
      <button type="button" className="back" onClick={onClear}>Back to overview</button>
      <div className="detail-head">
        <span className="detail-kind" style={{ color: TYPE_COLOR[node.type] }}>{node.type.toLowerCase()}</span>
        <h2 className="detail-name">{nodeName(node)}</h2>
        <span className="detail-band" style={{ background: BAND_COLOR[node.band] }}>
          {node.band.toLowerCase()} · {Math.round(node.severity)}
        </span>
      </div>
      {visit && (
        <a className="profile" href={visit.url} target="_blank" rel="noreferrer">{visit.label}</a>
      )}
      <NodeFacts node={node} connections={connections} />
      <Section title="Connections">
        <Relations document={document} index={index} onSelect={onSelect} />
      </Section>
    </div>
  );
}

interface Props {
  document: GraphDocument;
  selected: string | null;
  onClear: () => void;
  onSelect: (index: string) => void;
}

export function InsightRail({ document, selected, onClear, onSelect }: Props) {
  return (
    <aside className="rail">
      {selected != null ? (
        <NodeDetail document={document} index={Number(selected)} onClear={onClear} onSelect={onSelect} />
      ) : (
        <Stats document={document} />
      )}
    </aside>
  );
}
