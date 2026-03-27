const API = '';
let schemaData = null;
let simulation = null;
let svg, g, linkGroup, nodeGroup;
let focalId = null;
let history = []; // breadcrumbs
let currentView = 'nodes'; // 'nodes' | 'titles'
let lastEgoData = null; // cache for view switching

// --- Node visual config ---

// Colors by entity TYPE (not graph label)
const TYPE_COLORS = {
    Person:       { fill: '#5DADE2', stroke: '#AED6F1' },
    Location:     { fill: '#2ECC71', stroke: '#82E0AA' },
    Organization: { fill: '#E67E22', stroke: '#F5CBA7' },
    Object:       { fill: '#95A5A6', stroke: '#BDC3C7' },
    Event:        { fill: '#E74C3C', stroke: '#F1948A' }
};

// Fallback by graph label
const LABEL_COLORS = {
    Afirmacion: { fill: '#A569BD', stroke: 'none' },
    Noticia:    { fill: '#5D6D7E', stroke: 'none' }
};

const BASE_RADIUS = { Actor: 8, Evento: 8, Afirmacion: 4, Noticia: 3 };
const MAX_LABEL_LEN = 20;

function typeColor(d) {
    if (d.is_disputed && d.label === 'Afirmacion') return { fill: '#E74C3C', stroke: '#F1948A' };
    return TYPE_COLORS[d.type] || LABEL_COLORS[d.label] || TYPE_COLORS.Object;
}

function nodeRadius(d) {
    const base = BASE_RADIUS[d.label] || 5;
    // Scale by degree (connections)
    const degree = d._connectionCount || 1;
    const scale = Math.min(Math.sqrt(degree) * 0.6, 3);
    if (d.id === focalId) return base * 2 + scale;
    return base + scale;
}

function nodeColor(d) { return typeColor(d).fill; }
function nodeStroke(d) { return typeColor(d).stroke || 'none'; }

function nodeStrokeWidth(d) {
    if (d.id === focalId) return 3;
    if (d.label === 'Actor') return 1.5;
    return 0;
}

function truncLabel(name) {
    if (!name || name.length <= MAX_LABEL_LEN) return name || '';
    return name.slice(0, MAX_LABEL_LEN - 1) + '…';
}

// For search results and breadcrumbs
function nodeDot(label, type) {
    const c = TYPE_COLORS[type] || LABEL_COLORS[label] || TYPE_COLORS.Object;
    return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c.fill};border:1.5px solid ${c.stroke === 'none' ? c.fill : c.stroke};vertical-align:middle;margin-right:6px"></span>`;
}

// Radial grouping angles by type
const TYPE_ANGLE = {
    Person: 0,
    Location: Math.PI * 0.5,
    Organization: Math.PI,
    Object: Math.PI * 1.5,
    Event: Math.PI * 0.25
};

function edgeVisual(type) {
    if (!schemaData?.graph?.edges?.[type]?.visual) {
        return { color: '#7F8C8D', style: 'solid', width: 1, force_distance: 100 };
    }
    return schemaData.graph.edges[type].visual;
}

// --- Init ---

async function init() {
    // Init i18n
    setLang(detectLang());
    applyStaticI18n();

    const schemaRes = await fetch(`${API}/api/schema`);
    schemaData = await schemaRes.json();
    loadStats();
    setupSearch();
    setupSplitHandle();
    setupDetailClose();
    // Landing: random focal
    await navigateTo(null);
}

function applyStaticI18n() {
    document.getElementById('searchInput').placeholder = t('search.placeholder');
    document.querySelector('.detail-empty p').textContent = t('detail.empty');
    document.getElementById('langToggle').textContent = currentLang.toUpperCase();
}

function toggleLang() {
    setLang(currentLang === 'es' ? 'en' : 'es');
    applyStaticI18n();
    // Re-render current focal if exists
    if (focalId) navigateTo(focalId);
}

// --- Ego Navigation ---

async function navigateTo(id, resetBreadcrumb) {
    const previousFocalId = focalId;
    const url = id ? `${API}/api/ego?id=${encodeURIComponent(id)}` : `${API}/api/ego`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data.focal) return;

    focalId = data.focal.id;
    lastEgoData = data;

    // Reset breadcrumb on double-click or search
    if (resetBreadcrumb) {
        history = [];
    }

    // Update breadcrumbs with edge label
    if (!history.length || history[history.length - 1].id !== focalId) {
        const displayName = data.focal.name || data.focal.title || data.focal.predicate || focalId.replace(/[a-zA-Z0-9]{15,}/, '…');

        // Find the edge between previous focal and new focal
        let edgeLabel = null;
        if (previousFocalId && !resetBreadcrumb) {
            const edge = data.edges.find(e => {
                const s = typeof e.source === 'object' ? e.source.id : e.source;
                const t = typeof e.target === 'object' ? e.target.id : e.target;
                return (s === previousFocalId && t === focalId) || (t === previousFocalId && s === focalId);
            });
            if (edge) {
                edgeLabel = edge.type.replace(/_/g, ' ').toLowerCase();
            }
        }

        history.push({ id: focalId, name: displayName, edge: edgeLabel });
        if (history.length > 12) history.shift();
    }
    renderBreadcrumbs();

    if (currentView === 'titles') {
        renderTitles(data);
    } else {
        renderEgo(data);
    }
    showDetail(data.focal);
}

// --- Graph Rendering ---

