const API = '';
let schemaData = null;
let simulation = null;
let currentSimulation = null; // alias for applyDegreeFilter
let svg, g, linkGroup, nodeGroup;
let focalId = null;
let focalIds = new Set(); // panorama mode: multiple focal events
let panoramaMode = false;
let disputeMode = false;
let history = []; // breadcrumbs
let currentView = 'titles'; // 'nodes' | 'titles'
let territoryEnabled = false;
let currentDegree = 1;
let lastEgoData = null; // cache for view switching

// --- Node visual config ---

// Colors by entity TYPE (not graph label)
const TYPE_COLORS = {
    // Actors — reds/warm (sub-type variations)
    Person:       { fill: '#C45D3E', stroke: '#8B3322' },  // terracotta
    Organization: { fill: '#A8432A', stroke: '#6E2A18' },  // brick red
    // Locations — greens
    Location:     { fill: '#6B8C42', stroke: '#3D5C2E' },  // olive green
    // Objects — blues
    Object:       { fill: '#5B7FA5', stroke: '#3A5670' },  // slate blue
    // Events — earth/ochre (default, sub-types override via eventTypeColor)
    Event:        { fill: '#C49A2A', stroke: '#8B6D14' }   // ochre gold
};

// Event sub-type color variations (earth tones)
const EVENT_TYPE_COLORS = {
    ACCION_ARMADA:         { fill: '#A67C52', stroke: '#6E4F30' },  // sienna
    AMENAZA_COERCION:      { fill: '#B5651D', stroke: '#7A4012' },  // burnt orange
    SANCION_ECONOMICA:     { fill: '#D4A017', stroke: '#8B6D14' },  // gold
    RUPTURA_DIPLOMATICA:   { fill: '#C49A2A', stroke: '#8B6D14' },  // ochre
    PROTESTA_SOCIAL:       { fill: '#CC7A3E', stroke: '#8B4F28' },  // copper
    DENUNCIA_ACUSACION:    { fill: '#B88A5E', stroke: '#7A5D3E' },  // tan
    DECLARACION_PUBLICA:   { fill: '#D4B896', stroke: '#8B7D5A' },  // wheat
    ACUERDO_PAZ:           { fill: '#C4A85A', stroke: '#8B7A32' },  // pale gold
    CAMBIO_LIDERAZGO:      { fill: '#B8860B', stroke: '#7A5A08' },  // dark goldenrod
    INCAUTACION_DETENCION: { fill: '#A0785A', stroke: '#6B4F3A' },  // brown
};

// Fallback by graph label
const LABEL_COLORS = {
    Afirmacion: { fill: '#8B7D6B', stroke: '#5C5244' },
    Noticia:    { fill: '#6B5744', stroke: '#4A3C2E' }
};

const BASE_RADIUS = { Actor: 8, Evento: 8, Afirmacion: 4, Noticia: 3 };
const MAX_LABEL_LEN = 30;
const MAX_LABEL_LINE = 16; // chars per line for multiline wrapping

// Trim trailing " - Source Name" from news titles
function trimTitle(title) {
    if (!title) return '—';
    return title.replace(/\s*[-–—]\s*[^-–—]{2,30}$/, '').trim() || title;
}

// Human-readable date formatting: "Lunes 27 de Marzo, 2026"
function formatDate(dateStr) {
    if (!dateStr || dateStr === 'null' || dateStr === '') return '';
    try {
        let date;
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            const [y, m, d] = dateStr.split('-').map(Number);
            date = new Date(y, m - 1, d);
        } else {
            date = new Date(dateStr);
        }
        if (isNaN(date.getTime())) return dateStr;
        const day = date.getDate();
        const year = date.getFullYear();
        const days = currentLang === 'es'
            ? ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado']
            : ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
        const months = currentLang === 'es'
            ? ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre']
            : ['January','February','March','April','May','June','July','August','September','October','November','December'];
        const dayName = days[date.getDay()];
        const monthName = months[date.getMonth()];
        return currentLang === 'es'
            ? `${dayName} ${day} de ${monthName} de ${year}`
            : `${dayName} ${monthName} ${day}, ${year}`;
    } catch { return dateStr; }
}

