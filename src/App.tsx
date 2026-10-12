import { useCallback, useEffect, useMemo, useState } from "react";
import { GraphView } from "./components/GraphView";
import { InsightRail } from "./components/InsightRail";
import { Chips, type ChipItem } from "./components/Chips";
import { Analytics } from "./components/Analytics";
import { CrawlProgress } from "./components/CrawlProgress";
import { Search } from "./components/Search";
import { PublicDashboard } from "./components/PublicDashboard";
import { loadGraph, isPublicDocument, type GraphDocument, type PublicDocument } from "./data/graph";
import { BAND_ORDER, BAND_COLOR, TYPE_ORDER, TYPE_COLOR, STATUS, INK } from "./lib/palette";
import { relativeTime } from "./lib/format";
import { probeSession, LOGIN_URL, LOGOUT_URL } from "./data/session";

type View = "graph" | "charts" | "crawl" | "search";
type Mode = "public" | "private";

const PUBLIC_URL = `${import.meta.env.BASE_URL}graph.json`;

const VERIFY = [
  { id: "live", label: "confirmed live", color: STATUS.critical, key: "validatedLive" as const },
  { id: "dead", label: "validated dead", color: INK.muted, key: "validatedDead" as const },
  { id: "format", label: "format only", color: "#3987e5", key: "formatOnly" as const },
];

