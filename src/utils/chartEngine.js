import * as d3 from 'd3';

export function renderSingleChart(svgNode, wrapperNode, dataset, state, setAlertsCallback, onResizeEnd, onLoadMore, onDrawComplete, onDrawDelete) {
    if (!svgNode || !wrapperNode || dataset.length === 0) return;

    const svgEl = d3.select(svgNode);
    svgEl.selectAll("*").remove();

    const width = wrapperNode.clientWidth;
    const height = wrapperNode.clientHeight;

    if (width <= 0 || height <= 0) return;

    const margin = { top: 30, right: 65, bottom: 65, left: 20 };
    const chartWidth = width - margin.left - margin.right;
    
    const isDark = state.theme === 'dark';
    const colors = {
        text: isDark ? "#94a3b8" : "#64748b",
        grid: isDark ? "#374151" : "#e2e8f0",
        paneBg: isDark ? "rgba(30, 41, 59, 0.2)" : "rgba(241, 245, 249, 0.5)",
        xhLine: isDark ? "#94a3b8" : "#94a3b8",
        xhBg: isDark ? "#1e293b" : "#f1f5f9",
        xhTxt: isDark ? "#f8fafc" : "#0f172a",
        sessionLine: isDark ? "rgba(59, 130, 246, 0.4)" : "rgba(59, 130, 246, 0.2)"
    };
    
    const activePanes = ['macd', 'rsi', 'demarker'].filter(ind => state.indicators[ind]);
    const numSubPanes = activePanes.length;
    const subPaneGap = 10;
    
    // Read heights from state
    let subPaneHeights = { ...(state.subPaneHeights || { macd: 70, rsi: 70, demarker: 70 }) };
    
    let totalSubHeight = 0;
    activePanes.forEach(ind => {
        totalSubHeight += subPaneHeights[ind] + subPaneGap;
    });
    
    let chartHeight = height - margin.top - margin.bottom - totalSubHeight;
    let totalInnerHeight = chartHeight + totalSubHeight;

    svgEl.attr("viewBox", `0 0 ${width} ${height}`);

    const clipId = `clip-main-chart`;
    const defs = svgEl.append("defs");
    
    defs.append("clipPath")
        .attr("id", clipId)
        .append("rect")
        .attr("width", chartWidth)
        .attr("height", chartHeight);

    defs.append("clipPath")
        .attr("id", "clip-x-axis")
        .append("rect")
        .attr("width", chartWidth)
        .attr("height", margin.bottom);

    defs.append("clipPath")
        .attr("id", "clip-y-axis")
        .append("rect")
        .attr("width", margin.right)
        .attr("height", chartHeight);

    // Chart Background Interactive Overlay
    const bgOverlay = svgEl.append("rect")
        .attr("x", margin.left)
        .attr("y", margin.top)
        .attr("width", chartWidth)
        .attr("height", totalInnerHeight)
        .attr("fill", "transparent")
        .style("cursor", "crosshair")
        .style("pointer-events", "all");

    // Y-Axis Interactive Overlay
    const yAxisOverlay = svgEl.append("rect")
        .attr("x", margin.left + chartWidth)
        .attr("y", margin.top)
        .attr("width", margin.right)
        .attr("height", totalInnerHeight)
        .attr("fill", "transparent")
        .style("cursor", "ns-resize")
        .style("pointer-events", "all");

    // X-Axis Interactive Overlay
    const xAxisOverlay = svgEl.append("rect")
        .attr("x", margin.left)
        .attr("y", margin.top + totalInnerHeight)
        .attr("width", chartWidth)
        .attr("height", margin.bottom)
        .attr("fill", "transparent")
        .style("cursor", "ew-resize")
        .style("pointer-events", "all");

    const mainGroup = svgEl.append("g")
        .attr("transform", `translate(${margin.left}, ${margin.top})`);

    let isDrawing = false;
    let currentDrawing = null;
    
    // Internal zoom/pan state object maintained purely inside D3, preserved across re-renders
    if (!svgNode._cState) {
        svgNode._cState = {
            tx: d3.zoomIdentity,
            ty: d3.zoomIdentity,
            autoScaleY: true
        };
    }
    let cState = svgNode._cState;

    const newDomain = dataset.map(d => d.time);
    
    // Zoom preservation for infinite scrolling
    if (svgNode._lastDomain && newDomain.length > svgNode._lastDomain.length) {
        let oldDomain = svgNode._lastDomain;
        // If the newest candle hasn't changed, we prepended historical data
        if (newDomain[newDomain.length - 1] === oldDomain[oldDomain.length - 1]) {
            let oldXBase = d3.scaleBand().domain(oldDomain).range([0, chartWidth]).padding(0.2);
            let tempXBase = d3.scaleBand().domain(newDomain).range([0, chartWidth]).padding(0.2);
            
            let oldX = oldXBase(oldDomain[0]);
            let newX = tempXBase(oldDomain[0]);
            
            let visualOld = cState.tx.applyX(oldX);
            let k_new = cState.tx.k * (oldXBase.bandwidth() / tempXBase.bandwidth());
            let tx_x_new = visualOld - k_new * newX;
            
            cState.tx = d3.zoomIdentity.translate(tx_x_new, cState.tx.y).scale(k_new);
        }
    }
    svgNode._lastDomain = newDomain;

    // Scales
    const xBase = d3.scaleBand()
        .domain(newDomain)
        .range([0, chartWidth])
        .padding(0.2);

    let allPrices = dataset.flatMap(c => [c.high, c.low]);
    let minPrice = (d3.min(allPrices) || 2400) - 4;
    let maxPrice = (d3.max(allPrices) || 2450) + 4;

    const yBase = d3.scaleLinear()
        .domain([minPrice, maxPrice])
        .range([chartHeight, 0]);

    // Axes & Grid
    const xAxisGroup = mainGroup.append("g")
        .attr("transform", `translate(0, ${totalInnerHeight})`)
        .attr("class", `x-axis font-sans text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`)
        .attr("clip-path", "url(#clip-x-axis)");

    const yAxisGroup = mainGroup.append("g")
        .attr("transform", `translate(${chartWidth}, 0)`)
        .attr("class", `y-axis font-sans text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`)
        .attr("clip-path", "url(#clip-y-axis)");

    const gridGroup = mainGroup.append("g")
        .attr("class", "grid")
        .attr("clip-path", `url(#${clipId})`);

    const chartArea = mainGroup.append("g")
        .attr("clip-path", `url(#${clipId})`);
        
    // --- INDICATOR SUB-PANES SETUP ---
    const subPanes = {};
    let currentSubY = chartHeight + subPaneGap;
    
    // Create an ordered list of panes for resizing logic
    const panesLayout = [{ id: 'main', isMain: true, height: chartHeight, y: 0 }];
    
    activePanes.forEach((ind, i) => {
        let paneHeight = subPaneHeights[ind];
        
        let g = mainGroup.append("g")
            .attr("transform", `translate(0, ${currentSubY})`)
            .attr("class", `pane-${ind}`);
        
        g.append("rect").attr("class", "pane-bg").attr("width", chartWidth).attr("height", paneHeight).attr("fill", colors.paneBg);
        g.append("clipPath").attr("id", `clip-${ind}`)
            .append("rect").attr("width", chartWidth).attr("height", paneHeight);
            
        g.append("g").attr("class", "data-area").attr("clip-path", `url(#clip-${ind})`);
        g.append("g").attr("class", `y-axis font-sans text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`).attr("transform", `translate(${chartWidth}, 0)`);
        
        // Label
        g.append("text").attr("x", 4).attr("y", 12).attr("fill", colors.text).style("font-size", "10px").style("font-weight", "bold").text(ind.toUpperCase());
        
        subPanes[ind] = { g, currentSubY, height: paneHeight };
        panesLayout.push({ id: ind, isMain: false, height: paneHeight, y: currentSubY });
        
        // Splitter logic
        let paneIndex = i + 1; // index in panesLayout
        let splitterY = currentSubY - subPaneGap;
        
        let splitter = mainGroup.append("rect")
            .attr("class", `splitter-${ind}`)
            .attr("x", 0)
            .attr("y", splitterY)
            .attr("width", chartWidth) 
            .attr("height", subPaneGap)
            .attr("fill", "transparent")
            .style("cursor", "row-resize")
            .style("pointer-events", "all");
            
        splitter.call(d3.drag()
            .on("drag", (event) => {
                let dy = event.dy;
                let prevPane = panesLayout[paneIndex - 1];
                let currPane = panesLayout[paneIndex];
                
                let minH = 30;
                if (prevPane.height + dy < minH) dy = minH - prevPane.height;
                if (currPane.height - dy < minH) dy = currPane.height - minH;
                if (dy === 0) return;
                
                prevPane.height += dy;
                currPane.height -= dy;
                currPane.y += dy;
                
                // Update DOM
                if (prevPane.isMain) {
                    chartHeight = prevPane.height;
                    defs.select(`#${clipId} rect`).attr("height", chartHeight);
                    defs.select("#clip-y-axis rect").attr("height", chartHeight);
                    yBase.range([chartHeight, 0]);
                } else {
                    let pg = subPanes[prevPane.id].g;
                    pg.select("rect.pane-bg").attr("height", prevPane.height);
                    pg.select(`clipPath rect`).attr("height", prevPane.height);
                    subPanes[prevPane.id].height = prevPane.height;
                }
                
                let cg = subPanes[currPane.id].g;
                cg.attr("transform", `translate(0, ${currPane.y})`);
                cg.select("rect.pane-bg").attr("height", currPane.height);
                cg.select(`clipPath rect`).attr("height", currPane.height);
                subPanes[currPane.id].height = currPane.height;
                subPanes[currPane.id].currentSubY = currPane.y;
                
                splitter.attr("y", currPane.y - subPaneGap);
                
                // Redraw chart elements instantly
                draw();
            })
            .on("end", () => {
                // Save new heights to React state
                let newHeights = {};
                panesLayout.filter(p => !p.isMain).forEach(p => {
                    newHeights[p.id] = p.height;
                });
                if (onResizeEnd) onResizeEnd(newHeights);
            })
        );
        
        currentSubY += paneHeight + subPaneGap;
    });
    
    // --- SUPPLY/DEMAND LAYER ---
    const sdGroup = chartArea.append("g").attr("class", "sd-layer");

    // --- CROSSHAIR ---
    const drawingsGroup = mainGroup.append("g")
        .attr("class", "drawings-layer")
        .attr("clip-path", `url(#${clipId})`);

    const crosshairGroup = mainGroup.append("g")
        .attr("class", "crosshair")
        .style("display", "none")
        .style("pointer-events", "none");

    crosshairGroup.append("line").attr("class", "xh-x")
        .attr("stroke", colors.xhLine).attr("stroke-dasharray", "4,4").attr("stroke-width", 1)
        .attr("y1", 0).attr("y2", totalInnerHeight);

    crosshairGroup.append("line").attr("class", "xh-y")
        .attr("stroke", colors.xhLine).attr("stroke-dasharray", "4,4").attr("stroke-width", 1)
        .attr("x1", 0).attr("x2", chartWidth);

    crosshairGroup.append("rect").attr("class", "xh-p-bg")
        .attr("fill", colors.xhBg).attr("rx", 3)
        .attr("width", margin.right - 4).attr("height", 20);

    crosshairGroup.append("text").attr("class", "xh-p-txt")
        .attr("fill", colors.xhTxt).style("font-size", "11px").style("font-family", "monospace")
        .attr("text-anchor", "middle").attr("alignment-baseline", "middle");

    crosshairGroup.append("rect").attr("class", "xh-t-bg")
        .attr("fill", colors.xhBg).attr("rx", 3)
        .attr("width", 110).attr("height", 20);

    crosshairGroup.append("text").attr("class", "xh-t-txt")
        .attr("fill", colors.xhTxt).style("font-size", "11px").style("font-family", "monospace")
        .attr("text-anchor", "middle").attr("alignment-baseline", "middle");

    let activeXScale = xBase;
    let activeYScale = yBase;
    
    bgOverlay.on("mousemove", (event) => {
        const [mx, my] = d3.pointer(event, bgOverlay.node());
        crosshairGroup.style("display", "block");
        
        crosshairGroup.select(".xh-x").attr("x1", mx).attr("x2", mx);
        crosshairGroup.select(".xh-y").attr("y1", my).attr("y2", my);

        const price = activeYScale.invert(my);
        
        const domain = activeXScale.domain();
        const range = activeXScale.range();
        let step = activeXScale.step();
        let index = Math.floor((mx - range[0]) / step);
        let timeVal = domain[Math.min(Math.max(index, 0), domain.length - 1)];

        crosshairGroup.select(".xh-p-bg").attr("x", chartWidth + 2).attr("y", my - 10);
        crosshairGroup.select(".xh-p-txt").attr("x", chartWidth + margin.right / 2).attr("y", my + 1).text(price.toFixed(2));

        crosshairGroup.select(".xh-t-bg").attr("x", mx - 55).attr("y", totalInnerHeight + 2);
        crosshairGroup.select(".xh-t-txt").attr("x", mx).attr("y", totalInnerHeight + 12).text(timeVal ? d3.timeFormat("%b %d %H:%M")(new Date(timeVal)) : "");
    });

    bgOverlay.on("mouseleave", () => {
        crosshairGroup.style("display", "none");
    });

    // Types rendering moved to draw() function for performance windowing.

    const alertGroup = chartArea.append("g").attr("class", "alerts-layer");

    // Dynamic Redraw Function
    function draw() {
        const xRange = [0, chartWidth].map(d => cState.tx.applyX(d));
        const x = xBase.copy().range(xRange);
        const bw = x.bandwidth();
        const halfBw = bw / 2;

        let visibleData = dataset;
        // Optimization: Cull candles that are completely off screen.
        // We pad by 2 candles on each side to ensure smooth scrolling.
        visibleData = dataset.filter(d => {
            const xPos = x(d.time);
            return (xPos + bw) >= -bw*2 && (xPos - bw) <= chartWidth + bw*2;
        });

        if (cState.autoScaleY) {
            if (visibleData.length > 0) {
                let minP = d3.min(visibleData, d => d.low) - 2;
                let maxP = d3.max(visibleData, d => d.high) + 2;
                yBase.domain([minP, maxP]);
            }
        }

        const baseRange = [chartHeight, 0];
        const newYRange = cState.autoScaleY ? baseRange : baseRange.map(d => cState.ty.applyY(d));
        const y = yBase.copy().range(newYRange);

        activeXScale = x;
        activeYScale = y;

        const xAxis = d3.axisBottom(x)
            .tickValues(x.domain().filter((d, i) => i % Math.max(1, Math.floor(x.domain().length / 10)) === 0))
            .tickFormat(d => d3.timeFormat("%H:%M")(new Date(d)));
        xAxisGroup.call(xAxis).call(g => g.select(".domain").attr("d", `M0,0.5H${chartWidth}`));
        yAxisGroup.call(d3.axisRight(y).tickFormat(d => "$" + d.toFixed(2)))
            .call(g => g.select(".domain").attr("d", `M0,0V${chartHeight}`));

        gridGroup.call(d3.axisRight(y).tickSize(chartWidth).tickFormat(""))
            .call(g => g.select(".domain").remove())
            .call(g => g.selectAll(".tick line")
                .attr("stroke", colors.grid)
                .attr("stroke-dasharray", "2,4")
                .attr("stroke-opacity", 0.3));

        const cellH = Math.abs(y(state.tickSize) - y(0));
        const rectH = Math.max(cellH - 1, 2);

        // --- Session Separators ---
        gridGroup.selectAll(".session-line").remove();
        let currentDay = -1;
        visibleData.forEach(d => {
            const date = new Date(d.time);
            const day = date.getDate();
            if (currentDay !== -1 && day !== currentDay) {
                let xPos = x(d.time);
                if (xPos !== undefined && xPos >= 0 && xPos <= chartWidth) {
                    gridGroup.append("line").attr("class", "session-line")
                        .attr("x1", xPos).attr("x2", xPos)
                        .attr("y1", 0).attr("y2", chartHeight)
                        .attr("stroke", colors.sessionLine)
                        .attr("stroke-dasharray", "4,4")
                        .attr("stroke-width", 1);
                }
            }
            currentDay = day;
        });

        // --- SDPro ---
        sdGroup.selectAll(".sd-zone-group").remove();
        if (state.indicators.sdPro && dataset.sdZones) {
            dataset.sdZones.forEach(z => {
                if (z.breached) return; 
                let startX = x(z.time);
                if (startX === undefined) return;
                
                let drawX = Math.max(0, startX);
                let drawWidth = chartWidth - drawX;
                if (drawWidth <= 0) return;
                
                let yTop = Math.min(y(z.proximal), y(z.distal));
                let yBottom = Math.max(y(z.proximal), y(z.distal));
                let h = Math.max(1, yBottom - yTop);
                
                let isSupply = z.type === 'supply';
                let fillColor = isSupply ? "rgba(239, 68, 68, 0.25)" : "rgba(34, 197, 94, 0.25)";
                let strokeColor = isSupply ? "rgba(239, 68, 68, 0.8)" : "rgba(34, 197, 94, 0.8)";
                
                const zg = sdGroup.append("g").attr("class", "sd-zone-group");
                
                zg.append("rect")
                    .attr("x", drawX)
                    .attr("y", yTop)
                    .attr("width", drawWidth)
                    .attr("height", h)
                    .attr("fill", fillColor)
                    .attr("stroke", "none");
                    
                // Top border
                zg.append("line")
                    .attr("x1", drawX).attr("x2", chartWidth)
                    .attr("y1", yTop).attr("y2", yTop)
                    .attr("stroke", strokeColor).attr("stroke-width", 1);
                    
                // Bottom border
                zg.append("line")
                    .attr("x1", drawX).attr("x2", chartWidth)
                    .attr("y1", yBottom).attr("y2", yBottom)
                    .attr("stroke", strokeColor).attr("stroke-width", 1);
                    
                // Text Label
                let centerX = drawX + (drawWidth / 2);
                let centerY = yTop + (h / 2);
                let textStr = isSupply ? "Supply Zone" : "Demand Zone";
                
                zg.append("text")
                    .attr("x", centerX)
                    .attr("y", centerY - 4)
                    .attr("fill", "rgba(255, 255, 255, 0.7)")
                    .attr("font-size", "14px")
                    .attr("font-weight", "bold")
                    .attr("text-anchor", "middle")
                    .text(textStr);
                    
                zg.append("text")
                    .attr("x", centerX)
                    .attr("y", centerY + 12)
                    .attr("fill", "rgba(255, 255, 255, 0.6)")
                    .attr("font-size", "11px")
                    .attr("text-anchor", "middle")
                    .text(`Score: ${(z.score || 0).toFixed(2)}`);
            });
        }

        // --- TYPES (WINDOWING) ---
        
        // FOOTPRINT
        const candleNodes = chartArea.selectAll(".candle-node")
            .data(state.chartType === 'footprint' ? visibleData : [], d => d.time)
            .join(
                enter => {
                    const g = enter.append("g").attr("class", "candle-node");
                    g.append("line").attr("class", "wick").attr("stroke-width", 1.5);
                    g.append("rect").attr("class", "body-rect").attr("fill", "transparent");
                    g.append("text").attr("class", "delta-txt").style("font-size", "10px").style("font-weight", "bold").attr("text-anchor", "middle");
                    g.append("text").attr("class", "reb-txt").attr("fill", "#38bdf8").style("font-size", "10px").attr("text-anchor", "middle");
                    return g;
                }
            );

        if (state.chartType === 'footprint') {
            candleNodes.attr("transform", d => `translate(${x(d.time)}, 0)`);
            candleNodes.select(".wick")
                .attr("x1", halfBw).attr("x2", halfBw)
                .attr("y1", d => y(d.high)).attr("y2", d => y(d.low))
                .attr("stroke", d => d.close >= d.open ? "#22c55e" : "#ef4444");
            
            candleNodes.select(".body-rect")
                .attr("x", halfBw - (bw * 0.05)).attr("width", Math.max(1, bw * 0.1))
                .attr("y", d => y(Math.max(d.open, d.close)))
                .attr("height", d => Math.max(Math.abs(y(d.open) - y(d.close)), 2))
                .attr("stroke", d => d.close >= d.open ? "#22c55e" : "#ef4444");

            candleNodes.select(".delta-txt")
                .attr("x", halfBw).attr("y", d => Math.max(y(d.low), y(d3.min(d.levels || [], l => l.price) || d.low)) + 26)
                .style("display", state.layers.delta ? "block" : "none")
                .attr("fill", d => d.delta >= 0 ? "#22c55e" : "#ef4444")
                .text(d => "Δ " + d.delta);

            candleNodes.select(".reb-txt")
                .attr("x", halfBw).attr("y", d => Math.max(y(d.low), y(d3.min(d.levels || [], l => l.price) || d.low)) + 38)
                .style("display", state.layers.volume ? "block" : "none")
                .text(d => "Vol " + d.volume);

            const levels = candleNodes.selectAll(".level")
                .data(d => d.levels || [], l => l.price)
                .join(
                    enter => {
                        const g = enter.append("g").attr("class", "level");
                        g.append("rect").attr("class", "poc-outline").attr("fill", "transparent").attr("stroke", "#f59e0b").attr("stroke-width", 1.5);
                        g.append("rect").attr("class", "left-rect").attr("fill", "rgba(239, 68, 68, 0.3)");
                        g.append("rect").attr("class", "right-rect").attr("fill", "rgba(34, 197, 94, 0.3)");
                        g.append("text").attr("class", "bid-txt").attr("fill", colors.xhTxt).style("font-size", "9px").attr("text-anchor", "middle").attr("alignment-baseline", "middle");
                        g.append("text").attr("class", "ask-txt").attr("fill", colors.xhTxt).style("font-size", "9px").attr("text-anchor", "middle").attr("alignment-baseline", "middle");
                        return g;
                    }
                );

            levels.select(".poc-outline")
                .attr("x", bw * 0.05).attr("y", d => y(d.price) - cellH / 2 + 1)
                .attr("width", bw * 0.90).attr("height", Math.max(1, rectH - 2))
                .style("display", function(d) {
                    let pDatum = d3.select(this.parentNode.parentNode).datum();
                    return d.price === pDatum?.poc ? "block" : "none";
                });

            levels.select(".left-rect")
                .attr("x", bw * 0.05).attr("y", d => y(d.price) - cellH / 2 + 1)
                .attr("width", bw * 0.40).attr("height", Math.max(1, rectH - 2))
                .attr("stroke", d => d.bidImbalance ? "#eab308" : "none")
                .attr("stroke-width", d => d.bidImbalance ? 2 : 0);

            levels.select(".right-rect")
                .attr("x", bw * 0.55).attr("y", d => y(d.price) - cellH / 2 + 1)
                .attr("width", bw * 0.40).attr("height", Math.max(1, rectH - 2))
                .attr("stroke", d => d.askImbalance ? "#eab308" : "none")
                .attr("stroke-width", d => d.askImbalance ? 2 : 0);

            const showText = state.layers.footprintText && bw > 30 && cellH >= 9;
            levels.selectAll(".bid-txt, .ask-txt").style("display", showText ? "block" : "none");
            
            levels.select(".bid-txt")
                .attr("x", bw * 0.25).attr("y", d => y(d.price) + 1)
                .attr("fill", d => d.bidImbalance ? "#fef08a" : colors.xhTxt)
                .attr("font-weight", d => d.bidImbalance ? "bold" : "normal")
                .text(d => d.bid);
            levels.select(".ask-txt")
                .attr("x", bw * 0.75).attr("y", d => y(d.price) + 1)
                .attr("fill", d => d.askImbalance ? "#fef08a" : colors.xhTxt)
                .attr("font-weight", d => d.askImbalance ? "bold" : "normal")
                .text(d => d.ask);
        }

        // STANDARD CANDLES & HA
        const isHA = state.chartType === 'heikin-ashi';
        const showStd = (state.chartType === 'candlestick' || state.chartType === 'heikin-ashi');
        
        const stdG = chartArea.selectAll(".std-candle")
            .data(showStd ? visibleData : [], d => d.time)
            .join(
                enter => {
                    const g = enter.append("g").attr("class", "std-candle");
                    g.append("line").attr("class", "wick").attr("stroke-width", 1.5);
                    g.append("rect").attr("class", "body-rect").attr("rx", 1);
                    return g;
                }
            );

        if (showStd) {
            stdG.attr("transform", d => `translate(${x(d.time)}, 0)`);
            stdG.select(".wick")
                .attr("x1", halfBw).attr("x2", halfBw)
                .attr("y1", d => y(isHA ? d.haHigh : d.high))
                .attr("y2", d => y(isHA ? d.haLow : d.low))
                .attr("stroke", d => d.close >= d.open ? "#22c55e" : "#ef4444");
                
            stdG.select(".body-rect")
                .attr("x", 0).attr("width", bw)
                .attr("y", d => y(Math.max(isHA ? d.haOpen : d.open, isHA ? d.haClose : d.close)))
                .attr("height", d => Math.max(Math.abs(y(isHA ? d.haOpen : d.open) - y(isHA ? d.haClose : d.close)), 2))
                .attr("fill", d => d.close >= d.open ? "#22c55e" : "#ef4444");
        }

        // LINE CHART
        let chartLine = chartArea.selectAll(".chart-line")
            .data(state.chartType === 'line' ? [visibleData] : []);
            
        chartLine.enter().append("path").attr("class", "chart-line")
            .attr("fill", "none").attr("stroke", "#3b82f6").attr("stroke-width", 2)
            .merge(chartLine)
            .attr("d", d3.line().x(d => (x(d.time) || 0) + halfBw).y(d => y(d.close)));
            
        chartLine.exit().remove();

        // OHLC BARS
        const ohlcG = chartArea.selectAll(".ohlc-bar")
            .data(state.chartType === 'ohlc' ? visibleData : [], d => d.time)
            .join(
                enter => {
                    const g = enter.append("g").attr("class", "ohlc-bar");
                    g.append("line").attr("class", "ohlc-stem").attr("stroke-width", 1.5);
                    g.append("line").attr("class", "ohlc-open").attr("stroke-width", 1.5);
                    g.append("line").attr("class", "ohlc-close").attr("stroke-width", 1.5);
                    return g;
                }
            );

        if (state.chartType === 'ohlc') {
            ohlcG.attr("transform", d => `translate(${x(d.time)}, 0)`);
            ohlcG.select(".ohlc-stem")
                .attr("x1", halfBw).attr("x2", halfBw).attr("y1", d => y(d.high)).attr("y2", d => y(d.low))
                .attr("stroke", d => d.close >= d.open ? "#22c55e" : "#ef4444");
            ohlcG.select(".ohlc-open")
                .attr("x1", 0).attr("x2", halfBw).attr("y1", d => y(d.open)).attr("y2", d => y(d.open))
                .attr("stroke", d => d.close >= d.open ? "#22c55e" : "#ef4444");
            ohlcG.select(".ohlc-close")
                .attr("x1", halfBw).attr("x2", bw).attr("y1", d => y(d.close)).attr("y2", d => y(d.close))
                .attr("stroke", d => d.close >= d.open ? "#22c55e" : "#ef4444");
        }

        // --- ALERTS ---
        alertGroup.selectAll("*").remove();
        state.alerts.forEach(al => {
            if (!al.active) return;
            const yPos = y(al.price);
            if (yPos >= 0 && yPos <= chartHeight) {
                const g = alertGroup.append("g");
                g.append("line")
                    .attr("x1", 0).attr("x2", chartWidth)
                    .attr("y1", yPos).attr("y2", yPos)
                    .attr("stroke", "#f59e0b").attr("stroke-dasharray", "4,4").attr("stroke-width", 1.5);

                g.append("rect")
                    .attr("x", chartWidth - 55).attr("y", yPos - 10)
                    .attr("width", 55).attr("height", 20)
                    .attr("fill", "#f59e0b").attr("rx", 3);

                g.append("text")
                    .attr("x", chartWidth - 27).attr("y", yPos + 3)
                    .attr("fill", "#090d16").attr("text-anchor", "middle")
                    .style("font-size", "10px").style("font-weight", "bold")
                    .text(`$${al.price.toFixed(2)}`);
            }
        });

        // --- SMA / EMA ---
        chartArea.selectAll(".ma-line").remove();
        if (state.indicators.sma) {
            let smaLine = d3.line().x(d => (x(d.time) || 0) + halfBw).y(d => y(d.sma)).defined(d => d.sma !== null);
            chartArea.append("path").attr("class", "ma-line").attr("d", smaLine(visibleData)).attr("fill", "none").attr("stroke", "#06b6d4").attr("stroke-width", 1.5);
        }
        if (state.indicators.ema) {
            let emaLine = d3.line().x(d => (x(d.time) || 0) + halfBw).y(d => y(d.ema)).defined(d => d.ema !== null);
            chartArea.append("path").attr("class", "ma-line").attr("d", emaLine(visibleData)).attr("fill", "none").attr("stroke", "#a855f7").attr("stroke-width", 1.5);
        }

        // --- SUB-PANES ---
        if (state.indicators.macd && subPanes.macd) {
            let p = subPanes.macd.g;
            let vData = dataset.filter(d => (x(d.time) || -bw) >= -bw && (x(d.time) || chartWidth + bw) <= chartWidth + bw);
            let minM = d3.min(vData, d => Math.min(d.macdLine, d.macdHist)) || -1;
            let maxM = d3.max(vData, d => Math.max(d.macdLine, d.macdHist)) || 1;
            let yMacd = d3.scaleLinear().domain([minM * 1.1, maxM * 1.1]).range([subPanes.macd.height, 0]);
            
            p.select(".y-axis").call(d3.axisRight(yMacd).ticks(4));
            let area = p.select(".data-area");
            area.selectAll("*").remove();
            
            area.append("line").attr("x1", 0).attr("x2", chartWidth).attr("y1", yMacd(0)).attr("y2", yMacd(0)).attr("stroke", "#475569").attr("stroke-dasharray", "2,2");
            
            area.selectAll(".hist").data(visibleData.filter(d => d.macdHist !== null)).enter().append("rect").attr("class", "hist")
                .attr("x", d => x(d.time)).attr("width", bw)
                .attr("y", d => Math.min(yMacd(0), yMacd(d.macdHist)))
                .attr("height", d => Math.max(1, Math.abs(yMacd(0) - yMacd(d.macdHist))))
                .attr("fill", d => d.macdHist >= 0 ? "rgba(34, 197, 94, 0.5)" : "rgba(239, 68, 68, 0.5)");
                
            let mLine = d3.line().x(d => (x(d.time) || 0) + halfBw).y(d => yMacd(d.macdLine)).defined(d => d.macdLine !== null);
            let sLine = d3.line().x(d => (x(d.time) || 0) + halfBw).y(d => yMacd(d.macdSignal)).defined(d => d.macdSignal !== null);
            area.append("path").attr("d", mLine(visibleData)).attr("fill", "none").attr("stroke", "#3b82f6").attr("stroke-width", 1.5);
            area.append("path").attr("d", sLine(visibleData)).attr("fill", "none").attr("stroke", "#f59e0b").attr("stroke-width", 1.5);
        }
        
        if (state.indicators.rsi && subPanes.rsi) {
            let p = subPanes.rsi.g;
            let yRsi = d3.scaleLinear().domain([0, 100]).range([subPanes.rsi.height, 0]);
            p.select(".y-axis").call(d3.axisRight(yRsi).tickValues([30, 70]));
            let area = p.select(".data-area");
            area.selectAll("*").remove();
            
            area.append("rect").attr("x", 0).attr("y", yRsi(70)).attr("width", chartWidth).attr("height", yRsi(30) - yRsi(70)).attr("fill", "rgba(147, 51, 234, 0.1)");
            area.append("line").attr("x1", 0).attr("x2", chartWidth).attr("y1", yRsi(70)).attr("y2", yRsi(70)).attr("stroke", "#9333ea").attr("stroke-dasharray", "4,4");
            area.append("line").attr("x1", 0).attr("x2", chartWidth).attr("y1", yRsi(30)).attr("y2", yRsi(30)).attr("stroke", "#9333ea").attr("stroke-dasharray", "4,4");
            
            let rLine = d3.line().x(d => (x(d.time) || 0) + halfBw).y(d => yRsi(d.rsi)).defined(d => d.rsi !== null);
            area.append("path").attr("d", rLine(visibleData)).attr("fill", "none").attr("stroke", "#c084fc").attr("stroke-width", 1.5);
        }

        if (state.indicators.demarker && subPanes.demarker) {
            let p = subPanes.demarker.g;
            let yDem = d3.scaleLinear().domain([0, 1]).range([subPanes.demarker.height, 0]);
            p.select(".y-axis").call(d3.axisRight(yDem).tickValues([0.3, 0.7]));
            let area = p.select(".data-area");
            area.selectAll("*").remove();
            
            area.append("rect").attr("x", 0).attr("y", yDem(0.7)).attr("width", chartWidth).attr("height", yDem(0.3) - yDem(0.7)).attr("fill", "rgba(236, 72, 153, 0.1)");
            area.append("line").attr("x1", 0).attr("x2", chartWidth).attr("y1", yDem(0.7)).attr("y2", yDem(0.7)).attr("stroke", "#ec4899").attr("stroke-dasharray", "4,4");
            area.append("line").attr("x1", 0).attr("x2", chartWidth).attr("y1", yDem(0.3)).attr("y2", yDem(0.3)).attr("stroke", "#ec4899").attr("stroke-dasharray", "4,4");
            
            let dLine = d3.line().x(d => (x(d.time) || 0) + halfBw).y(d => yDem(d.demarker)).defined(d => d.demarker !== null);
            area.append("path").attr("d", dLine(visibleData)).attr("fill", "none").attr("stroke", "#f472b6").attr("stroke-width", 1.5);
        }
        
        // --- DRAWINGS ---
        drawingsGroup.selectAll("*").remove();
        let currentDrawings = (state.drawings && state.drawings[state.symbol]) ? [...state.drawings[state.symbol]] : [];
        if (isDrawing && currentDrawing) {
            currentDrawings.push(currentDrawing);
        }
        
        currentDrawings.forEach(d => {
            if (d.type === 'trendline' && d.points.length === 2) {
                let px1 = x(d.points[0].time) + halfBw;
                let py1 = y(d.points[0].price);
                let px2 = x(d.points[1].time) + halfBw;
                let py2 = y(d.points[1].price);
                
                let line = drawingsGroup.append("line")
                    .attr("x1", px1).attr("y1", py1)
                    .attr("x2", px2).attr("y2", py2)
                    .attr("stroke", "#3b82f6").attr("stroke-width", 2)
                    .style("cursor", "pointer")
                    .style("pointer-events", "stroke");
                    
                line.on("click", (e) => {
                    if (state.activeTool === 'cursor' && onDrawDelete) {
                        e.stopPropagation();
                        onDrawDelete(d.id);
                    }
                });
            } else if (d.type === 'horizontal' && d.points.length > 0) {
                let py = y(d.points[0].price);
                let line = drawingsGroup.append("line")
                    .attr("x1", 0).attr("y1", py)
                    .attr("x2", chartWidth).attr("y2", py)
                    .attr("stroke", "#3b82f6").attr("stroke-width", 2)
                    .style("cursor", "pointer")
                    .style("pointer-events", "stroke");
                    
                line.on("click", (e) => {
                    if (state.activeTool === 'cursor' && onDrawDelete) {
                        e.stopPropagation();
                        onDrawDelete(d.id);
                    }
                });
            } else if (d.type === 'vertical' && d.points.length > 0) {
                let px = x(d.points[0].time) + halfBw;
                let line = drawingsGroup.append("line")
                    .attr("x1", px).attr("y1", 0)
                    .attr("x2", px).attr("y2", chartHeight)
                    .attr("stroke", "#3b82f6").attr("stroke-width", 2)
                    .style("cursor", "pointer")
                    .style("pointer-events", "stroke");
                    
                line.on("click", (e) => {
                    if (state.activeTool === 'cursor' && onDrawDelete) {
                        e.stopPropagation();
                        onDrawDelete(d.id);
                    }
                });
            } else if (d.type === 'rectangle' && d.points.length === 2) {
                let px1 = x(d.points[0].time) + halfBw;
                let py1 = y(d.points[0].price);
                let px2 = x(d.points[1].time) + halfBw;
                let py2 = y(d.points[1].price);
                
                let rect = drawingsGroup.append('rect')
                    .attr('x', Math.min(px1, px2))
                    .attr('y', Math.min(py1, py2))
                    .attr('width', Math.abs(px2 - px1))
                    .attr('height', Math.abs(py2 - py1))
                    .attr('fill', 'rgba(99, 102, 241, 0.2)')
                    .attr('stroke', '#6366f1')
                    .attr('stroke-width', 1.5)
                    .style('cursor', 'pointer')
                    .style('pointer-events', 'all');
                    
                rect.on('click', (e) => {
                    if (state.activeTool === 'cursor' && onDrawDelete) {
                        e.stopPropagation();
                        onDrawDelete(d.id);
                    }
                });
            } else if ((d.type === 'long_position' || d.type === 'short_position') && d.entry) {
                const isLong = d.type === 'long_position';
                let px = x(d.entry.time) + halfBw;
                let pyEntry = y(d.entry.price);
                let pyTP = y(d.tpPrice);
                let pySL = y(d.slPrice);
                
                // Assuming fixed 10 candle width for now
                let step = x.step();
                let width = step * (d.width || 10);
                
                let group = drawingsGroup.append('g')
                    .style('cursor', 'pointer');
                    
                // Profit Zone (Green)
                let profitY = Math.min(pyEntry, pyTP);
                let profitH = Math.abs(pyEntry - pyTP);
                group.append('rect')
                    .attr('x', px)
                    .attr('y', profitY)
                    .attr('width', width)
                    .attr('height', profitH)
                    .attr('fill', 'rgba(34, 197, 94, 0.3)')
                    .attr('stroke', 'rgba(34, 197, 94, 0.8)')
                    .attr('stroke-width', 1);
                    
                // Loss Zone (Red)
                let lossY = Math.min(pyEntry, pySL);
                let lossH = Math.abs(pyEntry - pySL);
                group.append('rect')
                    .attr('x', px)
                    .attr('y', lossY)
                    .attr('width', width)
                    .attr('height', lossH)
                    .attr('fill', 'rgba(239, 68, 68, 0.3)')
                    .attr('stroke', 'rgba(239, 68, 68, 0.8)')
                    .attr('stroke-width', 1);
                    
                // Center Line
                group.append('line')
                    .attr('x1', px).attr('y1', pyEntry)
                    .attr('x2', px + width).attr('y2', pyEntry)
                    .attr('stroke', '#cbd5e1')
                    .attr('stroke-dasharray', '4,2')
                    .attr('stroke-width', 1);
                    
                // Risk/Reward Text
                let riskAmount = Math.abs(d.entry.price - d.slPrice);
                let rewardAmount = Math.abs(d.tpPrice - d.entry.price);
                let rr = riskAmount > 0 ? (rewardAmount / riskAmount).toFixed(2) : '0.00';
                
                group.append('text')
                    .attr('x', px + width / 2)
                    .attr('y', profitY + profitH / 2 + 4)
                    .attr('fill', '#f8fafc')
                    .attr('text-anchor', 'middle')
                    .style('font-size', '10px')
                    .style('font-weight', 'bold')
                    .style('pointer-events', 'none')
                    .text(rr);
                
                // SL Handle
                let slHandle = group.append('rect')
                    .attr('x', px).attr('y', pySL - 3)
                    .attr('width', width).attr('height', 6)
                    .attr('fill', 'transparent')
                    .style('cursor', 'ns-resize')
                    .style('pointer-events', 'all');
                    
                // TP Handle
                let tpHandle = group.append('rect')
                    .attr('x', px).attr('y', pyTP - 3)
                    .attr('width', width).attr('height', 6)
                    .attr('fill', 'transparent')
                    .style('cursor', 'ns-resize')
                    .style('pointer-events', 'all');
                    
                if (state.activeTool === 'cursor') {
                    // Update state callback (hacky way using onDrawComplete for updates)
                    const updatePosition = (newTP, newSL) => {
                        if (onDrawComplete) {
                            if (onDrawDelete) onDrawDelete(d.id);
                            onDrawComplete({ ...d, tpPrice: newTP, slPrice: newSL });
                        }
                    };

                    tpHandle.call(d3.drag()
                        .on('drag', (event) => {
                            let newP = activeYScale.invert(event.y);
                            d.tpPrice = newP; // mutate local for immediate visual
                            draw(); // re-render visually immediately
                        })
                        .on('end', () => {
                            updatePosition(d.tpPrice, d.slPrice);
                        }));
                        
                    slHandle.call(d3.drag()
                        .on('drag', (event) => {
                            let newP = activeYScale.invert(event.y);
                            d.slPrice = newP;
                            draw();
                        })
                        .on('end', () => {
                            updatePosition(d.tpPrice, d.slPrice);
                        }));
                        
                    // Delete on click body
                    group.on('click', (e) => {
                        if (e.defaultPrevented) return; // dragged
                        e.stopPropagation();
                        if (onDrawDelete) onDrawDelete(d.id);
                    });
                }
            }
        });

        // Add a triggerDraw reference for external UI to call
        if (svgNode) {
            svgNode._triggerDraw = draw;
        }

        if (typeof onPanUpdate === 'function') {
            onPanUpdate(cState);
        }
    }

    bgOverlay.on("click", function (event) {
        if (state.activeTool !== 'cursor') return;
        if (!state.settingAlert) return;
        const coords = d3.pointer(event, bgOverlay.node());
        const yCoord = coords[1];

        const baseRange = [chartHeight, 0];
        const yMapped = cState.autoScaleY ? yBase : yBase.copy().range(baseRange.map(d => cState.ty.applyY(d)));
        const clickedPrice = parseFloat(yMapped.invert(yCoord).toFixed(2));

        if(setAlertsCallback) setAlertsCallback(clickedPrice);
    });
    
    // Drawing Interaction Logic
    bgOverlay.on("mousedown.draw", function(event) {
        if (state.activeTool === 'cursor') return;
        const [mx, my] = d3.pointer(event, bgOverlay.node());
        const price = activeYScale.invert(my);
        const domain = activeXScale.domain();
        const step = activeXScale.step();
        const index = Math.max(0, Math.min(domain.length - 1, Math.floor((mx - activeXScale.range()[0]) / step)));
        const timeVal = domain[index];

        if (state.activeTool === 'horizontal' || state.activeTool === 'vertical') {
            onDrawComplete({
                id: Date.now(),
                type: state.activeTool,
                points: [{ time: timeVal, price: price }]
            });
            return;
        }

        if (state.activeTool === 'trendline' || state.activeTool === 'rectangle') {
            isDrawing = true;
            currentDrawing = {
                id: Date.now(),
                type: state.activeTool,
                points: [{ time: timeVal, price: price }, { time: timeVal, price: price }]
            };
            draw();
            return;
        }

        if (state.activeTool === 'long_position' || state.activeTool === 'short_position') {
            // Default RR handles (Stop Loss and Take Profit). 
            // In a real chart, we'd base this off ATR, but a fixed % or fixed dollar amount works for now.
            // Let's use 0.5% for SL and 1% for TP as defaults based on the clicked price.
            let slOffset = price * 0.005; 
            let tpOffset = price * 0.01;
            
            // If the price is very small (like forex), 0.5% might be huge or tiny, but it scales visually.
            
            let tpPrice = state.activeTool === 'long_position' ? price + tpOffset : price - tpOffset;
            let slPrice = state.activeTool === 'long_position' ? price - slOffset : price + slOffset;

            onDrawComplete({
                id: Date.now(),
                type: state.activeTool,
                entry: { time: timeVal, price: price },
                tpPrice: tpPrice,
                slPrice: slPrice,
                width: 10 // default 10 candles wide
            });
            return;
        }
    });

    bgOverlay.on("mousemove.draw", function(event) {
        if (!isDrawing || !currentDrawing) return;
        const [mx, my] = d3.pointer(event, bgOverlay.node());
        const price = activeYScale.invert(my);
        const domain = activeXScale.domain();
        const step = activeXScale.step();
        const index = Math.max(0, Math.min(domain.length - 1, Math.floor((mx - activeXScale.range()[0]) / step)));
        const timeVal = domain[index];
        
        currentDrawing.points[1] = { time: timeVal, price: price };
        draw();
    });

    bgOverlay.on("mouseup.draw", function(event) {
        if (!isDrawing) return;
        isDrawing = false;
        if (currentDrawing && onDrawComplete) {
            onDrawComplete(currentDrawing);
        }
        currentDrawing = null;
        draw();
    });

    const chartZoom = d3.zoom()
        .scaleExtent([0.15, 12])
        .filter((event) => {
            return state.activeTool === 'cursor' && (!event.ctrlKey && event.type !== 'dblclick');
        })
        .on("zoom", (event) => {
            if (event.sourceEvent && event.sourceEvent.type === 'wheel') {
                // TV style: wheel zooms horizontally (x-axis)
                // d3.zoom automatically computes the new transform around the mouse cursor
                cState.tx = event.transform;
            } else if (event.sourceEvent && event.sourceEvent.type === 'mousemove') {
                // TV style: drag pans
                const dx = event.sourceEvent.movementX;
                const dy = event.sourceEvent.movementY;
                cState.tx = cState.tx.translate(dx / cState.tx.k, 0);
                
                if (dy !== 0 && event.sourceEvent.buttons === 1) {
                    cState.autoScaleY = false;
                    cState.ty = cState.ty.translate(0, dy / cState.ty.k);
                }
            }
            if (cState.tx.applyX(0) > -100 && onLoadMore) {
                onLoadMore();
            }
            draw();
        });

    // We must apply the current tx to the zoom behavior so it scales correctly relative to existing zoom
    chartZoom.transform(bgOverlay, cState.tx);
    bgOverlay.call(chartZoom);

    // Y-Axis zoom: dragging scales the Y axis
    const yAxisDrag = d3.drag()
        .on("drag", (event) => {
            cState.autoScaleY = false;
            const dy = event.dy;
            const cy = chartHeight / 2; // scale around center
            const k_adj = Math.exp(-dy * 0.005);
            cState.ty = cState.ty.translate(0, cy).scale(k_adj).translate(0, -cy);
            draw();
        });
    yAxisOverlay.call(yAxisDrag);

    yAxisOverlay.on("dblclick", () => {
        cState.autoScaleY = true;
        cState.ty = d3.zoomIdentity;
        draw();
    });

    // X-Axis zoom: dragging scales the X axis
    const xAxisDrag = d3.drag()
        .on("drag", (event) => {
            const dx = event.dx;
            // Get mouse position relative to the x-axis overlay to scale around cursor
            const mx = d3.pointer(event, xAxisOverlay.node())[0]; 
            const k_adj = Math.exp(dx * 0.005);
            cState.tx = cState.tx.translate(mx, 0).scale(k_adj).translate(-mx, 0);
            
            // Sync the chartZoom behavior so wheel zoom doesn't jump
            chartZoom.transform(bgOverlay, cState.tx);
            draw();
        });
    xAxisOverlay.call(xAxisDrag);

    draw(); // Initial Draw
}