function typeColor(d) {
    if (d.is_disputed && d.label === 'Afirmacion') return { fill: '#C45D3E', stroke: '#8B3322' };
    // Event sub-type colors
    if (d.label === 'Evento' && d.event_type && EVENT_TYPE_COLORS[d.event_type]) {
        return EVENT_TYPE_COLORS[d.event_type];
    }
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
function themeVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function graphLabelColor(d) { return d.id === focalId ? themeVar('--graph-label-focal') : themeVar('--graph-label'); }

function nodeStrokeWidth(d) {
    if (d.id === focalId) return 3;
    if (d.label === 'Actor' || d.label === 'Evento') return 1.5;
    return 0;
}

function truncLabel(name) {
    if (!name || name.length <= MAX_LABEL_LEN) return name || '';
    return name.slice(0, MAX_LABEL_LEN - 1) + '…';
}

// For search results and breadcrumbs
function nodeDot(label, type) {
    const c = TYPE_COLORS[type] || LABEL_COLORS[label] || TYPE_COLORS.Object;
    return `<span class="node-dot" style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${c.fill};border:1.5px solid ${c.stroke === 'none' ? c.fill : c.stroke}"></span>`;
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
    // Init theme + i18n
    initTheme();
    setLang(detectLang());
    applyStaticI18n();

    const schemaRes = await fetch(`${API}/api/schema`);
    schemaData = await schemaRes.json();
    setSchemaData(schemaData);
    loadStats();
    setupSearch();
    setupSplitHandle();
    // Detail close button removed — sidebar-level control instead
    // Preload geo data for map backdrop
    await loadGeoData();
    // Landing: random focal
    await navigateTo(null);
}

function applyStaticI18n() {
    document.getElementById('searchInput').placeholder = t('search.placeholder');
    document.getElementById('detailEmptyMsg').textContent = t('detail.empty');
    document.getElementById('langToggle').textContent = currentLang.toUpperCase();
    // Toolbar
    document.getElementById('viewNodes').textContent = t('toolbar.nodes');
    document.getElementById('viewTitles').textContent = t('toolbar.titles');
    document.getElementById('degreeLabel').textContent = t('toolbar.degree');
    if (typeof feather !== 'undefined') feather.replace();
    // Tabs
    document.getElementById('tabFeed').textContent = t('tab.feed');
    document.getElementById('tabNode').textContent = t('tab.node');
    document.getElementById('tabSources').textContent = t('tab.sources');
    // Sources panel
    document.getElementById('sourcesFeedsTitle').textContent = t('sources.feeds');
    document.getElementById('sourcesTopicsTitle').textContent = t('sources.topics');
    document.getElementById('sourcesTopicsHint').textContent = t('sources.topicsHint');
    document.getElementById('addFeedLabel').textContent = t('sources.addFeed');
    document.getElementById('newFeedName').placeholder = t('sources.feedName');
    document.getElementById('newFeedUrl').placeholder = t('sources.feedUrl');
    document.getElementById('newFeedLang').placeholder = t('sources.feedLang');
    document.getElementById('newFeedRegion').placeholder = t('sources.feedRegion');
    document.getElementById('saveFeedLabel').textContent = t('sources.add');
    document.getElementById('cancelFeedLabel').textContent = t('sources.cancel');
    document.getElementById('topicInput').placeholder = t('sources.addTopic');
    // Feed
    document.getElementById('feedSortDate').textContent = t('feed.sort.date');
    document.getElementById('feedSortRelevance').textContent = t('feed.sort.relevance');
    document.getElementById('loadMoreBtn').textContent = t('feed.loadMore');
    // Dispute suffix
    document.getElementById('disputeSuffix').textContent = currentLang === 'es' ? 'sputa' : 'spute';
    // Process panel
    document.getElementById('processPanelTitle').textContent = t('process.title');
    document.getElementById('fetchRssLabel').textContent = t('process.fetch');
    document.getElementById('pruneBtnLabel').textContent = t('graph.prune');
    document.getElementById('consoleBtnLabel').textContent = t('process.console');
    // Console & tooltips
    document.getElementById('consoleTitle').textContent = t('console.title');
    document.getElementById('consoleToggleBtn').title = t('console.title');
    document.getElementById('themeToggle').title = t('theme.toggle');
}

function toggleLang() {
    setLang(currentLang === 'es' ? 'en' : 'es');
    applyStaticI18n();
    if (focalId) navigateTo(focalId);
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('os-theme', next);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.innerHTML = next === 'dark' ? '<i data-feather="sun"></i>' : '<i data-feather="moon"></i>';
    if (typeof feather !== 'undefined') feather.replace();
    if (focalId && lastEgoData) {
        if (currentView === 'titles') renderTitles(lastEgoData);
        else renderEgo(lastEgoData);
    }
}

function initTheme() {
    const saved = localStorage.getItem('os-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    const btn = document.getElementById('themeToggle');
    if (btn) btn.innerHTML = saved === 'dark' ? '<i data-feather="sun"></i>' : '<i data-feather="moon"></i>';
}

// --- Ego Navigation ---

async function setDegree(deg) {
    currentDegree = deg;
    document.querySelectorAll('.degree-btn').forEach(b => {
        b.classList.toggle('active', +b.dataset.deg === deg);
    });

    // If requesting higher degree than what we have, fetch more data
    if (focalId && lastEgoData && deg > 1) {
        const maxLoaded = Math.max(...lastEgoData.nodes.map(n => n._degree || 0));
        if (deg > maxLoaded) {
            const graphEl = document.getElementById('graph');
            graphEl.style.opacity = '0.4';
            graphEl.style.transition = 'opacity 0.15s';
            const res = await fetch(`${API}/api/ego?id=${encodeURIComponent(focalId)}&degree=${deg}`);
            const data = await res.json();
            graphEl.style.opacity = '1';
            if (data.focal) {
                lastEgoData = data;
                if (currentView === 'titles') renderTitles(data);
                else renderEgo(data);
                if (typeof Timeline !== 'undefined') Timeline.update(data);
                return;
            }
        }
    }

    if (lastEgoData) {
        if (currentView === 'titles') renderTitles(lastEgoData);
        else renderEgo(lastEgoData);
        if (typeof Timeline !== 'undefined') Timeline.update(lastEgoData);
    }
}

function applyDegreeFilter(deg) {
    applyVisibilityFilter();
}

/* Composed visibility filter: degree + timeline date range.
   In 'nodes' view, updates the force simulation so the layout reacts structurally.
   In 'titles'/'territory' views, uses opacity transitions. */
function applyVisibilityFilter() {
    if (!lastEgoData) return;

    const svgSel = d3.select('#graph');
    const allNodes = lastEgoData.nodes;

    // 1. Degree + date filter
    const dateFilter = (typeof Timeline !== 'undefined') ? Timeline.getVisibleDateIds() : null;
    let candidates = allNodes.filter(n => {
        if (n.id === focalId) return true;
        if ((n._degree || 0) > currentDegree) return false;
        if (dateFilter && n.label === 'Evento' && !dateFilter.has(n.id)) return false;
        return true;
    });

    // 2. Adaptive cap: limit nodes per degree level
    const NODE_CAP = { 1: 25, 2: 60, 3: Infinity };
    const cap = NODE_CAP[currentDegree] || 25;
    if (candidates.length > cap + 1) {
        const focal = candidates.filter(n => n.id === focalId);
        const rest = candidates.filter(n => n.id !== focalId)
            .sort((a, b) => (b._connectionCount || 0) - (a._connectionCount || 0))
            .slice(0, cap);
        candidates = [...focal, ...rest];
    }

    const visibleIds = new Set(candidates.map(n => n.id));

    if (currentView === 'nodes') {
        // Mark hidden state on each node for simulation forces
        allNodes.forEach(n => { n._hidden = !visibleIds.has(n.id); });

        // Update D3 selections: join with visibility
        svgSel.selectAll('.ego-node')
            .style('opacity', d => d._hidden ? 0 : (d._degree <= 1 ? 1 : 0.4))
            .style('pointer-events', d => d._hidden ? 'none' : 'all');

        svgSel.selectAll('.ego-edge')
            .style('opacity', d => {
                const sid = d.source?.id || d.source;
                const tid = d.target?.id || d.target;
                return visibleIds.has(sid) && visibleIds.has(tid) ? 0.6 : 0;
            });

        svgSel.selectAll('.ego-label')
            .style('opacity', d => {
                if (!visibleIds.has(d.id)) return 0;
                return d._degree <= 1 ? 1 : 0;
            });

        // Update simulation: hidden nodes get pushed far away with no forces
        if (simulation) {
            // Update link force to only act on visible edges
            const linkForce = simulation.force('link');
            if (linkForce) {
                linkForce.strength(d => {
                    const sid = d.source?.id || d.source;
                    const tid = d.target?.id || d.target;
                    if (!visibleIds.has(sid) || !visibleIds.has(tid)) return 0;
                    const base = d.type === 'CONTRADICE' ? 0.05 : d.type === 'SOSTIENE' ? 0.8 : 0.4;
                    return territoryEnabled ? base * 0.05 : base;
                });
            }

            // Reheat simulation so layout adjusts
            simulation.alpha(0.3).restart();
        }
    } else if (currentView === 'territory') {
        // Territory view: transition labels + dim zones
        if (nodeGroup) {
            nodeGroup.selectAll('g')
                .transition().duration(300)
                .attr('visibility', d => visibleIds.has(d.id) ? 'visible' : 'hidden')
                .style('opacity', d => visibleIds.has(d.id) ? 1 : 0);
        }
        // Dim arc connections
        d3.select('#graph').selectAll('.territory-arcs path')
            .transition().duration(300)
            .attr('opacity', d => {
                const sid = typeof d.source === 'object' ? d.source.id : d.source;
                const tid = typeof d.target === 'object' ? d.target.id : d.target;
                return visibleIds.has(sid) && visibleIds.has(tid) ? 0.3 : 0.02;
            });
    } else {
        // Titles view: mark hidden + update simulation structurally
        allNodes.forEach(n => { n._hidden = !visibleIds.has(n.id); });

        if (nodeGroup) {
            nodeGroup.selectAll('g')
                .style('visibility', d => visibleIds.has(d.id) ? 'visible' : 'hidden')
                .style('opacity', d => visibleIds.has(d.id) ? 1 : 0);
        }
        // Update link edges opacity
        if (linkGroup) {
            linkGroup.selectAll('g')
                .style('opacity', d => {
                    const sid = d.source?.id || d.source;
                    const tid = d.target?.id || d.target;
                    return visibleIds.has(sid) && visibleIds.has(tid) ? 1 : 0;
                });
        }

        // Update simulation forces for structural change
        if (simulation) {
            const linkForce = simulation.force('link');
            if (linkForce) {
                linkForce.strength(d => {
                    const sid = d.source?.id || d.source;
                    const tid = d.target?.id || d.target;
                    if (!visibleIds.has(sid) || !visibleIds.has(tid)) return 0;
                    return panoramaMode ? 0.5 : 0.25;
                });
            }
            simulation.alpha(0.3).restart();
        }
    }
}

async function navigateTo(id, resetBreadcrumb) {
    // Panorama mode: show recent events landscape
    if (id === null) {
        panoramaMode = true;
        focalId = null;
        focalIds = new Set();
        history = [];
        renderBreadcrumbs();
        const pRes = await fetch(`${API}/api/panorama?limit=10`);
        const pData = await pRes.json();
        if (!pData.nodes || !pData.nodes.length) return;
        focalIds = new Set(pData.focalIds || []);
        lastEgoData = pData;
        renderTitles(pData);
        return;
    }

    // Exit panorama/dispute on specific node navigation
    panoramaMode = false;
    focalIds = new Set();
    if (disputeMode) {
        disputeMode = false;
        document.getElementById('disputeSuffix').classList.remove('active');
    }

    // Immediate loading feedback
    const graphEl = document.getElementById('graph');
    graphEl.style.opacity = '0.4';
    graphEl.style.transition = 'opacity 0.15s';

    const previousFocalId = focalId;
    const base = `${API}/api/ego?id=${encodeURIComponent(id)}`;
    const url = `${base}&degree=1`;
    const res = await fetch(url);
    const data = await res.json();

    graphEl.style.opacity = '1';

    if (!data.focal) return;

    focalId = data.focal.id;
    lastEgoData = data;

    // Reset breadcrumb on double-click or search
    if (resetBreadcrumb) {
        history = [];
    }

    // Update breadcrumbs with edge label
    if (!history.length || history[history.length - 1].id !== focalId) {
        // If node already in history, truncate back to it (loop detection)
        const existingIdx = history.findIndex(h => h.id === focalId);
        if (existingIdx >= 0) {
            history = history.slice(0, existingIdx + 1);
        } else {
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
                    edgeLabel = tEdge(edge.type).toLowerCase();
                }
            }

            history.push({ id: focalId, name: displayName, edge: edgeLabel });
            if (history.length > 12) history.shift();
        }
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

async function renderEgo(data) {
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

    // Map backdrop — drawn after geoResolve if territory is enabled (to fit actual data bounds)

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

    // Geo-resolve for territorial gravity
    if (territoryEnabled && _geoCentroids) {
        geoResolve(nodes, edges);
        // Compute bounds from actual node geo positions to fit projection
        const geoNodes = nodes.filter(n => n._geo);
        let fitBounds = null;
        if (geoNodes.length > 1) {
            const lats = geoNodes.map(n => n._geo.lat);
            const lons = geoNodes.map(n => n._geo.lon);
            const pad = 10;
            fitBounds = {
                type: "Feature",
                geometry: {
                    type: "Polygon",
                    coordinates: [[
                        [Math.min(...lons) - pad, Math.min(...lats) - pad],
                        [Math.max(...lons) + pad, Math.min(...lats) - pad],
                        [Math.max(...lons) + pad, Math.max(...lats) + pad],
                        [Math.min(...lons) - pad, Math.max(...lats) + pad],
                        [Math.min(...lons) - pad, Math.min(...lats) - pad]
                    ]]
                }
            };
        }
        drawMapBackdrop(g, width, height, fitBounds);
    }

    // Pin focal to center (unless territory mode — let geo decide position)
    const focalNode = nodes.find(n => n.id === focalId);
    if (focalNode && !territoryEnabled) {
        focalNode.fx = cx;
        focalNode.fy = cy;
    }

    // --- Links (curved paths) ---
    linkGroup = g.append('g');
    const linkG = linkGroup.selectAll('g')
        .data(edges)
        .join('g')
        .attr('class', 'edge-group ego-edge');

    // Curved path
    const link = linkG.append('path')
        .attr('stroke', d => edgeVisual(d.type).color)
        .attr('stroke-width', d => edgeVisual(d.type).width)
        .attr('stroke-dasharray', d => edgeVisual(d.type).style === 'dashed' ? '6,3' : null)
        .attr('marker-end', d => `url(#arrow-${d.type})`)
        .attr('fill', 'none')
        .attr('opacity', d => {
            if (d.source === focalId || d.target === focalId ||
                d.source?.id === focalId || d.target?.id === focalId) return 0.4;
            return 0.08;
        });

    // Invisible fat path for hover
    const linkHit = linkG.append('path')
        .attr('stroke', 'transparent')
        .attr('stroke-width', 14)
        .attr('fill', 'none')
        .attr('cursor', 'pointer');

    // Edge label (visible on focal edges, shown on hover for others)
    const edgeLabel = linkG.append('text')
        .text(d => tEdge(d.type).toLowerCase())
        .attr('font-size', 10)
        .attr('font-family', 'var(--font-sans)')
        .attr('font-style', 'italic')
        .attr('fill', d => edgeVisual(d.type).color)
        .attr('text-anchor', 'middle')
        .attr('dy', -6)
        .attr('opacity', d => {
            const src = typeof d.source === 'object' ? d.source.id : d.source;
            const tgt = typeof d.target === 'object' ? d.target.id : d.target;
            return (src === focalId || tgt === focalId) ? 0.6 : 0;
        })
        .attr('pointer-events', 'none');

    // Hover on edges
    linkG.on('mouseenter', function (e, d) {
        d3.select(this).select('text').attr('opacity', 1);
        d3.select(this).select('path:first-child')
            .attr('stroke-width', edgeVisual(d.type).width + 2)
            .attr('opacity', 1);
    }).on('mouseleave', function (e, d) {
        const isFocal = (typeof d.source === 'object' ? d.source.id : d.source) === focalId ||
                         (typeof d.target === 'object' ? d.target.id : d.target) === focalId;
        d3.select(this).select('text').attr('opacity', isFocal ? 0.6 : 0);
        d3.select(this).select('path:first-child')
            .attr('stroke-width', edgeVisual(d.type).width)
            .attr('opacity', isFocal ? 0.4 : 0.08);
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
    const node = nodeGroup.selectAll('g')
        .data(nodes)
        .join('g')
        .attr('class', d => `ego-node degree-${d._degree || 0}`)
        .attr('cursor', d => d._degree <= currentDegree ? 'pointer' : 'default')
        .style('opacity', d => d._degree <= currentDegree ? 1 : 0)
        .style('pointer-events', d => d._degree <= currentDegree ? 'all' : 'none')
        .on('click', (e, d) => {
            e.stopPropagation();
            if (d.id === focalId) return;
            if (d.label === 'Actor' || d.label === 'Evento') {
                navigateTo(d.id);
            } else {
                showDetail(d);
            }
        })
        .on('dblclick', (e, d) => {
            e.stopPropagation();
            // Double-click: navigate with breadcrumb reset
            if (d.label === 'Actor' || d.label === 'Evento') {
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
        .attr('stroke', d => d.id === focalId ? themeVar('--graph-label-focal') : nodeStroke(d))
        .attr('stroke-width', d => nodeStrokeWidth(d))
        .attr('opacity', d => d._degree > currentDegree ? 0.15 : 1.0);

    // --- Label layer (separate group, always on top) ---
    const labelGroup = g.append('g');
    const labelNodes = nodes.filter(n => n._degree <= 1 && (n.label === 'Actor' || n.label === 'Evento'));

    // Wrap label text into lines of MAX_LABEL_LINE chars
    function wrapLines(text, maxLen) {
        if (!text) return [''];
        text = text.length > MAX_LABEL_LEN ? text.slice(0, MAX_LABEL_LEN - 1) + '\u2026' : text;
        text = text.toUpperCase();
        if (text.length <= maxLen) return [text];
        const words = text.split(/\s+/);
        const lines = [];
        let line = '';
        for (const w of words) {
            if (line && (line + ' ' + w).length > maxLen) {
                lines.push(line);
                line = w;
            } else {
                line = line ? line + ' ' + w : w;
            }
        }
        if (line) lines.push(line);
        return lines.length ? lines : [text];
    }

    const labels = labelGroup.selectAll('text')
        .data(labelNodes, d => d.id)
        .join('text')
        .attr('font-family', 'Alegreya Sans, system-ui, sans-serif')
        .attr('font-size', d => d.id === focalId ? 12 : 9)
        .attr('font-weight', d => d.id === focalId ? 700 : 500)
        .attr('fill', d => graphLabelColor(d))
        .attr('text-anchor', 'middle')
        .attr('pointer-events', 'none');

    labels.each(function(d) {
        const el = d3.select(this);
        const lines = wrapLines(d.name || d.id, MAX_LABEL_LINE);
        el.selectAll('tspan').remove();
        lines.forEach((line, i) => {
            el.append('tspan')
                .attr('x', 0)
                .attr('dy', i === 0 ? 0 : '1.15em')
                .text(line);
        });
        d._labelLines = lines.length;
    });

    // Tooltip for degree 2 (no permanent label)
    let tooltip = document.querySelector('.graph-tooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'graph-tooltip';
        container.appendChild(tooltip);
    }

    node.on('mouseenter', function (e, d) {
        const name = d.name || d.predicate || d.title || d.id;
        const desc = d.description ? `<span class="tooltip-desc">${d.description}</span>` : '';
        const dateStr = (d.label === 'Evento' && d.date && d.date !== 'null' && d.date !== '')
            ? `<span class="tooltip-date">${formatDate(d.date)}</span>` : '';
        tooltip.innerHTML = `<strong>${name}</strong>${dateStr}${desc ? '<br>' + desc : ''}`;
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
    .on('mousemove', function(e, d) {
        // Position tooltip centered above the node
        const containerRect = container.getBoundingClientRect();
        const svgEl = document.getElementById('graph');
        const pt = svgEl.createSVGPoint();
        pt.x = d.x; pt.y = d.y;
        const ctm = g.node().getCTM();
        if (ctm) {
            const screenPt = pt.matrixTransform(ctm);
            const nx = screenPt.x - containerRect.left;
            const ny = screenPt.y - containerRect.top;
            const r = nodeRadius(d);
            const tw = tooltip.offsetWidth || 120;
            tooltip.style.left = (nx - tw / 2) + 'px';
            tooltip.style.top = (ny - r * 2 - tooltip.offsetHeight - 8) + 'px';
        }
    })
    .on('mouseleave', () => {
        tooltip.classList.remove('visible');
        // Restore visibility based on current degree slider
        node.style('opacity', d => d._degree <= currentDegree ? 1 : 0)
            .style('pointer-events', d => d._degree <= currentDegree ? 'all' : 'none');
        linkG.each(function(d) {
            const src = typeof d.source === 'object' ? d.source.id : d.source;
            const tgt = typeof d.target === 'object' ? d.target.id : d.target;
            const isFocal = (src === focalId || tgt === focalId);
            d3.select(this).select('path:first-child').attr('opacity', isFocal ? 0.4 : 0.08);
            d3.select(this).select('text').attr('opacity', isFocal ? 0.6 : 0);
        });
        node.select('circle:not(.node-disputed-halo)')
            .attr('opacity', d => d._degree > currentDegree ? 0.15 : 1.0);
    });

    // --- Simulation ---
    const chargeMap = { Actor: -120, Evento: -300, Afirmacion: -80, Noticia: -40 };

    // In territory mode: pre-position nodes at geo coords, use minimal forces
    if (territoryEnabled && _mapProjection && _geoCentroids) {
        nodes.forEach(n => {
            if (!n._geo) return;
            const [px, py] = _mapProjection([n._geo.lon, n._geo.lat]);
            n.x = px;
            n.y = py;
        });
    }

    simulation = d3.forceSimulation(nodes)
        .velocityDecay(territoryEnabled ? 0.7 : 0.4)
        .force('link', d3.forceLink(edges)
            .id(d => d.id)
            .distance(d => (edgeVisual(d.type).force_distance || 100) * (territoryEnabled ? 1.5 : 1))
            .strength(d => {
                const base = d.type === 'CONTRADICE' ? 0.05 : d.type === 'SOSTIENE' ? 0.8 : 0.4;
                return territoryEnabled ? base * 0.05 : base;
            })
        )
        .force('charge', d3.forceManyBody()
            .strength(d => {
                if (d._hidden) return 0;
                if (territoryEnabled) return -5;
                if (d.id === focalId) return -500;
                return chargeMap[d.label] || -80;
            })
        )
        .force('contradict-repel', territoryEnabled ? null : (() => {
            edges.forEach(e => {
                if (e.type !== 'CONTRADICE') return;
                const s = typeof e.source === 'object' ? e.source : nodes.find(n => n.id === e.source);
                const t = typeof e.target === 'object' ? e.target : nodes.find(n => n.id === e.target);
                if (!s || !t || s._hidden || t._hidden) return;
                const dx = t.x - s.x, dy = t.y - s.y;
                const dist = Math.sqrt(dx * dx + dy * dy) || 1;
                const force = 5000 / (dist * dist);
                s.vx -= (dx / dist) * force;
                s.vy -= (dy / dist) * force;
                t.vx += (dx / dist) * force;
                t.vy += (dy / dist) * force;
            });
        }))
        .force('center', territoryEnabled ? null : d3.forceCenter(cx, cy).strength(0.02))
        .force('collapse-hidden', alpha => {
            // Pull hidden nodes toward focal center so they don't take layout space
            const focal = nodes.find(n => n.id === focalId);
            if (!focal) return;
            const fx = focal.x || cx, fy = focal.y || cy;
            nodes.forEach(n => {
                if (!n._hidden) return;
                n.vx += (fx - n.x) * 0.3;
                n.vy += (fy - n.y) * 0.3;
            });
        })
        .force('collision', d3.forceCollide().radius(d => d._hidden ? 0 : nodeRadius(d) + (territoryEnabled ? 12 : 4)))
        .force('geo-anchor', (territoryEnabled && _mapProjection && _geoCentroids) ? (alpha => {
            nodes.forEach(n => {
                if (!n._geo) return;
                const [tx, ty] = _mapProjection([n._geo.lon, n._geo.lat]);
                // Gentle pull back to geo position — nodes already pre-placed
                n.vx += (tx - n.x) * 0.15;
                n.vy += (ty - n.y) * 0.15;
            });
        }) : (alpha => {
            nodes.forEach(n => {
                if (n.id === focalId || n._degree > 1) return;
                const angle = TYPE_ANGLE[n.type] ?? 0;
                const targetX = cx + Math.cos(angle) * 120;
                const targetY = cy + Math.sin(angle) * 120;
                n.vx += (targetX - n.x) * alpha * 0.02;
                n.vy += (targetY - n.y) * alpha * 0.02;
            });
        }))
        .on('tick', () => {
            link.attr('d', linkPath);
            linkHit.attr('d', linkPath);
            edgeLabel
                .attr('x', d => (d.source.x + d.target.x) / 2)
                .attr('y', d => (d.source.y + d.target.y) / 2);
            node.attr('transform', d => `translate(${d.x},${d.y})`);
            labelGroup.selectAll('text')
                .attr('x', d => d.x)
                .attr('y', d => d.y + nodeRadius(d) + 13)
                .selectAll('tspan')
                .attr('x', function() { return d3.select(this.parentNode).attr('x'); });
        });

    // Auto-zoom to fit degree 1
    simulation.on('end', () => {
        autoZoom(nodes, zoomBehavior, width, height);
    });

    // Also after 2 seconds for fast stabilization
    currentSimulation = simulation;
    setTimeout(() => autoZoom(nodes, zoomBehavior, width, height), 2000);

    // Update timeline slider
    if (typeof Timeline !== 'undefined') Timeline.update(data);
}

function autoZoom(nodes, zoomBehavior, width, height) {
    const g1Nodes = nodes.filter(n => n._degree <= currentDegree);
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

// --- Dispute mode ---

async function toggleDispute() {
    disputeMode = !disputeMode;
    const suffix = document.getElementById('disputeSuffix');
    const plus = document.getElementById('disputeDot');
    suffix.classList.toggle('active', disputeMode);
    plus.classList.toggle('hidden', disputeMode);
    suffix.onclick = disputeMode ? () => toggleDispute() : null;

    if (disputeMode) {
        // Fetch dispute subgraph
        panoramaMode = true;
        focalId = null;
        history = [];
        renderBreadcrumbs();
        try {
            const res = await fetch(`${API}/api/disputes`);
            const data = await res.json();
            if (!data.nodes || !data.nodes.length) {
                disputeMode = false;
                suffix.classList.remove('active');
                plus.classList.remove('hidden');
                panoramaMode = false;
                return;
            }
            focalIds = new Set(data.focalIds || []);
            lastEgoData = data;
            renderTitles(data);
        } catch (e) {
            console.error('Dispute fetch failed:', e);
            disputeMode = false;
            suffix.classList.remove('active');
            plus.classList.remove('hidden');
            panoramaMode = false;
        }
    } else {
        // Return to panorama home
        panoramaMode = false;
        focalIds = new Set();
        navigateTo(null);
    }
}

// --- View switching ---

function toggleTerritory() {
    territoryEnabled = !territoryEnabled;
    document.getElementById('territoryToggle').classList.toggle('active', territoryEnabled);
    // Re-render to apply/remove geo forces and map
    if (lastEgoData) {
        if (currentView === 'titles') renderTitles(lastEgoData);
        else renderEgo(lastEgoData);
    }
}

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
    Person:       { transform: 'none', fontWeight: 400, fontStyle: 'normal',  fontSize: 14, font: 'serif' },
    Location:     { transform: 'uppercase', fontWeight: 500, fontStyle: 'normal',  fontSize: 12, font: 'sans', letterSpacing: '.2ex' },
    Organization: { transform: 'none', fontWeight: 400, fontStyle: 'normal',  fontSize: 12, font: 'sans' },
    Object:       { transform: 'none', fontWeight: 400, fontStyle: 'italic',  fontSize: 12, font: 'sans' },
    Event:        { transform: 'none', fontWeight: 400, fontStyle: 'normal',  fontSize: 14, font: 'serif' }
};

async function renderTitles(data) {
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
    // Map backdrop inside g
    if (territoryEnabled) drawMapBackdrop(g, width, height);
    let _zoomK = 1;
    svg.call(d3.zoom().scaleExtent([0.3, 6]).on('zoom', e => {
        g.attr('transform', e.transform);
        _zoomK = e.transform.k;
    }));

    let nodes = data.nodes;
    let edges = data.edges;

    // Connection counts
    const connCount = {};
    edges.forEach(e => {
        connCount[e.source] = (connCount[e.source] || 0) + 1;
        connCount[e.target] = (connCount[e.target] || 0) + 1;
    });
    nodes.forEach(n => { n._connectionCount = connCount[n.id] || 0; });

    // Geo-resolve nodes for territorial positioning
    if (territoryEnabled && _geoCentroids) geoResolve(nodes, edges);

    // Show nodes up to current degree + date filter + adaptive cap
    const dateFilter = (typeof Timeline !== 'undefined') ? Timeline.getVisibleDateIds() : null;
    const NODE_CAP = { 1: 25, 2: 60, 3: Infinity };
    const cap = NODE_CAP[currentDegree] || 25;

    // Filter by degree and date first
    let candidates = nodes.filter(n => {
        if (n.id === focalId) return true;
        if (n._degree > currentDegree) return false;
        if (dateFilter && n.label === 'Evento' && n.date && n.date !== 'null' && !dateFilter.has(n.id)) return false;
        return true;
    });

    // If over cap, keep focal + top N by connection count
    if (candidates.length > cap + 1) {
        const focal = candidates.filter(n => n.id === focalId);
        const rest = candidates.filter(n => n.id !== focalId)
            .sort((a, b) => (b._connectionCount || 0) - (a._connectionCount || 0))
            .slice(0, cap);
        candidates = [...focal, ...rest];
    }
    const visibleNodes = candidates;
    const visibleIds = new Set(visibleNodes.map(n => n.id));

    // Filter edges to only those connecting visible nodes
    const visibleEdges = edges.filter(e => {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        return visibleIds.has(s) && visibleIds.has(t);
    });

    // Use filtered sets for simulation
    nodes = visibleNodes;
    edges = visibleEdges;

    // Pin focal (skip in panorama — all nodes float free)
    const isFocal = panoramaMode ? (id => focalIds.has(id)) : (id => id === focalId);
    if (!panoramaMode) {
        const focalNode = nodes.find(n => n.id === focalId);
        if (focalNode) { focalNode.fx = cx; focalNode.fy = cy; }
    }

    // --- Links with edge labels ---
    linkGroup = g.append('g');
    const linkG_t = linkGroup.selectAll('g')
        .data(edges)
        .join('g');

    const link = linkG_t.append('path')
        .attr('stroke', d => edgeVisual(d.type).color)
        .attr('stroke-width', d => Math.max(edgeVisual(d.type).width * 0.7, 0.5))
        .attr('stroke-dasharray', d => edgeVisual(d.type).style === 'dashed' ? '4,3' : null)
        .attr('marker-end', d => `url(#arrow-t-${d.type})`)
        .attr('fill', 'none')
        .attr('opacity', d => {
            const s = typeof d.source === 'object' ? d.source.id : d.source;
            const t = typeof d.target === 'object' ? d.target.id : d.target;
            return (isFocal(s) || isFocal(t)) ? 0.35 : 0.08;
        });

    // Edge labels for focal edges
    const edgeLabel_t = linkG_t.append('text')
        .text(d => tEdge(d.type).toLowerCase())
        .attr('font-size', 9)
        .attr('font-family', 'var(--font-sans)')
        .attr('font-style', 'italic')
        .attr('fill', d => edgeVisual(d.type).color)
        .attr('text-anchor', 'middle')
        .attr('dy', -4)
        .attr('opacity', d => {
            const s = typeof d.source === 'object' ? d.source.id : d.source;
            const t = typeof d.target === 'object' ? d.target.id : d.target;
            return (isFocal(s) || isFocal(t)) ? 0.5 : 0;
        })
        .attr('pointer-events', 'none');

    // --- Layers: bg (diffuse backdrops) then text nodes ---
    const bgGroup = g.append('g').attr('class', 'title-bg-layer');
    nodeGroup = g.append('g');
    const node = nodeGroup.selectAll('g')
        .data(nodes)
        .join('g')
        .attr('cursor', d => d._degree <= currentDegree ? 'pointer' : 'default')
        .attr('visibility', d => d._degree <= currentDegree ? 'visible' : 'hidden')
        .on('click', (e, d) => {
            e.stopPropagation();
            if (!panoramaMode && d.id === focalId) return;
            if (d.label === 'Actor' || d.label === 'Evento') {
                navigateTo(d.id);
            } else {
                showDetail(d);
            }
        })
        .on('dblclick', (e, d) => {
            e.stopPropagation();
            if (d.label === 'Actor' || d.label === 'Evento') navigateTo(d.id, true);
        })
        .call(makeDrag());

    // Max width for text wrapping (pixels)
    const MAX_TEXT_WIDTH = 336;

    // Helper: wrap text into lines
    function wrapText(text, maxWidth, fontSize) {
        const words = text.split(/\s+/);
        const lines = [];
        let currentLine = words[0] || '';
        const charWidth = fontSize * 0.55; // approximate
        for (let i = 1; i < words.length; i++) {
            const test = currentLine + ' ' + words[i];
            if (test.length * charWidth > maxWidth) {
                lines.push(currentLine);
                currentLine = words[i];
            } else {
                currentLine = test;
            }
        }
        lines.push(currentLine);
        return lines;
    }

    // Text element as the "node" with multi-line wrapping
    const textEl = node.append('text')
        .attr('font-size', d => {
            const style = TITLE_STYLE[d.type] || TITLE_STYLE.Object;
            const base = style.fontSize;
            if (isFocal(d.id)) return base + 6;
            return base + Math.min(d._connectionCount * 0.3, 4);
        })
        .attr('font-weight', d => {
            // In panorama, bold actors connected to 2+ events (bridge nodes)
            if (panoramaMode && d.label === 'Actor' && d._connectionCount >= 2) return 700;
            return (TITLE_STYLE[d.type] || TITLE_STYLE.Object).fontWeight;
        })
        .attr('font-style', d => (TITLE_STYLE[d.type] || TITLE_STYLE.Object).fontStyle)
        .attr('font-family', d => {
            const style = TITLE_STYLE[d.type] || TITLE_STYLE.Object;
            return style.font === 'serif' ? 'Alegreya, Georgia, serif' : 'Alegreya Sans, system-ui, sans-serif';
        })
        .attr('letter-spacing', d => (TITLE_STYLE[d.type] || TITLE_STYLE.Object).letterSpacing || null)
        .attr('fill', d => {
            if (isFocal(d.id)) return themeVar('--graph-label-focal');
            return nodeColor(d);
        })
        .attr('text-anchor', 'start')
        .attr('dominant-baseline', 'central')
        .attr('opacity', d => d._degree === 2 ? 0.15 : (isFocal(d.id) ? 1 : 0.85));

    // Add multi-line tspan wrapping
    textEl.each(function(d) {
        const el = d3.select(this);
        const name = d.name || d.predicate || d.title || d.id;
        const style = TITLE_STYLE[d.type] || TITLE_STYLE.Object;
        let displayName = name;
        if (style.transform === 'uppercase') displayName = name.toUpperCase();
        else if (style.transform === 'lowercase') displayName = name.toLowerCase();

        const fontSize = parseFloat(el.attr('font-size'));
        const maxW = MAX_TEXT_WIDTH;
        const lines = wrapText(displayName, maxW, fontSize);
        const lineH = fontSize * 1.16;
        const startY = -(lines.length - 1) * lineH / 2;

        el.selectAll('tspan').remove();
        lines.forEach((line, i) => {
            el.append('tspan')
                .attr('x', 0)
                .attr('dy', i === 0 ? startY : lineH)
                .text(line);
        });
    });

    // Measure bounding boxes for collision + create diffuse backgrounds
    node.each(function(d) {
        const bbox = this.querySelector('text')?.getBBox();
        if (bbox) {
            d._w = bbox.width + 16;
            d._h = bbox.height + 8;
            d._bboxW = bbox.width;
            d._bboxH = bbox.height;
            // All text is left-aligned, so collision center is offset to the right
            d._bboxOffsetX = bbox.width / 2;
        } else {
            d._w = 80;
            d._h = 18;
            d._bboxW = 64;
            d._bboxH = 14;
            d._bboxOffsetX = 32;
        }
    });

    // SVG filter for diffuse blur
    const titleDefs = svg.select('defs').empty() ? svg.append('defs') : svg.select('defs');
    if (titleDefs.select('#title-blur').empty()) {
        const filter = titleDefs.append('filter').attr('id', 'title-blur')
            .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%');
        filter.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '8');
    }

    // Diffuse background rects
    const bgTheme = themeVar('--bg-app');
    bgGroup.selectAll('rect')
        .data(nodes.filter(n => n._degree <= currentDegree))
        .join('rect')
        .attr('rx', 3).attr('ry', 3)
        .attr('fill', bgTheme)
        .attr('opacity', 0.8)
        .attr('filter', 'url(#title-blur)')
        .attr('width', d => (d._bboxW || 48) + 24)
        .attr('height', d => (d._bboxH || 14) + 16)
        .attr('pointer-events', 'none');

    // Tooltip — shows date for events, positioned top-left of the text box
    let tooltip_t = document.querySelector('.graph-tooltip');
    if (!tooltip_t) {
        tooltip_t = document.createElement('div');
        tooltip_t.className = 'graph-tooltip';
        container.appendChild(tooltip_t);
    }

    node.on('mouseenter', function(e, d) {
        // Build tooltip content: date for events, description if available
        const hasDate = d.label === 'Evento' && d.date && d.date !== 'null' && d.date !== '';
        const hasDesc = d.description && d.description.length > 0;
        if (hasDate || hasDesc) {
            let html = '';
            if (hasDate) html += `<span class="tooltip-date" style="margin-left:0">${formatDate(d.date)}</span>`;
            if (hasDesc) html += `${hasDate ? '<br>' : ''}<span class="tooltip-desc">${d.description}</span>`;
            tooltip_t.innerHTML = html;
            tooltip_t.classList.add('visible');

            // Position just above the text
            const containerRect = container.getBoundingClientRect();
            const svgEl = document.getElementById('graph');
            const pt = svgEl.createSVGPoint();
            pt.x = d.x; pt.y = d.y;
            const ctm = g.node().getCTM();
            if (ctm) {
                const sp = pt.matrixTransform(ctm);
                tooltip_t.style.left = (sp.x - containerRect.left) + 'px';
                tooltip_t.style.top = (sp.y - containerRect.top - tooltip_t.offsetHeight - 2) + 'px';
            }
        }

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
        // Show edge labels for hovered node's connections
        edgeLabel_t.attr('opacity', l => {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            return (s === d.id || t === d.id) ? 0.7 : 0;
        });
    })
    .on('mouseleave', () => {
        tooltip_t.classList.remove('visible');
        textEl.attr('opacity', d => d._degree === 2 ? 0.15 : (d.id === focalId ? 1 : 0.85));
        link.attr('opacity', d => {
            const s = typeof d.source === 'object' ? d.source.id : d.source;
            const t = typeof d.target === 'object' ? d.target.id : d.target;
            return (s === focalId || t === focalId) ? 0.35 : 0.08;
        });
        edgeLabel_t.attr('opacity', d => {
            const s = typeof d.source === 'object' ? d.source.id : d.source;
            const t = typeof d.target === 'object' ? d.target.id : d.target;
            return (s === focalId || t === focalId) ? 0.5 : 0;
        });
    });

    // Rectangular collision force (accounts for text-anchor offset)
    const COLLISION_PADDING = 18; // extra px between labels — legibility first
    function forceRectCollide() {
        let nds;
        function force(alpha) {
            // Run 3 iterations per tick for better convergence
            for (let iter = 0; iter < 3; iter++) {
            for (let i = 0; i < nds.length; i++) {
                for (let j = i + 1; j < nds.length; j++) {
                    const a = nds[i], b = nds[j];
                    if (a._degree > currentDegree || b._degree > currentDegree) continue;
                    // Effective center accounts for left-aligned text offset
                    const ax = a.x + (a._bboxOffsetX || 0);
                    const bx = b.x + (b._bboxOffsetX || 0);
                    const dx = bx - ax, dy = b.y - a.y;
                    const minDistX = (a._w + b._w) / 2 + COLLISION_PADDING;
                    const minDistY = (a._h + b._h) / 2 + COLLISION_PADDING;
                    const overlapX = minDistX - Math.abs(dx);
                    const overlapY = minDistY - Math.abs(dy);
                    if (overlapX > 0 && overlapY > 0) {
                        // Stronger push: use max(alpha, 0.3) to keep resolving even late
                        const push = Math.max(alpha, 0.3) * 0.8;
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
            } // end iter loop
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

    // Track play state for opacity reset
    let _wasPlaying = false;

    // Panorama: arrange focal events in a circle, actors pulled toward their events
    const panoramaRadius = panoramaMode ? Math.min(width, height) * 0.38 : 0;

    // Simulation — slower alpha decay for better collision resolution
    simulation = d3.forceSimulation(nodes)
        .alphaDecay(0.02)
        .velocityDecay(0.55)
        .force('link', d3.forceLink(edges).id(d => d.id)
            .distance(d => (edgeVisual(d.type).force_distance || 100) * (panoramaMode ? 0.6 : 1.4))
            .strength(panoramaMode ? 0.4 : 0.25))
        .force('charge', d3.forceManyBody().strength(d => d._hidden ? 0 : (panoramaMode ? -60 : -120)))
        .force('center', (territoryEnabled ? null : d3.forceCenter(cx, cy).strength(panoramaMode ? 0.03 : 0.01)))
        .force('collapse-hidden', alpha => {
            nodes.forEach(n => {
                if (!n._hidden) return;
                n.vx += (cx - n.x) * 0.3;
                n.vy += (cy - n.y) * 0.3;
            });
        })
        .force('rectCollide', forceRectCollide())
        .force('panorama-circle', panoramaMode ? (alpha => {
            // Focal events arranged on a circle
            const focalArr = nodes.filter(n => focalIds.has(n.id));
            const nFocal = focalArr.length || 1;
            let i = 0;
            for (const n of focalArr) {
                const angle = (2 * Math.PI * i) / nFocal - Math.PI / 2;
                const tx = cx + Math.cos(angle) * panoramaRadius;
                const ty = cy + Math.sin(angle) * panoramaRadius;
                const s = 0.12 + 0.2 * alpha;
                n.vx += (tx - n.x) * s;
                n.vy += (ty - n.y) * s;
                i++;
            }
            // Non-focal (actors) pulled toward the circle perimeter near their linked events
            for (const n of nodes) {
                if (focalIds.has(n.id)) continue;
                const s = 0.04 * alpha;
                n.vx += (cx - n.x) * s;
                n.vy += (cy - n.y) * s;
            }
        }) : null)
        .force('geo-anchor', (territoryEnabled && _mapProjection && _geoCentroids) ? (alpha => {
            nodes.forEach(n => {
                if (!n._geo) return;
                const [tx, ty] = _mapProjection([n._geo.lon, n._geo.lat]);
                const strength = 0.08 + 0.15 * alpha;
                n.vx += (tx - n.x) * strength;
                n.vy += (ty - n.y) * strength;
            });
        }) : panoramaMode ? null : (alpha => {
            nodes.forEach(n => {
                if (n.id === focalId || n._degree > 1) return;
                const angle = TYPE_ANGLE[n.type] ?? 0;
                const r = 140;
                n.vx += (cx + Math.cos(angle) * r - n.x) * alpha * 0.015;
                n.vy += (cy + Math.sin(angle) * r - n.y) * alpha * 0.015;
            });
        }))
        .on('tick', () => {
            link.attr('d', titleLinkPath);
            edgeLabel_t
                .attr('x', d => (d.source.x + d.target.x) / 2)
                .attr('y', d => (d.source.y + d.target.y) / 2)
                .attr('font-size', 9 / _zoomK);
            // Semantic zoom: text stays same screen size regardless of map zoom
            node.attr('transform', d => `translate(${d.x},${d.y}) scale(${1/_zoomK})`);
            bgGroup.selectAll('rect')
                .attr('x', d => d.x - 12 / _zoomK)
                .attr('y', d => d.y - ((d._bboxH || 14) + 16) / (2 * _zoomK))
                .attr('width', d => ((d._bboxW || 48) + 24) / _zoomK)
                .attr('height', d => ((d._bboxH || 14) + 16) / _zoomK);

            // Age-based fade: event titles decay over 1 week during play
            if (typeof Timeline !== 'undefined' && Timeline.isPlaying()) {
                const playhead = Timeline.getPlayheadTime();
                if (playhead) {
                    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
                    const playMs = playhead.getTime();
                    textEl.style('transition', 'opacity 0.3s ease')
                        .attr('opacity', d => {
                        // Only fade event titles
                        if (d.label !== 'Evento' || !d.date || d.date === 'null')
                            return d._degree === 2 ? 0.15 : (isFocal(d.id) ? 1 : 0.85);
                        let dMs;
                        try { dMs = new Date(d.date).getTime(); } catch { return 0.85; }
                        if (isNaN(dMs) || dMs > playMs) return 0;
                        const age = playMs - dMs;
                        if (age <= 0) return 1;
                        if (age >= WEEK_MS) return 0.06;
                        return 1 - (age / WEEK_MS) * 0.94;
                    });
                }
                _wasPlaying = true;
            } else if (_wasPlaying) {
                // Restore all opacities when play stops
                textEl.style('transition', null)
                    .attr('opacity', d => d._degree === 2 ? 0.15 : (isFocal(d.id) ? 1 : 0.85));
                _wasPlaying = false;
            }
        });

    // Only auto-zoom when there's no geo-anchor (map IS the frame when geo is active)
    if (!territoryEnabled || !_mapProjection || !_geoCentroids) {
        setTimeout(() => autoZoom(nodes, d3.zoom().scaleExtent([0.3, 4]).on('zoom', e => g.attr('transform', e.transform)), width, height), 2000);
    }

    // Update timeline slider
    if (typeof Timeline !== 'undefined') Timeline.update(data);
}

// --- Persistent Map Backdrop ---

let _geoCentroids = null;
let _worldTopo = null;
let _mapProjection = null;

async function loadGeoData() {
    if (!_geoCentroids) {
        const r = await fetch(`${API}/data/geo-centroids.json`);
        _geoCentroids = await r.json();
    }
    if (!_worldTopo) {
        const r = await fetch(`${API}/data/world-110m.json`);
        _worldTopo = await r.json();
    }
}

// Renders a world map as the bottom layer inside a given <g> group.
// Called after g is created, inserts backdrop as first child.
// Europe + Mediterranean + Middle East: zoomed-in geopolitical center
const EUROPE_BOUNDS = {
    type: "Feature",
    geometry: {
        type: "Polygon",
        coordinates: [[[-12, 28], [55, 28], [55, 68], [-12, 68], [-12, 28]]]
    }
};

function drawMapBackdrop(gEl, width, height, fitBounds) {
    if (!_worldTopo) return;

    const worldGeo = topojson.feature(_worldTopo, _worldTopo.objects.countries);
    const projection = d3.geoNaturalEarth1()
        .fitSize([width, height], fitBounds || EUROPE_BOUNDS);
    _mapProjection = projection;
    const pathGen = d3.geoPath(projection);

    // Insert as FIRST child of g so everything draws on top
    const backdrop = gEl.insert('g', ':first-child').attr('class', 'map-backdrop');

    const isDark = !document.documentElement.getAttribute('data-theme') || document.documentElement.getAttribute('data-theme') === 'dark';
    const fillColor = isDark ? '#1e2230' : '#e0dcd4';
    const strokeColor = isDark ? '#2a3040' : '#c8c0b4';

    backdrop.selectAll('path')
        .data(worldGeo.features)
        .join('path')
        .attr('d', pathGen)
        .attr('fill', fillColor)
        .attr('stroke', strokeColor)
        .attr('stroke-width', 0.5)
        .attr('opacity', 1);

    return projection;
}

// Renders a mini-map in the detail panel showing the node's location
function renderMiniMap(containerId, nodeData) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    if (!nodeData?._geo || !_worldTopo || !_geoCentroids) {
        container.style.display = 'none';
        return;
    }
    container.style.display = 'block';

    const w = container.clientWidth || 280;
    const h = 140;
    const miniSvg = d3.select(container).append('svg')
        .attr('width', w).attr('height', h)
        .style('border-radius', '6px')
        .style('background', themeVar('--bg-surface-alt'));

    const worldGeo = topojson.feature(_worldTopo, _worldTopo.objects.countries);
    const proj = d3.geoNaturalEarth1()
        .fitSize([w * 0.92, h * 0.85], worldGeo)
        .translate([w / 2, h / 2]);
    const pathGen = d3.geoPath(proj);

    const isDark = !document.documentElement.getAttribute('data-theme') || document.documentElement.getAttribute('data-theme') === 'dark';
    miniSvg.selectAll('path')
        .data(worldGeo.features)
        .join('path')
        .attr('d', pathGen)
        .attr('fill', isDark ? '#1e2230' : '#e0dcd4')
        .attr('stroke', isDark ? '#2a3040' : '#c8c0b4')
        .attr('stroke-width', 0.5);

    // Node position
    const [px, py] = proj([nodeData._geo.lon, nodeData._geo.lat]);
    const color = nodeColor(nodeData);

    // Diffuse glow
    const defs = miniSvg.append('defs');
    const grad = defs.append('radialGradient').attr('id', 'mini-glow');
    grad.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.4);
    grad.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0);
    miniSvg.append('circle').attr('cx', px).attr('cy', py).attr('r', 20)
        .attr('fill', 'url(#mini-glow)');
    // Pin dot
    miniSvg.append('circle').attr('cx', px).attr('cy', py).attr('r', 3)
        .attr('fill', color).attr('stroke', themeVar('--bg-surface')).attr('stroke-width', 1);
}

function geoResolve(nodes, edges) {
    const nameIndex = _geoCentroids.$nameIndex || {};

    // Try to resolve a single node by ID, name, or name fragments
    function lookupCentroid(n) {
        // 1. Direct ID match
        if (_geoCentroids[n.id]) return _geoCentroids[n.id];
        // 2. Name index (exact match, lowercase)
        const nameLower = (n.name || '').toLowerCase();
        if (nameIndex[nameLower]) return _geoCentroids[nameIndex[nameLower]];
        // 3. ID-based fuzzy: strip common prefixes/suffixes
        const idClean = n.id.replace(/^(el-|la-|los-|las-|the-)/, '');
        if (_geoCentroids[idClean]) return _geoCentroids[idClean];
        // 4. Search name index keys as substrings within node name
        for (const [alias, centroidId] of Object.entries(nameIndex)) {
            if (alias.length >= 4 && nameLower.includes(alias)) return _geoCentroids[centroidId];
        }
        // 5. Search centroid keys as substrings within node ID
        for (const key of Object.keys(_geoCentroids)) {
            if (key.startsWith('$')) continue;
            if (key.length >= 4 && n.id.includes(key)) return _geoCentroids[key];
        }
        return null;
    }

    // Build adjacency for UBICADO_EN and PERTENECE_A
    const locOf = {};
    edges.forEach(e => {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        if (e.type === 'UBICADO_EN' || e.type === 'PERTENECE_A') {
            if (!locOf[s]) locOf[s] = [];
            locOf[s].push(t);
        }
    });

    const nodeMap = {};
    nodes.forEach(n => { nodeMap[n.id] = n; });

    // Phase 1: Direct lookup for each node
    nodes.forEach(n => { n._geo = lookupCentroid(n); });

    // Phase 2: Walk UBICADO_EN / PERTENECE_A edges
    nodes.forEach(n => {
        if (n._geo) return;
        const targets = locOf[n.id] || [];
        for (const tid of targets) {
            const target = nodeMap[tid];
            if (target?._geo) { n._geo = target._geo; return; }
            // Try resolving the target directly
            const geo = lookupCentroid(target || { id: tid, name: tid });
            if (geo) { n._geo = geo; return; }
        }
    });

    // Phase 3: Events inherit from their PARTICIPA actors
    edges.forEach(e => {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        if (e.type === 'PARTICIPA') {
            const actor = nodeMap[s];
            const evento = nodeMap[t];
            if (actor?._geo && evento && !evento._geo) {
                evento._geo = actor._geo;
            }
        }
    });

    // Phase 4: Remaining events — try name-based geo from event name itself
    nodes.forEach(n => {
        if (n._geo || n.label !== 'Evento') return;
        n._geo = lookupCentroid(n);
    });

    // Phase 5: Propagate — anyone connected to someone who knows, learns.
    // "Las cosas no saben, pero alguien sí sabe"
    // Repeat until no more changes.
    let changed = true;
    let passes = 0;
    while (changed && passes < 5) {
        changed = false;
        passes++;
        edges.forEach(e => {
            const s = typeof e.source === 'object' ? e.source.id : e.source;
            const t = typeof e.target === 'object' ? e.target.id : e.target;
            const sn = nodeMap[s], tn = nodeMap[t];
            if (sn?._geo && tn && !tn._geo) { tn._geo = sn._geo; changed = true; }
            if (tn?._geo && sn && !sn._geo) { sn._geo = tn._geo; changed = true; }
        });
    }

    // Phase 6: Fallback — every node MUST have a geographic position.
    // Unresolved nodes get placed near Europe center with slight jitter to avoid stacking.
    const FALLBACK_CENTER = { lat: 48.5, lon: 10.0 }; // Central Europe
    nodes.forEach(n => {
        if (n._geo) return;
        n._geo = {
            lat: FALLBACK_CENTER.lat + (Math.random() - 0.5) * 6,
            lon: FALLBACK_CENTER.lon + (Math.random() - 0.5) * 8
        };
    });
}

async function renderTerritory(data) {
    await loadGeoData();

    const container = document.getElementById('graphPanel');
    const width = container.clientWidth;
    const height = container.clientHeight;

    if (simulation) simulation.stop();
    d3.select('#graph').selectAll('*').remove();

    svg = d3.select('#graph').attr('width', width).attr('height', height);
    const defs = svg.append('defs');

    // Blur filter for diffuse zones
    const blurFilter = defs.append('filter').attr('id', 'geo-blur')
        .attr('x', '-80%').attr('y', '-80%').attr('width', '260%').attr('height', '260%');
    blurFilter.append('feGaussianBlur').attr('in', 'SourceGraphic').attr('stdDeviation', '18');

    // Arrow defs for edges
    const edgeTypes = schemaData?.graph?.edges || {};
    Object.keys(edgeTypes).forEach(type => {
        const v = edgeVisual(type);
        defs.append('marker')
            .attr('id', `arrow-ter-${type}`)
            .attr('viewBox', '0 0 10 10')
            .attr('refX', 10).attr('refY', 5)
            .attr('markerWidth', 5).attr('markerHeight', 5)
            .attr('orient', 'auto')
            .append('path')
            .attr('d', 'M 0 0 L 10 5 L 0 10 Z')
            .attr('fill', v.color);
    });

    g = svg.append('g');
    const zoomBehavior = d3.zoom().scaleExtent([0.3, 6]).on('zoom', e => g.attr('transform', e.transform));
    svg.call(zoomBehavior);

    // Projection — Europe-focused
    const worldGeo = topojson.feature(_worldTopo, _worldTopo.objects.countries);
    const projection = d3.geoNaturalEarth1()
        .fitSize([width, height], EUROPE_BOUNDS);
    const path = d3.geoPath(projection);

    const nodes = data.nodes;
    const edges = data.edges;

    // Connection counts
    const connCount = {};
    edges.forEach(e => {
        const s = typeof e.source === 'object' ? e.source.id : e.source;
        const t = typeof e.target === 'object' ? e.target.id : e.target;
        connCount[s] = (connCount[s] || 0) + 1;
        connCount[t] = (connCount[t] || 0) + 1;
    });
    nodes.forEach(n => { n._connectionCount = connCount[n.id] || 0; });

    // Geo-resolve all nodes
    geoResolve(nodes, edges);

    // --- Layer 1: Coastlines ---
    const coastLayer = g.append('g').attr('class', 'territory-coast');
    const landColor = themeVar('--ink-faint') || '#6b7385';
    coastLayer.selectAll('path')
        .data(worldGeo.features)
        .join('path')
        .attr('d', path)
        .attr('fill', 'none')
        .attr('stroke', landColor)
        .attr('stroke-width', 0.4)
        .attr('opacity', 0.25);

    // --- Layer 2: Diffuse territorial zones ---
    // Count events per location
    const locationEventCount = {};
    nodes.forEach(n => {
        if (n._geo && n.label === 'Evento') {
            const key = `${n._geo.lat},${n._geo.lon}`;
            locationEventCount[key] = (locationEventCount[key] || 0) + 1;
        }
    });
    // Also count actors as activity
    nodes.forEach(n => {
        if (n._geo && n.label === 'Actor') {
            const key = `${n._geo.lat},${n._geo.lon}`;
            locationEventCount[key] = (locationEventCount[key] || 0) + 0.3;
        }
    });

    // Get unique geo positions for zones
    const zoneMap = {};
    nodes.forEach(n => {
        if (!n._geo) return;
        const key = `${n._geo.lat},${n._geo.lon}`;
        if (!zoneMap[key]) {
            const [px, py] = projection([n._geo.lon, n._geo.lat]);
            zoneMap[key] = { x: px, y: py, count: locationEventCount[key] || 1, lat: n._geo.lat, lon: n._geo.lon };
        }
    });

    const zoneData = Object.values(zoneMap);
    const zoneLayer = g.append('g').attr('class', 'territory-zones');

    // Create radial gradients per zone
    zoneData.forEach((z, i) => {
        const grad = defs.append('radialGradient')
            .attr('id', `zone-grad-${i}`)
            .attr('cx', '50%').attr('cy', '50%').attr('r', '50%');
        grad.append('stop').attr('offset', '0%')
            .attr('stop-color', TYPE_COLORS.Location.fill)
            .attr('stop-opacity', 0.3);
        grad.append('stop').attr('offset', '60%')
            .attr('stop-color', TYPE_COLORS.Location.fill)
            .attr('stop-opacity', 0.1);
        grad.append('stop').attr('offset', '100%')
            .attr('stop-color', TYPE_COLORS.Location.fill)
            .attr('stop-opacity', 0);
    });

    zoneLayer.selectAll('ellipse')
        .data(zoneData)
        .join('ellipse')
        .attr('cx', d => d.x)
        .attr('cy', d => d.y)
        .attr('rx', d => Math.max(Math.sqrt(d.count) * 35, 25))
        .attr('ry', d => Math.max(Math.sqrt(d.count) * 25, 18))
        .attr('fill', (d, i) => `url(#zone-grad-${i})`)
        .attr('filter', 'url(#geo-blur)')
        .attr('class', 'territory-zone');

    // --- Layer 3: Connection arcs ---
    const arcLayer = g.append('g').attr('class', 'territory-arcs');
    const isFocal = panoramaMode ? (id => focalIds.has(id)) : (id => id === focalId);

    const geoEdges = edges.filter(e => {
        const s = typeof e.source === 'object' ? e.source : nodes.find(n => n.id === e.source);
        const t = typeof e.target === 'object' ? e.target : nodes.find(n => n.id === e.target);
        return s?._geo && t?._geo;
    });

    arcLayer.selectAll('path')
        .data(geoEdges)
        .join('path')
        .attr('d', e => {
            const s = typeof e.source === 'object' ? e.source : nodes.find(n => n.id === e.source);
            const t = typeof e.target === 'object' ? e.target : nodes.find(n => n.id === e.target);
            // Great circle arc
            const line = { type: 'LineString', coordinates: [[s._geo.lon, s._geo.lat], [t._geo.lon, t._geo.lat]] };
            return path(line);
        })
        .attr('fill', 'none')
        .attr('stroke', e => edgeVisual(e.type).color)
        .attr('stroke-width', e => Math.max(edgeVisual(e.type).width * 0.6, 0.5))
        .attr('stroke-dasharray', e => edgeVisual(e.type).style === 'dashed' ? '4,3' : null)
        .attr('opacity', e => {
            const s = typeof e.source === 'object' ? e.source.id : e.source;
            const t = typeof e.target === 'object' ? e.target.id : e.target;
            return (isFocal(s) || isFocal(t)) ? 0.5 : 0.15;
        })
        .attr('marker-end', e => `url(#arrow-ter-${e.type})`);

    // --- Layer 4: Node labels positioned by geo ---
    nodeGroup = g.append('g').attr('class', 'territory-labels');
    const bgGroup = g.append('g').attr('class', 'territory-bg-layer');

    // Jitter same-location nodes with golden angle spiral
    const positionCounts = {};
    nodes.forEach(n => {
        if (!n._geo) return;
        const key = `${n._geo.lat},${n._geo.lon}`;
        positionCounts[key] = (positionCounts[key] || 0) + 1;
        const [px, py] = projection([n._geo.lon, n._geo.lat]);
        const idx = positionCounts[key];
        const angle = (idx * 2.399) % (Math.PI * 2); // golden angle
        const radius = 12 + Math.sqrt(idx) * 18;
        n.x = px + Math.cos(angle) * radius;
        n.y = py + Math.sin(angle) * radius;
        n.fx = n.x;
        n.fy = n.y;
    });

    // Mark unresolved nodes
    nodes.forEach(n => {
        if (!n._geo) n._unresolved = true;
    });

    // Date filter
    const dateFilter = (typeof Timeline !== 'undefined') ? Timeline.getVisibleDateIds() : null;

    // Only render geo-resolved nodes on the map
    const geoNodes = nodes.filter(n => n._geo);

    const node = nodeGroup.selectAll('g')
        .data(geoNodes)
        .join('g')
        .attr('transform', d => `translate(${d.x},${d.y})`)
        .attr('cursor', 'pointer')
        .attr('visibility', d => {
            if (d._degree > currentDegree) return 'hidden';
            if (dateFilter && d.label === 'Evento' && d.date && d.date !== 'null' && !dateFilter.has(d.id)) return 'hidden';
            return 'visible';
        })
        .on('click', (e, d) => {
            e.stopPropagation();
            if (d.label === 'Actor' || d.label === 'Evento') navigateTo(d.id);
            else showDetail(d);
        });

    // Text labels — same typography as titles view
    node.append('text')
        .text(d => {
            const name = d.name || d.id;
            return name.length > MAX_LABEL_LEN ? name.slice(0, MAX_LABEL_LEN) + '...' : name;
        })
        .attr('font-size', d => {
            const style = TITLE_STYLE[d.type] || TITLE_STYLE.Object;
            const base = style.fontSize;
            if (isFocal(d.id)) return base + 4;
            return base + Math.min(d._connectionCount * 0.2, 3);
        })
        .attr('font-weight', d => {
            if (panoramaMode && d.label === 'Actor' && d._connectionCount >= 2) return 700;
            return (TITLE_STYLE[d.type] || TITLE_STYLE.Object).fontWeight;
        })
        .attr('font-style', d => (TITLE_STYLE[d.type] || TITLE_STYLE.Object).fontStyle)
        .attr('font-family', d => {
            const style = TITLE_STYLE[d.type] || TITLE_STYLE.Object;
            return style.font === 'serif' ? 'Alegreya, Georgia, serif' : 'Alegreya Sans, system-ui, sans-serif';
        })
        .attr('fill', d => {
            if (isFocal(d.id)) return themeVar('--graph-label-focal');
            return nodeColor(d);
        })
        .attr('text-anchor', 'start')
        .attr('dominant-baseline', 'central')
        .attr('opacity', d => d._degree === 2 ? 0.25 : (isFocal(d.id) ? 1 : 0.85));

    // Measure bboxes for bg rects
    node.each(function(d) {
        const bbox = this.querySelector('text')?.getBBox();
        if (bbox) {
            d._bboxW = bbox.width;
            d._bboxH = bbox.height;
        }
    });

    // Background rects
    const bgTheme = themeVar('--bg-app');
    bgGroup.selectAll('rect')
        .data(geoNodes.filter(n => n._degree <= currentDegree))
        .join('rect')
        .attr('x', d => d.x - 4)
        .attr('y', d => d.y - ((d._bboxH || 14) + 4) / 2)
        .attr('width', d => (d._bboxW || 48) + 8)
        .attr('height', d => (d._bboxH || 14) + 4)
        .attr('rx', 2).attr('ry', 2)
        .attr('fill', bgTheme)
        .attr('opacity', 0.7)
        .attr('pointer-events', 'none');

    // Tooltip
    let tooltip_t = document.querySelector('.graph-tooltip');
    if (!tooltip_t) {
        tooltip_t = document.createElement('div');
        tooltip_t.className = 'graph-tooltip';
        container.appendChild(tooltip_t);
    }

    const textEls = nodeGroup.selectAll('text');
    const arcPaths = arcLayer.selectAll('path');

    node.on('mouseenter', function(e, d) {
        const hasDate = d.label === 'Evento' && d.date && d.date !== 'null';
        const hasDesc = d.description && d.description.length > 0;
        if (hasDate || hasDesc) {
            let html = '';
            if (hasDate) html += `<span class="tooltip-date" style="margin-left:0">${formatDate(d.date)}</span>`;
            if (hasDesc) html += `${hasDate ? '<br>' : ''}<span class="tooltip-desc">${d.description}</span>`;
            tooltip_t.innerHTML = html;
            tooltip_t.classList.add('visible');
            const containerRect = container.getBoundingClientRect();
            const svgEl = document.getElementById('graph');
            const pt = svgEl.createSVGPoint();
            pt.x = d.x; pt.y = d.y;
            const ctm = g.node().getCTM();
            if (ctm) {
                const sp = pt.matrixTransform(ctm);
                tooltip_t.style.left = (sp.x - containerRect.left) + 'px';
                tooltip_t.style.top = (sp.y - containerRect.top - tooltip_t.offsetHeight - 2) + 'px';
            }
        }

        // Highlight connections
        const connIds = new Set();
        edges.forEach(e => {
            const s = typeof e.source === 'object' ? e.source.id : e.source;
            const t = typeof e.target === 'object' ? e.target.id : e.target;
            if (s === d.id) connIds.add(t);
            if (t === d.id) connIds.add(s);
        });

        textEls.attr('opacity', n => {
            if (n.id === d.id) return 1;
            if (connIds.has(n.id)) return 0.9;
            return 0.1;
        });
        arcPaths.attr('opacity', l => {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            return (s === d.id || t === d.id) ? 0.7 : 0.03;
        });
    })
    .on('mouseleave', () => {
        tooltip_t.classList.remove('visible');
        textEls.attr('opacity', d => d._degree === 2 ? 0.25 : (isFocal(d.id) ? 1 : 0.85));
        arcPaths.attr('opacity', e => {
            const s = typeof e.source === 'object' ? e.source.id : e.source;
            const t = typeof e.target === 'object' ? e.target.id : e.target;
            return (isFocal(s) || isFocal(t)) ? 0.5 : 0.15;
        });
    });

    // Collision simulation — gentle, positions are mostly fixed
    simulation = d3.forceSimulation(nodes.filter(n => n._geo))
        .alphaDecay(0.05)
        .velocityDecay(0.6)
        .force('rectCollide', forceRectCollide())
        .on('tick', () => {
            node.attr('transform', d => `translate(${d.x},${d.y})`);
            bgGroup.selectAll('rect')
                .attr('x', d => d.x - 4)
                .attr('y', d => d.y - ((d._bboxH || 14) + 4) / 2);
        });

    // Let collision settle then release fixed positions for geo-resolved nodes only
    setTimeout(() => {
        nodes.forEach(n => { if (n._geo) { n.fx = null; n.fy = null; } });
        // Re-apply gentle geo-gravity so nodes stay near their territory
        simulation.force('geo-gravity', alpha => {
            nodes.forEach(n => {
                if (!n._geo) return;
                const [tx, ty] = projection([n._geo.lon, n._geo.lat]);
                const key = `${n._geo.lat},${n._geo.lon}`;
                const idx = (positionCounts[key] || 1);
                const angle = (idx * 2.399) % (Math.PI * 2);
                const radius = 12 + Math.sqrt(idx) * 18;
                const targetX = tx + Math.cos(angle) * radius;
                const targetY = ty + Math.sin(angle) * radius;
                n.vx += (targetX - n.x) * alpha * 0.05;
                n.vy += (targetY - n.y) * alpha * 0.05;
            });
        });
        simulation.alpha(0.3).restart();
    }, 1500);

    // Update timeline
    if (typeof Timeline !== 'undefined') Timeline.update(data);
}

// Extracted from renderTitles for reuse
function forceRectCollide() {
    let nds;
    function force(alpha) {
        for (let iter = 0; iter < 3; iter++) {
        for (let i = 0; i < nds.length; i++) {
            for (let j = i + 1; j < nds.length; j++) {
                const a = nds[i], b = nds[j];
                if (a._degree > currentDegree || b._degree > currentDegree) continue;
                const ax = a.x + (a._bboxOffsetX || 0);
                const bx = b.x + (b._bboxOffsetX || 0);
                const dx = bx - ax, dy = b.y - a.y;
                const minDistX = ((a._w || 80) + (b._w || 80)) / 2 + 6;
                const minDistY = ((a._h || 18) + (b._h || 18)) / 2 + 6;
                const overlapX = minDistX - Math.abs(dx);
                const overlapY = minDistY - Math.abs(dy);
                if (overlapX > 0 && overlapY > 0) {
                    const push = Math.max(alpha, 0.3) * 0.8;
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
    }
    force.initialize = function(nodes) { nds = nodes; };
    return force;
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
    switchRightTab('node');
    document.querySelector('.detail-empty').hidden = true;
    const content = document.getElementById('detailContent');
    content.hidden = false;
    document.getElementById('detailBody').innerHTML = renderDetail(node) +
        `<div class="detail-section" id="newsSection"><h3>${t('detail.news')}</h3><p class="loading-inline">${t('detail.news.loading')}</p></div>`;

    // Geo-resolve and render mini-map
    if (_geoCentroids && _worldTopo) {
        if (!node._geo) {
            const nameIndex = _geoCentroids.$nameIndex || {};
            const nameLower = (node.name || '').toLowerCase();
            node._geo = _geoCentroids[node.id] || (nameIndex[nameLower] && _geoCentroids[nameIndex[nameLower]]) || null;
            if (!node._geo) {
                for (const [alias, cid] of Object.entries(nameIndex)) {
                    if (alias.length >= 4 && nameLower.includes(alias)) { node._geo = _geoCentroids[cid]; break; }
                }
            }
        }
        renderMiniMap('detailMiniMap', node);
    }

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
                    <span class="news-source">${n.source_name || ''}</span>
                    <span class="news-date">${formatDate(n.pub_date)}</span>
                </div>
                <div class="news-title-row">
                    <span class="news-title-text">${trimTitle(n.title)}</span>
                    ${n.link ? `<a class="news-external" href="${n.link}" target="_blank" rel="noopener" title="${t('detail.news.openSource')}"><i data-feather="external-link"></i></a>` : ''}
                </div>
                ${n._eventName ? `<div class="news-event-tag">${n._eventType ? n._eventType.replace(/_/g, ' ') + ': ' : ''}${n._eventName}</div>` : ''}
                ${n._evidenceQuote ? `<blockquote class="news-evidence">${n._evidenceQuote}</blockquote>` : ''}
                ${n._role ? `<div class="news-role">${n._role}</div>` : ''}
                ${n.description ? `<p class="news-desc">${(n.description || '').slice(0, 200)}${(n.description || '').length > 200 ? '...' : ''}</p>` : ''}
            </div>
        `).join('');

    // Render feather icons
    if (typeof feather !== 'undefined') feather.replace();
}

function renderDetail(node) {
    const label = node.label || 'Actor';
    const safeName = (node.name || node.id).replace(/'/g, "\\'");
    let html = '';

    // 1. TYPE SELECTOR
    if (label === 'Evento') {
        const eventTypes = (schemaData?.event_types || []).map(e => e.id);
        html += `<div class="detail-type-row">
            ${nodeDot(label, 'Event')}
            <select id="nodeTypeSelect" class="node-type-select" onchange="updateNodeType('${node.id}', this.value, 'event_type')">
                ${eventTypes.map(et => `<option value="${et}" ${et === node.event_type ? 'selected' : ''}>${tEventType(et)}</option>`).join('')}
            </select>
            ${node.date && node.date !== 'null' && node.date !== '' ? `<span class="event-date-badge">${formatDate(node.date)}</span>` : ''}
            ${node.is_disputed ? `<span class="disputed-badge">${t('detail.disputed')}</span>` : ''}
        </div>`;
    } else {
        const nodeTypes = ['Person', 'Organization', 'Location', 'Object'];
        html += `<div class="detail-type-row">
            ${nodeDot(label, node.type)}
            <select id="nodeTypeSelect" class="node-type-select" onchange="updateNodeType('${node.id}', this.value)">
                ${nodeTypes.map(tp => `<option value="${tp}" ${tp === node.type ? 'selected' : ''}>${tType(tp)}</option>`).join('')}
            </select>
        </div>`;
    }

    // 2. NAME (editable)
    html += `<h2 class="detail-name" contenteditable="true" spellcheck="false"
        data-node-id="${node.id}" data-field="name"
        onblur="saveNodeField(this)"
        onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur()}"
        >${node.name || node.id}</h2>`;

    // 3. DESCRIPTION (editable)
    html += `<p class="node-description" contenteditable="true" spellcheck="false"
        data-node-id="${node.id}" data-field="description"
        onblur="saveNodeField(this)"
        data-placeholder="${t('detail.addDescription') || 'Agregar descripción...'}"
        >${node.description || ''}</p>`;

    // Mini-map container
    html += `<div id="detailMiniMap" class="detail-minimap"></div>`;

    // Event-specific metadata
    if (label === 'Evento') {
        if (node.evidence_quote) html += `<blockquote class="evidence-quote">${node.evidence_quote}</blockquote>`;
        if (node.source) html += `<div class="detail-meta"><i data-feather="radio" class="meta-icon"></i> ${node.source}</div>`;
    }

    // 4. ALIASES
    html += `<div class="detail-section aliases-section" id="aliasesSection">
        <h3>${t('detail.aliases')}</h3>
        <div id="aliasesList" class="aliases-list"><span class="loading-inline">...</span></div>
        <div class="alias-add-row">
            <input type="text" id="aliasInput" class="alias-input" placeholder="${t('detail.aliases.add')}">
            <button onclick="addAlias('${node.id}')" class="alias-add-btn">+</button>
        </div>
    </div>`;

    // 5. ACTION BUTTONS
    html += `<div class="detail-actions">
        <button class="action-btn" id="reprocessBtn" onclick="reprocessNode('${node.id}')">
            <i data-feather="refresh-cw"></i> ${t('reprocess')}
        </button>
        <button class="action-btn" onclick="searchRelatedNews('${safeName}')">
            <i data-feather="search"></i> ${t('searchRelatedNews')}
        </button>
        <button class="action-btn" id="translateBtn" onclick="translateNode('${node.id}')">
            <i data-feather="globe"></i> ${t('detail.translate') || 'Traducir'}
        </button>
        ${label === 'Actor' ? `<button class="action-btn" id="enrichBtn" onclick="enrichNode('${node.id}', '${safeName}')">
            <i data-feather="globe"></i> ${t('detail.enrich')}
        </button>` : ''}
        <button class="action-btn danger" onclick="if(confirm('${t('detail.delete.confirm')} ${safeName}?')) deleteNode('${node.id}', '${safeName}')">
            <i data-feather="trash-2"></i>
        </button>
    </div>`;
    html += `<div id="enrichResults"></div>`;

    // 6. CONNECTIONS (last, scrollable)
    html += renderConnections(node);

    return html;
}

function renderConnections(node) {
    if (!lastEgoData) return '';
    const edges = lastEgoData.edges || [];
    const nodes = lastEgoData.nodes || [];
    const nodesById = new Map(nodes.map(n => [n.id, n]));

    // Find all edges involving this node (skip v1 orphan types)
    const skipTypes = new Set(['INVOLUCRA', 'REPORTA']);
    const connections = [];
    for (const e of edges) {
        if (skipTypes.has(e.type)) continue;
        const sid = typeof e.source === 'object' ? e.source.id : e.source;
        const tid = typeof e.target === 'object' ? e.target.id : e.target;
        if (sid === node.id) {
            const other = nodesById.get(tid);
            if (other && other.name && !other.name.startsWith('aHR0')) connections.push({ node: other, edge: e, direction: 'out' });
        } else if (tid === node.id) {
            const other = nodesById.get(sid);
            if (other && other.name && !other.name.startsWith('aHR0')) connections.push({ node: other, edge: e, direction: 'in' });
        }
    }

    if (!connections.length) return '';

    // Group by NODE TYPE for columnar layout
    const typeOrder = ['Person', 'Location', 'Organization', 'Event', 'Object'];
    const typeLabels = { Person: tType('Person'), Location: tType('Location'), Organization: tType('Organization'), Event: tType('Event'), Object: tType('Object') };
    const byType = {};
    for (const c of connections) {
        const ntype = c.node.type || c.node.label || 'Object';
        if (!byType[ntype]) byType[ntype] = [];
        byType[ntype].push(c);
    }

    let html = `<div class="detail-section connections-section">`;
    html += `<h3>${t('detail.connections')} (${connections.length})</h3>`;
    html += `<div class="conn-columns">`;

    const COLLAPSE_THRESHOLD = 5;

    function renderConnColumn(type, conns) {
        // Sort events by date descending (newest first)
        if (type === 'Event' || type === 'Evento') {
            conns.sort((a, b) => (b.node.date || '').localeCompare(a.node.date || ''));
        }
        const collapsed = conns.length > COLLAPSE_THRESHOLD;
        const largeClass = conns.length > 4 ? ' conn-large' : '';
        let h = `<div class="conn-column${largeClass}${collapsed ? ' collapsed' : ''}" data-type="${type}">
            <div class="conn-column-label" onclick="this.parentElement.classList.toggle('collapsed')">
                ${nodeDot(type, type)} ${typeLabels[type] || type} <span class="conn-count">${conns.length}</span>
                ${collapsed ? '<span class="conn-chevron"></span>' : ''}
            </div>
            <div class="conn-items">`;
        for (const c of conns) {
            const n = c.node;
            const edgeLabel = tEdge(c.edge.type);
            const role = c.edge.role ? ` — ${c.edge.role}` : '';
            const dateStr = ((type === 'Event' || type === 'Evento') && n.date && n.date !== 'null' && n.date !== '')
                ? `<span class="conn-date">${formatDate(n.date)}</span>` : '';
            h += `<div class="conn-item" onclick="navigateTo('${n.id}')" title="${edgeLabel}${role}">
                <span class="conn-name">${n.name || n.id}</span>
                ${dateStr}
                <span class="conn-edge-tag">${edgeLabel}</span>
            </div>`;
        }
        h += `</div></div>`;
        return h;
    }

    for (const type of typeOrder) {
        const conns = byType[type];
        if (!conns || !conns.length) continue;
        html += renderConnColumn(type, conns);
    }

    // Catch any types not in typeOrder
    for (const [type, conns] of Object.entries(byType)) {
        if (typeOrder.includes(type)) continue;
        html += renderConnColumn(type, conns);
    }

    html += `</div>`;

    // Add Relation button and form
    html += `<div class="add-relation-row">
        <button class="action-btn" onclick="toggleAddRelation('${node.id}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            ${t('detail.addRelation') || 'Agregar relación'}
        </button>
    </div>
    <div id="addRelationForm" class="add-relation-form" hidden>
        <div class="relation-field">
            <label class="relation-label">${t('detail.targetNode') || 'Nodo'}</label>
            <div class="relation-search-wrap">
                <input type="text" id="relationSearchInput" class="alias-input" placeholder="${t('detail.searchNode') || 'Buscar nodo...'}" autocomplete="off">
                <div id="relationSearchResults" class="relation-search-results" hidden></div>
            </div>
        </div>
        <div class="relation-field-row">
            <div class="relation-field" style="flex:1">
                <label class="relation-label">${t('detail.relationType') || 'Tipo'}</label>
                <select id="relationTypeSelect" class="node-type-select">
                    ${Object.keys(schemaData?.graph?.edges || {}).map(k =>
                        `<option value="${k}">${tEdge(k).toLowerCase()}</option>`
                    ).join('\n                    ')}
                </select>
            </div>
            <div class="relation-field" style="flex:1">
                <label class="relation-label">${t('detail.role') || 'Rol'} <span style="opacity:0.5">(opc.)</span></label>
                <input type="text" id="relationRoleInput" class="alias-input" placeholder="ej: fundador, miembro...">
            </div>
        </div>
        <div class="relation-actions">
            <button class="action-btn primary" onclick="saveRelation('${node.id}')">Guardar</button>
            <button class="action-btn" onclick="toggleAddRelation()">Cancelar</button>
        </div>
    </div>`;

    html += `</div>`;
    return html;
}

// --- Add Relation ---
let _relationTargetId = null;
let _relationSearchTimeout = null;

function toggleAddRelation(nodeId) {
    const form = document.getElementById('addRelationForm');
    if (!form) return;
    form.hidden = !form.hidden;
    _relationTargetId = null;
    if (!form.hidden) {
        const input = document.getElementById('relationSearchInput');
        if (input) { input.value = ''; input.focus(); }
        setupRelationSearch();
    }
}

function setupRelationSearch() {
    const input = document.getElementById('relationSearchInput');
    if (!input) return;
    input.addEventListener('input', () => {
        clearTimeout(_relationSearchTimeout);
        const q = input.value.trim();
        if (q.length < 2) {
            document.getElementById('relationSearchResults').hidden = true;
            _relationTargetId = null;
            return;
        }
        _relationSearchTimeout = setTimeout(async () => {
            try {
                const res = await fetch(`${API}/api/search?q=${encodeURIComponent(q)}`);
                const results = await res.json();
                const container = document.getElementById('relationSearchResults');
                if (!results.length) {
                    container.innerHTML = `<div class="relation-search-item" style="opacity:0.5">${t('search.noResults') || 'Sin resultados'}</div>`;
                    container.hidden = false;
                    return;
                }
                container.innerHTML = results.slice(0, 8).map(n =>
                    `<div class="relation-search-item" onclick="selectRelationTarget('${esc(n.id)}', '${esc(n.name || n.id)}')">
                        ${nodeDot(n.label, n.type)} <span>${n.name || n.id}</span>
                        <span class="conn-edge-tag">${n.type || n.label || ''}</span>
                    </div>`
                ).join('');
                container.hidden = false;
            } catch (err) {
                console.error('Relation search error:', err);
            }
        }, 250);
    });
}

function selectRelationTarget(id, name) {
    _relationTargetId = id;
    const input = document.getElementById('relationSearchInput');
    if (input) input.value = name;
    document.getElementById('relationSearchResults').hidden = true;
}

async function saveRelation(sourceId) {
    if (!_relationTargetId) {
        alert(t('detail.selectNode') || 'Selecciona un nodo primero');
        return;
    }
    const type = document.getElementById('relationTypeSelect').value;
    const role = document.getElementById('relationRoleInput')?.value?.trim() || '';

    try {
        const res = await fetch(`${API}/api/edge/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: sourceId, target: _relationTargetId, type, role })
        });
        const data = await res.json();
        if (data.ok) {
            toggleAddRelation();
            await navigateTo(sourceId);
        } else {
            alert('Error: ' + (data.error || 'unknown'));
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function searchRelatedNews(query) {
    // Switch to feed tab and search web
    switchRightTab('feed');
    searchWebNews(query);
}

async function translateNode(nodeId) {
    const btn = document.getElementById('translateBtn');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<span class="pulse-dot"></span> ${t('detail.translating') || 'Traduciendo...'}`;

    try {
        const res = await fetch(`${API}/api/node/translate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: nodeId, lang: currentLang })
        });
        const data = await res.json();
        if (data.ok && data.translated) {
            // Update in-memory node data
            const node = lastEgoData?.nodes?.find(n => n.id === nodeId);
            if (node) {
                if (data.translated.name) node.name = data.translated.name;
                if (data.translated.description) node.description = data.translated.description;
                if (data.translated.evidence_quote) node.evidence_quote = data.translated.evidence_quote;
                showDetail(node);
            }
            // Re-render graph titles
            if (currentView === 'titles' && lastEgoData) renderTitles(lastEgoData);
        } else {
            btn.innerHTML = originalHTML;
            btn.disabled = false;
        }
    } catch (e) {
        console.error('Translation failed:', e);
        btn.innerHTML = originalHTML;
        btn.disabled = false;
    }
}

async function reprocessNode(nodeId) {
    const btn = document.querySelector('.action-btn[onclick*="reprocessNode"]');
    if (!btn || btn.classList.contains('processing')) return;

    btn.classList.add('processing');
    const originalHTML = btn.innerHTML;
    btn.innerHTML = `<span class="pulse-dot"></span> <span class="reprocess-label">${t('reprocess.searching')}</span>`;

    const actionsDiv = btn.closest('.detail-actions');
    let progressEl = document.getElementById('reprocessProgress');
    if (progressEl) progressEl.remove();
    actionsDiv.insertAdjacentHTML('afterend', `
        <div id="reprocessProgress" class="reprocess-progress">
            <div class="reprocess-bar-track">
                <div class="reprocess-bar-fill" id="reprocessBarFill"></div>
            </div>
            <div class="reprocess-status" id="reprocessStatus"></div>
        </div>
    `);

    const barFill = document.getElementById('reprocessBarFill');
    const statusEl = document.getElementById('reprocessStatus');

    function setProgress(pct, msg) {
        barFill.style.width = pct + '%';
        statusEl.textContent = msg;
        const label = btn.querySelector('.reprocess-label');
        if (label) label.textContent = msg;
    }

    try {
        setProgress(10, 'Buscando relaciones latentes...');

        const response = await fetch(`${API}/api/node/discover`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: nodeId })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let discovered = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const msg = JSON.parse(line.slice(6));
                    if (msg.type === 'status') {
                        setProgress(Math.min(30 + discovered * 10, 90), msg.message);
                    } else if (msg.type === 'discovered') {
                        discovered++;
                        const reason = msg.reason || msg.edge?.role || '';
                        setProgress(Math.min(30 + discovered * 10, 90), `+${discovered}: ${msg.targetNode?.name || msg.edge?.target} (${reason})`);
                    } else if (msg.type === 'done') {
                        setProgress(95, 'Actualizando grafo...');
                    } else if (msg.type === 'error') {
                        setProgress(100, 'Error: ' + msg.message);
                    }
                } catch {}
            }
        }

        // Reload the ego to show new connections
        await navigateTo(nodeId);
        setProgress(100, discovered > 0
            ? `✓ ${discovered} relaciones descubiertas`
            : 'Sin relaciones latentes nuevas');
    } catch (err) {
        setProgress(100, 'Error: ' + err.message);
    }

    setTimeout(() => finishReprocess(), 3000);

    function finishReprocess() {
        btn.classList.remove('processing');
        btn.innerHTML = originalHTML;
        if (typeof feather !== 'undefined') feather.replace();
        const prog = document.getElementById('reprocessProgress');
        if (prog) prog.remove();
    }
}

// --- Node editing ---

async function updateNodeType(nodeId, newValue, field) {
    const body = { id: nodeId };
    if (field === 'event_type') body.event_type = newValue;
    else body.type = newValue;
    await fetch(`${API}/api/node/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
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
        if (i > 0 && h.edge) {
            html += `<span class="crumb-edge"> – ${h.edge} – </span>`;
        } else if (i > 0) {
            html += `<span class="crumb-edge"> – </span>`;
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

            let html = items.map(item =>
                `<li onclick="jumpTo('${item.id}')">
                    ${nodeDot(item.label, item.type)}${item.name || item.title || item.id}
                    <span class="label-tag">${item.type || item.label}</span>
                </li>`
            ).join('');

            // Always offer web search + create node at the bottom
            html += `<li class="search-web-option" onclick="searchWebNews('${esc(q)}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                ${t('searchWeb')} "<strong>${q}</strong>"
            </li>`;
            html += `<li class="search-create-option" onclick="openCreateNodeModal('${esc(q)}')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                ${t('createNode')} "<strong>${q}</strong>"
            </li>`;

            results.innerHTML = html;
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

function esc(s) { return String(s).replace(/'/g, "\\'").replace(/"/g, '&quot;'); }

function jumpTo(id) {
    document.getElementById('searchResults').hidden = true;
    document.getElementById('searchInput').value = '';
    navigateTo(id, true); // Search always resets breadcrumb
}

async function searchWebNews(query) {
    document.getElementById('searchResults').hidden = true;
    document.getElementById('searchInput').value = '';

    // Switch to feed tab to show results
    switchRightTab('feed');
    const feed = document.getElementById('newsFeed');
    feed.innerHTML = `<div class="search-loading">${t('searchingWeb')} "${query}"...</div>`;

    try {
        const lang = document.documentElement.lang || 'es';
        const res = await fetch(`${API}/api/news/search-web?q=${encodeURIComponent(query)}&lang=${lang}`);
        const items = await res.json();

        if (!items.length) {
            feed.innerHTML = `<div class="search-loading">${t('noWebResults')}</div>`;
            return;
        }

        feed.innerHTML = `<h4 class="web-results-header">${t('webResults')} "${query}" (${items.length})</h4>` +
            items.map(item => {
                const date = item.pubDate ? new Date(item.pubDate).toLocaleDateString() : '';
                const src = typeof item.source === 'object' ? item.source['#text'] || '' : item.source || '';
                return `<div class="news-card web-result">
                    <div class="news-meta">
                        <span class="news-source">${src}</span>
                        <span class="news-date">${date}</span>
                    </div>
                    <div class="news-title">${trimTitle(item.title)}</div>
                    <div class="news-actions">
                        <button class="ingest-btn" onclick="ingestFromWeb(this, '${esc(item.title)}', '${esc(item.link)}', '${esc(src)}', '${esc(item.pubDate)}')">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 16 12 12 8 16"></polyline><line x1="12" y1="12" x2="12" y2="21"></line><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"></path></svg>
                            ${t('ingest')}
                        </button>
                        <a href="${item.link}" target="_blank" class="news-link-external">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                        </a>
                    </div>
                </div>`;
            }).join('');
    } catch (err) {
        feed.innerHTML = `<div class="search-loading">Error: ${err.message}</div>`;
    }
}

async function ingestFromWeb(btn, title, link, source, pubDate) {
    btn.disabled = true;
    btn.innerHTML = '<span class="pulse-dot"></span>';
    // Pass focalId so the backend guarantees a link back to the origin node
    streamProcessNews({ title, link, source, description: '', contextNodeId: focalId || null }, btn);
}

// --- Create Node Modal ---

function openCreateNodeModal(prefill) {
    document.getElementById('searchResults').hidden = true;
    document.getElementById('searchInput').value = '';

    // Remove existing modal
    let modal = document.getElementById('createNodeModal');
    if (modal) modal.remove();

    const nodeTypes = [
        { value: 'Person', label: 'Actor' },
        { value: 'Organization', label: tType('Organization') },
        { value: 'Location', label: tType('Location') },
        { value: 'Object', label: tType('Object') },
        { value: 'Event', label: tType('Event') }
    ];
    modal = document.createElement('div');
    modal.id = 'createNodeModal';
    modal.className = 'create-node-modal-overlay';
    modal.innerHTML = `
        <div class="create-node-modal">
            <h3>${t('createNode.title')}</h3>
            <label>${t('createNode.name')}</label>
            <input type="text" id="createNodeName" value="${prefill.replace(/"/g, '&quot;')}" autofocus>
            <div class="create-node-row">
                <div class="create-node-field">
                    <label>${t('createNode.lang')}</label>
                    <select id="createNodeLang">
                        <option value="es" ${currentLang === 'es' ? 'selected' : ''}>ES</option>
                        <option value="en" ${currentLang === 'en' ? 'selected' : ''}>EN</option>
                    </select>
                </div>
                <div class="create-node-field">
                    <label>${t('createNode.type')}</label>
                    <select id="createNodeType">
                        ${nodeTypes.map(tp => `<option value="${tp.value}">${tp.label}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="create-node-actions">
                <button class="action-btn" onclick="closeCreateNodeModal()">${t('createNode.cancel')}</button>
                <button class="action-btn primary" id="createNodeSubmit" onclick="submitCreateNode()">${t('createNode.create')}</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) closeCreateNodeModal(); });
    document.getElementById('createNodeName').focus();
    document.getElementById('createNodeName').addEventListener('keydown', e => {
        if (e.key === 'Enter') submitCreateNode();
        if (e.key === 'Escape') closeCreateNodeModal();
    });
}

function closeCreateNodeModal() {
    const modal = document.getElementById('createNodeModal');
    if (modal) modal.remove();
}

async function submitCreateNode() {
    const name = document.getElementById('createNodeName').value.trim();
    if (!name) return;
    const lang = document.getElementById('createNodeLang').value;
    const type = document.getElementById('createNodeType').value;
    const btn = document.getElementById('createNodeSubmit');
    btn.disabled = true;
    btn.textContent = '...';

    try {
        const res = await fetch(`${API}/api/node/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, type, lang })
        });
        const data = await res.json();
        closeCreateNodeModal();
        if (data.ok && data.id) {
            navigateTo(data.id, true);
        }
    } catch (e) {
        console.error('Create node failed:', e);
        btn.disabled = false;
        btn.textContent = t('createNode.create');
    }
}

