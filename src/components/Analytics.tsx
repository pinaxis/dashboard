import { useMemo, useState } from "react";
import {
  ComposedChart, Bar as RBar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import type { GraphDocument } from "../data/graph";
import { nodeName } from "../data/graph";
import { leaksPerRepository } from "../data/exposure";
import { topPackages, coOccurrenceBars, packagesByEcosystem, hasNamedPackages, type Bar } from "../data/analytics";
import { exposuresOverTime, byCategory, byFileType, validityTotals, applyFilter, type ChartFilter } from "../data/chartSeries";
import { Chips, type ChipItem } from "./Chips";
import { BAND_ORDER, BAND_COLOR, TYPE_ORDER, TYPE_COLOR, STATUS, SERIES, INK, GRID } from "../lib/palette";
import { compactNumber } from "../lib/format";

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

function Credentials({ document, onOpenType }: { document: GraphDocument; onOpenType?: (name: string) => void }) {
  const rows = [...document.stats.credentials]
    .map((row) => ({ ...row, total: row.validatedLive + row.validatedDead + row.formatOnly }))
    .sort((a, b) => b.total - a.total);
  const widest = Math.max(1, ...rows.map((row) => row.total));
  return (
    <div>
      <ul className="hbars">
        {rows.map((row) => (
          <li key={row.target}>
            {onOpenType ? (
              <button type="button" className="hbar-label target-link" title={row.target} onClick={() => onOpenType(row.target)}>{row.target}</button>
            ) : (
              <span className="hbar-label" title={row.target}>{row.target}</span>
            )}
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
  return [...leaksPerRepository(document).entries()]
    .map(([index, count]) => ({ node: document.nodes[index], count }))
    .filter((entry) => entry.node?.type === "REPOSITORY")
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map((entry) => ({ label: nodeName(entry.node), value: entry.count, color: BAND_COLOR[entry.node.band] }));
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

const VALIDITY = [
  { id: "live" as const, label: "live", color: STATUS.critical },
  { id: "dead" as const, label: "dead", color: INK.muted },
  { id: "format" as const, label: "format", color: SERIES[0] },
];

function emptyFilter(): ChartFilter {
  return { bands: new Set(), types: new Set(), validity: new Set() };
}

function toggle<T>(set: Set<T>, id: T): Set<T> {
  const next = new Set(set);
  if (next.has(id)) { next.delete(id); } else { next.add(id); }
  return next;
}

const tooltipStyle = { background: "#111", border: `1px solid ${GRID}`, color: INK.primary };

export function Analytics({ document, onOpenType }: { document: GraphDocument; onOpenType?: (name: string) => void }) {
  const [filter, setFilter] = useState<ChartFilter>(emptyFilter);
  const [bucket, setBucket] = useState<"day" | "week">("week");
  const view = useMemo(() => applyFilter(document, filter), [document, filter]);

  const series = useMemo(() => exposuresOverTime(view, bucket), [view, bucket]);
  const validity = useMemo(() => validityTotals(document), [document]);
  const categories = useMemo(() => byCategory(view), [view]);
  const fileTypes = useMemo(() => byFileType(view), [view]);
  const bands: Bar[] = BAND_ORDER.map((band) => ({
    label: band.toLowerCase(),
    value: view.nodes.filter((node) => node.band === band).length,
    color: BAND_COLOR[band],
  }));

  const severityChips: ChipItem[] = BAND_ORDER.map((band) => ({ id: band, label: band.toLowerCase(), color: BAND_COLOR[band] }));
  const typeChips: ChipItem[] = TYPE_ORDER.map((type) => ({ id: type, label: type.toLowerCase(), color: TYPE_COLOR[type] }));
  const validityChips: ChipItem[] = VALIDITY.map((role) => ({ id: role.id, label: role.label, color: role.color }));

  const donut = [
    { name: "live", value: validity.live, color: STATUS.critical },
    { name: "dead", value: validity.dead, color: INK.muted },
    { name: "format only", value: validity.formatOnly, color: SERIES[0] },
  ].filter((slice) => slice.value > 0);

  return (
    <div className="analytics">
      <div className="toolbar toolbar-charts">
        <Chips label="Severity" items={severityChips} active={filter.bands} onToggle={(id) => setFilter((f) => ({ ...f, bands: toggle(f.bands, id) }))} />
        <Chips label="Types" items={typeChips} active={filter.types} onToggle={(id) => setFilter((f) => ({ ...f, types: toggle(f.types, id) }))} />
        <Chips label="Validity" items={validityChips} active={filter.validity} onToggle={(id) => setFilter((f) => ({ ...f, validity: toggle(f.validity, id as "live" | "dead" | "format") }))} />
      </div>

      <div className="tiles">
        <Tile value={compactNumber(view.nodes.length)} label="entities in view" />
        <Tile value={compactNumber(validity.live)} label="confirmed live" accent={validity.live > 0 ? STATUS.critical : undefined} />
        <Tile value={compactNumber(categories.length)} label="categories" />
        <Tile value={compactNumber(fileTypes.reduce((sum, bar) => sum + bar.value, 0))} label="files" />
      </div>

      <div className="charts">
        <Panel title="Exposures over time" wide>
          <div className="panel-switch">
            <button type="button" className={`tab ${bucket === "day" ? "tab-on" : ""}`} onClick={() => setBucket("day")}>day</button>
            <button type="button" className={`tab ${bucket === "week" ? "tab-on" : ""}`} onClick={() => setBucket("week")}>week</button>
          </div>
          {series.length === 0 ? <p className="empty">No dated findings in this slice.</p> : (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={series}>
                <XAxis dataKey="at" stroke={INK.muted} fontSize={11} />
                <YAxis stroke={INK.muted} fontSize={11} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <RBar dataKey="found" fill={SERIES[0]} />
                <Line type="monotone" dataKey="cumulative" stroke={STATUS.critical} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Validity">
          {donut.length === 0 ? <p className="empty">Nothing to show yet.</p> : (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={donut} dataKey="value" nameKey="name" innerRadius={48} outerRadius={72}>
                  {donut.map((slice) => <Cell key={slice.name} fill={slice.color} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Severity distribution">
          <HBars items={bands} />
        </Panel>
        <Panel title="Credentials by type" wide>
          <Credentials document={document} onOpenType={onOpenType} />
        </Panel>
        <Panel title="By category"><HBars items={categories} /></Panel>
        <Panel title="By file type"><HBars items={fileTypes} /></Panel>
        <Panel title="Most exposed repositories"><HBars items={topExposedRepositories(view)} /></Panel>
        <Panel title="Types that leak together"><HBars items={coOccurrenceBars(view)} /></Panel>
        <Panel title={hasNamedPackages(view) ? "Most used packages" : "Most depended-on ecosystems"}>
          <HBars items={hasNamedPackages(view) ? topPackages(view) : packagesByEcosystem(view)} format={compactNumber} />
        </Panel>
      </div>
    </div>
  );
}
