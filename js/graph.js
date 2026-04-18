/* Lightweight SVG force-directed graph with pan, pinch-zoom, drag.
 * Renders either:
 *   mode = "schema"    - classes (nodes) + subClassOf / domain-range (edges)
 *   mode = "instances" - individuals (nodes) + object-assertions (edges)
 *
 * Uses a Verlet-style force simulation: repulsion (Coulomb), spring (Hooke),
 * centering, and link constraints. Deliberately tiny: ~300 LOC, no deps.
 */
(function (global) {
  "use strict";

  const SVGNS = "http://www.w3.org/2000/svg";

  function create(container, options = {}) {
    container.innerHTML = "";
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("xmlns", SVGNS);
    svg.setAttribute("class", "graph-svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    const defs = document.createElementNS(SVGNS, "defs");
    defs.innerHTML = `
      <marker id="arrow-obj" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b"/>
      </marker>
      <marker id="arrow-sub" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="none" stroke="#38bdf8" stroke-width="1.3"/>
      </marker>
      <marker id="arrow-restr" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="#a78bfa"/>
      </marker>
    `;
    svg.appendChild(defs);

    const viewport = document.createElementNS(SVGNS, "g");
    viewport.setAttribute("class", "viewport");
    svg.appendChild(viewport);

    const linksLayer = document.createElementNS(SVGNS, "g");
    linksLayer.setAttribute("class", "links");
    const labelsLayer = document.createElementNS(SVGNS, "g");
    labelsLayer.setAttribute("class", "linklabels");
    const nodesLayer = document.createElementNS(SVGNS, "g");
    nodesLayer.setAttribute("class", "nodes");
    viewport.appendChild(linksLayer);
    viewport.appendChild(labelsLayer);
    viewport.appendChild(nodesLayer);

    container.appendChild(svg);

    let nodes = [];
    let links = [];
    let tx = 0, ty = 0, scale = 1;
    let rafId = null;
    let running = false;
    let ticks = 0;

    function resize() {
      const rect = container.getBoundingClientRect();
      svg.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
      return rect;
    }

    function applyTransform() {
      viewport.setAttribute("transform", `translate(${tx} ${ty}) scale(${scale})`);
    }

    function step() {
      const rect = { width: container.clientWidth, height: container.clientHeight };
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      const repulsion = 1400;
      const springLen = 110;
      const springK = 0.02;
      const gravity = 0.02;
      const damping = 0.85;

      for (const a of nodes) {
        a.fx = 0;
        a.fy = 0;
      }
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        a.fx += (cx - a.x) * gravity;
        a.fy += (cy - a.y) * gravity;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { d2 = 0.01; dx = (Math.random() - 0.5); dy = (Math.random() - 0.5); }
          const f = repulsion / d2;
          const d = Math.sqrt(d2);
          const nx = dx / d, ny = dy / d;
          a.fx += nx * f;
          a.fy += ny * f;
          b.fx -= nx * f;
          b.fy -= ny * f;
        }
      }
      for (const l of links) {
        const a = l.source, b = l.target;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.1;
        const diff = (d - springLen) * springK;
        const nx = dx / d, ny = dy / d;
        a.fx += nx * diff;
        a.fy += ny * diff;
        b.fx -= nx * diff;
        b.fy -= ny * diff;
      }
      for (const n of nodes) {
        if (n.pinned) continue;
        n.vx = (n.vx + n.fx) * damping;
        n.vy = (n.vy + n.fy) * damping;
        n.x += n.vx;
        n.y += n.vy;
      }
      renderPositions();
      ticks++;
      if (ticks < 600 && running) {
        rafId = requestAnimationFrame(step);
      } else {
        running = false;
      }
    }

    function start() {
      ticks = 0;
      if (!running) {
        running = true;
        rafId = requestAnimationFrame(step);
      }
    }

    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
    }

    function renderPositions() {
      // Links
      for (const l of links) {
        l._path.setAttribute("x1", l.source.x);
        l._path.setAttribute("y1", l.source.y);
        l._path.setAttribute("x2", l.target.x);
        l._path.setAttribute("y2", l.target.y);
        if (l._label) {
          const mx = (l.source.x + l.target.x) / 2;
          const my = (l.source.y + l.target.y) / 2;
          l._label.setAttribute("x", mx);
          l._label.setAttribute("y", my);
        }
      }
      for (const n of nodes) {
        n._g.setAttribute("transform", `translate(${n.x} ${n.y})`);
      }
    }

    function setData(ns, ls) {
      nodes = ns;
      links = ls;
      linksLayer.innerHTML = "";
      labelsLayer.innerHTML = "";
      nodesLayer.innerHTML = "";

      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2 || 150;
      const cy = rect.height / 2 || 150;
      for (const n of nodes) {
        if (n.x == null)
          n.x = cx + (Math.random() - 0.5) * 200;
        if (n.y == null)
          n.y = cy + (Math.random() - 0.5) * 200;
        n.vx = n.vx || 0;
        n.vy = n.vy || 0;
      }

      for (const l of links) {
        const line = document.createElementNS(SVGNS, "line");
        line.setAttribute("class", `link link-${l.kind || "obj"}`);
        line.setAttribute("stroke", l.color || colorForKind(l.kind));
        line.setAttribute("stroke-width", l.kind === "sub" ? 1.6 : 1.3);
        if (l.dashed) line.setAttribute("stroke-dasharray", "4 3");
        line.setAttribute("marker-end", `url(#${markerForKind(l.kind)})`);
        linksLayer.appendChild(line);
        l._path = line;

        if (l.label) {
          const txt = document.createElementNS(SVGNS, "text");
          txt.setAttribute("class", "linklabel");
          txt.setAttribute("text-anchor", "middle");
          txt.setAttribute("dy", "-4");
          txt.textContent = l.label;
          labelsLayer.appendChild(txt);
          l._label = txt;
        }
      }

      for (const n of nodes) {
        const g = document.createElementNS(SVGNS, "g");
        g.setAttribute("class", `node node-${n.kind || "default"}`);
        const shape = n.kind === "individual" ? createCircle(n) : createRoundedRect(n);
        g.appendChild(shape);

        const label = document.createElementNS(SVGNS, "text");
        label.setAttribute("class", "nodelabel");
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline", "central");
        label.textContent = truncate(n.label || "?", 18);
        g.appendChild(label);

        if (n.subtitle) {
          const sub = document.createElementNS(SVGNS, "text");
          sub.setAttribute("class", "nodesubtitle");
          sub.setAttribute("text-anchor", "middle");
          sub.setAttribute("y", n.kind === "individual" ? 26 : 22);
          sub.textContent = truncate(n.subtitle, 24);
          g.appendChild(sub);
        }

        attachDrag(g, n);
        g.addEventListener("click", (e) => {
          if (!g._dragged && options.onSelect) options.onSelect(n);
          g._dragged = false;
        });
        nodesLayer.appendChild(g);
        n._g = g;
      }
      resize();
      applyTransform();
      start();
    }

    function createRoundedRect(n) {
      const width = Math.max(80, 10 + (n.label || "").length * 7);
      const height = 30;
      const r = document.createElementNS(SVGNS, "rect");
      r.setAttribute("x", -width / 2);
      r.setAttribute("y", -height / 2);
      r.setAttribute("width", width);
      r.setAttribute("height", height);
      r.setAttribute("rx", 10);
      r.setAttribute("ry", 10);
      r.setAttribute("fill", n.color || "#1e293b");
      r.setAttribute("stroke", n.borderColor || "#38bdf8");
      r.setAttribute("stroke-width", 1.4);
      return r;
    }
    function createCircle(n) {
      const c = document.createElementNS(SVGNS, "circle");
      c.setAttribute("r", 16);
      c.setAttribute("fill", n.color || "#0f172a");
      c.setAttribute("stroke", n.borderColor || "#38bdf8");
      c.setAttribute("stroke-width", 1.4);
      return c;
    }

    function colorForKind(k) {
      if (k === "sub") return "#38bdf8";
      if (k === "restr") return "#a78bfa";
      if (k === "domain") return "#22c55e";
      if (k === "range") return "#f59e0b";
      return "#64748b";
    }
    function markerForKind(k) {
      if (k === "sub") return "arrow-sub";
      if (k === "restr") return "arrow-restr";
      return "arrow-obj";
    }
    function truncate(s, n) {
      if (!s) return "";
      return s.length > n ? s.slice(0, n - 1) + "…" : s;
    }

    /* --- Interaction (pan, pinch zoom, drag) --- */
    function attachDrag(el, node) {
      let dragging = false;
      let startClientX = 0, startClientY = 0, startNodeX = 0, startNodeY = 0;
      el.addEventListener("pointerdown", (e) => {
        dragging = true;
        el.setPointerCapture(e.pointerId);
        startClientX = e.clientX;
        startClientY = e.clientY;
        startNodeX = node.x;
        startNodeY = node.y;
        node.pinned = true;
        el._dragged = false;
        e.stopPropagation();
      });
      el.addEventListener("pointermove", (e) => {
        if (!dragging) return;
        const dx = (e.clientX - startClientX) / scale;
        const dy = (e.clientY - startClientY) / scale;
        node.x = startNodeX + dx;
        node.y = startNodeY + dy;
        node.vx = 0; node.vy = 0;
        if (Math.abs(dx) + Math.abs(dy) > 2) el._dragged = true;
        renderPositions();
        start();
      });
      el.addEventListener("pointerup", () => {
        dragging = false;
        node.pinned = false;
      });
      el.addEventListener("pointercancel", () => {
        dragging = false;
        node.pinned = false;
      });
    }

    // Pan + pinch-zoom on SVG background
    let panning = false;
    let panStartX = 0, panStartY = 0, panStartTx = 0, panStartTy = 0;
    const pointers = new Map();
    let pinchStartDist = 0, pinchStartScale = 1, pinchStartMid = [0, 0], pinchStartTxTy = [0, 0];

    svg.addEventListener("pointerdown", (e) => {
      if (e.target !== svg && e.target !== viewport && !e.target.classList.contains("graph-bg")) return;
      svg.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1) {
        panning = true;
        panStartX = e.clientX;
        panStartY = e.clientY;
        panStartTx = tx;
        panStartTy = ty;
      } else if (pointers.size === 2) {
        panning = false;
        const pts = [...pointers.values()];
        pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pinchStartScale = scale;
        pinchStartMid = [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2];
        pinchStartTxTy = [tx, ty];
      }
    });
    svg.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1 && panning) {
        tx = panStartTx + (e.clientX - panStartX);
        ty = panStartTy + (e.clientY - panStartY);
        applyTransform();
      } else if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const newScale = Math.max(0.3, Math.min(3, pinchStartScale * (d / pinchStartDist)));
        const mid = [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2];
        const rect = svg.getBoundingClientRect();
        const midLocalX = (pinchStartMid[0] - rect.left - pinchStartTxTy[0]) / pinchStartScale;
        const midLocalY = (pinchStartMid[1] - rect.top - pinchStartTxTy[1]) / pinchStartScale;
        tx = mid[0] - rect.left - midLocalX * newScale;
        ty = mid[1] - rect.top - midLocalY * newScale;
        scale = newScale;
        applyTransform();
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) panning = pointers.size === 1;
    };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);

    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const delta = -e.deltaY;
      const factor = delta > 0 ? 1.1 : 0.9;
      const newScale = Math.max(0.3, Math.min(3, scale * factor));
      const localX = (mx - tx) / scale;
      const localY = (my - ty) / scale;
      tx = mx - localX * newScale;
      ty = my - localY * newScale;
      scale = newScale;
      applyTransform();
    }, { passive: false });

    const ro = new ResizeObserver(() => {
      resize();
      start();
    });
    ro.observe(container);

    resize();

    return {
      setData,
      fit: () => {
        if (!nodes.length) return;
        const xs = nodes.map((n) => n.x);
        const ys = nodes.map((n) => n.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const w = (maxX - minX) || 1;
        const h = (maxY - minY) || 1;
        const rect = container.getBoundingClientRect();
        const pad = 60;
        scale = Math.min((rect.width - pad * 2) / w, (rect.height - pad * 2) / h, 1.5);
        tx = rect.width / 2 - (minX + w / 2) * scale;
        ty = rect.height / 2 - (minY + h / 2) * scale;
        applyTransform();
      },
      reheat: start,
      stop,
      destroy: () => {
        stop();
        ro.disconnect();
        container.innerHTML = "";
      },
    };
  }

  global.Graph = { create };
})(typeof window !== "undefined" ? window : globalThis);