// --- Split handle ---

function setupSplitHandle() {
    const handle = document.getElementById('splitHandle');
    const splitLeft = document.querySelector('.split-left');
    const splitRight = document.querySelector('.split-right');
    let dragging = false;
    const MIN_LEFT = 250;  // px
    const MIN_RIGHT = 280; // px

    // Restore saved ratio
    const saved = localStorage.getItem('os-split-ratio');
    if (saved) splitLeft.style.flex = `0 0 ${saved}%`;

    handle.addEventListener('pointerdown', e => {
        dragging = true;
        handle.classList.add('dragging');
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    handle.addEventListener('pointermove', e => {
        if (!dragging) return;
        const parent = handle.parentElement;
        const rect = parent.getBoundingClientRect();
        const totalW = rect.width;
        const x = e.clientX - rect.left;

        // Clamp to pixel minimums
        const clamped = Math.max(MIN_LEFT, Math.min(totalW - MIN_RIGHT, x));
        const ratio = (clamped / totalW) * 100;
        splitLeft.style.flex = `0 0 ${ratio}%`;
        localStorage.setItem('os-split-ratio', ratio.toFixed(1));
    });
    handle.addEventListener('pointerup', () => {
        dragging = false;
        handle.classList.remove('dragging');
    });
}

// --- Detail close ---

// Detail close button removed — closing is at sidebar level

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
        btn.innerHTML = `<i data-feather="globe"></i> ${t('detail.enrich')}`;
    }
    if (typeof feather !== 'undefined') feather.replace();
}