function renderEgo(data) {
    const container = document.getElementById('graphPanel');
    const width = container.clientWidth;
    const height = container.clientHeight;
    const cx = width / 2;
    const cy = height / 2;

    // Kill old simulation
    if (simulation) simulation.stop();
    d3.select('#graph').selectAll('*').remove();

    svg = d3.select('#graph').attr('width', width).attr('height', height);

    // Defs: arrow markers for all edge types
    const defs = svg.append('defs');
    const edgeTypes = schemaData?.graph?.edges || {};
    Object.keys(edgeTypes).forEach(type => {
        const v = edgeVisual(type);
        defs.append('marker')
            .attr('id', `arrow-${type}`)
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 20).attr('refY', 5)
            .attr('markerWidth', 5).attr('markerHeight', 5)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M 0 0 L 10 5 L 0 10 Z')
            .attr('fill', v.color);
    });

    g = svg.append('g');

    // Zoom
    const zoomBehavior = d3.zoom()
        .scaleExtent([0.3, 4])
        .on('zoom', e => g.attr('transform', e.transform));
    svg.call(zoomBehavior);

    const nodes = data.nodes;
    const edges = data.edges;

    // Compute connection counts per node
    const connCount = {};
    edges.forEach(e => {
        connCount[e.source] = (connCount[e.source] || 0) + 1;
        connCount[e.target] = (connCount[e.target] || 0) + 1;
    });
    nodes.forEach(n => { n._connectionCount = connCount[n.id] || 0; });

    // Pin focal to center
    const focalNode = nodes.find(n => n.id === focalId);
    if (focalNode) {
        focalNode.fx = cx;
        focalNode.fy = cy;
    }

    // --- Links (curved paths) ---
    linkGroup = g.append('g');
    const linkG = linkGroup.selectAll('g')
        .data(edges)
        .join('g')
        .attr('class', 'edge-group');

    // Curved path
    const link = linkG.append('path')
        .attr('stroke', d => edgeVisual(d.type).color)
        .attr('stroke-width', d => edgeVisual(d.type).width)
        .attr('stroke-dasharray', d => edgeVisual(d.type).style === 'dashed' ? '6,3' : null)
        .attr('marker-end', d => `url(#arrow-${d.type})`)
        .attr('fill', 'none')
        .attr('opacity', d => {
            if (d.source === focalId || d.target === focalId ||
                d.source?.id === focalId || d.target?.id === focalId) return 0.7;
            return 0.15;
        });

    // Invisible fat path for hover
    const linkHit = linkG.append('path')
        .attr('stroke', 'transparent')
        .attr('stroke-width', 14)
        .attr('fill', 'none')
        .attr('cursor', 'pointer');

    // Edge label (shown on hover)
    const edgeLabel = linkG.append('text')
        .text(d => d.type.replace(/_/g, ' ').toLowerCase())
        .attr('font-size', 8)
        .attr('font-family', 'var(--font-mono)')
        .attr('fill', d => edgeVisual(d.type).color)
        .attr('text-anchor', 'middle')
        .attr('dy', -5)
        .attr('opacity', 0)
        .attr('pointer-events', 'none');

    // Hover on edges
    linkG.on('mouseenter', function (e, d) {
        d3.select(this).select('text').attr('opacity', 1);
        d3.select(this).select('path:first-child')
            .attr('stroke-width', edgeVisual(d.type).width + 2)
            .attr('opacity', 1);
    }).on('mouseleave', function (e, d) {
        d3.select(this).select('text').attr('opacity', 0);
        const isFocal = (typeof d.source === 'object' ? d.source.id : d.source) === focalId ||
                         (typeof d.target === 'object' ? d.target.id : d.target) === focalId;
        d3.select(this).select('path:first-child')
            .attr('stroke-width', edgeVisual(d.type).width)
            .attr('opacity', isFocal ? 0.7 : 0.15);
    });

    // Curve generator helper
    function linkPath(d) {
        const sx = d.source.x, sy = d.source.y;
        const tx = d.target.x, ty = d.target.y;
        const dx = tx - sx, dy = ty - sy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // Slight curve offset perpendicular to the line
        const offset = Math.min(dist * 0.15, 25);
        const mx = (sx + tx) / 2 - (dy / dist) * offset;
        const my = (sy + ty) / 2 + (dx / dist) * offset;
        return `M${sx},${sy} Q${mx},${my} ${tx},${ty}`;
    }

    // --- Nodes ---
    nodeGroup = g.append('g');

    // Separate degree 2 (hidden by default) from degree 0-1
    const visibleNodes = nodes.filter(n => n._degree <= 1);
    const hiddenNodes = nodes.filter(n => n._degree === 2);

    const node = nodeGroup.selectAll('g')
        .data(nodes)
        .join('g')
        .attr('cursor', d => d._degree <= 1 ? 'pointer' : 'default')
        .attr('visibility', d => d._degree <= 1 ? 'visible' : 'hidden')
        .on('click', (e, d) => {
            e.stopPropagation();
            if (d.id === focalId) return;
            if (d.label === 'Actor') {
                navigateTo(d.id);
            } else {
                showDetail(d);
            }
        })
        .on('dblclick', (e, d) => {
            e.stopPropagation();
            // Double-click: navigate with breadcrumb reset
            if (d.label === 'Actor') {
                navigateTo(d.id, true);
            }
        })
        .call(makeDrag());

    // Halo for disputed
    node.filter(d => d.is_disputed && d.label === 'Afirmacion')
        .append('circle')
        .attr('class', 'node-disputed-halo')
        .attr('r', d => nodeRadius(d) + 6);

    // Main circle — color by TYPE
    node.append('circle')
        .attr('r', d => nodeRadius(d))
        .attr('fill', d => nodeColor(d))
        .attr('stroke', d => d.id === focalId ? '#fff' : nodeStroke(d))
        .attr('stroke-width', d => nodeStrokeWidth(d))
        .attr('opacity', d => d._degree === 2 ? 0.2 : 1.0);

    // Labels: degree 0 and 1, Actor/Evento only, TRUNCATED
    node.filter(d => d._degree <= 1 && (d.label === 'Actor' || d.label === 'Evento'))
        .append('text')
        .text(d => truncLabel(d.name || d.id))
        .attr('font-size', d => d.id === focalId ? 13 : 9)
        .attr('font-weight', d => d.id === focalId ? 700 : 400)
        .attr('fill', d => d.id === focalId ? '#fff' : '#c0c8d4')
        .attr('text-anchor', 'middle')
        .attr('dy', d => nodeRadius(d) + 13)
        .attr('pointer-events', 'none');

    // Tooltip for degree 2 (no permanent label)
    let tooltip = document.querySelector('.graph-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'graph-tooltip';
        container.appendChild(tooltip);
    }

    node.on('mouseenter', function (e, d) {
        const name = d.name || d.predicate || d.title || d.id;
        const desc = d.description ? ` — ${d.description}` : '';
        tooltip.textContent = `${name}${desc}`;
        tooltip.classList.add('visible');

        // Reveal degree-2 neighbors of this node
        const connectedIds = new Set();
        edges.forEach(e => {
            const src = typeof e.source === 'object' ? e.source.id : e.source;
            const tgt = typeof e.target === 'object' ? e.target.id : e.target;
            if (src === d.id) connectedIds.add(tgt);
            if (tgt === d.id) connectedIds.add(src);
        });

        // Show connected degree-2 nodes
        node.attr('visibility', n => {
            if (n._degree <= 1) return 'visible';
            if (connectedIds.has(n.id)) return 'visible';
            return 'hidden';
        });

        // Highlight connected edges
        linkG.each(function(l) {
            const src = typeof l.source === 'object' ? l.source.id : l.source;
            const tgt = typeof l.target === 'object' ? l.target.id : l.target;
            const connected = (src === d.id || tgt === d.id);
            d3.select(this).select('path:first-child').attr('opacity', connected ? 1 : 0.06);
            if (connected) d3.select(this).select('text').attr('opacity', 0.8);
        });

        // Dim non-connected nodes
        node.select('circle:not(.node-disputed-halo)')
            .attr('opacity', n => {
                if (n.id === d.id || n.id === focalId) return 1;
                if (connectedIds.has(n.id)) return 0.85;
                return 0.12;
            });
    })
    .on('mousemove', e => {
        const rect = container.getBoundingClientRect();
        tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
        tooltip.style.top = (e.clientY - rect.top - 8) + 'px';
    })
    .on('mouseleave', () => {
        tooltip.classList.remove('visible');
        // Hide degree 2 again
        node.attr('visibility', d => d._degree <= 1 ? 'visible' : 'hidden');
        linkG.each(function(d) {
            const src = typeof d.source === 'object' ? d.source.id : d.source;
            const tgt = typeof d.target === 'object' ? d.target.id : d.target;
            const isFocal = (src === focalId || tgt === focalId);
            d3.select(this).select('path:first-child').attr('opacity', isFocal ? 0.7 : 0.15);
            d3.select(this).select('text').attr('opacity', 0);
        });
        node.select('circle:not(.node-disputed-halo)')
            .attr('opacity', d => d._degree === 2 ? 0.2 : 1.0);
    });

    // --- Simulation ---
    const chargeMap = { Actor: -120, Evento: -300, Afirmacion: -80, Noticia: -40 };

    simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(edges)
            .id(d => d.id)
            .distance(d => edgeVisual(d.type).force_distance || 100)
            .strength(d => {
                if (d.type === 'CONTRADICE') return 0.05; // Weak — they repel via charge
                if (d.type === 'SOSTIENE') return 0.8;
                return 0.4;
            })
        )
        .force('charge', d3.forceManyBody()
            .strength(d => {
                if (d.id === focalId) return -500;
                return chargeMap[d.label] || -80;
            })
        )
        .force('contradict-repel', () => {
            // Extra repulsion for CONTRADICE edges
            edges.forEach(e => {
                if (e.type !== 'CONTRADICE') return;
                const s = typeof e.source === 'object' ? e.source : nodes.find(n => n.id === e.source);
                const t = typeof e.target === 'object' ? e.target : nodes.find(n => n.id === e.target);
                if (!s || !t) return;
                const dx = t.x - s.x, dy = t.y - s.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const force = 5000 / (dist * dist); // Strong repulsion
                s.vx -= (dx / dist) * force;
                s.vy -= (dy / dist) * force;
                t.vx += (dx / dist) * force;
                t.vy += (dy / dist) * force;
            });
        })
        .force('center', d3.forceCenter(cx, cy).strength(0.02))
        .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 4))
        .force('type-radial', (alpha) => {
            // Gently push nodes toward their type's angular zone
            nodes.forEach(n => {
                if (n.id === focalId || n._degree > 1) return;
                const angle = TYPE_ANGLE[n.type] ?? 0;
                const targetX = cx + Math.cos(angle) * 120;
                const targetY = cy + Math.sin(angle) * 120;
                n.vx += (targetX - n.x) * alpha * 0.02;
                n.vy += (targetY - n.y) * alpha * 0.02;
            });
        })
        .on('tick', () => {
            link.attr('d', linkPath);
            linkHit.attr('d', linkPath);
            edgeLabel
                .attr('x', d => (d.source.x + d.target.x) / 2)
                .attr('y', d => (d.source.y + d.target.y) / 2);
            node.attr('transform', d => `translate(${d.x},${d.y})`);
        });

    // Auto-zoom to fit degree 1
    simulation.on('end', () => {
        autoZoom(nodes, zoomBehavior, width, height);
    });

    // Also after 2 seconds for fast stabilization
    setTimeout(() => autoZoom(nodes, zoomBehavior, width, height), 2000);
}

