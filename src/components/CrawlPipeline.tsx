import type { Crawl } from "../data/graph";
import { lifecycleStages, throughput } from "../data/crawlAnalytics";
import { SERIES, INK } from "../lib/palette";
import { compactNumber } from "../lib/format";

const HOST_COLOR: Record<string, string> = { github: SERIES[6], gcp: SERIES[0], either: INK.muted };

export function CrawlPipeline({ crawl }: { crawl: Crawl }) {
  const stages = lifecycleStages();
  const flow = throughput(crawl);
  const live = Boolean(crawl.turns && crawl.turns.length > 0);
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