async function saveNodeField(el) {
    const nodeId = el.dataset.nodeId;
    const field = el.dataset.field;
    const newValue = el.textContent.trim();
    if (!newValue || !nodeId) return;
    try {
        const res = await fetch(`/api/node/${encodeURIComponent(nodeId)}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [field]: newValue })
        });
        if (res.ok) {
            console.log(`Nodo ${nodeId}: ${field} → "${newValue}"`);
            // Update in current ego data
            if (lastEgoData) {
                const n = lastEgoData.nodes.find(n => n.id === nodeId);
                if (n) n[field] = newValue;
            }
        }
    } catch (e) {
        console.error('Error updating node:', e);
    }
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
    results.innerHTML = `<p class="loading-inline">${t('detail.enrich.applying')}</p>`;

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
                section.querySelector('h3').textContent = `${t('detail.news')} (${news.length})`;
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
        const [ingestRes, healthRes] = await Promise.all([
            fetch(`${API}/api/ingest/status`),
            fetch(`${API}/api/graph/health`)
        ]);
        const s = await ingestRes.json();
        const h = await healthRes.json();
        const total = s.pending + s.processed;
        const pct = total > 0 ? Math.round((s.processed / total) * 100) : 0;

        document.getElementById('processBar').style.width = `${pct}%`;

        // News/ingestion stats
        document.getElementById('processDetails').innerHTML = `
            <div class="process-section-label">${t('graph.news')}</div>
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
                <span class="process-stat-label">${t('process.total')}</span>
            </div>
        `;

        // Graph health stats
        document.getElementById('graphHealthDetails').innerHTML = `
            <div class="process-section-label">${t('graph.section')}</div>
            <div class="process-stat">
                <span class="process-stat-value">${h.total_nodes?.toLocaleString() || 0}</span>
                <span class="process-stat-label">${t('graph.nodes')}</span>
            </div>
            <div class="process-stat">
                <span class="process-stat-value">${h.total_edges?.toLocaleString() || 0}</span>
                <span class="process-stat-label">${t('graph.edges')}</span>
            </div>
            <div class="process-stat ${h.orphans > 0 ? 'warn' : ''}">
                <span class="process-stat-value">${h.orphans || 0}</span>
                <span class="process-stat-label">${t('graph.orphans')}</span>
            </div>
            <div class="process-stat ${h.events_no_date > 10 ? 'warn' : ''}">
                <span class="process-stat-value">${h.events_no_date || 0}</span>
                <span class="process-stat-label">${t('graph.noDate')}</span>
            </div>
            <div class="process-stat">
                <span class="process-stat-value">${h.news_total?.toLocaleString() || 0}</span>
                <span class="process-stat-label">${t('graph.news')}</span>
            </div>
            <div class="process-stat">
                <span class="process-stat-value">${h.news_sources || 0}</span>
                <span class="process-stat-label">${t('graph.sources')}</span>
            </div>
        `;

        // Update prune button label
        const pruneLabel = document.getElementById('pruneBtnLabel');
        if (pruneLabel) pruneLabel.textContent = t('graph.prune');
    } catch {}
}

async function pruneGraph() {
    const btn = document.getElementById('pruneBtn');
    btn.disabled = true;
    btn.innerHTML = `<i data-feather="loader"></i> ${t('graph.pruning')}`;
    if (typeof feather !== 'undefined') feather.replace();

    try {
        const res = await fetch(`${API}/api/graph/prune`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                actions: ['orphans', 'mistyped', 'thin_events', 'thin_actors'],
                dry_run: false
            })
        });
        const result = await res.json();
        const removed = result.removed?.length || 0;
        const fixed = result.fixed?.length || 0;

        btn.innerHTML = `<i data-feather="check"></i> ${removed} ${t('graph.pruned')}, ${fixed} ${t('graph.fixed')}`;
        if (typeof feather !== 'undefined') feather.replace();

        // Refresh stats after prune
        setTimeout(() => {
            refreshProcessStatus();
            btn.disabled = false;
            btn.innerHTML = `<i data-feather="scissors"></i> ${t('graph.prune')}`;
            if (typeof feather !== 'undefined') feather.replace();
        }, 3000);
    } catch (err) {
        btn.disabled = false;
        btn.innerHTML = `<i data-feather="scissors"></i> ${t('graph.prune')}`;
        if (typeof feather !== 'undefined') feather.replace();
    }
}

async function fetchNewRSS() {
    const btn = document.getElementById('fetchRssBtn');
    btn.disabled = true;
    btn.innerHTML = `<i data-feather="loader"></i> ${t('process.fetching')}`;
    if (typeof feather !== 'undefined') feather.replace();

    await fetch(`${API}/api/ingest/fetch`, { method: 'POST' });

    setTimeout(() => {
        btn.disabled = false;
        btn.innerHTML = `<i data-feather="rss"></i> ${t('process.fetch')}`;
        if (typeof feather !== 'undefined') feather.replace();
        refreshProcessStatus();
    }, 10000);
}

// --- Right panel tabs ---

let currentRightTab = 'feed';
let feedPage = 0;
let feedTotal = 0;

function switchRightTab(tab) {
    currentRightTab = tab;
    document.querySelectorAll('.right-tab').forEach(b => b.classList.remove('active'));
    const tabMap = { feed: 'tabFeed', node: 'tabNode', sources: 'tabSources' };
    document.getElementById(tabMap[tab]).classList.add('active');
    document.getElementById('rightNodePanel').hidden = tab !== 'node';
    document.getElementById('rightFeedPanel').hidden = tab !== 'feed';
    document.getElementById('rightSourcesPanel').hidden = tab !== 'sources';

    if (tab === 'feed' && document.getElementById('newsFeed').children.length === 0) {
        feedPage = 0;
        loadNewsFeed();
    }
    if (tab === 'sources') {
        loadSourcesPanel();
    }
}

let feedSortOrder = 'date';

function changeFeedSort(val) {
    feedSortOrder = val;
    feedPage = 0;
    loadNewsFeed();
}

async function loadNewsFeed(append) {
    const feed = document.getElementById('newsFeed');
    if (!append) { feed.innerHTML = ''; feedPage = 0; }

    const res = await fetch(`${API}/api/news/feed?page=${feedPage}&sort=${feedSortOrder}`);
    const data = await res.json();
    feedTotal = data.total;

    for (const item of data.items) {
        const el = document.createElement('div');
        el.className = 'feed-item';
        el.onclick = () => showNewsEgo(item.link, item.title);
        el.innerHTML = `
            <div class="feed-item-header">
                <span class="feed-item-source">${item.source_name || ''}</span>
                <span class="feed-item-date">${formatDate(item.pub_date)}</span>
            </div>
            <div class="feed-item-title">${trimTitle(item.title)}</div>
            <div class="feed-item-status">
                <span class="feed-status-dot ${item._inGraph ? 'in-graph' : 'pending'}"></span>
                <span class="feed-status-label">${item._inGraph ? `${item._actorCount} ${t('feed.actors')}` : t('ingest.status.pending')}</span>
            </div>
            ${item._eventName ? `<div class="feed-item-event">${item._eventName}</div>` : ''}
        `;
        feed.appendChild(el);
    }

    const btn = document.getElementById('loadMoreBtn');
    btn.hidden = (feedPage + 1) * data.limit >= feedTotal;
}

function loadMoreFeed() {
    feedPage++;
    loadNewsFeed(true);
}

async function showNewsEgo(link, title) {
    // Mark feed item as processing
    const feedItems = document.querySelectorAll('.feed-item');
    let targetItem = null;
    feedItems.forEach(el => {
        if (el.querySelector('.feed-item-title')?.textContent === title) {
            targetItem = el;
            el.classList.add('processing');
        }
    });

    streamProcessNews({ link, title }, targetItem);
}

/**
 * Core streaming processor: sends news to /api/news/process (SSE),
 * renders focal node immediately, then adds actors one by one to the D3 graph.
 */
function streamProcessNews(params, feedBtn) {
    // Prepare a fresh graph with just a "processing" placeholder
    const container = document.getElementById('graphPanel');
    const width = container.clientWidth;
    const height = container.clientHeight;
    const cx = width / 2, cy = height / 2;

    // Kill old simulation
    if (simulation) simulation.stop();
    d3.select('#graph').selectAll('*').remove();
    svg = d3.select('#graph').attr('width', width).attr('height', height);

    // Defs
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
            .append('path').attr('d', 'M 0 0 L 10 5 L 0 10 Z').attr('fill', v.color);
    });

    g = svg.append('g');
    const zoomBehavior = d3.zoom().scaleExtent([0.3, 4]).on('zoom', e => g.attr('transform', e.transform));
    svg.call(zoomBehavior);

    linkGroup = g.append('g');
    nodeGroup = g.append('g');

    // Live data arrays that D3 will bind to
    const liveNodes = [];
    const liveEdges = [];
    let liveSimulation = null;

    function rebuildSimulation() {
        if (liveSimulation) liveSimulation.stop();

        liveSimulation = d3.forceSimulation(liveNodes)
            .force('link', d3.forceLink(liveEdges).id(d => d.id).distance(100).strength(0.4))
            .force('charge', d3.forceManyBody().strength(d => d._degree === 0 ? -400 : -120))
            .force('center', d3.forceCenter(cx, cy).strength(0.05))
            .force('collision', d3.forceCollide().radius(d => nodeRadius(d) + 6))
            .on('tick', () => {
                linkGroup.selectAll('line')
                    .attr('x1', d => d.source.x).attr('y1', d => d.source.y)
                    .attr('x2', d => d.target.x).attr('y2', d => d.target.y);
                nodeGroup.selectAll('g.live-node')
                    .attr('transform', d => `translate(${d.x},${d.y})`);
            });

        // Pin focal
        const focal = liveNodes.find(n => n._degree === 0);
        if (focal) { focal.fx = cx; focal.fy = cy; }

        simulation = liveSimulation;
        currentSimulation = liveSimulation;
    }

    function addNodeToGraph(nodeData, edgeData) {
        // Add to live data
        if (!liveNodes.find(n => n.id === nodeData.id)) {
            liveNodes.push(nodeData);
        }
        if (edgeData) {
            liveEdges.push(edgeData);
        }

        // Re-bindlinks
        linkGroup.selectAll('line')
            .data(liveEdges, d => `${d.source?.id || d.source}-${d.target?.id || d.target}`)
            .join(
                enter => enter.append('line')
                    .attr('stroke', d => edgeVisual(d.type).color)
                    .attr('stroke-width', d => edgeVisual(d.type).width)
                    .attr('opacity', 0)
                    .transition().duration(500).attr('opacity', 0.6)
            );

        // Re-bind nodes
        const nodeSel = nodeGroup.selectAll('g.live-node')
            .data(liveNodes, d => d.id);

        const enter = nodeSel.enter().append('g')
            .attr('class', 'live-node')
            .attr('cursor', 'pointer')
            .style('opacity', 0)
            .on('click', (e, d) => {
                if (d.label === 'Actor' || d.label === 'Evento') navigateTo(d.id);
                else showDetail(d);
            })
            .call(makeDrag());

        enter.append('circle')
            .attr('r', d => nodeRadius(d))
            .attr('fill', d => nodeColor(d))
            .attr('stroke', d => d._degree === 0 ? '#fff' : nodeStroke(d))
            .attr('stroke-width', d => nodeStrokeWidth(d));

        enter.append('text')
            .text(d => truncLabel(d.name || d.id))
            .attr('font-size', d => d._degree === 0 ? 13 : 10)
            .attr('font-weight', d => d._degree === 0 ? 700 : 400)
            .attr('fill', d => graphLabelColor(d))
            .attr('text-anchor', 'middle')
            .attr('dy', d => nodeRadius(d) + 13)
            .attr('pointer-events', 'none');

        // Animate entrance
        enter.transition().duration(400).style('opacity', 1);

        rebuildSimulation();
    }

    // Start SSE request
    fetch(`${API}/api/news/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
    }).then(async response => {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            // Parse SSE lines
            const lines = buffer.split('\n');
            buffer = lines.pop(); // keep incomplete line

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const msg = JSON.parse(line.slice(6));

                    if (msg.type === 'focal') {
                        focalId = msg.node.id;
                        addNodeToGraph(msg.node, null);
                        history = [{ id: focalId, name: msg.node.name, edge: null }];
                        renderBreadcrumbs();
                    }
                    else if (msg.type === 'node') {
                        addNodeToGraph(msg.node, msg.edge);
                    }
                    else if (msg.type === 'edge') {
                        liveEdges.push(msg.edge);
                        rebuildSimulation();
                    }
                    else if (msg.type === 'done') {
                        // Update lastEgoData for detail panel
                        lastEgoData = {
                            focal: liveNodes.find(n => n._degree === 0),
                            nodes: [...liveNodes],
                            edges: [...liveEdges]
                        };
                        // Show detail of the focal event
                        const focalNode = liveNodes.find(n => n._degree === 0);
                        if (focalNode) showDetail(focalNode);

                        // Update feed button
                        if (feedBtn) {
                            if (feedBtn.tagName === 'BUTTON') {
                                feedBtn.textContent = '✓';
                                feedBtn.classList.add('ingested');
                            } else {
                                feedBtn.classList?.remove('processing');
                                const dot = feedBtn.querySelector?.('.feed-status-dot');
                                if (dot) dot.classList.replace('pending', 'in-graph');
                            }
                        }
                    }
                    else if (msg.type === 'error') {
                        console.error('Process error:', msg.message);
                        if (feedBtn?.tagName === 'BUTTON') feedBtn.textContent = '✗';
                    }
                } catch {}
            }
        }
    }).catch(err => {
        console.error('Stream error:', err);
        if (feedBtn?.tagName === 'BUTTON') feedBtn.textContent = '✗';
    });
}