function autoZoom(nodes, zoomBehavior, width, height) {
    const g1Nodes = nodes.filter(n => n._degree <= 1);
    if (g1Nodes.length < 2) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    g1Nodes.forEach(n => {
        minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
        minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    });

    const padding = 80;
    const bw = (maxX - minX) + padding * 2;
    const bh = (maxY - minY) + padding * 2;
    const scale = Math.min(width / bw, height / bh, 2.0) * 0.85; // 85% to leave breathing room
    const tx = width / 2 - ((minX + maxX) / 2) * scale;
    const ty = height / 2 - ((minY + maxY) / 2) * scale;

    svg.transition().duration(800).call(
        zoomBehavior.transform,
        d3.zoomIdentity.translate(tx, ty).scale(scale)
    );
}

// --- View switching ---

function setView(view) {
    currentView = view;
    document.querySelectorAll('.view-toggle').forEach(b => b.classList.remove('active'));
    document.getElementById(view === 'titles' ? 'viewTitles' : 'viewNodes').classList.add('active');
    if (lastEgoData) {
        if (view === 'titles') renderTitles(lastEgoData);
        else renderEgo(lastEgoData);
    }
}

// --- Titles View ---

// Typography rules by entity type
const TITLE_STYLE = {
    Person:       { transform: 'none',      fontWeight: 400, fontStyle: 'normal',  fontSize: 12 },
    Location:     { transform: 'uppercase',  fontWeight: 700, fontStyle: 'normal',  fontSize: 12 },
    Organization: { transform: 'uppercase',  fontWeight: 400, fontStyle: 'normal',  fontSize: 11 },
    Object:       { transform: 'lowercase',  fontWeight: 400, fontStyle: 'italic',  fontSize: 10 },
    Event:        { transform: 'uppercase',  fontWeight: 700, fontStyle: 'normal',  fontSize: 13 }
};

