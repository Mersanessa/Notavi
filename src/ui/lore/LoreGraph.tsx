import { useEffect, useMemo, useRef, useState } from 'react';
import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type Simulation, type SimulationLinkDatum, type SimulationNodeDatum } from 'd3-force';
import type { LoreEntry } from '../../lore/view';
import type { LoreKind } from '../../lore/extract';
import { KIND_COLOUR } from './kinds';

interface Node extends SimulationNodeDatum {
  key: string;
  name: string;
  kind: LoreKind;
  r: number;
  tier: LoreEntry['tier'];
  deg: number;
}
interface Link extends SimulationLinkDatum<Node> {
  w: number;
}

/** Remember layouts per novel while the app is open, so returning to the graph doesn't re-shuffle it. */
const layoutCache = new Map<string, Map<string, { x: number; y: number }>>();

function mixWhite(hex: string, t: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const m = (c: number) => Math.round(c + (235 - c) * t);
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`;
}

/**
 * Obsidian-style graph of a novel's lore: everyone and everything you've met, sized by importance,
 * coloured by kind, joined when they share a paragraph. Pan, pinch or scroll to zoom, drag nodes,
 * hover (or tap) to see who connects to whom.
 */
export function LoreGraph({
  cacheKey,
  entries,
  selected,
  onSelect,
  focus,
  compact = false,
}: {
  cacheKey: string;
  entries: LoreEntry[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  /** Ask the camera to fly to this key. */
  focus?: { key: string; n: number } | null;
  compact?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<string | null>(null);
  const hoverRef = useRef<string | null>(null);
  hoverRef.current = hover;
  const selRef = useRef<string | null>(selected);
  selRef.current = selected;

  const { nodes, links, neighbours } = useMemo(() => {
    const maxScore = Math.max(1, ...entries.map((e) => e.score));
    const keys = new Set(entries.map((e) => e.key));
    const saved = layoutCache.get(cacheKey);
    const nodes: Node[] = entries.map((e) => {
      const p = saved?.get(e.key);
      return { key: e.key, name: e.name, kind: e.kind, tier: e.tier, deg: 0, r: 2.2 + 11 * Math.sqrt(e.score / maxScore), ...(p ? { x: p.x, y: p.y } : {}) };
    });
    const seen = new Set<string>();
    const links: Link[] = [];
    for (const e of entries) {
      e.related
        .filter((r) => keys.has(r.key))
        .slice(0, 6)
        .forEach((r, i) => {
          if (i >= 3 && r.weight < 3) return;
          const id = e.key < r.key ? `${e.key}|${r.key}` : `${r.key}|${e.key}`;
          if (seen.has(id)) return;
          seen.add(id);
          links.push({ source: e.key, target: r.key, w: r.weight });
        });
    }
    const neighbours = new Map<string, Set<string>>();
    for (const l of links) {
      const a = l.source as string;
      const b = l.target as string;
      if (!neighbours.has(a)) neighbours.set(a, new Set());
      if (!neighbours.has(b)) neighbours.set(b, new Set());
      neighbours.get(a)!.add(b);
      neighbours.get(b)!.add(a);
    }
    for (const n of nodes) n.deg = neighbours.get(n.key)?.size ?? 0;
    return { nodes, links, neighbours };
  }, [entries, cacheKey]);

  // Camera and simulation live in refs: the canvas redraws itself, React only re-renders for hover labels.
  const cam = useRef({ x: 0, y: 0, k: 1 });
  const camAnim = useRef<{ from: typeof cam.current; to: typeof cam.current; t0: number; dur: number } | null>(null);
  const sim = useRef<Simulation<Node, Link> | null>(null);
  const draw = useRef<() => void>(() => {});
  const fitted = useRef(false);

  useEffect(() => {
    const c = canvas.current!;
    const ctx = c.getContext('2d')!;
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    let raf = 0;
    let dirty = true;
    let W = 0;
    let H = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      const r = wrap.current!.getBoundingClientRect();
      W = r.width;
      H = r.height;
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
      c.style.width = `${W}px`;
      c.style.height = `${H}px`;
      dirty = true;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap.current!);

    const s = forceSimulation<Node, Link>(nodes)
      .force(
        'link',
        forceLink<Node, Link>(links)
          .id((d) => d.key)
          .distance((l) => 26 + 46 / Math.sqrt(l.w))
          .strength((l) => Math.min(0.9, 0.08 + l.w * 0.04)),
      )
      .force('charge', forceManyBody<Node>().strength((d) => -26 - d.r * 9).distanceMax(520))
      .force('x', forceX<Node>(0).strength(0.035))
      .force('y', forceY<Node>(0).strength(0.035))
      .force('collide', forceCollide<Node>((d) => d.r + 2.5))
      .alphaDecay(0.028)
      .velocityDecay(0.32)
      .stop();
    sim.current = s;
    // Settle most of the way before the first frame, then let it breathe into place.
    const warm = layoutCache.has(cacheKey) ? 20 : Math.min(260, 60 + nodes.length / 3);
    for (let i = 0; i < warm; i++) s.tick();
    s.alpha(layoutCache.has(cacheKey) ? 0.05 : 0.35);

    const fit = (animate: boolean) => {
      if (!nodes.length || !W) return;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y0 = Infinity;
      let y1 = -Infinity;
      for (const n of nodes) {
        x0 = Math.min(x0, n.x!);
        x1 = Math.max(x1, n.x!);
        y0 = Math.min(y0, n.y!);
        y1 = Math.max(y1, n.y!);
      }
      const k = Math.min(2.2, 0.9 * Math.min(W / Math.max(60, x1 - x0), H / Math.max(60, y1 - y0)));
      const to = { x: W / 2 - ((x0 + x1) / 2) * k, y: H / 2 - ((y0 + y1) / 2) * k, k };
      if (animate) camAnim.current = { from: { ...cam.current }, to, t0: performance.now(), dur: 700 };
      else cam.current = to;
      dirty = true;
    };
    if (!fitted.current) {
      fit(false);
      fitted.current = true;
    }

    draw.current = () => {
      dirty = true;
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (s.alpha() > s.alphaMin()) {
        s.tick();
        dirty = true;
      }
      const a = camAnim.current;
      if (a) {
        const t = Math.min(1, (now - a.t0) / a.dur);
        const e = 1 - Math.pow(1 - t, 3);
        cam.current = { x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e, k: a.from.k + (a.to.k - a.from.k) * e };
        if (t >= 1) camAnim.current = null;
        dirty = true;
      }
      if (!dirty) return;
      dirty = false;
      const { x: tx, y: ty, k } = cam.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const focusKey = hoverRef.current ?? selRef.current;
      const near = focusKey ? neighbours.get(focusKey) ?? new Set<string>() : null;
      const lit = (key: string) => !near || key === focusKey || near.has(key);

      // Links
      ctx.lineWidth = 0.8;
      for (const l of links) {
        const sN = l.source as Node;
        const tN = l.target as Node;
        const on = near && (sN.key === focusKey || tN.key === focusKey);
        ctx.strokeStyle = on ? 'rgba(168, 130, 255, 0.85)' : near ? 'rgba(120,120,130,0.08)' : 'rgba(130,130,140,0.32)';
        ctx.lineWidth = on ? 1.4 : 0.8;
        ctx.beginPath();
        ctx.moveTo(sN.x! * k + tx, sN.y! * k + ty);
        ctx.lineTo(tN.x! * k + tx, tN.y! * k + ty);
        ctx.stroke();
      }
      // Nodes
      for (const n of nodes) {
        const x = n.x! * k + tx;
        const y = n.y! * k + ty;
        const r = Math.max(1.6, n.r * Math.sqrt(k));
        if (x < -40 || y < -40 || x > W + 40 || y > H + 40) continue;
        const faint = n.tier === 'passing' || n.tier === 'minor';
        const colour = faint ? mixWhite(KIND_COLOUR[n.kind], 0.72) : KIND_COLOUR[n.kind];
        ctx.globalAlpha = lit(n.key) ? 1 : 0.16;
        if (!faint && lit(n.key)) {
          ctx.shadowColor = KIND_COLOUR[n.kind];
          ctx.shadowBlur = n.key === focusKey ? 22 : 10;
        }
        ctx.fillStyle = colour;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        if (n.key === selRef.current) {
          ctx.strokeStyle = '#fff';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // Labels: big nodes always, the rest as you zoom in, and the neighbourhood of what you're looking at.
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const n of nodes) {
        const r = n.r * Math.sqrt(k);
        const show = (near ? lit(n.key) : true) && (n.key === focusKey || (near && near.has(n.key)) || r * k > 9 || r > 9);
        if (!show) continue;
        const x = n.x! * k + tx;
        const y = n.y! * k + ty;
        if (x < -80 || y < -40 || x > W + 80 || y > H + 40) continue;
        const fade = near ? 1 : Math.min(1, (r * k - 6) / 6 + (r > 9 ? 1 : 0));
        ctx.globalAlpha = Math.max(0.35, fade);
        ctx.font = `${n.key === focusKey ? 600 : 500} ${n.key === focusKey ? 13 : 11.5}px 'Hanken Grotesk Variable', system-ui, sans-serif`;
        ctx.fillStyle = n.key === focusKey ? '#ffffff' : '#c9c9d1';
        ctx.fillText(n.name, x, y + Math.max(1.6, r) + 4);
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(frame);

    /* -------------------------------------------------------- interaction */
    const toWorld = (sx: number, sy: number) => ({ x: (sx - cam.current.x) / cam.current.k, y: (sy - cam.current.y) / cam.current.k });
    const hit = (sx: number, sy: number) => {
      const p = toWorld(sx, sy);
      let best: Node | null = null;
      let bd = Infinity;
      for (const n of nodes) {
        const d = Math.hypot(n.x! - p.x, n.y! - p.y);
        const rr = Math.max(n.r, 9 / cam.current.k) + 2;
        if (d < rr && d < bd) {
          best = n;
          bd = d;
        }
      }
      return best;
    };
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { node: Node | null; sx: number; sy: number; moved: boolean; cam: typeof cam.current } | null = null;
    let pinch: { d: number; k: number; cx: number; cy: number; cam: typeof cam.current } | null = null;
    const local = (e: PointerEvent | WheelEvent) => {
      const r = c.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onDown = (e: PointerEvent) => {
      c.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      camAnim.current = null;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), k: cam.current.k, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, cam: { ...cam.current } };
        drag = null;
        return;
      }
      const n = hit(p.x, p.y);
      drag = { node: n, sx: p.x, sy: p.y, moved: false, cam: { ...cam.current } };
      if (n) {
        n.fx = n.x;
        n.fy = n.y;
      }
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      if (pointers.has(e.pointerId)) pointers.set(e.pointerId, p);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        const k = Math.max(0.15, Math.min(6, pinch.k * (d / pinch.d)));
        const cx = (a.x + b.x) / 2;
        const cy = (a.y + b.y) / 2;
        const wx = (pinch.cx - pinch.cam.x) / pinch.cam.k;
        const wy = (pinch.cy - pinch.cam.y) / pinch.cam.k;
        cam.current = { k, x: cx - wx * k, y: cy - wy * k };
        dirty = true;
        return;
      }
      if (drag) {
        const dx = p.x - drag.sx;
        const dy = p.y - drag.sy;
        if (Math.hypot(dx, dy) > 4) drag.moved = true;
        if (drag.node && drag.moved) {
          const w = toWorld(p.x, p.y);
          drag.node.fx = w.x;
          drag.node.fy = w.y;
          s.alphaTarget(0.25);
          if (s.alpha() < 0.25) s.alpha(0.25);
        } else if (!drag.node) {
          cam.current = { ...drag.cam, x: drag.cam.x + dx, y: drag.cam.y + dy };
          dirty = true;
        }
        return;
      }
      if (e.pointerType === 'mouse') {
        const n = hit(p.x, p.y);
        const key = n?.key ?? null;
        if (key !== hoverRef.current) {
          setHover(key);
          hoverRef.current = key;
          c.style.cursor = key ? 'pointer' : 'grab';
          dirty = true;
        }
      }
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pinch) {
        if (pointers.size < 2) pinch = null;
        return;
      }
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.node) {
        d.node.fx = null;
        d.node.fy = null;
        s.alphaTarget(0);
      }
      if (!d.moved) onSelect(d.node ? d.node.key : null);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      camAnim.current = null;
      const p = local(e);
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018));
      const k = Math.max(0.15, Math.min(6, cam.current.k * factor));
      const wx = (p.x - cam.current.x) / cam.current.k;
      const wy = (p.y - cam.current.y) / cam.current.k;
      cam.current = { k, x: p.x - wx * k, y: p.y - wy * k };
      dirty = true;
    };
    const onLeave = () => {
      if (hoverRef.current) {
        setHover(null);
        hoverRef.current = null;
        dirty = true;
      }
    };
    c.addEventListener('pointerdown', onDown);
    c.addEventListener('pointermove', onMove);
    c.addEventListener('pointerup', onUp);
    c.addEventListener('pointercancel', onUp);
    c.addEventListener('pointerleave', onLeave);
    c.addEventListener('wheel', onWheel, { passive: false });

    (c as unknown as { __fly: (key: string) => void }).__fly = (key: string) => {
      const n = byKey.get(key);
      if (!n || !W) return;
      const k = Math.max(cam.current.k, 1.4);
      // On a phone the note opens as a sheet over the lower part, so keep the node in the top part.
      const cy = W < 760 ? H * 0.2 : H / 2;
      camAnim.current = { from: { ...cam.current }, to: { k, x: W / 2 - n.x! * k, y: cy - n.y! * k }, t0: performance.now(), dur: 650 };
    };
    (c as unknown as { __fit: () => void }).__fit = () => fit(true);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      s.stop();
      layoutCache.set(cacheKey, new Map(nodes.map((n) => [n.key, { x: n.x!, y: n.y! }])));
      c.removeEventListener('pointerdown', onDown);
      c.removeEventListener('pointermove', onMove);
      c.removeEventListener('pointerup', onUp);
      c.removeEventListener('pointercancel', onUp);
      c.removeEventListener('pointerleave', onLeave);
      c.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, links, neighbours]);

  useEffect(() => draw.current(), [selected, hover]);
  useEffect(() => {
    if (focus) (canvas.current as unknown as { __fly?: (k: string) => void })?.__fly?.(focus.key);
  }, [focus]);

  return (
    <div ref={wrap} className={`lore-graph ${compact ? 'lore-graph--compact' : ''}`}>
      <canvas ref={canvas} className="lore-graph__canvas" aria-label="Graph of characters, places and things you have met so far" role="img" data-testid="lore-graph" />
      {!compact && (
        <button type="button" className="lore-graph__fit" onClick={() => (canvas.current as unknown as { __fit?: () => void })?.__fit?.()}>
          Fit
        </button>
      )}
    </div>
  );
}
