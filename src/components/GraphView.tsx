import { useEffect, useMemo, useRef, useState } from "react";
import Sigma from "sigma";
import { createNodeBorderProgram } from "@sigma/node-border";
import Graph from "graphology";
import type { GraphDocument } from "../data/graph";
import { buildModel } from "../graph/model";
import type { ColorMode } from "../graph/scene";
import { DIM, INK } from "../lib/palette";

const NodeBorder = createNodeBorderProgram({
  borders: [
    { size: { value: 0.2 }, color: { attribute: "borderColor" } },
    { size: { fill: true }, color: { attribute: "color" } },
  ],
});

const EDGE_COLOR = "#2b2a27";
const LIT_EDGE = "#6f6e66";
// The exposure graph loads once and never changes as you pan or zoom, so navigation is pure camera
// movement. The maintainer social layer (74% of nodes, 84% of edges) is drawn only around a selected
// node, which is what kept the whole graph from being loaded at once.
const SOCIAL_EDGE = new Set(["FOLLOWS", "CO_MAINTAINS", "MAINTAINS"]);

const RELATION: Record<string, string> = {
  LEAKED_IN: "leaked in",
  USED_IN: "used in",
  OWNED_BY: "owned by",
  MAINTAINS: "maintains",
  CO_MAINTAINS: "co-maintains",
  HOSTED_ON: "hosted on",
  CONTAINS: "contains",
  FOLLOWS: "follows",
};

interface Tip {
  title: string;
  meta?: string;
  x: number;
  y: number;
}

interface Props {
  document: GraphDocument;
  activeBands: Set<string>;
  activeTypes: Set<string>;
  activeVerify: Set<string>;
  selected: string | null;
  onSelect: (index: string | null) => void;
}