function renderTitles(data) {
    const container = document.getElementById('graphPanel');
    const width = container.clientWidth;
    const height = container.clientHeight;
    const cx = width / 2, cy = height / 2;

    if (simulation) simulation.stop();
    d3.select('#graph').selectAll('*').remove();

    svg = d3.select('#graph').attr('width', width).attr('height', height);

    // Arrow defs
    const defs = svg.append('defs');
    const edgeTypes = schemaData?.graph?.edges || {};
    Object.keys(edgeTypes).forEach(type => {
        const v = edgeVisual(type);
        defs.append('marker')
            .attr('id', `arrow-t-${type}`)
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 10).attr('refY', 5)
            .attr('markerWidth', 5).attr('markerHeight', 5)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M 0 0 L 10 5 L 0 10 Z')
            .attr('fill', v.color);
    });

    g = svg.append('g');
    svg.call(d3.zoom().scaleExtent([0.3, 4]).on('zoom', e => g.attr('transform', e.transform)));

    const nodes = data.nodes;
    const edges = data.edges;

    // Connection counts
    const connCount = {};
    edges.forEach(e => {
        connCount[e.source] = (connCount[e.source] || 0) + 1;
        connCount[e.target] = (connCount[e.target] || 0) + 1;
    });
    nodes.forEach(n => { n._connectionCount = connCount[n.id] || 0; });

    // Only show degree 0-1
    const visibleNodes = nodes.filter(n => n._degree <= 1);

    // Pin focal
    const focalNode = nodes.find(n => n.id === focalId);
    if (focalNode) { focalNode.fx = cx; focalNode.fy = cy; }

    // --- Links ---
    linkGroup = g.append('g');
    const link = linkGroup.selectAll('path')
        .data(edges)
        .join('path')
        .attr('stroke', d => edgeVisual(d.type).color)
        .attr('stroke-width', d => Math.max(edgeVisual(d.type).width * 0.7, 0.5))
        .attr('stroke-dasharray', d => edgeVisual(d.type).style === 'dashed' ? '4,3' : null)
        .attr('marker-end', d => `url(#arrow-t-${d.type})`)
        .attr('fill', 'none')
        .attr('opacity', d => {
            const s = typeof d.source === 'object' ? d.source.id : d.source;
            const t = typeof d.target === 'object' ? d.target.id : d.target;
            return (s === focalId || t === focalId) ? 0.5 : 0.12;
        });

    // --- Text Nodes ---
    nodeGroup = g.append('g');
    const node = nodeGroup.selectAll('g')
        .data(nodes)
        .join('g')
        .attr('cursor', d => d._degree <= 1 ? 'pointer' : 'default')
        .attr('visibility', d => d._degree <= 1 ? 'visible' : 'hidden')
        .on('click', (e, d) => {
            e.stopPropagation();
            if (d.id === focalId) return;
            if (d.label === 'Actor') {
                navigateTo(d.id);
            } else {
                showDetail(d);
            }
        })
        .on('dblclick', (e, d) => {
            e.stopPropagation();
            if (d.label === 'Actor') navigateTo(d.id, true);
        })
        .call(makeDrag());

    // Text element as the "node"
    const textEl = node.append('text')
        .text(d => {
            const name = d.name || d.predicate || d.title || d.id;
            const style = TITLE_STYLE[d.type] || TITLE_STYLE.Object;
            if (style.transform === 'uppercase') return name.toUpperCase();
            if (style.transform === 'lowercase') return name.toLowerCase();
            return name;
        })
        .attr('font-size', d => {
            const style = TITLE_STYLE[d.type] || TITLE_STYLE.Object;
            const base = style.fontSize;
            if (d.id === focalId) return base + 6;
            return base + Math.min(d._connectionCount * 0.3, 4);
        })
        .attr('font-weight', d => {
            if (d.id === focalId) return 700;
            return (TITLE_STYLE[d.type] || TITLE_STYLE.Object).fontWeight;
        })
        .attr('font-style', d => (TITLE_STYLE[d.type] || TITLE_STYLE.Object).fontStyle)
        .attr('fill', d => {
            if (d.id === focalId) return '#fff';
            return nodeColor(d);
        })
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('opacity', d => d._degree === 2 ? 0.15 : (d.id === focalId ? 1 : 0.85));

    // Measure bounding boxes for collision
    node.each(function(d) {
        const bbox = this.querySelector('text')?.getBBox();
        if (bbox) {
            d._w = bbox.width + 12;
            d._h = bbox.height + 6;
        } else {
            d._w = 60;
            d._h = 16;
        }
    });

    // Tooltip on hover
    let tooltip = document.querySelector('.graph-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'graph-tooltip';
        container.appendChild(tooltip);
    }

    node.on('mouseenter', function(e, d) {
        const desc = d.description ? ` — ${d.description}` : '';
        tooltip.textContent = `${d.name || d.id}${desc}`;
        tooltip.classList.add('visible');

        // Highlight connections
        const connIds = new Set();
        edges.forEach(e => {
            const s = typeof e.source === 'object' ? e.source.id : e.source;
            const t = typeof e.target === 'object' ? e.target.id : e.target;
            if (s === d.id) connIds.add(t);
            if (t === d.id) connIds.add(s);
        });

        textEl.attr('opacity', n => {
            if (n.id === d.id || n.id === focalId) return 1;
            if (connIds.has(n.id)) return 0.9;
            return 0.1;
        });
        link.attr('opacity', l => {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            return (s === d.id || t === d.id) ? 0.8 : 0.04;
        });
    })
    .on('mousemove', e => {
        const rect = container.getBoundingClientRect();
        tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
        tooltip.style.top = (e.clientY - rect.top - 8) + 'px';
    })
    .on('mouseleave', () => {
        tooltip.classList.remove('visible');
        textEl.attr('opacity', d => d._degree === 2 ? 0.15 : (d.id === focalId ? 1 : 0.85));
        link.attr('opacity', d => {
            const s = typeof d.source === 'object' ? d.source.id : d.source;
            const t = typeof d.target === 'object' ? d.target.id : d.target;
            return (s === focalId || t === focalId) ? 0.5 : 0.12;
        });
    });

    // Rectangular collision force
    function forceRectCollide() {
        let nds;
        function force(alpha) {
            for (let i = 0; i < nds.length; i++) {
                for (let j = i + 1; j < nds.length; j++) {
                    const a = nds[i], b = nds[j];
                    if (a._degree > 1 || b._degree > 1) continue;
                    const dx = b.x - a.x, dy = b.y - a.y;
                    const minDistX = (a._w + b._w) / 2;
                    const minDistY = (a._h + b._h) / 2;
                    const overlapX = minDistX - Math.abs(dx);
                    const overlapY = minDistY - Math.abs(dy);
                    if (overlapX > 0 && overlapY > 0) {
                        const push = alpha * 0.5;
                        if (overlapX < overlapY) {
                            const sx = (dx > 0 ? 1 : -1) * overlapX * push;
                            a.x -= sx; b.x += sx;
                        } else {
                            const sy = (dy > 0 ? 1 : -1) * overlapY * push;
                            a.y -= sy; b.y += sy;
                        }
                    }
                }
            }
        }
        force.initialize = function(nodes) { nds = nodes; };
        return force;
    }

    // Curve helper
    function titleLinkPath(d) {
        const sx = d.source.x, sy = d.source.y;
        const tx = d.target.x, ty = d.target.y;
        const dx = tx - sx, dy = ty - sy;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const offset = Math.min(dist * 0.1, 15);
        const mx = (sx + tx) / 2 - (dy / dist) * offset;
        const my = (sy + ty) / 2 + (dx / dist) * offset;
        return `M${sx},${sy} Q${mx},${my} ${tx},${ty}`;
    }

    // Simulation
    simulation = d3.forceSimulation(nodes)
        .force('link', d3.forceLink(edges).id(d => d.id)
            .distance(d => (edgeVisual(d.type).force_distance || 100) * 1.2)
            .strength(0.3))
        .force('charge', d3.forceManyBody().strength(-150))
        .force('center', d3.forceCenter(cx, cy).strength(0.03))
        .force('rectCollide', forceRectCollide())
        .force('type-radial', alpha => {
            nodes.forEach(n => {
                if (n.id === focalId || n._degree > 1) return;
                const angle = TYPE_ANGLE[n.type] ?? 0;
                const r = 140;
                n.vx += (cx + Math.cos(angle) * r - n.x) * alpha * 0.015;
                n.vy += (cy + Math.sin(angle) * r - n.y) * alpha * 0.015;
            });
        })
        .on('tick', () => {
            link.attr('d', titleLinkPath);
            node.attr('transform', d => `translate(${d.x},${d.y})`);
        });

    setTimeout(() => autoZoom(nodes, d3.zoom().scaleExtent([0.3, 4]).on('zoom', e => g.attr('transform', e.transform)), width, height), 2000);
}

