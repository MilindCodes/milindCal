"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MilindDocFile } from "@/lib/models";

interface DocsGraphViewProps {
  docs: MilindDocFile[];
  activeDocId: string | null;
  onDocSelect: (id: string) => void;
  onUpdateGraphPos: (id: string, pos: { x: number; y: number }) => void;
  onUpdateDocColor: (id: string, color: string) => void;
  onAddGraphLink: (fromId: string, toId: string) => void;
}

interface PhysicsNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned: boolean; // true while user is dragging
}

interface ContextMenuState {
  id: string;
  screenX: number; // px from container left
  screenY: number; // px from container top
  showColors: boolean;
}

const NODE_COLORS = [
  { value: "#fef9c3", label: "Yellow" },
  { value: "#fce7f3", label: "Pink" },
  { value: "#d1fae5", label: "Mint" },
  { value: "#dbeafe", label: "Blue" },
  { value: "#ede9fe", label: "Lavender" },
  { value: "#fecaca", label: "Rose" },
  { value: "#fed7aa", label: "Peach" },
  { value: "#e5e7eb", label: "Grey" },
];

// Physics constants
const REPULSION = 6000;
const SPRING_LEN = 180;
const SPRING_K = 0.04;
const DAMPING = 0.78;
const MIN_SPEED = 0.05; // below this we stop simulating