// --- Console ---

let consoleOpen = false;
let consoleEventSource = null;

function toggleConsole() {
    consoleOpen = !consoleOpen;
    const drawer = document.getElementById('consoleDrawer');
    drawer.hidden = !consoleOpen;

    if (consoleOpen) {
        startConsoleStream();
    } else {
        stopConsoleStream();
    }
}

function startConsoleStream() {
    if (consoleEventSource) consoleEventSource.close();

    const output = document.getElementById('consoleOutput');
    output.innerHTML = '';

    consoleEventSource = new EventSource(`${API}/api/ingest/log`);
    consoleEventSource.onmessage = (e) => {
        const data = JSON.parse(e.data);
        const line = data.line;

        const el = document.createElement('div');
        el.className = 'log-line';

        // Color coding
        if (line.includes('ERROR') || line.includes('GRAPH ERROR')) {
            el.classList.add('log-error');
        } else if (line.includes('Guardado en grafo')) {
            el.classList.add('log-saved');
        } else if (line.includes('Evento:')) {
            el.classList.add('log-event');
        } else if (line.includes('Entidades:')) {
            el.classList.add('log-entity');
        } else if (line.includes('Procesando')) {
            el.classList.add('log-title');
        }

        el.textContent = line;
        output.appendChild(el);

        // Auto-scroll to bottom
        output.scrollTop = output.scrollHeight;

        // Limit lines
        while (output.children.length > 500) {
            output.removeChild(output.firstChild);
        }
    };
}

