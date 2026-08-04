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

    function degreeOf(node) {
      return node._degree || 0;
    }

    function refreshDegrees() {
      for (const n of nodes) n._degree = 0;
      for (const l of links) {
        if (l.source) l.source._degree = (l.source._degree || 0) + 1;
        if (l.target) l.target._degree = (l.target._degree || 0) + 1;
      }
    }

    function idealEdgeLength(a, b) {
      const dense = nodes.length > 120;
      const base = dense ? 140 : 110;
      return base + Math.max(degreeOf(a), degreeOf(b)) * (dense ? 7 : 3);
    }

    function seedRadialLayout(cx, cy) {
      refreshDegrees();
      const hubs = nodes
        .filter((n) => degreeOf(n) >= 3)
        .sort((a, b) => degreeOf(b) - degreeOf(a));
      const placed = new Set();
      const ringCount = Math.max(1, hubs.length);
      const densest = hubs.length ? degreeOf(hubs[0]) : 0;
      const leafRadius = Math.max(140, 40 + densest * 11);
      // Keep hub rings from overlapping: adjacent hub distance ~ 2.1 * leaf radius.
      const minAdjacent = leafRadius * 2.1;
      const hubRadius = Math.max(
        240,
        20 * Math.sqrt(nodes.length),
        ringCount <= 1 ? leafRadius : minAdjacent / (2 * Math.sin(Math.PI / ringCount))
      );

      hubs.forEach((hub, index) => {
        const angle = (Math.PI * 2 * index) / ringCount - Math.PI / 2;
        hub.x = cx + Math.cos(angle) * hubRadius;
        hub.y = cy + Math.sin(angle) * hubRadius;
        hub.vx = 0;
        hub.vy = 0;
        hub.pinned = false;
        placed.add(hub);
      });

      for (const hub of hubs) {
        const neighbors = [];
        for (const l of links) {
          if (l.source === hub && !placed.has(l.target)) neighbors.push(l.target);
          else if (l.target === hub && !placed.has(l.source)) neighbors.push(l.source);
        }
        const radius = Math.max(140, 40 + neighbors.length * 11);
        neighbors.forEach((node, index) => {
          const angle = (Math.PI * 2 * index) / Math.max(1, neighbors.length);
          // Slight radial jitter so neighbors are not perfectly co-circular.
          const jitter = 0.85 + ((index % 5) * 0.04);
          node.x = hub.x + Math.cos(angle) * radius * jitter;
          node.y = hub.y + Math.sin(angle) * radius * jitter;
          node.vx = 0;
          node.vy = 0;
          node.pinned = false;
          placed.add(node);
        });
      }

      const leftovers = nodes.filter((n) => !placed.has(n));
      if (!leftovers.length) return;
      const columns = Math.max(1, Math.ceil(Math.sqrt(leftovers.length)));
      const spacing = nodes.length > 120 ? 88 : 96;
      leftovers.forEach((node, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        node.x = cx + (column - (columns - 1) / 2) * spacing;
        node.y = cy + hubRadius + leafRadius + 120 + row * spacing;
        node.vx = 0;
        node.vy = 0;
        node.pinned = false;
      });
    }

    function fit() {
      if (!nodes.length) return;
      const xs = nodes.map((n) => n.x).filter(Number.isFinite);
      const ys = nodes.map((n) => n.y).filter(Number.isFinite);
      if (!xs.length || !ys.length) return;
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const w = maxX - minX || 1;
      const h = maxY - minY || 1;
      const rect = container.getBoundingClientRect();
      const width = rect.width || container.clientWidth || 1;
      const height = rect.height || container.clientHeight || 1;
      const pad = 60;
      const nextScale = Math.min((width - pad * 2) / w, (height - pad * 2) / h, 1.5);
      if (!Number.isFinite(nextScale) || nextScale <= 0) return;
      scale = Math.max(0.05, nextScale);
      tx = width / 2 - (minX + w / 2) * scale;
      ty = height / 2 - (minY + h / 2) * scale;
      applyTransform();
    }

    function step() {
      const rect = { width: container.clientWidth, height: container.clientHeight };
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      const dense = nodes.length > 120;
      const repulsion = dense ? 4200 : 1600;
      const minDistance = dense ? 64 : 42;
      const springK = dense ? 0.012 : 0.022;
      const gravity = dense ? 0.00025 : 0.008;
      const damping = dense ? 0.76 : 0.8;
      const maxSpeed = dense ? 12 : 7;
      const maxTicks = nodes.length > 400 ? 220 : dense ? 280 : 280;

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
          if (d2 < 0.01) {
            d2 = 0.01;
            dx = (Math.random() - 0.5) || 0.01;
            dy = (Math.random() - 0.5) || 0.01;
          }
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          // Soft-core repulsion keeps hubs from collapsing into a blob.
          let f = repulsion / d2;
          if (d < minDistance) f += ((minDistance - d) / minDistance) * 48;
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
        const desired = idealEdgeLength(a, b);
        const diff = (d - desired) * springK;
        const nx = dx / d, ny = dy / d;
        a.fx += nx * diff;
        a.fy += ny * diff;
        b.fx -= nx * diff;
        b.fy -= ny * diff;
      }
      let movement = 0;
      for (const n of nodes) {
        if (n.pinned) {
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.vx = Math.max(-maxSpeed, Math.min(maxSpeed, (n.vx + n.fx) * damping));
        n.vy = Math.max(-maxSpeed, Math.min(maxSpeed, (n.vy + n.fy) * damping));
        n.x += n.vx;
        n.y += n.vy;
        movement += Math.abs(n.vx) + Math.abs(n.vy);
      }
      renderPositions();
      ticks++;
      if (ticks < maxTicks && movement > nodes.length * 0.02 && running) {
        rafId = requestAnimationFrame(step);
      } else {
        running = false;
        rafId = null;
        fit();
      }
    }

    function start(resetTicks = true) {
      if (running || !nodes.length) return;
      if (resetTicks) ticks = 0;
      running = true;
      rafId = requestAnimationFrame(step);
    }

    function stop() {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
    }

    function reheat() {
      if (!nodes.length) return;
      stop();
      const rect = container.getBoundingClientRect();
      seedRadialLayout(rect.width / 2 || 150, rect.height / 2 || 150);
      start(true);
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
      const previousPositions = new Map(
        nodes.map((node) => [
          node.iri,
          { x: node.x, y: node.y, pinned: node.pinned },
        ])
      );
      stop();
      nodes = ns;
      links = ls;
      linksLayer.innerHTML = "";
      labelsLayer.innerHTML = "";
      nodesLayer.innerHTML = "";

      const rect = container.getBoundingClientRect();
      const cx = rect.width / 2 || 150;
      const cy = rect.height / 2 || 150;
      let reused = 0;
      for (const n of nodes) {
        const previous = previousPositions.get(n.iri);
        if (previous && Number.isFinite(previous.x) && Number.isFinite(previous.y)) {
          n.x = previous.x;
          n.y = previous.y;
          n.pinned = previous.pinned;
          reused++;
        } else {
          n.x = NaN;
          n.y = NaN;
          n.pinned = false;
        }
        n.vx = 0;
        n.vy = 0;
      }
      // Fresh/mostly-new graphs get a hub-aware radial seed so dense
      // instance graphs do not start as a tight overlapping blob.
      if (!nodes.length) {
        // nothing to place
      } else if (reused < nodes.length * 0.5) {
        seedRadialLayout(cx, cy);
      } else {
        const missing = nodes.filter((n) => !Number.isFinite(n.x) || !Number.isFinite(n.y));
        if (missing.length) {
          const columns = Math.max(1, Math.ceil(Math.sqrt(missing.length)));
          const spacing = nodes.length > 120 ? 88 : 92;
          missing.forEach((n, index) => {
            const column = index % columns;
            const row = Math.floor(index / columns);
            n.x = cx + (column - (columns - 1) / 2) * spacing;
            n.y = cy + 180 + row * spacing;
          });
        }
      }

      const showLinkLabels = links.length <= 80;
      for (const l of links) {
        const line = document.createElementNS(SVGNS, "line");
        line.setAttribute("class", `link link-${l.kind || "obj"}`);
        line.setAttribute("stroke", l.color || colorForKind(l.kind));
        line.setAttribute("stroke-width", l.kind === "sub" ? 1.6 : 1.3);
        if (l.dashed) line.setAttribute("stroke-dasharray", "4 3");
        line.setAttribute("marker-end", `url(#${markerForKind(l.kind)})`);
        if (l.label) {
          const title = document.createElementNS(SVGNS, "title");
          title.textContent = l.label;
          line.appendChild(title);
        }
        linksLayer.appendChild(line);
        l._path = line;

        if (l.label && showLinkLabels) {
          const txt = document.createElementNS(SVGNS, "text");
          txt.setAttribute("class", "linklabel");
          txt.setAttribute("text-anchor", "middle");
          txt.setAttribute("dy", "-4");
          txt.textContent = l.label;
          labelsLayer.appendChild(txt);
          l._label = txt;
        }
      }

      const showSubtitles = nodes.length <= 120;
      for (const n of nodes) {
        const g = document.createElementNS(SVGNS, "g");
        g.setAttribute("class", `node node-${n.kind || "default"}`);
        const title = document.createElementNS(SVGNS, "title");
        title.textContent = [n.label, n.subtitle].filter(Boolean).join(" — ");
        g.appendChild(title);
        const shape = n.kind === "individual" ? createCircle(n) : createRoundedRect(n);
        g.appendChild(shape);

        const label = document.createElementNS(SVGNS, "text");
        label.setAttribute("class", "nodelabel");
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline", "central");
        label.textContent = truncate(n.label || "?", 18);
        g.appendChild(label);

        if (n.subtitle && showSubtitles) {
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
        // Manual positioning takes control of the layout; do not let the
        // remaining simulation pull every other node around while dragging.
        stop();
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
    });
    ro.observe(container);

    resize();

    return {
      setData,
      fit,
      reheat,
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