function makeDrag() {
    return d3.drag()
        .on('start', (e, d) => {
            if (!e.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
        })
        .on('drag', (e, d) => { d.fx = e.x; d.fy = e.y; })
        .on('end', (e, d) => {
            if (!e.active) simulation.alphaTarget(0);
            // Keep focal pinned
            if (d.id !== focalId) { d.fx = null; d.fy = null; }
        });
}

// --- Detail Panel ---

async function showDetail(node) {
    document.querySelector('.detail-empty').hidden = true;
    const content = document.getElementById('detailContent');
    content.hidden = false;
    document.getElementById('detailBody').innerHTML = renderDetail(node) +
        `<div class="detail-section" id="newsSection"><h3>${t('detail.news')}</h3><p class="loading-inline">${t('detail.news.loading')}</p></div>`;

    // Load aliases for Actor/Evento
    if (node.label === 'Actor' || node.label === 'Evento') {
        loadAliases(node.id);
    }

    // Render feather icons in detail
    if (typeof feather !== 'undefined') feather.replace();

    // Fetch ingest status
    loadIngestButton(node);

    // Fetch linked news
    const res = await fetch(`${API}/api/news?id=${encodeURIComponent(node.id)}`);
    const news = await res.json();

    const section = document.getElementById('newsSection');
    if (!news.length) {
        section.innerHTML = `<h3>${t('detail.news')}</h3><p style="color:var(--ink-faint)">${t('detail.news.none')}</p>`;
        return;
    }

    section.innerHTML = `<h3>${t('detail.news')} (${news.length})</h3>` +
        news.map(n => `
            <div class="news-card">
                <div class="news-meta">
                    <span class="news-source">${n.source || ''}</span>
                    <span class="news-date">${formatDate(n.pub_date)}</span>
                </div>
                <div class="news-title-row">
                    <span class="news-title-text">${n.title || '—'}</span>
                    ${n.link ? `<a class="news-external" href="${n.link}" target="_blank" rel="noopener" title="Abrir fuente original"><i data-feather="external-link"></i></a>` : ''}
                </div>
                ${n.description ? `<p class="news-desc">${n.description}</p>` : ''}
                <div class="news-claim">
                    <span class="claim-arrow">${n.subject} → ${n.claim} → ${n.object}</span>
                    ${n.is_disputed ? '<span class="disputed-badge">disputado</span>' : ''}
                </div>
            </div>
        `).join('');

    // Render feather icons
    if (typeof feather !== 'undefined') feather.replace();
}

function renderDetail(node) {
    const label = node.label || 'Actor';
    const nodeTypes = ['Person', 'Organization', 'Location', 'Object', 'Event'];

    let html = '';

    // Editable type selector
    html += `<div class="detail-type-row">
        ${nodeDot(label, node.type)}
        <select id="nodeTypeSelect" class="node-type-select" onchange="updateNodeType('${node.id}', this.value)">
            ${nodeTypes.map(tp => `<option value="${tp}" ${tp === node.type ? 'selected' : ''}>${tType(tp)}</option>`).join('')}
        </select>
    </div>`;

    // Name + description
    if (label === 'Afirmacion') {
        html += `<h2>${node.subject} → ${node.predicate} → ${node.object}</h2>`;
        html += `<div class="detail-section"><h3>${t('detail.event')}</h3><p>${(node.event_type || '').replace(/_/g, ' ')}</p></div>`;
        if (node.is_disputed) html += `<p class="disputed-badge">${t('detail.disputed')}</p>`;
        if (node.evidence_quote) html += `<div class="detail-section"><h3>${t('detail.evidence')}</h3><p class="evidence-quote">${node.evidence_quote}</p></div>`;
    } else if (label === 'Noticia') {
        html += `<h2>${node.title}</h2>`;
        html += `<div class="detail-section"><h3>${t('detail.source')}</h3><p>${node.source} (${node.lang})</p></div>`;
    } else {
        html += `<h2>${node.name || node.id}</h2>`;
        if (node.description) html += `<p class="node-description">${node.description}</p>`;
    }

    // Aliases editor (for Actor/Evento nodes)
    if (label === 'Actor' || label === 'Evento') {
        html += `<div class="detail-section" id="aliasesSection">
            <h3>${t('detail.aliases')}</h3>
            <div id="aliasesList" class="aliases-list"><span class="loading-inline">...</span></div>
            <div class="alias-add-row">
                <input type="text" id="aliasInput" class="alias-input" placeholder="${t('detail.aliases.add')}">
                <button onclick="addAlias('${node.id}')" class="alias-add-btn">+</button>
            </div>
        </div>`;

        // Enrich button
        html += `<div class="detail-section">
            <div class="detail-actions-row">
                <button class="enrich-btn" id="enrichBtn" onclick="enrichNode('${node.id}', '${(node.name || node.id).replace(/'/g, "\\'")}')">
                    <i data-feather="globe"></i> ${t('detail.enrich')}
                </button>
                <button class="delete-btn" onclick="deleteNode('${node.id}', '${(node.name || node.id).replace(/'/g, "\\'")}')">
                    <i data-feather="trash-2"></i>
                </button>
            </div>
            <div id="enrichResults"></div>
        </div>`;
    }

    return html;
}

// --- Node editing ---

async function updateNodeType(nodeId, newType) {
    await fetch(`${API}/api/node/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: nodeId, type: newType })
    });
}

async function loadAliases(nodeId) {
    const res = await fetch(`${API}/api/node/aliases?id=${encodeURIComponent(nodeId)}`);
    const data = await res.json();
    const list = document.getElementById('aliasesList');
    if (!list) return;

    const aliases = data.entry?.aliases || [];
    if (!aliases.length) {
        list.innerHTML = `<span style="color:var(--ink-faint);font-size:var(--font-size-xs)">${t('detail.aliases.none')}</span>`;
        return;
    }
    list.innerHTML = aliases.map(a =>
        `<span class="alias-chip">
            ${a}
            <button onclick="removeAlias('${nodeId}', '${a.replace(/'/g, "\\'")}')" class="alias-remove">&times;</button>
        </span>`
    ).join('');
}

async function addAlias(nodeId) {
    const input = document.getElementById('aliasInput');
    const alias = input.value.trim();
    if (!alias) return;

    const res = await fetch(`${API}/api/node/aliases/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: nodeId, alias })
    });
    const data = await res.json();

    if (data.merge_candidate) {
        // Show merge dialog
        showMergeDialog(nodeId, data.merge_candidate, alias);
        return;
    }

    input.value = '';
    loadAliases(nodeId);
}