function stopConsoleStream() {
    if (consoleEventSource) {
        consoleEventSource.close();
        consoleEventSource = null;
    }
}

// --- Sources panel ---

let sourcesData = [];
let topicsData = { topics: [] };

async function loadSourcesPanel() {
    try {
        const [feedsRes, topicsRes] = await Promise.all([
            fetch('/api/sources').then(r => r.json()),
            fetch('/api/topics').then(r => r.json())
        ]);
        sourcesData = feedsRes;
        topicsData = topicsRes;
    } catch (e) {
        console.error('Error loading sources:', e);
    }
    renderSourcesPanel();
}

function renderSourcesPanel() {
    // Topics
    const topicsList = document.getElementById('topicsList');
    topicsList.innerHTML = '';
    if (topicsData.topics.length === 0) {
        topicsList.innerHTML = `<span class="sources-empty">${t('sources.noTopics')}</span>`;
    } else {
        topicsData.topics.forEach((topic, i) => {
            const chip = document.createElement('span');
            chip.className = 'alias-chip';
            chip.innerHTML = `${topic} <button class="alias-remove" onclick="removeTopic(${i})">&times;</button>`;
            topicsList.appendChild(chip);
        });
    }

    // Feeds
    const feedsList = document.getElementById('feedsList');
    feedsList.innerHTML = '';
    const enabledCount = sourcesData.filter(f => f.enabled !== false).length;
    document.getElementById('sourcesCount').textContent = `${enabledCount}/${sourcesData.length} ${t('sources.enabled')}`;

    sourcesData.forEach((feed, i) => {
        const row = document.createElement('div');
        row.className = 'feed-row' + (feed.enabled === false ? ' disabled' : '');
        row.innerHTML = `
            <label class="feed-toggle">
                <input type="checkbox" ${feed.enabled !== false ? 'checked' : ''} onchange="toggleFeed(${i}, this.checked)">
                <span class="feed-toggle-slider"></span>
            </label>
            <div class="feed-info">
                <span class="feed-name">${feed.name}</span>
                <span class="feed-region">${feed.lang} · ${feed.region || ''}</span>
            </div>
            <button class="alias-remove" onclick="removeFeed(${i})" title="Eliminar">&times;</button>
        `;
        feedsList.appendChild(row);
    });
    if (typeof feather !== 'undefined') feather.replace();
}

