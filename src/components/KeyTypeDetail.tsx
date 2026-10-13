import { useMemo } from "react";
import type { KeyTypeView } from "../data/keyType.ts";
import { targetFindings } from "../data/keyType.ts";
import type { GraphDocument } from "../data/graph.ts";
import { BAND_ORDER, BAND_COLOR } from "../lib/palette.ts";
import { compactNumber } from "../lib/format.ts";
import { Empty } from "./Empty.tsx";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span className="detail-key">{label}</span>
      <span className="detail-val">{value}</span>
    </div>
  );
}

function Findings({ document, name }: { document: GraphDocument; name: string }) {
  const findings = useMemo(() => targetFindings(document, name), [document, name]);
  const total = BAND_ORDER.reduce((sum, band) => sum + (findings.bands[band] ?? 0), 0);
  if (total === 0 && findings.repos.length === 0) {
    return null;
  }
  const widest = Math.max(1, ...BAND_ORDER.map((band) => findings.bands[band] ?? 0));
  return (
    <>
      <div className="detail-section">
        <span className="detail-key">by severity</span>
        <ul className="detail-bands">
          {BAND_ORDER.map((band) => (
            <li key={band}>
              <span className="detail-band-name">{band.toLowerCase()}</span>
              <span className="detail-band-track">
                <span style={{ width: `${((findings.bands[band] ?? 0) / widest) * 100}%`, background: BAND_COLOR[band] }} />
              </span>
              <span className="detail-band-count">{findings.bands[band] ?? 0}</span>
            </li>
          ))}
        </ul>
      </div>
      {findings.repos.length > 0 && (
        <div className="detail-section">
          <span className="detail-key">affected repositories ({findings.repos.length})</span>
          <ul className="detail-list">
            {findings.repos.slice(0, 12).map((repo) => (
              <li key={repo.label}>
                <a href={`https://github.com/${repo.label}`} target="_blank" rel="noopener noreferrer">{repo.label}</a>
                <span className="detail-count">{compactNumber(repo.count)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {findings.owners.length > 0 && (
        <div className="detail-section">
          <span className="detail-key">owners affected ({findings.owners.length})</span>
          <ul className="detail-chips">
            {findings.owners.slice(0, 20).map((owner) => (
              <li key={owner}><a href={`https://github.com/${owner}`} target="_blank" rel="noopener noreferrer">{owner}</a></li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export function KeyTypeDetail({ view, document, onClose }: { view: KeyTypeView; document: GraphDocument; onClose: () => void }) {
  const info = view.info;
  return (
    <aside className="detail-drawer" aria-label={`${view.name} detail`}>
      <header className="detail-head">
        <h2>{view.name}</h2>
        <button type="button" className="tab" onClick={onClose} aria-label="Close detail">Close</button>
      </header>
      {!view.known || !info ? (
        <Empty>No detail for this type; it is not in the current catalog.</Empty>
      ) : (
        <div className="detail-body">
          <Row label="category" value={info.category} />
          <Row label="kind" value={info.secret ? "leaked secret" : info.kind.toLowerCase()} />
          <Row
            label="verification"
            value={info.verification === "VALIDATED" ? "validated live against an endpoint" : "format only"}
          />
          <Row label="priority" value={String(info.weight)} />
          {info.validationEndpoint && <Row label="validated against" value={info.validationEndpoint} />}
          {info.rateLimitPerMinute != null && (
            <Row label="validation rate" value={`${info.rateLimitPerMinute} per minute`} />
          )}
          <Row
            label="found"
            value={`${view.tally.total} (${view.tally.live} live, ${view.tally.dead} dead, ${view.tally.formatOnly} format only)`}
          />
          {info.prefixRules.length > 0 && (
            <div className="detail-rules">
              <span className="detail-key">searched as</span>
              <ul>
                {info.prefixRules.map((rule) => (
                  <li key={rule.prefix}>
                    <code>{rule.prefix}</code>
                    <span className="detail-regex">{rule.regex}</span>
                    {rule.length != null && <span className="detail-len">{rule.length} chars</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Findings document={document} name={view.name} />
        </div>
      )}
    </aside>
  );
}
