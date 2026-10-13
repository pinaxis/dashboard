import type { KeyTypeView } from "../data/keyType.ts";
import { Empty } from "./Empty.tsx";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="detail-row">
      <span className="detail-key">{label}</span>
      <span className="detail-val">{value}</span>
    </div>
  );
}

export function KeyTypeDetail({ view, onClose }: { view: KeyTypeView; onClose: () => void }) {
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
        </div>
      )}
    </aside>
  );
}