async function toggleFeed(index, enabled) {
    sourcesData[index].enabled = enabled;
    await fetch('/api/sources', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sourcesData)
    });
    renderSourcesPanel();
}

async function removeFeed(index) {
    sourcesData.splice(index, 1);
    await fetch('/api/sources', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sourcesData)
    });
    renderSourcesPanel();
}

function toggleAddFeedForm() {
    const form = document.getElementById('addFeedForm');
    form.hidden = !form.hidden;
    if (!form.hidden) document.getElementById('newFeedName').focus();
}

async function saveFeed() {
    const name = document.getElementById('newFeedName').value.trim();
    const url = document.getElementById('newFeedUrl').value.trim();
    if (!name || !url) return;

    const lang = document.getElementById('newFeedLang').value.trim();
    const region = document.getElementById('newFeedRegion').value.trim();
    const id = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    sourcesData.push({ id, name, url, lang, region, enabled: true });
    await fetch('/api/sources', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sourcesData)
    });
    document.getElementById('newFeedName').value = '';
    document.getElementById('newFeedUrl').value = '';
    document.getElementById('newFeedLang').value = '';
    document.getElementById('newFeedRegion').value = '';
    document.getElementById('addFeedForm').hidden = true;
    renderSourcesPanel();
}

async function addTopic() {
    const input = document.getElementById('topicInput');
    const topic = input.value.trim();
    if (!topic) return;
    topicsData.topics.push(topic);
    await fetch('/api/topics', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(topicsData)
    });
    input.value = '';
    renderSourcesPanel();
}

async function removeTopic(index) {
    topicsData.topics.splice(index, 1);
    await fetch('/api/topics', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(topicsData)
    });
    renderSourcesPanel();
}

// --- Boot ---

init().catch(err => {
    console.error('Error:', err);
    document.getElementById('graphPanel').innerHTML =
        `<div class="loading">${t('loading.graph')}</div>`;
});