async function removeAlias(nodeId, alias) {
    await fetch(`${API}/api/node/aliases/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: nodeId, alias })
    });
    loadAliases(nodeId);
}

function showMergeDialog(currentId, candidate, aliasTyped) {
    const section = document.getElementById('aliasesSection');
    const nodeTypes = ['Person', 'Organization', 'Location', 'Object', 'Event'];

    section.insertAdjacentHTML('beforeend', `
        <div class="merge-dialog" id="mergeDialog">
            <p class="merge-warning">"${aliasTyped}" ${t('merge.warning')} <strong>${candidate.canonical || candidate.id}</strong></p>
            <div class="merge-options">
                <label class="merge-label">${t('merge.canonical')}
                    <input type="text" id="mergeCanonical" class="alias-input" value="${candidate.canonical || candidate.id}">
                </label>
                <label class="merge-label">${t('merge.type')}
                    <select id="mergeType" class="node-type-select">
                        ${nodeTypes.map(t => `<option value="${t}" ${t === candidate.type ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </label>
                <div class="merge-actions">
                    <button onclick="executeMerge('${currentId}', '${candidate.id}')" class="merge-btn merge-confirm">${t('merge.confirm')}</button>
                    <button onclick="document.getElementById('mergeDialog').remove()" class="merge-btn merge-cancel">${t('merge.cancel')}</button>
                </div>
            </div>
        </div>
    `);
}

async function executeMerge(currentId, candidateId) {
    const canonicalName = document.getElementById('mergeCanonical').value;
    const canonicalType = document.getElementById('mergeType').value;

    const res = await fetch(`${API}/api/node/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            keepId: currentId,
            removeId: candidateId,
            canonicalName,
            canonicalType
        })
    });
    const data = await res.json();

    if (data.ok) {
        // Refresh ego from the kept node
        navigateTo(currentId);
    }
}

// --- Breadcrumbs ---

function renderBreadcrumbs() {
    const nav = document.getElementById('breadcrumbs');
    let html = '';
    history.forEach((h, i) => {
        // Edge label before this node (from the previous navigation)
        if (i > 0 && h.edge) {
            html += `<span class="crumb-edge">—${h.edge}→</span>`;
        } else if (i > 0) {
            html += `<span class="crumb-edge">›</span>`;
        }
        html += `<span class="crumb ${h.id === focalId ? 'active' : ''}" onclick="navigateTo('${h.id}')">${h.name}</span>`;
    });
    nav.innerHTML = html;
}

// --- Search ---

function setupSearch() {
    const input = document.getElementById('searchInput');
    const results = document.getElementById('searchResults');
    let debounce = null;

    input.addEventListener('input', () => {
        clearTimeout(debounce);
        const q = input.value.trim();
        if (q.length < 2) { results.hidden = true; return; }

        debounce = setTimeout(async () => {
            const res = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`);
            const items = await res.json();
            if (!items.length) { results.hidden = true; return; }

            results.innerHTML = items.map(item =>
                `<li onclick="jumpTo('${item.id}')">
                    ${nodeDot(item.label, item.type)}${item.name || item.title || item.id}
                    <span class="label-tag">${item.type || item.label}</span>
                </li>`
            ).join('');
            results.hidden = false;
        }, 250);
    });

    input.addEventListener('keydown', e => {
        if (e.key === 'Escape') { results.hidden = true; input.blur(); }
    });

    // Close on click outside
    document.addEventListener('click', e => {
        if (!e.target.closest('.search-container')) results.hidden = true;
    });
}

