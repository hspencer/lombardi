/* ============================================================
   Timeline — brushable range slider with play/animate
   Depends on D3 v7 (loaded globally)
   ============================================================ */

const Timeline = (() => {
    // --- State ---
    let _container, _svg, _brush, _brushG;
    let _xScale;
    let _dateRange = null;       // [Date, Date]
    let _datedNodes = [];        // [{id, date: Date}]
    let _selectedRange = null;   // [Date, Date]
    let _playInterval = null;
    let _playing = false;
    let _active = false;         // timeline visible & operational
    let _resizeObserver = null;
    let _playBtn = null;
    let _updating = false;       // re-entrance guard

    const MARGIN = { left: 40, right: 12, top: 3, bottom: 18 };
    const BAR_HEIGHT = 44;
    const PLAY_ICON = '<svg viewBox="0 0 12 12"><polygon points="2,0 12,6 2,12"/></svg>';
    const PAUSE_ICON = '<svg viewBox="0 0 12 12"><rect x="1" y="0" width="3.5" height="12"/><rect x="7.5" y="0" width="3.5" height="12"/></svg>';

    // --- Public API ---

    function update(egoData) {
        _container = document.getElementById('timelineBar');
        if (!_container || _updating) return;
        _updating = true;

        // Extract dated Evento nodes (only those passing degree filter)
        const deg = (typeof currentDegree !== 'undefined') ? currentDegree : 3;
        _datedNodes = (egoData?.nodes || [])
            .filter(n => n.label === 'Evento' && n.date && n.date !== 'null' && n.date !== ''
                && (n._degree || 0) <= deg)
            .map(n => ({ id: n.id, date: _parseDate(n.date) }))
            .filter(n => n.date instanceof Date && !isNaN(n.date));

        // Need at least 2 distinct dates
        const uniqueDates = new Set(_datedNodes.map(n => n.date.getTime()));
        if (uniqueDates.size < 2) {
            _hide();
            _updating = false;
            return;
        }

        _dateRange = [
            d3.min(_datedNodes, d => d.date),
            d3.max(_datedNodes, d => d.date)
        ];

        _show();
        _render();
        // Delay releasing guard until after brush init events settle
        setTimeout(() => { _updating = false; }, 50);

        // Watch for resize
        if (!_resizeObserver) {
            _resizeObserver = new ResizeObserver(() => {
                if (_active) _render();
            });
            _resizeObserver.observe(_container.parentElement);
        }
    }

    function destroy() {
        _stopPlay();
        _hide();
        if (_resizeObserver) {
            _resizeObserver.disconnect();
            _resizeObserver = null;
        }
    }

    function getVisibleDateIds() {
        if (!_active || !_selectedRange) return null;
        const [lo, hi] = _selectedRange;
        const ids = new Set();
        for (const n of _datedNodes) {
            if (n.date >= lo && n.date <= hi) ids.add(n.id);
        }
        return ids;
    }

    // --- Rendering ---

    function _render() {
        const w = _container.clientWidth;
        const h = BAR_HEIGHT;
        const innerW = w - MARGIN.left - MARGIN.right;
        const innerH = h - MARGIN.top - MARGIN.bottom;

        if (innerW < 80) return;

        // Clear previous
        _container.innerHTML = '';

        // Play button
        _playBtn = document.createElement('button');
        _playBtn.className = 'timeline-play-btn';
        _playBtn.innerHTML = PLAY_ICON;
        _playBtn.title = 'Play';
        _playBtn.addEventListener('click', _togglePlay);
        _container.appendChild(_playBtn);

        // SVG
        const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svgEl.classList.add('timeline-svg');
        _container.appendChild(svgEl);

        _svg = d3.select(svgEl)
            .attr('width', '100%')
            .attr('height', h);

        const svgW = svgEl.clientWidth || (w - 44);
        const plotLeft = 8;
        const plotRight = svgW - 8;
        const plotW = plotRight - plotLeft;

        _xScale = d3.scaleTime()
            .domain(_dateRange)
            .range([plotLeft, plotRight]);

        const g = _svg.append('g');

        // --- Density histogram ---
        _renderDensity(g, plotLeft, plotRight, innerH);

        // --- Axis ---
        const axisG = g.append('g')
            .attr('class', 'timeline-axis')
            .attr('transform', `translate(0,${h - MARGIN.bottom})`);

        const tickCount = Math.max(2, Math.min(Math.floor(plotW / 50), 10));
        axisG.call(
            d3.axisBottom(_xScale)
                .ticks(tickCount)
                .tickFormat(d3.timeFormat('%m/%y'))
                .tickSize(3)
        );

        // --- Brush (init without events to avoid recursion) ---
        _brush = d3.brushX()
            .extent([[plotLeft, MARGIN.top], [plotRight, h - MARGIN.bottom]]);

        _brushG = g.append('g')
            .attr('class', 'timeline-brush')
            .call(_brush);

        // Set initial position without triggering events
        _brushG.call(_brush.move, [plotLeft, plotRight]);
        _selectedRange = [..._dateRange];

        // NOW attach event listeners (after initial position is set)
        _brush
            .on('brush', _onBrush)
            .on('end', _onBrushEnd);

        // --- Date labels on handles ---
        _svg.append('text')
            .attr('class', 'timeline-date-label')
            .attr('id', 'tl-label-lo')
            .attr('y', h / 2)
            .attr('text-anchor', 'end');

        _svg.append('text')
            .attr('class', 'timeline-date-label')
            .attr('id', 'tl-label-hi')
            .attr('y', h / 2)
            .attr('text-anchor', 'start');
    }

    function _renderDensity(g, plotLeft, plotRight, innerH) {
        const bins = d3.bin()
            .value(d => d.date)
            .domain(_xScale.domain())
            .thresholds(_xScale.ticks(Math.min(30, _datedNodes.length * 2)))
            (_datedNodes);

        const yMax = d3.max(bins, b => b.length) || 1;
        const yScale = d3.scaleLinear()
            .domain([0, yMax])
            .range([0, innerH * 0.7]);

        const densityG = g.append('g').attr('class', 'timeline-density');

        densityG.selectAll('rect')
            .data(bins.filter(b => b.length > 0))
            .join('rect')
            .attr('x', d => _xScale(d.x0))
            .attr('width', d => Math.max(1, _xScale(d.x1) - _xScale(d.x0) - 1))
            .attr('y', d => BAR_HEIGHT - MARGIN.bottom - yScale(d.length))
            .attr('height', d => yScale(d.length))
            .attr('rx', 1);
    }

    // --- Brush Events ---

    function _onBrush(event) {
        if (!event.selection) return;
        const [x0, x1] = event.selection;
        _selectedRange = [_xScale.invert(x0), _xScale.invert(x1)];
        _updateLabels(x0, x1);
    }

    function _onBrushEnd(event) {
        if (!event.selection) {
            // Brush cleared — reset to full range
            _selectedRange = [..._dateRange];
            _brushG.call(_brush.move, _xScale.range());
            return;
        }
        _onBrush(event);
        _applyFilter();
    }

    function _updateLabels(x0, x1) {
        const fmt = d3.timeFormat('%d/%m/%y');
        const lo = _xScale.invert(x0);
        const hi = _xScale.invert(x1);
        const range = _xScale.range();
        const isFullRange = Math.abs(x0 - range[0]) < 2 && Math.abs(x1 - range[1]) < 2;

        const labelLo = _svg.select('#tl-label-lo');
        const labelHi = _svg.select('#tl-label-hi');

        // Hide labels when brush covers full range (axis labels suffice)
        if (isFullRange) {
            labelLo.text('');
            labelHi.text('');
            return;
        }

        labelLo
            .attr('x', x0 + 4)
            .attr('text-anchor', 'start')
            .text(fmt(lo));

        labelHi
            .attr('x', x1 + 4)
            .attr('text-anchor', 'start')
            .text(fmt(hi));
    }

    // --- Filtering ---

    function _applyFilter() {
        if (_updating) return;
        if (typeof applyVisibilityFilter === 'function') {
            applyVisibilityFilter();
        }
    }

    // --- Play / Pause ---

    function _togglePlay() {
        if (_playing) {
            _stopPlay();
        } else {
            _startPlay();
        }
    }

    function _startPlay() {
        if (!_dateRange || !_brushG) return;

        _playing = true;
        _updatePlayIcon();

        const totalMs = _dateRange[1].getTime() - _dateRange[0].getTime();
        const steps = 80;
        const stepMs = totalMs / steps;
        let currentRight = _dateRange[0].getTime();

        _playInterval = setInterval(() => {
            currentRight += stepMs;

            if (currentRight >= _dateRange[1].getTime()) {
                currentRight = _dateRange[1].getTime();
                _stopPlay();
            }

            const x0 = _xScale(_dateRange[0]);
            const x1 = _xScale(new Date(currentRight));

            _brushG.call(_brush.move, [x0, x1]);
            _selectedRange = [_dateRange[0], new Date(currentRight)];
            _updateLabels(x0, x1);
            _applyFilter();
        }, 100);
    }

    function _stopPlay() {
        _playing = false;
        if (_playInterval) {
            clearInterval(_playInterval);
            _playInterval = null;
        }
        _updatePlayIcon();
    }

    function _updatePlayIcon() {
        if (_playBtn) {
            _playBtn.innerHTML = _playing ? PAUSE_ICON : PLAY_ICON;
            _playBtn.title = _playing ? 'Pause' : 'Play';
        }
    }

    // --- Helpers ---

    function _parseDate(str) {
        if (!str || str === 'null' || str === 'undefined' || str === '') return null;
        // Handle YYYY-MM-DD (add noon to avoid timezone shift)
        if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
            return new Date(str + 'T12:00:00');
        }
        return new Date(str);
    }

    function _show() {
        _active = true;
        if (_container) _container.hidden = false;
    }

    function _hide() {
        _active = false;
        _stopPlay();
        _selectedRange = null;
        if (_container) _container.hidden = true;
    }

    // --- Expose ---
    return { update, destroy, getVisibleDateIds };
})();
