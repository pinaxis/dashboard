import { useMemo, useState } from "react";
import type { GraphDocument, GraphNode } from "../data/graph";
import { nodeName } from "../data/graph";
import { TYPE_COLOR, BAND_COLOR } from "../lib/palette";

const LIMIT = 300;

function haystack(node: GraphNode): string {
  const parts: (string | number | boolean | null | undefined)[] = [node.type, node.band, node.severity];
  if ("label" in node) {
    parts.push(node.label);
  }
  if (node.type === "SECRET") {
    parts.push(node.target, node.category, node.value, node.valid ? "live" : "dead", node.validated ? "validated" : "format");
  }
  if (node.type === "PACKAGE") {
    parts.push(node.target, node.popularity);
  }
  if (node.type === "FILE") {
    parts.push(node.path);
  }
  return parts.filter((part) => part != null).join(" ").toLowerCase();
}

export function Search({ document, onOpen }: { document: GraphDocument; onOpen: (index: string) => void }) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length < 2) {
      return [];
    }
    const matches: { index: number; node: GraphNode }[] = [];
    for (let index = 0; index < document.nodes.length && matches.length < LIMIT; index += 1) {
      if (haystack(document.nodes[index]).includes(needle)) {
        matches.push({ index, node: document.nodes[index] });
      }
    }
    return matches;
  }, [query, document]);

  const typed = query.trim().length >= 2;

  return (
    <div className="analytics">
      <div className="search">
        <input
          className="search-input"
          type="search"
          placeholder="Search everything stored: secrets, repositories, owners, packages, files, maintainers…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Search the database"
        />
        <p className="search-note">
          {typed
            ? `${results.length}${results.length === LIMIT ? "+" : ""} match${results.length === 1 ? "" : "es"}`
            : "Type at least two characters to search every stored field."}
        </p>
      </div>
      <ul className="results">
        {results.map(({ index, node }) => (
          <li key={index}>
            <button type="button" className="result" onClick={() => onOpen(String(index))}>
              <span className="result-type" style={{ color: TYPE_COLOR[node.type] }}>{node.type.toLowerCase()}</span>
              <span className="result-name">{nodeName(node)}</span>
              <span className="result-band" style={{ background: BAND_COLOR[node.band] }}>{node.band.toLowerCase()}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