function jumpTo(id) {
    document.getElementById('searchResults').hidden = true;
    document.getElementById('searchInput').value = '';
    navigateTo(id, true); // Search always resets breadcrumb
}

// --- Split handle ---

function setupSplitHandle() {
    const handle = document.getElementById('splitHandle');
    const splitLeft = document.querySelector('.split-left');
    let dragging = false;

    handle.addEventListener('pointerdown', e => {
        dragging = true;
        handle.classList.add('dragging');
        handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener('pointermove', e => {
        if (!dragging) return;
        const rect = handle.parentElement.getBoundingClientRect();
        const ratio = Math.max(0.2, Math.min(0.8, (e.clientX - rect.left) / rect.width));
        splitLeft.style.flex = `0 0 ${ratio * 100}%`;
    });
    handle.addEventListener('pointerup', () => {
        dragging = false;
        handle.classList.remove('dragging');
    });
}

// --- Detail close ---

function setupDetailClose() {
    document.getElementById('detailClose').addEventListener('click', () => {
        document.getElementById('detailContent').hidden = true;
        document.querySelector('.detail-empty').hidden = false;
    });
}

// --- Stats ---

async function loadStats() {
    const res = await fetch(`${API}/api/stats`);
    const stats = await res.json();

    // Also get ingest status for the bar
    const iRes = await fetch(`${API}/api/ingest/status`).catch(() => null);
    const ingest = iRes ? await iRes.json() : { pending: 0, processed: 0 };
    const total = ingest.pending + ingest.processed;
    const pct = total > 0 ? Math.round((ingest.processed / total) * 100) : 100;

    document.getElementById('statsBar').textContent =
        `${stats.processed}/${stats.total} — ${stats.sources.length} ${t('stats.sources')} — ${pct}%`;
}

// --- Wikidata enrichment ---

async function enrichNode(nodeId, nodeName) {
    const btn = document.getElementById('enrichBtn');
    const results = document.getElementById('enrichResults');
    btn.disabled = true;
    btn.innerHTML = `<i data-feather="loader"></i> ${t('detail.enrich.loading')}`;
    if (typeof feather !== 'undefined') feather.replace();

    try {
        // First: preview (don't apply yet)
        const res = await fetch(`${API}/api/node/enrich`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: nodeId, name: nodeName, apply: false })
        });
        const data = await res.json();

        if (!data.found) {
            results.innerHTML = `<p class="ingest-hint">${t('detail.enrich.notfound')}</p>`;
            btn.disabled = false;
            btn.innerHTML = `<i data-feather="globe"></i> ${t('detail.enrich')}`;
            if (typeof feather !== 'undefined') feather.replace();
            return;
        }

        // Show preview of what will be added
        let html = `<div class="enrich-preview">`;
        if (data.description) {
            html += `<p class="enrich-desc"><strong>${t('detail.enrich.description')}</strong> ${data.description}</p>`;
        }
        if (data.relations.length > 0) {
            html += `<p class="enrich-desc"><strong>${t('detail.enrich.relations')} (${data.relations.length}):</strong></p><ul class="enrich-relations">`;
            data.relations.forEach(r => {
                html += `<li>${r.property_label}: <strong>${r.target_name}</strong> <span class="enrich-rel-desc">${r.target_desc}</span></li>`;
            });
            html += `</ul>`;
        }
        html += `<div class="merge-actions">
            <button onclick="applyEnrichment('${nodeId}', '${nodeName.replace(/'/g, "\\'")}')" class="merge-btn merge-confirm">${t('detail.enrich.apply')}</button>
            <button onclick="cancelEnrich()" class="merge-btn merge-cancel">${t('detail.enrich.cancel')}</button>
        </div></div>`;

        results.innerHTML = html;
    } catch (err) {
        results.innerHTML = `<p class="ingest-hint">Error: ${err.message}</p>`;
        btn.disabled = false;
        btn.innerHTML = '<i data-feather="globe"></i> Enriquecer desde Wikidata';
    }
    if (typeof feather !== 'undefined') feather.replace();
}