function toggleIn(setter: (update: (previous: Set<string>) => Set<string>) => void) {
  return (id: string) =>
    setter((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
}

export default function App() {
  const [publicData, setPublicData] = useState<PublicDocument | null>(null);
  const [privateData, setPrivateData] = useState<GraphDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bands, setBands] = useState<Set<string>>(() => new Set(BAND_ORDER));
  const [types, setTypes] = useState<Set<string>>(() => new Set(TYPE_ORDER));
  const [verify, setVerify] = useState<Set<string>>(() => new Set(["live", "dead", "format"]));
  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<View>("graph");
  const [mode, setMode] = useState<Mode>("public");

  useEffect(() => {
    loadGraph(PUBLIC_URL)
      .then((document) => {
        if (!isPublicDocument(document)) {
          throw new Error("the public graph is not an aggregates-only document");
        }
        setPublicData(document);
      })
      .catch((cause: Error) => setError(cause.message));
    probeSession().then((document) => {
      if (document) {
        setPrivateData(document);
        setMode("private");
      }
    });
  }, []);

  const logOut = useCallback(() => {
    setSelected(null);
    setPrivateData(null);
    setMode("public");
    setView("graph");
    if (!import.meta.env.DEV) {
      window.location.assign(LOGOUT_URL);
    }
  }, []);

  const showPublic = useCallback(() => {
    setMode("public");
    setSelected(null);
  }, []);

  const showPrivate = useCallback(() => {
    setSelected(null);
    setMode("private");
  }, []);

  const clear = useCallback(() => setSelected(null), []);
  const openNode = useCallback((index: string) => {
    setSelected(index);
    setView("graph");
  }, []);

  useEffect(() => {
    if (mode === "public" && (view === "crawl" || view === "search")) {
      setView("graph");
    }
  }, [mode, view]);

  const data = privateData;

  const filters = useMemo(() => {
    if (!data) {
      return { severity: [], nodeTypes: [], status: [] };
    }
    const totals = data.stats.credentials.reduce(
      (sum, row) => ({
        validatedLive: sum.validatedLive + row.validatedLive,
        validatedDead: sum.validatedDead + row.validatedDead,
        formatOnly: sum.formatOnly + row.formatOnly,
      }),
      { validatedLive: 0, validatedDead: 0, formatOnly: 0 },
    );
    const severity: ChipItem[] = BAND_ORDER.map((band) => ({
      id: band, label: band.toLowerCase(), color: BAND_COLOR[band], count: data.stats.bands[band] ?? 0,
    }));
    const nodeTypes: ChipItem[] = TYPE_ORDER.filter((type) => (data.stats.nodes[type] ?? 0) > 0).map((type) => ({
      id: type, label: type.toLowerCase(), color: TYPE_COLOR[type], count: data.stats.nodes[type] ?? 0,
    }));
    const status: ChipItem[] = VERIFY.map((role) => ({
      id: role.id, label: role.label, color: role.color, count: totals[role.key],
    }));
    return { severity, nodeTypes, status };
  }, [data]);

  if (error) {
    return <div className="state">Could not load the exposure graph. {error}</div>;
  }
  if (mode === "public" ? !publicData : !data) {
    return <div className="state">Charting the exposure graph…</div>;
  }

  const header = (
    <header className="masthead">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <div className="brand-words">
          <h1>Pinaxis</h1>
          <p>Exposure across public code, drawn as one graph</p>
        </div>
      </div>
      <nav className="tabs" aria-label="View">
        {mode === "private" && (
          <>
            <button type="button" className={`tab ${view === "graph" ? "tab-on" : ""}`} aria-pressed={view === "graph"} onClick={() => setView("graph")}>Graph</button>
            <button type="button" className={`tab ${view === "charts" ? "tab-on" : ""}`} aria-pressed={view === "charts"} onClick={() => setView("charts")}>Charts</button>
            <button type="button" className={`tab ${view === "search" ? "tab-on" : ""}`} aria-pressed={view === "search"} onClick={() => setView("search")}>Search</button>
            <button type="button" className={`tab ${view === "crawl" ? "tab-on" : ""}`} aria-pressed={view === "crawl"} onClick={() => setView("crawl")}>Crawl</button>
          </>
        )}
      </nav>
      <div className="controls">
        {privateData ? (
          <>
            <div className="toggle" role="group" aria-label="Disclosure">
              <button type="button" className={`tab ${mode === "public" ? "tab-on" : ""}`} aria-pressed={mode === "public"} onClick={showPublic}>Public</button>
              <button type="button" className={`tab ${mode === "private" ? "tab-on" : ""}`} aria-pressed={mode === "private"} onClick={showPrivate}>Private</button>
            </div>
            <button type="button" className="tab" onClick={logOut}>Log out</button>
          </>
        ) : (
          <a className="tab" href={LOGIN_URL}>Sign in</a>
        )}
      </div>
    </header>
  );

  if (mode === "public") {
    return (
      <div className="app">
        {header}
        <main className="stage stage-scroll">
          {publicData && <PublicDashboard document={publicData} />}
        </main>
        <footer className="footer">
          <span>public view</span>
          <span>{publicData?.dataset ?? "current dataset"}</span>
          <span>as of {publicData?.stats.asOf ?? "unknown"}</span>
        </footer>
      </div>
    );
  }

  if (!data) {
    return <div className="state">Charting the exposure graph…</div>;
  }

  return (
    <div className="app">
      {header}
      {view === "graph" && (
        <div className="toolbar">
          <Chips label="Severity" items={filters.severity} active={bands} onToggle={toggleIn(setBands)} />
          <Chips label="Types" items={filters.nodeTypes} active={types} onToggle={toggleIn(setTypes)} />
          <Chips label="Status" items={filters.status} active={verify} onToggle={toggleIn(setVerify)} />
        </div>
      )}
      {view === "graph" && (
        <main className="stage">
          <GraphView document={data} activeBands={bands} activeTypes={types} activeVerify={verify} selected={selected} onSelect={setSelected} />
          <InsightRail document={data} selected={selected} onClear={clear} onSelect={setSelected} />
        </main>
      )}
      {view === "charts" && (
        <main className="stage stage-scroll">
          <Analytics document={data} />
        </main>
      )}
      {view === "search" && (
        <main className="stage stage-scroll">
          <Search document={data} onOpen={openNode} />
        </main>
      )}
      {view === "crawl" && (
        <main className="stage stage-scroll">
          <CrawlProgress document={data} />
        </main>
      )}
      <footer className="footer">
        <span>{data.nodes.length} nodes, {data.edges.length} relationships</span>
        <span>{mode === "private" ? "private view" : "public view"}</span>
        <span>{data.dataset ?? "current dataset"}</span>
        <span>updated {relativeTime(data.stats.lastSeen)}</span>
      </footer>
    </div>
  );
}