export function DocsGraphView({
  docs,
  activeDocId,
  onDocSelect,
  onUpdateGraphPos,
  onUpdateDocColor,
  onAddGraphLink,
}: DocsGraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // Physics lives in a ref — never causes React re-renders mid-frame
  const nodesRef = useRef<PhysicsNode[]>([]);
  const rafRef = useRef<number>(0);
  const isSimulatingRef = useRef(false);

  // Pan state
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ mx: 0, my: 0, px: 0, py: 0 });

  // Drag state
  const draggingRef = useRef<{ id: string; ox: number; oy: number } | null>(null);
  const didDragRef = useRef(false);

  // Context menu & linking
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [linkingFrom, setLinkingFrom] = useState<string | null>(null);
  const linkingFromRef = useRef<string | null>(null);

  // Force re-render to reflect physics positions (throttled)
  const [renderTick, setRenderTick] = useState(0);

  /* ── Init / sync physics nodes when docs change ── */
  useEffect(() => {
    const el = containerRef.current;
    const W = el?.clientWidth ?? 700;
    const H = el?.clientHeight ?? 500;
    const cx = W / 2;
    const cy = H / 2;

    const existing = new Map(nodesRef.current.map((n) => [n.id, n]));

    nodesRef.current = docs.map((doc, i) => {
      if (existing.has(doc.id)) return existing.get(doc.id)!;
      // Use saved graph position or distribute in a circle
      if (doc.graphPos) {
        return { id: doc.id, x: doc.graphPos.x, y: doc.graphPos.y, vx: 0, vy: 0, pinned: false };
      }
      const angle = (i / Math.max(docs.length, 1)) * Math.PI * 2;
      const r = Math.min(W, H) * 0.28;
      return {
        id: doc.id,
        x: cx + Math.cos(angle) * r + (Math.random() - 0.5) * 40,
        y: cy + Math.sin(angle) * r + (Math.random() - 0.5) * 40,
        vx: 0,
        vy: 0,
        pinned: false,
      };
    });

    kickSimulation();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs.length]);

  /* ── Build edge set ── */
  const getEdges = useCallback(() => {
    const edges: { from: string; to: string }[] = [];
    docs.forEach((doc) => {
      const targets = new Set([...doc.links, ...(doc.graphLinks ?? [])]);
      targets.forEach((to) => {
        if (docs.some((d) => d.id === to)) edges.push({ from: doc.id, to });
      });
    });
    return edges;
  }, [docs]);

  /* ── Physics simulation ── */
  const tickPhysics = useCallback(() => {
    const nodes = nodesRef.current;
    if (nodes.length === 0) return false;

    const edges = getEdges();
    const W = containerRef.current?.clientWidth ?? 700;
    const H = containerRef.current?.clientHeight ?? 500;
    let maxSpeed = 0;

    // Repulsion between all pairs (Barnes-Hut approximation skipped for simplicity — fine for <100 nodes)
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i];
        const b = nodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist2 = dx * dx + dy * dy;
        const dist = Math.sqrt(dist2) + 0.1;
        const force = REPULSION / dist2;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
        if (!b.pinned) { b.vx += fx; b.vy += fy; }
      }
    }

    // Spring attraction along edges
    edges.forEach(({ from, to }) => {
      const a = nodes.find((n) => n.id === from);
      const b = nodes.find((n) => n.id === to);
      if (!a || !b) return;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
      const stretch = dist - SPRING_LEN;
      const force = SPRING_K * stretch;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.pinned) { a.vx += fx; a.vy += fy; }
      if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
    });

    // Center gravity (mild pull toward center)
    const cx = W / 2;
    const cy = H / 2;
    nodes.forEach((n) => {
      if (n.pinned) return;
      n.vx += (cx - n.x) * 0.002;
      n.vy += (cy - n.y) * 0.002;
    });

    // Integrate & damp
    nodes.forEach((n) => {
      if (n.pinned) return;
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
      // Boundary soft-wall
      const margin = 60;
      if (n.x < margin) n.vx += (margin - n.x) * 0.15;
      if (n.y < margin) n.vy += (margin - n.y) * 0.15;
      if (n.x > W - margin) n.vx += (W - margin - n.x) * 0.15;
      if (n.y > H - margin) n.vy += (H - margin - n.y) * 0.15;
      maxSpeed = Math.max(maxSpeed, Math.abs(n.vx), Math.abs(n.vy));
    });

    // Update DOM directly for SVG edges
    updateSvgEdges();

    return maxSpeed > MIN_SPEED;
  }, [getEdges]);

  const updateSvgEdges = useCallback(() => {
    if (!svgRef.current) return;
    const nodeMap = new Map(nodesRef.current.map((n) => [n.id, n]));
    svgRef.current.querySelectorAll<SVGLineElement>(".physics-edge").forEach((line) => {
      const fromId = line.dataset.from!;
      const toId = line.dataset.to!;
      const a = nodeMap.get(fromId);
      const b = nodeMap.get(toId);
      if (a && b) {
        line.setAttribute("x1", String(a.x));
        line.setAttribute("y1", String(a.y));
        line.setAttribute("x2", String(b.x));
        line.setAttribute("y2", String(b.y));
      }
    });
  }, []);

  const kickSimulation = useCallback(() => {
    if (isSimulatingRef.current) return;
    isSimulatingRef.current = true;

    let frameCount = 0;
    const loop = () => {
      const stillMoving = tickPhysics();
      frameCount++;

      /* React re-render every 3 frames so node DIVs follow physics.
       *
       * Worth knowing when debugging: the nodes are rendered from
       * `nodesRef.current`, a ref React does not track, so this tick is the
       * only thing that puts them on screen. In a hidden tab
       * (document.visibilityState === "hidden") rAF never fires, this loop
       * never runs, and the graph paints its edges with no nodes at all —
       * which looks exactly like a rendering bug and isn't one. Check
       * document.hidden before chasing it. */
      if (frameCount % 3 === 0) {
        setRenderTick((t) => t + 1);
      }

      if (stillMoving) {
        rafRef.current = requestAnimationFrame(loop);
      } else {
        isSimulatingRef.current = false;
        // Final render sync
        setRenderTick((t) => t + 1);
        // Persist final positions
        nodesRef.current.forEach((n) => {
          onUpdateGraphPos(n.id, { x: n.x, y: n.y });
        });
      }
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [tickPhysics, onUpdateGraphPos]);

  useEffect(() => {
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  /* ── Pointer events ── */
  const onNodePointerDown = useCallback((e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    // In linking mode, don't start a drag
    if (linkingFromRef.current) return;

    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return;

    didDragRef.current = false;
    draggingRef.current = { id, ox: e.clientX - node.x, oy: e.clientY - node.y };
    node.pinned = true;
    setContextMenu(null);
  }, []);

  const onNodePointerMove = useCallback((e: React.PointerEvent, id: string) => {
    if (!draggingRef.current || draggingRef.current.id !== id) return;
    const node = nodesRef.current.find((n) => n.id === id);
    if (!node) return;
    const newX = e.clientX - draggingRef.current.ox;
    const newY = e.clientY - draggingRef.current.oy;
    if (Math.abs(newX - node.x) > 2 || Math.abs(newY - node.y) > 2) {
      didDragRef.current = true;
    }
    node.x = newX;
    node.y = newY;
    node.vx = 0;
    node.vy = 0;
    updateSvgEdges();
    setRenderTick((t) => t + 1);
  }, [updateSvgEdges]);

  const onNodePointerUp = useCallback((e: React.PointerEvent, id: string) => {
    if (!draggingRef.current || draggingRef.current.id !== id) return;
    const node = nodesRef.current.find((n) => n.id === id);
    if (node) {
      node.pinned = false;
      onUpdateGraphPos(id, { x: node.x, y: node.y });
    }
    draggingRef.current = null;
    // Resume simulation after drag
    kickSimulation();
  }, [kickSimulation, onUpdateGraphPos]);

  const onNodeClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (didDragRef.current) return;

    // Linking mode: complete the connection
    if (linkingFromRef.current) {
      if (linkingFromRef.current !== id) {
        onAddGraphLink(linkingFromRef.current, id);
        kickSimulation(); // new edge changes spring forces
      }
      linkingFromRef.current = null;
      setLinkingFrom(null);
      return;
    }

    // Show context menu at click position relative to container
    const rect = containerRef.current!.getBoundingClientRect();
    setContextMenu({
      id,
      screenX: e.clientX - rect.left,
      screenY: e.clientY - rect.top,
      showColors: false,
    });
  }, [onAddGraphLink, kickSimulation]);

  /* ── Canvas pan ── */
  const onCanvasPointerDown = useCallback((e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest(".graph-node, .graph-context-menu")) return;
    setContextMenu(null);
    isPanningRef.current = true;
    panStartRef.current = { mx: e.clientX, my: e.clientY, px: panRef.current.x, py: panRef.current.y };
  }, []);

  const onCanvasPointerMove = useCallback((e: React.PointerEvent) => {
    if (!isPanningRef.current) return;
    const nx = panStartRef.current.px + (e.clientX - panStartRef.current.mx);
    const ny = panStartRef.current.py + (e.clientY - panStartRef.current.my);
    panRef.current = { x: nx, y: ny };
    setPan({ x: nx, y: ny });
  }, []);

  const onCanvasPointerUp = useCallback(() => {
    isPanningRef.current = false;
  }, []);

  const onCanvasClick = useCallback(() => {
    setContextMenu(null);
    if (linkingFromRef.current) {
      linkingFromRef.current = null;
      setLinkingFrom(null);
    }
  }, []);

  /* ── Escape cancels linking ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        linkingFromRef.current = null;
        setLinkingFrom(null);
        setContextMenu(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  /* ── Build SVG edge elements ── */
  const edges = getEdges();
  const nodeMap = new Map(nodesRef.current.map((n) => [n.id, n]));

  return (
    <div
      className={`docs-graph${linkingFrom ? " docs-graph--linking" : ""}`}
      ref={containerRef}
      onClick={onCanvasClick}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      style={{ cursor: isPanningRef.current ? "grabbing" : linkingFrom ? "crosshair" : "default" }}
    >
      {/* SVG layer for edges — positioned in physics space, panned with transform */}
      <svg
        ref={svgRef}
        className="docs-graph__svg"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
      >
        {edges.map((edge, i) => {
          const a = nodeMap.get(edge.from);
          const b = nodeMap.get(edge.to);
          return (
            <line
              key={i}
              className="physics-edge docs-graph__edge"
              data-from={edge.from}
              data-to={edge.to}
              x1={a?.x ?? 0}
              y1={a?.y ?? 0}
              x2={b?.x ?? 0}
              y2={b?.y ?? 0}
            />
          );
        })}
      </svg>

      {/* Node layer — panned with same transform */}
      <div
        className="docs-graph__nodes"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
      >
        {nodesRef.current.map((node) => {
          const doc = docs.find((d) => d.id === node.id);
          if (!doc) return null;
          const isActive = node.id === activeDocId;
          const isLinkTarget = !!linkingFrom && linkingFrom !== node.id;
          const linkCount =
            doc.links.length +
            (doc.graphLinks?.length ?? 0) +
            docs.filter((d) => d.links.includes(node.id) || d.graphLinks?.includes(node.id)).length;
          const size = Math.max(64, Math.min(120, 64 + linkCount * 8));
          const bgColor = doc.nodeColor ?? "rgba(255, 253, 248, 0.92)";

          return (
            <div
              key={node.id}
              className={[
                "graph-node",
                isActive ? "graph-node--active" : "",
                doc.calendarMeta ? "graph-node--cal" : "",
                doc.autoCreatedFromCalendar ? "graph-node--auto-cal" : "",
                isLinkTarget ? "graph-node--link-target" : "",
              ].filter(Boolean).join(" ")}
              style={{
                left: node.x,
                top: node.y,
                width: size,
                height: size,
                background: bgColor,
                willChange: "left, top",
              }}
              onPointerDown={(e) => onNodePointerDown(e, node.id)}
              onPointerMove={(e) => onNodePointerMove(e, node.id)}
              onPointerUp={(e) => onNodePointerUp(e, node.id)}
              onClick={(e) => onNodeClick(e, node.id)}
            >
              <span className="graph-node__title">{doc.title || "Untitled"}</span>
              {doc.calendarMeta && (
                <span className="graph-node__cal-dot" title="Calendar event" />
              )}
            </div>
          );
        })}
      </div>

      {/* Context menu — positioned in screen space (no pan transform) */}
      {contextMenu && (() => {
        const doc = docs.find((d) => d.id === contextMenu.id);
        if (!doc) return null;

        // Clamp so menu doesn't overflow container
        const menuW = 172;
        const menuH = contextMenu.showColors ? 160 : 110;
        const containerW = containerRef.current?.clientWidth ?? 700;
        const containerH = containerRef.current?.clientHeight ?? 500;
        const left = Math.min(contextMenu.screenX, containerW - menuW - 8);
        const top = Math.min(contextMenu.screenY + 8, containerH - menuH - 8);

        return (
          <div
            className="graph-context-menu"
            style={{ left, top }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button
              className="graph-context-btn"
              onClick={() => { onDocSelect(contextMenu.id); setContextMenu(null); }}
              type="button"
            >
              Open milindDoc
            </button>
            <button
              className={`graph-context-btn${contextMenu.showColors ? " active" : ""}`}
              onClick={() => setContextMenu((m) => m ? { ...m, showColors: !m.showColors } : m)}
              type="button"
            >
              Color node
            </button>
            {contextMenu.showColors && (
              <div className="graph-color-row">
                {NODE_COLORS.map((c) => (
                  <button
                    key={c.value}
                    className={`graph-color-swatch${doc.nodeColor === c.value ? " active" : ""}`}
                    style={{ background: c.value }}
                    title={c.label}
                    onClick={() => { onUpdateDocColor(contextMenu.id, c.value); setContextMenu(null); }}
                    type="button"
                  />
                ))}
                {doc.nodeColor && (
                  <button
                    className="graph-color-clear"
                    onClick={() => { onUpdateDocColor(contextMenu.id, ""); setContextMenu(null); }}
                    title="Clear color"
                    type="button"
                  >
                    ✕
                  </button>
                )}
              </div>
            )}
            <button
              className="graph-context-btn graph-context-btn--connect"
              onClick={() => {
                linkingFromRef.current = contextMenu.id;
                setLinkingFrom(contextMenu.id);
                setContextMenu(null);
              }}
              type="button"
            >
              Draw connection
            </button>
          </div>
        );
      })()}

      {/* Linking mode indicator */}
      {linkingFrom && (
        <div className="graph-linking-indicator">
          Click another node to connect — Esc to cancel
        </div>
      )}

      {docs.length === 0 && (
        <div className="docs-graph__empty">
          Create docs to see them appear here as nodes.
          <br />
          Use <strong>@mentions</strong> to link docs together.
        </div>
      )}
    </div>
  );
}