async function deleteNode(nodeId, nodeName) {
    if (!confirm(`${t('detail.delete.confirm')} "${nodeName}"?`)) return;

    await fetch(`${API}/api/node/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: nodeId })
    });

    // Navigate back or to random
    if (history.length > 1) {
        history.pop();
        const prev = history[history.length - 1];
        navigateTo(prev.id);
    } else {
        navigateTo(null, true);
    }
}

function cancelEnrich() {
    document.getElementById('enrichResults').innerHTML = '';
    const btn = document.getElementById('enrichBtn');
    btn.disabled = false;
    btn.innerHTML = `<i data-feather="globe"></i> ${t('detail.enrich')}`;
    if (typeof feather !== 'undefined') feather.replace();
}

async function applyEnrichment(nodeId, nodeName) {
    const results = document.getElementById('enrichResults');
    results.innerHTML = '<p class="loading-inline">Aplicando...</p>';

    await fetch(`${API}/api/node/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: nodeId, name: nodeName, apply: true })
    });

    // Refresh ego to see new nodes
    navigateTo(nodeId);
}

// --- Ingest from UI ---

async function loadIngestButton(node) {
    const newsSection = document.getElementById('newsSection');
    if (!newsSection) return;

    // Build search keywords from node name + aliases
    const aliasRes = await fetch(`${API}/api/node/aliases?id=${encodeURIComponent(node.id)}`);
    const aliasData = await aliasRes.json();
    const keywords = [node.name || node.id];
    if (aliasData.entry?.aliases) keywords.push(...aliasData.entry.aliases);

    // Search corpus
    const searchRes = await fetch(`${API}/api/ingest/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keywords })
    });
    const searchData = await searchRes.json();

    if (searchData.matches.length > 0) {
        newsSection.insertAdjacentHTML('afterend', `
            <div class="detail-section" id="ingestSection">
                <h3>${t('ingest.unprocessed')} (${searchData.matches.length} ${t('ingest.pending')})</h3>
                <p class="ingest-hint">${searchData.matches.length} ${t('ingest.hint')}</p>
                <button class="ingest-btn" onclick="ingestForNode('${node.id}')">
                    <i data-feather="download-cloud"></i> ${t('ingest.process')}
                </button>
                <div id="ingestResults"></div>
            </div>
        `);
        if (typeof feather !== 'undefined') feather.replace();

        // Store matches for later use
        window._pendingIngest = searchData.matches;
    }
}

async function ingestForNode(nodeId) {
    const matches = window._pendingIngest || [];
    if (!matches.length) return;

    const btn = document.querySelector('.ingest-btn');
    const results = document.getElementById('ingestResults');
    btn.disabled = true;
    btn.textContent = t('ingest.processing');

    const files = matches.map(m => m.file);

    // Queue for processing
    const res = await fetch(`${API}/api/ingest/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files })
    });
    const data = await res.json();

    results.innerHTML = `<p class="ingest-hint">${data.queued} ${t('ingest.queued')}</p>`;
    btn.remove();

    // Poll for completion
    pollIngestStatus(nodeId);
}

async function pollIngestStatus(nodeId) {
    const results = document.getElementById('ingestResults');
    if (!results) return;

    let prevProcessed = 0;
    const interval = setInterval(async () => {
        const res = await fetch(`${API}/api/ingest/status`);
        const status = await res.json();

        results.innerHTML = `<p class="ingest-hint">${t('ingest.status.pending')}: ${status.pending} | ${t('ingest.status.processed')}: ${status.processed} | ${t('ingest.status.extractions')}: ${status.extractions}</p>`;

        if (status.processed !== prevProcessed) {
            prevProcessed = status.processed;
            // Refresh news
            const newsRes = await fetch(`${API}/api/news?id=${encodeURIComponent(nodeId)}`);
            const news = await newsRes.json();
            const section = document.getElementById('newsSection');
            if (section && news.length > 0) {
                section.querySelector('h3').textContent = `Noticias (${news.length})`;
            }
        }
    }, 5000);

    // Stop after 5 minutes
    setTimeout(() => clearInterval(interval), 300000);
}

// --- Process panel ---

let processPanelOpen = false;
let processInterval = null;

function toggleProcessPanel() {
    processPanelOpen = !processPanelOpen;
    document.getElementById('processPanel').hidden = !processPanelOpen;
    if (processPanelOpen) {
        refreshProcessStatus();
        if (!processInterval) {
            processInterval = setInterval(refreshProcessStatus, 5000);
        }
    } else {
        if (processInterval) { clearInterval(processInterval); processInterval = null; }
    }
}

async function refreshProcessStatus() {
    try {
        const res = await fetch(`${API}/api/ingest/status`);
        const s = await res.json();
        const total = s.pending + s.processed;
        const pct = total > 0 ? Math.round((s.processed / total) * 100) : 0;

        document.getElementById('processBar').style.width = `${pct}%`;
        document.getElementById('processDetails').innerHTML = `
            <div class="process-stat">
                <span class="process-stat-value">${s.processed}</span>
                <span class="process-stat-label">${t('ingest.status.processed')}</span>
            </div>
            <div class="process-stat">
                <span class="process-stat-value">${s.pending}</span>
                <span class="process-stat-label">${t('ingest.status.pending')}</span>
            </div>
            <div class="process-stat">
                <span class="process-stat-value">${s.extractions}</span>
                <span class="process-stat-label">${t('ingest.status.extractions')}</span>
            </div>
            <div class="process-stat">
                <span class="process-stat-value">${pct}%</span>
                <span class="process-stat-label">Total</span>
            </div>
        `;
    } catch {}
}

async function fetchNewRSS() {
    const btn = document.getElementById('fetchRssBtn');
    btn.disabled = true;
    btn.innerHTML = '<i data-feather="loader"></i> Fetching...';
    if (typeof feather !== 'undefined') feather.replace();

    await fetch(`${API}/api/ingest/fetch`, { method: 'POST' });

    setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = '<i data-feather="rss"></i> Fetch RSS';
        if (typeof feather !== 'undefined') feather.replace();
        refreshProcessStatus();
    }, 10000);
}

// --- Helpers ---

function formatDate(str) {
    if (!str) return '';
    try {
        const d = new Date(str);
        return d.toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return str; }
}

// --- Boot ---

init().catch(err => {
    console.error('Error:', err);
    document.getElementById('graphPanel').innerHTML =
        '<div class="loading">Cargando grafo...</div>';
});
