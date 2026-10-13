# Charts Interactivity and Crawl-Run Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the private Charts view interactive and data-rich, completely redesign the Crawl view around the real crawl lifecycle (GitHub to Google Cloud Run handoff), and add backward-compatible engine telemetry so the handoff view carries live per-turn numbers after a future crawl.

**Architecture:** Tested pure-data modules (`.ts`) produce aggregated series and shapes; presentation components (`.tsx`) render them with recharts and plain markup. The crawl pipeline is architecture-true and renders correctly whether or not optional per-turn telemetry is present. Engine additions reuse counters that already exist and leave the dataset schema's node/edge shape unchanged.

**Tech Stack:** React 18, Vite 5, TypeScript, recharts 2.15.4 (already a dependency), node --test (Node type-stripping, no JSX), Java 21/Gradle (engine).

**Spec:** `docs/superpowers/specs/2026-10-13-charts-and-crawl-redesign-design.md`

## Global Constraints

- Do not run a crawl; it overwrites the preserved 54,014-node dataset.
- Do not regenerate `dist-private/api/graph.json` or the catalog.
- Tested logic lives in `.ts` modules; `node --test` strips types but does not transform JSX.
- recharts is fed aggregated series (daily buckets, top-N), never the raw 54k nodes.
- Charts and Crawl are private-view only (`mode === "private"`).
- Commit as finn@birich.de. No en-dashes or em-dashes anywhere. Conventional Commits.
- The engine schema stays 5 (node/edge shape unchanged); the crawl block carries an optional new field only.
- Comments: default to zero; only non-obvious *why*.

## Review Focus

- A node with a missing or malformed `firstSeen` must not crash `exposuresOverTime` (skip it) — pinned in Task 1.
- A FILE node with no extension or no `path` folds to `"other"`, never `undefined` — pinned in Task 1.
- `applyFilter` with every dimension empty returns all nodes, not none — pinned in Task 1.
- A crawl with zero runs renders the pipeline and an empty timeline, with no divide-by-zero — pinned in Task 3.
- `turns` absent (current dataset) renders the pipeline in architecture-only mode, not a broken "undefined" view — pinned in Task 3.

---

### Task 1: Chart series data module

**Files:**
- Create: `src/data/chartSeries.ts`
- Test: `test/chart-series.test.mjs`

**Interfaces:**
- Consumes: `GraphDocument`, `GraphNode`, `SecretNode`, `FileNode` from `./graph.ts`; `Band` from `../lib/palette.ts`; `Bar` from `./analytics.ts`.
- Produces:
  - `interface TimePoint { at: string; found: number; critical: number; cumulative: number }`
  - `interface ChartFilter { bands: Set<string>; types: Set<string>; validity: Set<"live" | "dead" | "format"> }`
  - `exposuresOverTime(document: GraphDocument, bucket: "day" | "week"): TimePoint[]`
  - `byCategory(document: GraphDocument): Bar[]`
  - `byFileType(document: GraphDocument): Bar[]`
  - `validityTotals(document: GraphDocument): { live: number; dead: number; formatOnly: number }`
  - `applyFilter(document: GraphDocument, filter: ChartFilter): GraphDocument`
  - `secretValidity(node: SecretNode): "live" | "dead" | "format"`

- [ ] **Step 1: Write the failing test**

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exposuresOverTime, byCategory, byFileType, validityTotals, applyFilter, secretValidity,
} from "../src/data/chartSeries.ts";

function doc(nodes) {
  return {
    mode: "private", schema: 5, nodes, edges: [],
    stats: { nodes: {}, edges: {}, bands: {}, credentials: [], coOccurrence: [], lastSeen: null },
  };
}
const secret = (over) => ({ type: "SECRET", severity: 10, band: "LOW", firstSeen: "2026-10-01T00:00:00Z", lastSeen: "2026-10-01T00:00:00Z", target: "github-token", category: "vcs", valid: false, validated: false, ...over });
const file = (over) => ({ type: "FILE", severity: 1, band: "LOW", firstSeen: "2026-10-01T00:00:00Z", lastSeen: "2026-10-01T00:00:00Z", label: "f", ...over });

