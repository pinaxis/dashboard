import type { GraphDocument, PackageNode } from "../data/graph";
import { nodeName } from "../data/graph";
import { BAND_ORDER, BAND_COLOR, TYPE_COLOR, STATUS, SERIES, INK } from "../lib/palette";
import { compactNumber } from "../lib/format";

interface Bar {
  label: string;
  value: number;
  color: string;
}

function HBars({ items, format }: { items: Bar[]; format?: (value: number) => string }) {
  const widest = Math.max(1, ...items.map((item) => item.value));
  const show = format ?? String;
  if (items.length === 0) {
    return <p className="empty">Nothing to show yet.</p>;
  }
  return (
    <ul className="hbars">
      {items.map((item) => (
        <li key={item.label}>
          <span className="hbar-label" title={item.label}>{item.label}</span>
          <span className="hbar-track">
            <span className="hbar-fill" style={{ width: `${(item.value / widest) * 100}%`, background: item.color }} />
          </span>
          <span className="hbar-value">{show(item.value)}</span>
        </li>
      ))}
    </ul>
  );
}

const CREDENTIAL_ROLES = [
  { key: "validatedLive", label: "confirmed live", color: STATUS.critical },
  { key: "validatedDead", label: "validated dead", color: INK.muted },
  { key: "formatOnly", label: "format only", color: SERIES[0] },
] as const;

function Credentials({ document }: { document: GraphDocument }) {
  const rows = [...document.stats.credentials]
    .map((row) => ({ ...row, total: row.validatedLive + row.validatedDead + row.formatOnly }))
    .sort((a, b) => b.total - a.total);
  const widest = Math.max(1, ...rows.map((row) => row.total));
  return (
    <div>
      <ul className="hbars">
        {rows.map((row) => (
          <li key={row.target}>
            <span className="hbar-label" title={row.target}>{row.target}</span>
            <span className="hbar-track">
              {CREDENTIAL_ROLES.map((role) =>
                row[role.key] > 0 ? (
                  <span
                    key={role.key}
                    className="hbar-seg"
                    style={{ width: `${(row[role.key] / widest) * 100}%`, background: role.color }}
                    title={`${role.label} ${row[role.key]}`}
                  />
                ) : null,
              )}
            </span>
            <span className="hbar-value">{row.total}</span>
          </li>
        ))}
      </ul>
      <ul className="legend legend-inline">
        {CREDENTIAL_ROLES.map((role) => (
          <li key={role.key}>
            <span className="swatch" style={{ background: role.color }} />
            {role.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function topExposedRepositories(document: GraphDocument): Bar[] {
  const leaks = new Map<number, number>();
  for (const edge of document.edges) {
    if (edge.type !== "LEAKED_IN") {
      continue;
    }
    const repository = document.nodes[edge.t]?.type === "REPOSITORY" ? edge.t : edge.s;
    leaks.set(repository, (leaks.get(repository) ?? 0) + 1);
  }
  return [...leaks.entries()]
    .map(([index, count]) => ({ node: document.nodes[index], count }))
    .filter((entry) => entry.node?.type === "REPOSITORY")
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((entry) => ({ label: nodeName(entry.node), value: entry.count, color: BAND_COLOR[entry.node.band] }));
}

function topPackages(document: GraphDocument): Bar[] {
  return document.nodes
    .filter((node): node is PackageNode => node.type === "PACKAGE" && node.popularity != null)
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .slice(0, 10)
    .map((node) => ({ label: node.label, value: node.popularity ?? 0, color: TYPE_COLOR.PACKAGE }));
}

function Tile({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <div className="tile">
      <span className="tile-value" style={accent ? { color: accent } : undefined}>{value}</span>
      <span className="tile-label">{label}</span>
    </div>
  );
}

function Panel({ title, wide, children }: { title: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <section className={`panel ${wide ? "panel-wide" : ""}`}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function Analytics({ document }: { document: GraphDocument }) {
  const live = document.stats.credentials.reduce((sum, row) => sum + row.validatedLive, 0);
  const bands: Bar[] = BAND_ORDER.map((band) => ({
    label: band.toLowerCase(),
    value: document.stats.bands[band] ?? 0,
    color: BAND_COLOR[band],
  }));
  const cooccurrence: Bar[] = document.stats.coOccurrence
    .slice(0, 8)
    .map((pair) => ({ label: `${pair.a} + ${pair.b}`, value: pair.repositories, color: SERIES[6] }));

  return (
    <div className="analytics">
      <div className="tiles">
        <Tile value={compactNumber(document.nodes.length)} label="entities" />
        <Tile value={compactNumber(document.edges.length)} label="relationships" />
        <Tile value={compactNumber(live)} label="confirmed live" accent={live > 0 ? STATUS.critical : undefined} />
        <Tile value={compactNumber(document.stats.nodes.REPOSITORY ?? 0)} label="repositories" />
        <Tile value={compactNumber(document.stats.nodes.PACKAGE ?? 0)} label="packages" />
      </div>
      <div className="charts">
        <Panel title="Credentials by type" wide>
          <Credentials document={document} />
        </Panel>
        <Panel title="Severity distribution">
          <HBars items={bands} />
        </Panel>
        <Panel title="Types that leak together">
          <HBars items={cooccurrence} />
        </Panel>
        <Panel title="Most exposed repositories">
          <HBars items={topExposedRepositories(document)} />
        </Panel>
        <Panel title="Most used packages">
          <HBars items={topPackages(document)} format={compactNumber} />
        </Panel>
      </div>
    </div>
  );
}
