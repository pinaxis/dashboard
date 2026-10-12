import { useMemo } from "react";
import Sigma from "sigma";
import { useEffect, useRef } from "react";
import type { PublicDocument } from "../data/graph";
import { buildCategoryScene } from "../graph/scene";
import { SERIES, STATUS } from "../lib/palette";
import { compactNumber } from "../lib/format";
import { describePublic } from "../data/publicView";


function Bars({ title, items, color }: { title: string; items: { label: string; count: number }[]; color: string }) {
  const widest = Math.max(1, ...items.map((item) => item.count));
  return (
    <section className="panel">
      <h2>{title}</h2>
      <ul className="hbars">
        {items.map((item) => (
          <li key={item.label}>
            <span className="hbar-label" title={item.label}>{item.label}</span>
            <span className="hbar-track">
              <span className="hbar-fill" style={{ width: `${(item.count / widest) * 100}%`, background: color }} />
            </span>
            <span className="hbar-value">{compactNumber(item.count)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function CategoryGraph({ document }: { document: PublicDocument }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) {
      return undefined;
    }
    const graph = buildCategoryScene(document);
    const sigma = new Sigma(graph, container.current, { defaultEdgeColor: "#2b2a27", renderEdgeLabels: false });
    return () => sigma.kill();
  }, [document]);
  return <div className="stage-canvas" ref={container} />;
}

export function PublicDashboard({ document }: { document: PublicDocument }) {
  const { tiles, asOfNote } = useMemo(() => describePublic(document.stats), [document.stats]);
  const stats = document.stats;
  return (
    <div className="analytics">
      <p className="progress-detail">{asOfNote}</p>
      <div className="tiles">
        {tiles.map((tile) => (
          <div key={tile.label} className="tile">
            <span className="tile-value">{tile.value}</span>
            <span className="tile-label">{tile.label}</span>
          </div>
        ))}
      </div>
      <div className="charts">
        <Bars title="By credential type" items={stats.byCredential} color={SERIES[0]} />
        <Bars title="By file extension" items={stats.byExtension} color={SERIES[1]} />
        <Bars title="By severity" items={stats.byBand.map((entry) => ({ ...entry }))} color={STATUS.warning} />
        <Bars title="New findings per month"
          items={stats.monthly.map((entry) => ({ label: entry.month, count: entry.found }))} color={SERIES[3]} />
        <section className="panel panel-wide">
          <h2>How categories connect</h2>
          <CategoryGraph document={document} />
        </section>
      </div>
    </div>
  );
}