test("exposuresOverTime buckets by day with a running cumulative and skips bad firstSeen", () => {
  const nodes = [
    secret({ firstSeen: "2026-10-01T05:00:00Z", band: "CRITICAL" }),
    secret({ firstSeen: "2026-10-01T22:00:00Z", band: "LOW" }),
    secret({ firstSeen: "2026-10-03T01:00:00Z", band: "CRITICAL" }),
    secret({ firstSeen: "not-a-date" }),
    secret({ firstSeen: "" }),
  ];
  const series = exposuresOverTime(doc(nodes), "day");
  assert.deepEqual(series.map((p) => p.at), ["2026-10-01", "2026-10-03"]);
  assert.equal(series[0].found, 2);
  assert.equal(series[0].critical, 1);
  assert.equal(series[0].cumulative, 2);
  assert.equal(series[1].cumulative, 3);
});

test("byFileType folds a missing or extensionless path to other", () => {
  const bars = byFileType(doc([
    file({ path: "a/b/config.env" }),
    file({ path: "a/b/config.env" }),
    file({ path: "Dockerfile" }),
    file({ path: undefined }),
  ]));
  const map = Object.fromEntries(bars.map((b) => [b.label, b.value]));
  assert.equal(map.env, 2);
  assert.equal(map.other, 2);
});

test("byCategory folds a null category to uncategorized", () => {
  const bars = byCategory(doc([secret({ category: null }), secret({ category: "vcs" }), secret({ category: "vcs" })]));
  const map = Object.fromEntries(bars.map((b) => [b.label, b.value]));
  assert.equal(map.uncategorized, 1);
  assert.equal(map.vcs, 2);
});

test("secretValidity maps valid/validated to live, dead, or format", () => {
  assert.equal(secretValidity(secret({ valid: true, validated: true })), "live");
  assert.equal(secretValidity(secret({ valid: false, validated: true })), "dead");
  assert.equal(secretValidity(secret({ valid: false, validated: false })), "format");
});

test("applyFilter with every dimension empty returns all nodes", () => {
  const nodes = [secret({}), file({})];
  const out = applyFilter(doc(nodes), { bands: new Set(), types: new Set(), validity: new Set() });
  assert.equal(out.nodes.length, 2);
});

