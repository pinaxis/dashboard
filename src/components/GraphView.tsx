import { useEffect, useMemo, useRef, useState } from "react";
import Sigma from "sigma";
import { createNodeBorderProgram } from "@sigma/node-border";
import type Graph from "graphology";
import type { GraphDocument } from "../data/graph";
import { buildScene, thresholdForZoom, type ColorMode } from "../graph/scene";
import { DIM, INK } from "../lib/palette";

const NodeBorder = createNodeBorderProgram({
  borders: [
    { size: { value: 0.2 }, color: { attribute: "borderColor" } },
    { size: { fill: true }, color: { attribute: "color" } },
  ],
});

const LIT_EDGE = "#6f6e66";
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
  const graph = useMemo(() => buildScene(document), [document]);

  const bandsRef = useRef(activeBands);
  const typesRef = useRef(activeTypes);
  const verifyRef = useRef(activeVerify);
  const selectedRef = useRef<string | null>(selected);
  const hoveredRef = useRef<string | null>(null);
  const neighborsRef = useRef<Set<string>>(new Set());
  const [tip, setTip] = useState<Tip | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("severity");
  const colorModeRef = useRef<ColorMode>(colorMode);
  const thresholdRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }
    const nodeVisible = (node: string) => {
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

    const sigma = new Sigma(graph as Graph, containerRef.current, {
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
      minCameraRatio: 0.05,
      maxCameraRatio: 24,
      nodeReducer: (node, data) => {
        if (!nodeVisible(node)) {
          return { ...data, hidden: true };
        }
        const focus = hoveredRef.current ?? selectedRef.current;
        const kept = focus && (node === focus || neighborsRef.current.has(node));
        if (!kept && (data.importance ?? 1) < thresholdRef.current) {
          return { ...data, hidden: true };
        }
        const mode = colorModeRef.current;
        const toned = {
          ...data,
          color: mode === "severity" ? data.sevColor : data.typeColor,
          borderColor: mode === "severity" ? data.typeBorder : data.sevBorder,
        };
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
        if (!focus) {
          const threshold = thresholdRef.current;
          if ((graph.getNodeAttribute(source, "importance") as number) < threshold
            || (graph.getNodeAttribute(target, "importance") as number) < threshold) {
            return { ...data, hidden: true };
          }
        }
        if (focus) {
          return { ...data, color: LIT_EDGE, size: 1.8 };
        }
        return data;
      },
    });

    refocusRef.current = (skipIndexation) => {
      const focus = hoveredRef.current ?? selectedRef.current;
      neighborsRef.current = focus ? new Set(graph.neighbors(focus)) : new Set();
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

    const camera = sigma.getCamera();
    thresholdRef.current = thresholdForZoom(camera.ratio);
    camera.on("updated", () => {
      const next = thresholdForZoom(camera.ratio);
      if (next !== thresholdRef.current) {
        thresholdRef.current = next;
        sigma.refresh({ skipIndexation: true });
      }
    });

    sigmaRef.current = sigma;

    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      camera.setState({ ratio: 2.4 });
      camera.animatedReset({ duration: 900 });
    }

    return () => {
      sigma.kill();
      sigmaRef.current = null;
    };
  }, [graph, onSelect]);

  useEffect(() => {
    bandsRef.current = activeBands;
    typesRef.current = activeTypes;
    verifyRef.current = activeVerify;
    selectedRef.current = selected;
    refocusRef.current(false);
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