export function GraphView({ document, activeBands, activeTypes, activeVerify, selected, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const refocusRef = useRef<(skipIndexation: boolean) => void>(() => {});
  const revealRef = useRef<() => void>(() => {});
  const model = useMemo(() => buildModel(document), [document]);

  const bandsRef = useRef(activeBands);
  const typesRef = useRef(activeTypes);
  const verifyRef = useRef(activeVerify);
  const selectedRef = useRef<string | null>(selected);
  const hoveredRef = useRef<string | null>(null);
  const neighborsRef = useRef<Set<string>>(new Set());
  const [colorMode, setColorMode] = useState<ColorMode>("severity");
  const colorModeRef = useRef<ColorMode>(colorMode);
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const container = containerRef.current;
    const graph = new Graph();
    const onDemandNodes = new Set<number>();

    const addNode = (index: number): void => {
      if (graph.hasNode(String(index))) {
        return;
      }
      const style = model.style[index];
      graph.addNode(String(index), {
        x: model.x[index],
        y: model.y[index],
        size: style.size,
        label: style.label,
        nodeType: style.nodeType,
        band: style.band,
        verify: style.verify,
        severity: style.severity,
        color: style.sevColor,
        borderColor: style.typeBorder,
        sevColor: style.sevColor,
        sevBorder: style.sevBorder,
        typeColor: style.typeColor,
        typeBorder: style.typeBorder,
        forceLabel: style.forceLabel,
        zIndex: style.zIndex,
      });
    };
    const addEdgesFor = (index: number, includeSocial: boolean): void => {
      for (const { j, edgeType } of model.neighbors[index]) {
        if (!graph.hasNode(String(j)) || (!includeSocial && SOCIAL_EDGE.has(edgeType))) {
          continue;
        }
        const a = String(Math.min(index, j));
        const b = String(Math.max(index, j));
        if (!graph.hasEdge(a, b)) {
          graph.addEdgeWithKey(`${a}-${b}`, a, b, { edgeType, size: 0.9, color: EDGE_COLOR });
        }
      }
    };

    // The static base: every exposure node and the exposure-edge mesh between them. Maintainers are
    // left out until a node is selected.
    for (let index = 0; index < model.count; index += 1) {
      if (!model.onDemand[index]) {
        addNode(index);
      }
    }
    graph.forEachNode((node) => addEdgesFor(Number(node), false));

    const reveal = (): void => {
      for (const index of onDemandNodes) {
        if (graph.hasNode(String(index))) {
          graph.dropNode(String(index));
        }
      }
      onDemandNodes.clear();
      if (selectedRef.current !== null) {
        const index = Number(selectedRef.current);
        for (const { j } of model.neighbors[index]) {
          if (model.onDemand[j] && !graph.hasNode(String(j))) {
            addNode(j);
            onDemandNodes.add(j);
          }
        }
        addEdgesFor(index, true);
      }
      refocusRef.current(false);
    };
    revealRef.current = reveal;

    const nodeVisible = (node: string): boolean => {
      const attributes = graph.getNodeAttributes(node);
      if (!bandsRef.current.has(attributes.band as string)) {
        return false;
      }
      if (!typesRef.current.has(attributes.nodeType as string)) {
        return false;
      }
      if (attributes.nodeType === "SECRET" && !verifyRef.current.has(attributes.verify as string)) {
        return false;
      }
      return true;
    };
    const midpoint = (edge: string) => {
      const [source, target] = graph.extremities(edge);
      const a = sigma.graphToViewport({ x: graph.getNodeAttribute(source, "x"), y: graph.getNodeAttribute(source, "y") });
      const b = sigma.graphToViewport({ x: graph.getNodeAttribute(target, "x"), y: graph.getNodeAttribute(target, "y") });
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    };

    const sigma = new Sigma(graph, container, {
      defaultNodeType: "bordered",
      nodeProgramClasses: { bordered: NodeBorder },
      renderEdgeLabels: false,
      enableEdgeEvents: true,
      hideEdgesOnMove: true,
      hideLabelsOnMove: true,
      labelColor: { color: INK.secondary },
      labelFont: "'IBM Plex Sans', system-ui, sans-serif",
      labelWeight: "500",
      labelSize: 12,
      labelRenderedSizeThreshold: 8,
      zIndex: true,
      minCameraRatio: 0.02,
      maxCameraRatio: 24,
      nodeReducer: (node, data) => {
        if (!nodeVisible(node)) {
          return { ...data, hidden: true };
        }
        const mode = colorModeRef.current;
        const toned = {
          ...data,
          color: mode === "severity" ? data.sevColor : data.typeColor,
          borderColor: mode === "severity" ? data.typeBorder : data.sevBorder,
        };
        const focus = hoveredRef.current ?? selectedRef.current;
        if (!focus) {
          return toned;
        }
        if (node === focus || neighborsRef.current.has(node)) {
          return { ...toned, forceLabel: true };
        }
        return { ...toned, color: DIM, borderColor: DIM, label: "" };
      },
      edgeReducer: (edge, data) => {
        const [source, target] = graph.extremities(edge);
        if (!nodeVisible(source) || !nodeVisible(target)) {
          return { ...data, hidden: true };
        }
        const focus = hoveredRef.current ?? selectedRef.current;
        if (focus && source !== focus && target !== focus) {
          return { ...data, hidden: true };
        }
        if (focus) {
          return { ...data, color: LIT_EDGE, size: 1.8 };
        }
        return data;
      },
    });

    refocusRef.current = (skipIndexation) => {
      const focus = hoveredRef.current ?? selectedRef.current;
      neighborsRef.current = focus && graph.hasNode(focus) ? new Set(graph.neighbors(focus)) : new Set();
      sigma.refresh(skipIndexation ? { skipIndexation: true } : undefined);
    };

    sigma.on("enterNode", ({ node }) => {
      const attributes = graph.getNodeAttributes(node);
      const viewport = sigma.graphToViewport({ x: attributes.x, y: attributes.y });
      setTip({
        title: attributes.label as string,
        meta: `${(attributes.nodeType as string).toLowerCase()} · ${(attributes.band as string).toLowerCase()}`,
        x: viewport.x,
        y: viewport.y,
      });
      hoveredRef.current = node;
      refocusRef.current(true);
    });
    sigma.on("leaveNode", () => {
      setTip(null);
      hoveredRef.current = null;
      refocusRef.current(true);
    });
    sigma.on("enterEdge", ({ edge }) => {
      const point = midpoint(edge);
      setTip({ title: RELATION[graph.getEdgeAttribute(edge, "edgeType") as string] ?? "relationship", x: point.x, y: point.y });
    });
    sigma.on("leaveEdge", () => setTip(null));
    sigma.on("clickNode", ({ node }) => onSelect(node));
    sigma.on("clickStage", () => onSelect(null));

    sigmaRef.current = sigma;

    const camera = sigma.getCamera();
    camera.setState({ ratio: 1.2 });
    camera.animatedReset({ duration: 600 });

    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [model, onSelect]);

  useEffect(() => {
    bandsRef.current = activeBands;
    typesRef.current = activeTypes;
    verifyRef.current = activeVerify;
    const selectionChanged = selectedRef.current !== selected;
    selectedRef.current = selected;
    if (selectionChanged) {
      revealRef.current();
    } else {
      refocusRef.current(false);
    }
  }, [activeBands, activeTypes, activeVerify, selected]);

  useEffect(() => {
    colorModeRef.current = colorMode;
    refocusRef.current(true);
  }, [colorMode]);

  const camera = () => sigmaRef.current?.getCamera();

  return (
    <div className="graph">
      <div className="graph-canvas" ref={containerRef} />
      <div className="graph-controls">
        <button type="button" aria-label="Zoom in" onClick={() => camera()?.animatedZoom({ duration: 250 })}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => camera()?.animatedUnzoom({ duration: 250 })}>−</button>
        <button type="button" aria-label="Fit graph" onClick={() => camera()?.animatedReset({ duration: 350 })}>Fit</button>
      </div>
      <div className="graph-colormode" role="group" aria-label="Colour by">
        <button type="button" className={`tab ${colorMode === "severity" ? "tab-on" : ""}`} aria-pressed={colorMode === "severity"} onClick={() => setColorMode("severity")}>Severity</button>
        <button type="button" className={`tab ${colorMode === "type" ? "tab-on" : ""}`} aria-pressed={colorMode === "type"} onClick={() => setColorMode("type")}>Type</button>
      </div>
      {tip && (
        <div className="graph-tip" style={{ left: tip.x, top: tip.y }}>
          <span className="graph-tip-name">{tip.title}</span>
          {tip.meta && <span className="graph-tip-meta">{tip.meta}</span>}
        </div>
      )}
    </div>
  );
}
