import { useState } from "react";
import type { GraphDocument } from "../data/graph";
import { compactNumber, relativeTime } from "../lib/format";
import { STATUS, SERIES } from "../lib/palette";

const REPO_URL = (import.meta.env.VITE_REPO_URL as string) || "https://github.com/intisy/pinaxis";

function percentColor(percent: number): string {
  if (percent >= 100) {
    return STATUS.good;
  }
  if (percent >= 50) {
    return STATUS.warning;
  }
  return STATUS.serious;
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

function ProgressRow({ label, percent, detail, completed }: { label: string; percent: number; detail: string; completed: string | null }) {
  return (
    <li className="progress-row">
      <div className="progress-head">
        <span className="progress-label" title={label}>{label}</span>
        <span className="progress-pct">{percent}%</span>
      </div>
      <span className="hbar-track">
        <span className="hbar-fill" style={{ width: `${percent}%`, background: percentColor(percent) }} />
      </span>
      <span className="progress-detail">
        {detail} · {completed ? `last full pass ${relativeTime(completed)}` : "no full pass yet"}
      </span>
    </li>
  );
}

export function CrawlProgress({ document }: { document: GraphDocument }) {
  const crawl = document.crawl;
  const [requested, setRequested] = useState(false);
  const [target, setTarget] = useState("all");
  const [maxSearches, setMaxSearches] = useState(25);
  const [pages, setPages] = useState(1);

  if (!crawl) {
    return (
      <div className="analytics">
        <p className="empty">This dataset carries no crawl telemetry.</p>
      </div>
    );
  }

  const running = requested || crawl.lock.state === "running";
  const startCrawl = () => {
    window.open(`${REPO_URL}/actions/workflows/scan.yml`, "_blank", "noopener");
    setRequested(true);
  };
  const stopCrawl = () => {
    window.open(crawl.lock.run ?? `${REPO_URL}/actions`, "_blank", "noopener");
    setRequested(false);
  };

  const scannedTotal = crawl.targets.reduce((sum, target) => sum + target.scanned, 0);
  const estimatedTotal = crawl.targets.reduce((sum, target) => sum + target.estimated, 0);
  const mostStored = Math.max(1, ...crawl.history.map((point) => point.stored));

  return (
    <div className="analytics">
      <div className={`crawl-status crawl-status-${running ? "running" : "idle"}`}>
        <span className="crawl-dot" />
        <span>
          {running
            ? `Crawl running${crawl.lock.since ? ` since ${relativeTime(crawl.lock.since)}` : ""}${requested ? " (dispatch requested)" : ""}`
            : "No crawl running"}
        </span>
      </div>

      <section className="panel panel-wide controls">
        <h2>Controls</h2>
        <div className="controls-grid">
          <label>
            Target
            <select value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="all">all</option>
              {crawl.targets.map((row) => (
                <option key={row.target} value={row.target}>{row.target}</option>
              ))}
            </select>
          </label>
          <label>
            Max searches
            <input type="number" min={1} value={maxSearches} onChange={(event) => setMaxSearches(Number(event.target.value))} />
          </label>
          <label>
            Discovery pages
            <input type="number" min={1} value={pages} onChange={(event) => setPages(Number(event.target.value))} />
          </label>
        </div>
        <div className="controls-actions">
          <button type="button" className="control-start" disabled={running} onClick={startCrawl}>Start crawl</button>
          <button type="button" className="control-stop" disabled={!running} onClick={stopCrawl}>Stop running crawl</button>
        </div>
        <p className="progress-detail">
          Start opens the <code>scan.yml</code> workflow on GitHub with target <code>{target}</code>,
          max searches <code>{maxSearches}</code>, pages <code>{pages}</code>; you dispatch it with your own
          account. A run holds an atomic <code>refs/tags/crawl-lock</code> ref for its whole duration, so a
          second dispatch refuses and only one crawl ever runs at a time. One-click control from here would
          need an access-gated worker holding a token.
        </p>
      </section>

      <div className="tiles">
        <Tile value={`${crawl.overallPercent}%`} label="overall scanned" accent={percentColor(crawl.overallPercent)} />
        <Tile value={`${crawl.searched}/${crawl.budget}`} label="searches this run" />
        <Tile value={compactNumber(crawl.pending)} label="pending frontier" accent={SERIES[3]} />
        <Tile value={String(crawl.runs)} label="runs on this dataset" />
        <Tile value={relativeTime(crawl.lastRun)} label="last run" />
      </div>
      <div className="charts">
        <Panel title="Overall progress" wide>
          <div className="hbar-track" style={{ height: 18 }}>
            <span className="hbar-fill" style={{ width: `${crawl.overallPercent}%`, background: percentColor(crawl.overallPercent) }} />
          </div>
          <p className="progress-detail" style={{ marginTop: "0.7rem" }}>
            {compactNumber(scannedTotal)} of an estimated {compactNumber(estimatedTotal)} items scanned across
            all targets. The estimate is scanned items plus the pending frontier, so it moves as discovery finds more.
          </p>
        </Panel>

        <Panel title="By source">
          <ul className="progress-list">
            {crawl.sources.map((source) => (
              <ProgressRow
                key={source.source}
                label={source.source}
                percent={source.percent}
                detail={`${compactNumber(source.scanned)} of ~${compactNumber(source.estimated)} scanned`}
                completed={source.lastCompleted}
              />
            ))}
          </ul>
        </Panel>

        <Panel title="Search budget">
          <div className="hbar-track" style={{ height: 16 }}>
            <span className="hbar-fill" style={{ width: `${Math.round((crawl.searched / Math.max(1, crawl.budget)) * 100)}%`, background: STATUS.warning }} />
          </div>
          <p className="progress-detail" style={{ marginTop: "0.7rem" }}>
            {crawl.searched} of {crawl.budget} searches spent this run. A capped run stops here and refuses to
            hop, so the {compactNumber(crawl.pending)}-item frontier persists to the next run.
          </p>
        </Panel>

        <Panel title="By target" wide>
          <ul className="progress-list">
            {crawl.targets.map((target) => (
              <ProgressRow
                key={target.target}
                label={target.target}
                percent={target.percent}
                detail={`${compactNumber(target.scanned)} of ~${compactNumber(target.estimated)} scanned · ${target.pending} pending · ${target.discovered} found`}
                completed={target.lastCompleted}
              />
            ))}
          </ul>
        </Panel>

        <Panel title="Recent runs" wide>
          <ul className="hbars">
            {crawl.history.map((point) => (
              <li key={point.at}>
                <span className="hbar-label">{relativeTime(point.at)}</span>
                <span className="hbar-track">
                  <span className="hbar-fill" style={{ width: `${(point.stored / mostStored) * 100}%`, background: SERIES[0] }} />
                </span>
                <span className="hbar-value">{compactNumber(point.stored)} stored · {point.searched} searched</span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