test("applyFilter narrows by band, type, and validity; non-secret passes the validity dimension", () => {
  const nodes = [
    secret({ band: "CRITICAL", valid: true, validated: true }),
    secret({ band: "LOW", valid: false, validated: false }),
    file({ band: "CRITICAL" }),
  ];
  const byBand = applyFilter(doc(nodes), { bands: new Set(["CRITICAL"]), types: new Set(), validity: new Set() });
  assert.equal(byBand.nodes.length, 2);
  const byType = applyFilter(doc(nodes), { bands: new Set(), types: new Set(["SECRET"]), validity: new Set() });
  assert.equal(byType.nodes.length, 2);
  const byValidity = applyFilter(doc(nodes), { bands: new Set(), types: new Set(), validity: new Set(["live"]) });
  assert.equal(byValidity.nodes.length, 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/chart-series.test.mjs`
Expected: FAIL, cannot find module `../src/data/chartSeries.ts`.

- [ ] **Step 3: Write the module**

```ts
import type { GraphDocument, GraphNode, SecretNode, FileNode } from "./graph.ts";
import type { Bar } from "./analytics.ts";
import { CATEGORY_COLOR, SERIES, STATUS } from "../lib/palette.ts";

export interface TimePoint {
  at: string;
  found: number;
  critical: number;
  cumulative: number;
}

export interface ChartFilter {
  bands: Set<string>;
  types: Set<string>;
  validity: Set<"live" | "dead" | "format">;
}

export function secretValidity(node: SecretNode): "live" | "dead" | "format" {
  if (!node.validated) {
    return "format";
  }
  return node.valid ? "live" : "dead";
}

function bucketKey(iso: string, bucket: "day" | "week"): string | null {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) {
    return null;
  }
  const date = new Date(time);
  if (bucket === "week") {
    const day = (date.getUTCDay() + 6) % 7;
    date.setUTCDate(date.getUTCDate() - day);
  }
  return date.toISOString().slice(0, 10);
}

export function exposuresOverTime(document: GraphDocument, bucket: "day" | "week"): TimePoint[] {
  const found = new Map<string, number>();
  const critical = new Map<string, number>();
  for (const node of document.nodes) {
    const key = bucketKey(node.firstSeen, bucket);
    if (key === null) {
      continue;
    }
    found.set(key, (found.get(key) ?? 0) + 1);
    if (node.band === "CRITICAL") {
      critical.set(key, (critical.get(key) ?? 0) + 1);
    }
  }
  let running = 0;
  return [...found.keys()].sort().map((at) => {
    running += found.get(at) ?? 0;
    return { at, found: found.get(at) ?? 0, critical: critical.get(at) ?? 0, cumulative: running };
  });
}

function tally(entries: string[], color: (label: string) => string, limit?: number): Bar[] {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    totals.set(entry, (totals.get(entry) ?? 0) + 1);
  }
  const bars = [...totals.entries()]
    .map(([label, value]) => ({ label, value, color: color(label) }))
    .sort((a, b) => b.value - a.value);
  return limit == null ? bars : bars.slice(0, limit);
}

export function byCategory(document: GraphDocument): Bar[] {
  const labels = document.nodes
    .filter((node): node is SecretNode => node.type === "SECRET")
    .map((node) => node.category ?? "uncategorized");
  return tally(labels, () => CATEGORY_COLOR.credential);
}

function extensionOf(path: string | undefined): string {
  if (!path) {
    return "other";
  }
  const base = path.slice(path.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "other";
}

export function byFileType(document: GraphDocument): Bar[] {
  const labels = document.nodes
    .filter((node): node is FileNode => node.type === "FILE")
    .map((node) => extensionOf(node.path));
  return tally(labels, () => SERIES[1], 12);
}

export function validityTotals(document: GraphDocument): { live: number; dead: number; formatOnly: number } {
  return document.stats.credentials.reduce(
    (sum, row) => ({
      live: sum.live + row.validatedLive,
      dead: sum.dead + row.validatedDead,
      formatOnly: sum.formatOnly + row.formatOnly,
    }),
    { live: 0, dead: 0, formatOnly: 0 },
  );
}

function passesValidity(node: GraphNode, validity: Set<"live" | "dead" | "format">): boolean {
  if (validity.size === 0 || node.type !== "SECRET") {
    return true;
  }
  return validity.has(secretValidity(node));
}

export function applyFilter(document: GraphDocument, filter: ChartFilter): GraphDocument {
  const nodes = document.nodes.filter(
    (node) =>
      (filter.bands.size === 0 || filter.bands.has(node.band)) &&
      (filter.types.size === 0 || filter.types.has(node.type)) &&
      passesValidity(node, filter.validity),
  );
  return { ...document, nodes };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/chart-series.test.mjs`
Expected: PASS, 6/6.

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: exit 0.

```bash
git add src/data/chartSeries.ts test/chart-series.test.mjs
git commit -m "feat(charts): add time-series, breakdown, and cross-filter data module"
```

---

### Task 2: Interactive Charts view

**Files:**
- Modify: `src/components/Analytics.tsx` (full rewrite of the body; keep the `Analytics`/`onOpenType` signature)
- Modify: `src/index.css` (chart panel, filter bar, donut legend styles)

**Interfaces:**
- Consumes: `exposuresOverTime`, `byCategory`, `byFileType`, `validityTotals`, `applyFilter`, `ChartFilter`, `TimePoint` from `../data/chartSeries`; `topPackages`, `coOccurrenceBars`, `packagesByEcosystem`, `hasNamedPackages`, `Bar` from `../data/analytics`; `leaksPerRepository` from `../data/exposure`; `Chips`, `ChipItem` from `./Chips`; `BAND_ORDER`, `BAND_COLOR`, `TYPE_ORDER`, `TYPE_COLOR`, `STATUS`, `SERIES`, `INK`, `GRID` from `../lib/palette`; `compactNumber` from `../lib/format`; recharts (`ComposedChart`, `Bar as RBar`, `Line`, `XAxis`, `YAxis`, `Tooltip`, `ResponsiveContainer`, `PieChart`, `Pie`, `Cell`).
- Produces: `Analytics({ document, onOpenType }: { document: GraphDocument; onOpenType?: (name: string) => void })` (unchanged signature).

- [ ] **Step 1: Confirm there is no unit test for this component**

recharts renders in `.tsx`, which `node --test` cannot parse, so this task is covered by Task 1's data tests plus the typecheck and a browser check. No `.test.mjs` is added here.

- [ ] **Step 2: Rewrite `Analytics.tsx`**

Hold filter state and recompute the filtered document; render the cross-filter bar, the recharts panels, and the kept bar panels. Keep the `HBars`, `Credentials`, `Tile`, `Panel` helpers that already exist in the file; add the filter bar and recharts panels.

```tsx
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

// (keep existing HBars, Credentials, topExposedRepositories, Tile, Panel helpers verbatim)

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

export function Analytics({ document, onOpenType }: { document: GraphDocument; onOpenType?: (name: string) => void }) {
  const [filter, setFilter] = useState<ChartFilter>(emptyFilter);
  const [bucket, setBucket] = useState<"day" | "week">("week");
  const view = useMemo(() => applyFilter(document, filter), [document, filter]);

  const series = useMemo(() => exposuresOverTime(view, bucket), [view, bucket]);
  const validity = useMemo(() => validityTotals(view), [view]);
  const categories = useMemo(() => byCategory(view), [view]);
  const fileTypes = useMemo(() => byFileType(view), [view]);
  const bands: Bar[] = BAND_ORDER.map((band) => ({ label: band.toLowerCase(), value: view.nodes.filter((n) => n.band === band).length, color: BAND_COLOR[band] }));

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
        <Tile value={compactNumber(fileTypes.reduce((s, b) => s + b.value, 0))} label="files" />
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
                <Tooltip contentStyle={{ background: "#111", border: `1px solid ${GRID}` }} />
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
                <Tooltip contentStyle={{ background: "#111", border: `1px solid ${GRID}` }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Severity distribution">
          <HBars items={bands} />
        </Panel>
        <Panel title="Credentials by type" wide>
          <Credentials document={view} onOpenType={onOpenType} />
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
```

Note: `topExposedRepositories`, `HBars`, `Credentials`, `Tile`, `Panel` are the existing helpers in the current file; keep them. `Credentials` already consumes `document.stats.credentials`, so pass `view` only where node-derived; where a panel needs the full credential aggregates unfiltered, pass `document`. Decide per panel at implementation and keep the stacked `Credentials` fed by `document` if the filtered slice would zero the aggregates (the aggregates are not recomputed by `applyFilter`).

- [ ] **Step 3: Add CSS**

Append to `src/index.css`:

```css
.toolbar-charts { margin-bottom: 14px; }
.panel-switch { display: flex; gap: 6px; margin-bottom: 8px; }
.recharts-surface { overflow: visible; }
.panel .empty { color: var(--ink-muted, #8a897f); }
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npx vite build`
Expected: exit 0, bundle emitted (recharts increases bundle size; acceptable).

- [ ] **Step 5: Commit**

```bash
git add src/components/Analytics.tsx src/index.css
git commit -m "feat(charts): interactive cross-filter, time series, and validity donut"
```

---

### Task 3: Crawl types and lifecycle data

**Files:**
- Modify: `src/data/graph.ts` (add `TurnRecord`, `turns?` on `Crawl`)
- Modify: `src/data/crawlAnalytics.ts` (add `lifecycleStages`, `runSpan`)
- Test: `test/crawl-analytics.test.mjs` (extend)

**Interfaces:**
- Produces:
  - `interface TurnRecord { host: "github" | "gcp" | "local"; depth: number; at: string; conclusion: string | null; perTarget: Record<string, { searched: number; stored: number }> }`
  - `Crawl` gains `turns?: TurnRecord[]`
  - `interface Stage { key: string; label: string; host: "github" | "gcp" | "either"; note: string }`
  - `lifecycleStages(): Stage[]`
  - `runSpan(crawl: Crawl): { first: string | null; last: string | null; turns: number }`

- [ ] **Step 1: Write the failing test (append to `test/crawl-analytics.test.mjs`)**

```js
import { lifecycleStages, runSpan } from "../src/data/crawlAnalytics.ts";

test("lifecycleStages lists the real phases in order with a GitHub-to-GCP hop", () => {
  const stages = lifecycleStages();
  assert.equal(stages[0].key, "start");
  assert.equal(stages[stages.length - 1].key, "hop");
  assert.ok(stages.some((s) => s.key === "search" && s.host === "either"));
  assert.ok(stages.some((s) => s.host === "gcp"));
  assert.deepEqual(stages.map((s) => s.key), [
    "start", "lock", "download", "seed", "search", "validate", "store", "enrich", "flush", "offload", "hop",
  ]);
});

test("runSpan reports first, last, and turn count, and tolerates zero runs", () => {
  assert.deepEqual(runSpan({ dataset: "d", since: "s", targets: [], sources: [], runs: [] }), { first: null, last: null, turns: 0 });
  const span = runSpan({
    dataset: "d", since: "s", targets: [], sources: [],
    runs: [
      { at: "2026-10-13T05:00:00Z", workflow: "scan", conclusion: "success", url: "u1", stored: 1 },
      { at: "2026-10-13T03:00:00Z", workflow: "resume", conclusion: "success", url: "u2", stored: 1 },
    ],
  });
  assert.equal(span.turns, 2);
  assert.equal(span.first, "2026-10-13T03:00:00Z");
  assert.equal(span.last, "2026-10-13T05:00:00Z");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/crawl-analytics.test.mjs`
Expected: FAIL, `lifecycleStages` / `runSpan` not exported.

- [ ] **Step 3: Add the types to `src/data/graph.ts`**

Insert before `export interface Crawl`:

```ts
export interface TurnRecord {
  host: "github" | "gcp" | "local";
  depth: number;
  at: string;
  conclusion: string | null;
  perTarget: Record<string, { searched: number; stored: number }>;
}
```

Add `turns?: TurnRecord[];` as the last field of `interface Crawl`.

- [ ] **Step 4: Add the functions to `src/data/crawlAnalytics.ts`**

```ts
export interface Stage {
  key: string;
  label: string;
  host: "github" | "gcp" | "either";
  note: string;
}

const STAGES: Stage[] = [
  { key: "start", label: "Start", host: "either", note: "Classify the turn: fresh, continue, or stopped." },
  { key: "lock", label: "Lock", host: "either", note: "Acquire the crawl lock and start the heartbeat." },
  { key: "download", label: "Download", host: "either", note: "Pull the dataset release asset." },
  { key: "seed", label: "Seed", host: "either", note: "Seed the weighted frontier per target and source." },
  { key: "search", label: "Search", host: "either", note: "Sweep GitHub code search with 64 workers." },
  { key: "validate", label: "Validate", host: "either", note: "Live-check found secrets against each endpoint." },
  { key: "store", label: "Store", host: "either", note: "Upsert nodes and edges into the graph." },
  { key: "enrich", label: "Enrich", host: "either", note: "Walk contributors and the follow graph." },
  { key: "flush", label: "Flush", host: "either", note: "Snapshot the frontier and re-upload the dataset." },
  { key: "offload", label: "Offload", host: "either", note: "Decide whether to hand the next turn off." },
  { key: "hop", label: "Hop", host: "gcp", note: "Dispatch the next turn to GitHub Actions or Google Cloud Run." },
];

export function lifecycleStages(): Stage[] {
  return STAGES;
}

export function runSpan(crawl: Crawl): { first: string | null; last: string | null; turns: number } {
  const times = crawl.runs.map((run) => Date.parse(run.at)).filter((value) => !Number.isNaN(value));
  if (times.length === 0) {
    return { first: null, last: null, turns: crawl.runs.length };
  }
  return {
    first: new Date(Math.min(...times)).toISOString(),
    last: new Date(Math.max(...times)).toISOString(),
    turns: crawl.runs.length,
  };
}
```

Add `import type { Crawl } from "./graph";` is already present at the top of the file; keep it.

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test test/crawl-analytics.test.mjs`
Expected: PASS (the 3 existing plus 2 new).

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: exit 0.

```bash
git add src/data/graph.ts src/data/crawlAnalytics.ts test/crawl-analytics.test.mjs
git commit -m "feat(crawl): add lifecycle stages, run span, and optional per-turn record type"
```

---

### Task 4: Crawl pipeline component and view redesign

**Files:**
- Create: `src/components/CrawlPipeline.tsx`
- Modify: `src/components/CrawlProgress.tsx` (use the pipeline; redesign the run table into a timeline; keep controls and priority table behavior)
- Modify: `src/index.css` (pipeline, timeline, card styles)

**Interfaces:**
- Consumes: `lifecycleStages`, `throughput`, `runSpan`, `Stage` from `../data/crawlAnalytics`; `Crawl`, `TurnRecord` from `../data/graph`; `STATUS`, `SERIES`, `INK` from `../lib/palette`; `compactNumber`, `relativeTime` from `../lib/format`.
- Produces: `CrawlPipeline({ crawl }: { crawl: Crawl })`.

- [ ] **Step 1: No unit test (presentation `.tsx`)**

Covered by Task 3's data tests, the typecheck, and a browser check.

- [ ] **Step 2: Write `CrawlPipeline.tsx`**

```tsx
import type { Crawl } from "../data/graph";
import { lifecycleStages, throughput } from "../data/crawlAnalytics";
import { SERIES, STATUS, INK } from "../lib/palette";
import { compactNumber } from "../lib/format";

const HOST_COLOR: Record<string, string> = { github: SERIES[6], gcp: SERIES[0], either: INK.muted };

export function CrawlPipeline({ crawl }: { crawl: Crawl }) {
  const stages = lifecycleStages();
  const flow = throughput(crawl);
  const live = crawl.turns && crawl.turns.length > 0;
  return (
    <section className="panel panel-wide pipeline">
      <h2>How a crawl runs</h2>
      <ol className="pipeline-flow">
        {stages.map((stage) => (
          <li key={stage.key} className={`pipeline-stage pipeline-${stage.host}`} title={stage.note}>
            <span className="pipeline-dot" style={{ background: HOST_COLOR[stage.host] }} />
            <span className="pipeline-label">{stage.label}</span>
          </li>
        ))}
      </ol>
      <div className="pipeline-hosts">
        <span><span className="swatch" style={{ background: HOST_COLOR.github }} /> GitHub Actions</span>
        <span><span className="swatch" style={{ background: HOST_COLOR.gcp }} /> Google Cloud Run</span>
      </div>
      <div className="pipeline-counts">
        <span>{compactNumber(flow.found)} stored</span>
        <span>{compactNumber(flow.pending)} queued</span>
        <span>{compactNumber(flow.avgPerRun)} per run</span>
      </div>
      {!live && (
        <p className="progress-detail">
          Per-turn host and stage figures appear here once a crawl emits them; today this shows the
          crawl architecture and the dataset-wide counts.
        </p>
      )}
    </section>
  );
}
```

- [ ] **Step 3: Redesign the run table in `CrawlProgress.tsx`**

Import `CrawlPipeline` and `runSpan`; render `<CrawlPipeline crawl={crawl} />` directly under the status line (before `Controls`). Replace the "Crawl runs" `<table>` with a timeline list:

```tsx
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
</Panel>
```

Keep `mostStored`, `flow`, `sources`, the tiles, `Controls`, `PriorityTable`, and `Queue by source` as they are.

- [ ] **Step 4: Add CSS**

Append to `src/index.css`:

```css
.pipeline-flow { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; padding: 0; margin: 10px 0; }
.pipeline-stage { display: flex; align-items: center; gap: 6px; padding: 6px 10px; border: 1px solid var(--grid, #33322f); border-radius: 6px; font-size: 12px; position: relative; }
.pipeline-stage:not(:last-child)::after { content: "\2192"; margin-left: 4px; color: var(--ink-muted, #8a897f); }
.pipeline-dot { width: 8px; height: 8px; border-radius: 50%; }
.pipeline-hosts, .pipeline-counts { display: flex; gap: 16px; font-size: 12px; color: var(--ink-secondary, #c3c2b7); margin-top: 8px; }
.pipeline-hosts .swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 4px; }
.timeline { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
.timeline-run { display: grid; grid-template-columns: 90px 70px 1fr 50px 70px 70px; align-items: center; gap: 10px; }
.run-badge { font-size: 11px; text-transform: uppercase; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--grid, #33322f); }
.run-scan { color: #3987e5; } .run-resume { color: #199e70; }
.timeline-bar { height: 8px; } .timeline-bar > span { display: block; height: 100%; border-radius: 4px; }
```

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit && npx vite build`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/components/CrawlPipeline.tsx src/components/CrawlProgress.tsx src/index.css
git commit -m "feat(crawl): lifecycle pipeline with host handoff and run timeline"
```

---

### Task 5: build-graph optional turn assembly

**Files:**
- Modify: `scripts/lib/crawl.mjs` (accept optional `turns` and attach when present)
- Modify: `scripts/build-graph.mjs` (pass `turns` through from run metadata + step outputs when available)

**Interfaces:**
- Consumes: the engine's per-run step outputs (`host`, `depth`, per-target JSON) when present on a run; falls back to omitting `turns`.
- Produces: `crawl.turns?: TurnRecord[]` on the private document when the data is available; absent otherwise.

- [ ] **Step 1: Make `buildCrawl` pass `turns` through**

In `scripts/lib/crawl.mjs`, change the `buildCrawl` return to include `turns` only when the caller supplies a non-empty array:

```js
export function buildCrawl(db, { dataset, since, runs, turns }) {
  // ... existing body unchanged ...
  const base = { dataset, since, targets, sources, runs: withStored(db, runs) };
  return turns && turns.length > 0 ? { ...base, turns } : base;
}
```

- [ ] **Step 2: Assemble `turns` in `build-graph.mjs` (best effort)**

In `scripts/build-graph.mjs`, extend `crawlRuns` is not required; instead add a `crawlTurns(since)` that reads the same `gh run list` entries and, when a run exposes `host`/`depth` outputs, maps them. Because the current workflow does not yet emit these, `crawlTurns` returns `[]` today, which keeps `turns` absent:

```js
function crawlTurns() {
  return [];
}
```

Pass it into `buildCrawl`:

```js
graph.crawl = buildCrawl(db, { dataset: tag, since, runs: crawlRuns(since), turns: crawlTurns() });
```

The real mapping lands with Task 6; until a crawl emits the outputs, `turns` stays absent and the dashboard renders architecture-only, which Task 3's test pins.

- [ ] **Step 3: Verify the build script still parses**

Run: `node -e "import('./scripts/lib/crawl.mjs').then(() => console.log('ok'))"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add scripts/lib/crawl.mjs scripts/build-graph.mjs
git commit -m "feat(crawl): thread optional per-turn records through the graph build"
```

---

### Task 6: Engine per-turn telemetry

**Files (in `../pinaxis`):**
- Modify: `core/src/main/java/io/github/intisy/pinaxis/core/crawl/Scanner.java` (extend the `RunOutcome` record and populate per-target counts)
- Modify: `adapter/src/main/java/io/github/intisy/pinaxis/adapter/github/GitHubClient.java` (serialize new outputs in `publishOutputs`)
- Modify: `app/src/main/java/io/github/intisy/pinaxis/app/ScanCommand.java` (pass host and depth to `publishOutputs`)
- Test: the engine's existing test module for `Scanner`/outputs (match the repo's test layout)

**Interfaces:**
- Produces: GitHub Actions step outputs `host`, `depth`, and `per_target` (compact JSON of `{ target: { searched, stored } }`), consumed later by `build-graph`'s `crawlTurns`.

- [ ] **Step 1: Read the three files**

Read `Scanner.java` around the `RunOutcome` record (reported near line 20) and the counters in `run`/`worker`/`handle`; read `GitHubClient.publishOutputs` (reported near line 63); read the `publishOutputs` call site in `ScanCommand.java`.

- [ ] **Step 2: Write the failing engine test**

Add a unit test (matching the repo's JUnit layout) asserting that a `RunOutcome` built from a scan with two targets carries a `perTarget` map whose entries hold the per-target `searched` and `stored` counts, and that `GitHubClient.publishOutputs` writes a `per_target` line to the `$GITHUB_OUTPUT` file it is given. Use the engine's existing test for `publishOutputs` (it already tests `offload`/`pending`) as the pattern; add `host` and `depth` assertions there.

- [ ] **Step 3: Run it to confirm it fails**

Run (in `../pinaxis`): `./gradlew test --tests "*Scanner*" --tests "*GitHubClient*"`
Expected: FAIL (new fields absent).

- [ ] **Step 4: Extend `RunOutcome` and populate per-target counts**

Add `Map<String, int[]> perTarget` (or a small record `TargetCount(int searched, int stored)`) to `RunOutcome`, populated from the per-target `AtomicInteger`s already tracked in `Scanner`. Keep existing fields.

- [ ] **Step 5: Serialize the new outputs**

In `publishOutputs`, write `host`, `depth`, and `per_target` (compact JSON) alongside the existing `offload` and `pending`. In `ScanCommand`, pass the detected host (github/gcp/local) and `PINAXIS_CHAIN_DEPTH` to the call.

- [ ] **Step 6: Run the engine tests**

Run (in `../pinaxis`): `./gradlew test`
Expected: PASS, suite green.

- [ ] **Step 7: Commit (in `../pinaxis`)**

```bash
git add -A
git commit -m "feat(scan): emit per-turn host, depth, and per-target counts"
```

The engine change is backward compatible: readers that ignore the new outputs are unaffected, and the dataset schema is unchanged. The data populates only on the next crawl, which this work does not run.

---
