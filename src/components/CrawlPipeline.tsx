import type { Crawl } from "../data/graph";
import { lifecycleStages, throughput } from "../data/crawlAnalytics";
import { compactNumber } from "../lib/format";

export function CrawlPipeline({ crawl }: { crawl: Crawl }) {
  const stages = lifecycleStages();
  const flow = throughput(crawl);
  const live = Boolean(crawl.turns && crawl.turns.length > 0);
  return (
    <section className="panel panel-wide pipeline">
      <div className="pipeline-head">
        <h2>How a crawl runs</h2>
        <p className="pipeline-sub">One turn sweeps these phases in order, then hands the next turn to another host.</p>
      </div>

      <ol className="pipeline-track">
        {stages.map((stage, index) => (
          <li key={stage.key} className={`pipeline-step step-${stage.host}`} title={stage.note}>
            <span className="pipeline-node">{index + 1}</span>
            <span className="pipeline-cap">{stage.label}</span>
          </li>
        ))}
      </ol>

      <div className="pipeline-handoff">
        <span className="host-badge host-github">GitHub Actions</span>
        <span className="handoff-swap" aria-hidden="true">&#8644;</span>
        <span className="host-badge host-gcp">Google Cloud Run</span>
        <span className="handoff-note">a turn hands off between hosts at the offload step</span>
      </div>

      <div className="pipeline-stats">
        <div className="pstat"><span className="pstat-value">{compactNumber(flow.found)}</span><span className="pstat-label">stored</span></div>
        <div className="pstat"><span className="pstat-value">{compactNumber(flow.pending)}</span><span className="pstat-label">queued</span></div>
        <div className="pstat"><span className="pstat-value">{compactNumber(flow.avgPerRun)}</span><span className="pstat-label">per run</span></div>
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
