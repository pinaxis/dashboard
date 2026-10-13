import { useCallback, useEffect, useMemo, useState } from "react";
import type { Crawl, GraphDocument } from "../data/graph";
import { crawlApi } from "../data/crawlApi";
import type { StartInputs } from "../data/crawlApi";
import { canStart, describeStatus, isActive, isCrawlStatus } from "../data/crawlStatus";
import type { LiveState } from "../data/crawlStatus";
import type { TargetInfo } from "../data/catalog";
import { loadPriorities, savePriorities, priorityRows, validatePriorityInput } from "../data/priorities";
import { throughput, queueBySource } from "../data/crawlAnalytics";
import { CrawlPipeline } from "./CrawlPipeline";
import { compactNumber, relativeTime } from "../lib/format";
import { STATUS, SERIES } from "../lib/palette";

const POLL_MS = 15_000;

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

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

function percentFound(row: { discovered: number; pending: number } | undefined): number {
  if (!row) {
    return 0;
  }
  const total = row.discovered + row.pending;
  return total === 0 ? 0 : Math.round((row.discovered / total) * 100);
}
const errorText = (failure: unknown): string => (failure instanceof Error ? failure.message : String(failure));

function useLiveStatus(): [LiveState, () => Promise<void>] {
  const [state, setState] = useState<LiveState>({ kind: "loading" });
  const refresh = useCallback(async () => {
    try {
      const status = await crawlApi.status();
      setState(isCrawlStatus(status)
        ? { kind: "ready", status }
        : { kind: "unknown", error: "the crawl status response was not in the expected shape" });
    } catch (failure) {
      setState({ kind: "unknown", error: errorText(failure) });
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const running = state.kind === "ready" && isActive(state.status);
  useEffect(() => {
    if (!running) {
      return undefined;
    }
    const timer = window.setInterval(() => {
      if (!window.document.hidden) {
        void refresh();
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [running, refresh]);
  return [state, refresh];
}

function Controls({ crawl, state, refresh }: { crawl: Crawl; state: LiveState; refresh: () => Promise<void> }) {
  const [targets, setTargets] = useState("");
  const [maxSearches, setMaxSearches] = useState("");
  const [pages, setPages] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = state.kind === "ready" ? state.status : null;

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
      await refresh();
    }
  };
  const inputs = (mode: StartInputs["mode"]): StartInputs => ({
    mode,
    ...(targets.trim() ? { targets: targets.trim() } : {}),
    ...(maxSearches ? { maxSearches: Number(maxSearches) } : {}),
    ...(pages ? { discoveryPages: Number(pages) } : {}),
  });
  const cancel = () => {
    if (window.confirm("Cancel the running crawl? It is paused first; work since its last snapshot is lost, "
      + "and the crawl lock clears when its lease expires.")) {
      void act(crawlApi.cancel);
    }
  };
  const cannotStart = busy || !status || !canStart(status);

  return (
    <section className="panel panel-wide controls">
      <h2>Controls</h2>
      <div className="controls-grid">
        <label>
          Targets (comma separated, blank for all)
          <input list="crawl-targets" value={targets} onChange={(event) => setTargets(event.target.value)} />
          <datalist id="crawl-targets">
            {crawl.targets.map((row) => <option key={row.target} value={row.target} />)}
          </datalist>
        </label>
        <label>
          Max searches (blank for uncapped)
          <input type="number" min={1} max={1000} value={maxSearches} onChange={(event) => setMaxSearches(event.target.value)} />
        </label>
        <label>
          Discovery pages (blank for all ten)
          <input type="number" min={1} max={10} value={pages} onChange={(event) => setPages(event.target.value)} />
        </label>
      </div>
      <div className="controls-actions">
        <button type="button" className="control-start" disabled={cannotStart} onClick={() => void act(() => crawlApi.start(inputs("full")))}>Start full crawl</button>
        <button type="button" className="control-stop" disabled={cannotStart} onClick={() => void act(() => crawlApi.start(inputs("test")))}>Start test run</button>
        <button type="button" className="control-stop" disabled={busy || !status || status.paused} onClick={() => void act(crawlApi.pause)}>Pause</button>
        <button type="button" className="control-stop" disabled={busy || !status?.current} onClick={cancel}>Cancel running crawl</button>
      </div>
      {error && <p className="progress-detail" style={{ color: STATUS.serious }}>{error}</p>}
      <p className="progress-detail">
        A full crawl is the default. A manual full run lifts a pause; a capped or test run sets the pause again
        when it starts, so the schedule does not continue it uncapped. Pause lets the current turn finish;
        cancel stops it now.
      </p>
    </section>
  );
}

type SortKey = "priority" | "found";

function PriorityTable(
  { crawl, catalog, onOpenType }: { crawl: Crawl; catalog: TargetInfo[]; onOpenType?: (name: string) => void },
) {
  const [overrides, setOverrides] = useState<Record<string, number>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadPriorities().then(setOverrides);
  }, []);

  const found = useMemo(() => new Map(crawl.targets.map((row) => [row.target, row])), [crawl.targets]);

  const rows = useMemo(() => {
    const base = priorityRows(catalog, overrides).map((row) => ({ ...row, crawl: found.get(row.name) }));
    if (sortKey === "found") {
      return [...base].sort((a, b) => (b.crawl?.discovered ?? 0) - (a.crawl?.discovered ?? 0));
    }
    return base;
  }, [catalog, overrides, found, sortKey]);

  const effective = (name: string, weight: number): number => validatePriorityInput(edits[name] ?? "") ?? weight;
  const invalid = Object.entries(edits).some(([, raw]) => validatePriorityInput(raw) === null);
  const dirty = rows.some((row) => {
    const parsed = validatePriorityInput(edits[row.name] ?? "");
    return parsed !== null && parsed !== row.weight;
  });

  const save = async () => {
    setBusy(true);
    setError(null);
    const weights: Record<string, number> = {};
    for (const entry of catalog) {
      const value = effective(entry.name, overrides[entry.name] ?? entry.weight);
      if (value !== entry.weight) {
        weights[entry.name] = value;
      }
    }
    try {
      await savePriorities(weights);
      setOverrides(await loadPriorities());
      setEdits({});
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel panel-wide">
      <h2>Targets and priority</h2>
      {catalog.length === 0 ? (
        <p className="empty">The catalog is not available; priority cannot be shown.</p>
      ) : (
        <>
          <table className="ptable">
            <thead>
              <tr>
                <th>target</th>
                <th><button type="button" className="th-sort" onClick={() => setSortKey("priority")}>priority {sortKey === "priority" ? "▾" : ""}</button></th>
                <th><button type="button" className="th-sort" onClick={() => setSortKey("found")}>found {sortKey === "found" ? "▾" : ""}</button></th>
                <th>queued</th>
                <th>progress</th>
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const raw = edits[row.name] ?? String(row.weight);
                const bad = validatePriorityInput(raw) === null;
                return (
                  <tr key={row.name}>
                    <td>
                      <button type="button" className="target-link" onClick={() => onOpenType?.(row.name)}>{row.name}</button>
                    </td>
                    <td>
                      <input
                        type="number" min={1} max={100} value={raw}
                        aria-invalid={bad}
                        onChange={(event) => setEdits((prev) => ({ ...prev, [row.name]: event.target.value }))}
                      />
                    </td>
                    <td>{compactNumber(row.crawl?.discovered ?? 0)}</td>
                    <td>{compactNumber(row.crawl?.pending ?? 0)}</td>
                    <td>
                      <span className="run-bar" title={`${percentFound(row.crawl)}% found`}>
                        <span style={{ width: `${percentFound(row.crawl)}%`, background: STATUS.good }} />
                      </span>
                    </td>
                    <td>{row.crawl?.complete ? <strong style={{ color: STATUS.good }}>done</strong> : (row.crawl?.pending ?? 0) > 0 ? "queued" : "idle"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="psave">
            <button type="button" className="control-start" disabled={busy || invalid || !dirty} onClick={() => void save()}>Save priority</button>
            {error && <span className="progress-detail" style={{ color: STATUS.serious }}> {error}</span>}
          </div>
        </>
      )}
    </section>
  );
}

export function CrawlProgress(
  { document, catalog, onOpenType }:
    { document: GraphDocument; catalog: TargetInfo[]; onOpenType?: (name: string) => void },
) {
  const crawl = document.crawl;
  const [state, refresh] = useLiveStatus();

  if (!crawl) {
    return (
      <div className="analytics">
        <p className="empty">This dataset carries no crawl telemetry.</p>
      </div>
    );
  }

  const line = describeStatus(state, relativeTime);
  const lastRun = crawl.runs[0];
  const mostStored = Math.max(1, ...crawl.runs.map((run) => run.stored));
  const flow = throughput(crawl);
  const sources = queueBySource(crawl);

  return (
    <div className="analytics">
      <div className={`crawl-status crawl-status-${line.tone}`}>
        <span className="crawl-dot" />
        <span>{line.text}</span>
        {state.kind === "ready" && state.status.current && (
          <a href={state.status.current.url} target="_blank" rel="noopener noreferrer">view run</a>
        )}
      </div>

      <CrawlPipeline crawl={crawl} />

      <Controls crawl={crawl} state={state} refresh={refresh} />

      <div className="tiles">
        <Tile value={compactNumber(flow.pending)} label="queued queries" accent={SERIES[3]} />
        <Tile value={compactNumber(sum(crawl.targets.map((row) => row.discovered)))} label="items found" />
        <Tile value={compactNumber(flow.avgPerRun)} label="found per run" />
        <Tile value={flow.etaRuns == null ? "caught up" : `~${flow.etaRuns}`} label={flow.etaRuns == null ? "backlog" : "runs to drain"} />
        <Tile value={String(crawl.runs.length)} label={`runs on ${crawl.dataset}`} />
        <Tile value={lastRun ? relativeTime(lastRun.at) : "none"} label={lastRun ? `last run, ${lastRun.conclusion ?? "running"}` : "last run"} />
      </div>
      <div className="charts">
        <PriorityTable crawl={crawl} catalog={catalog} onOpenType={onOpenType} />

        <Panel title="Queue by source">
          <ul className="hbars">
            {sources.map((row) => (
              <li key={row.source}>
                <span className="hbar-label" title={row.source}>{row.source}</span>
                <span className="hbar-track">
                  <span className="hbar-fill" style={{ width: `${row.share}%`, background: SERIES[3] }} />
                </span>
                <span className="hbar-value">{compactNumber(row.pending)}</span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Run timeline" wide>
          <ol className="timeline">
            {crawl.runs.map((run) => (
              <li key={run.url} className="timeline-run">
                <span className="timeline-when">{relativeTime(run.at)}</span>
                <span className={`run-badge run-${run.workflow}`}>{run.workflow}</span>
                <span className="run-bar timeline-bar"><span style={{ width: `${(run.stored / mostStored) * 100}%`, background: SERIES[0] }} /></span>
                <span className="timeline-found">{compactNumber(run.stored)}</span>
                <span className="run-outcome" style={{ color: run.conclusion === "success" ? STATUS.good : run.conclusion ? STATUS.serious : SERIES[0] }}>{run.conclusion ?? "running"}</span>
                <a href={run.url} target="_blank" rel="noopener noreferrer">view run</a>
              </li>
            ))}
          </ol>
          <p className="progress-detail">
            Found per run counts the nodes first seen between a run's start and the next run's start. An
            approximation: a long run can find nodes after a later run has started.
          </p>
        </Panel>
      </div>
    </div>
  );
}
