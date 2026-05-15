// IMPORTANT: Update the fallback URL when Kaggle/ngrok gives you a new public endpoint.
const DEFAULT_API_BASE_URL = " https://strike-happily-lurk.ngrok-free.dev";
const API_BASE_URL = (() => {
    const params = new URLSearchParams(window.location.search);
    const queryUrl = params.get("apiBaseUrl");
    const savedUrl = window.localStorage.getItem("apiBaseUrl");
    const resolvedUrl = queryUrl || savedUrl || DEFAULT_API_BASE_URL;

    if (queryUrl) {
        window.localStorage.setItem("apiBaseUrl", queryUrl);
    }

    return resolvedUrl.replace(/\/$/, "");
})();

function postJson(path, payload) {
    return fetch(`${API_BASE_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    }).then(parseApiResponse);
}

const sentimentColors = {
    positive: "#22c55e",
    negative: "#ef4444",
    neutral: "#94a3b8"
};

const topicLabelMap = {
    0: "Baggage Issues",
    1: "Flight Delays",
    2: "Customer Service"
    // Add the rest of your BERTopic labels here, up to topic 14.
};

const perturbationColors = {
    dict_synonym: "#2ca02c",
    dict_antonym: "#d62728",
    dict_remove: "#9333ea",
    custom_replace: "#edef4b",
    llm_paraphrase: "#1f77b4",
    llm_opposite: "#ff7f0e",
    noise: "#7f7f7f"
};

const keywordHighlightColor = "#facc15";

const mapContainer = document.getElementById("scatterplot-container");
const rect = mapContainer.getBoundingClientRect();
const width = rect.width;
const height = rect.height;

const svg = d3.select("#map")
    .attr("width", width)
    .attr("height", height);

const zoomGroup = svg.append("g").attr("id", "zoom-group");
const linkLayer = zoomGroup.append("g").attr("id", "link-layer");
const nodeLayer = zoomGroup.append("g").attr("id", "node-layer");
const brushLayer = svg.append("g").attr("class", "brush").style("display", "none");

const xAxisGroup = svg.append("g").attr("class", "x-axis");
const yAxisGroup = svg.append("g").attr("class", "y-axis");



svg.append("defs").append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 8)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#555");

const btnPerturb = document.getElementById("btn-perturb");
const btnClear = document.getElementById("btn-clear");
const btnResetZoom = document.getElementById("btn-reset-zoom");
const btnZoomSelection = document.getElementById("btn-zoom-selection");
const btnZoomOut = document.getElementById("btn-zoom-out");
let btnPanSelection = document.getElementById("btn-pan-selection");
const colorEncodingSelect = document.getElementById("color-encoding-select");
const mapToolbar = document.getElementById("map-toolbar");
const interactionClickBtn = document.getElementById("interaction-click");
const interactionBrushBtn = document.getElementById("interaction-brush");
const selectionPointBtn = document.getElementById("selection-point");
const selectionClusterBtn = document.getElementById("selection-cluster");
const selectionViewSentimentBtn = document.getElementById("selection-view-sentiment");
const selectionViewAirlineBtn = document.getElementById("selection-view-airline");
const selectionViewTopicBtn = document.getElementById("selection-view-topic");

const centerButton = document.createElement("button");
centerButton.id = "btn-pan-selection";
centerButton.className = "toolbar-pill";
centerButton.textContent = "Center";
centerButton.title = "Center current selection";
centerButton.disabled = true;
centerButton.style.minWidth = "78px";
centerButton.style.fontWeight = "600";
btnPanSelection.replaceWith(centerButton);
btnPanSelection = centerButton;

const btnClearSelection = document.createElement("button");
btnClearSelection.id = "btn-clear-selection";
btnClearSelection.className = "toolbar-pill";
btnClearSelection.textContent = "Clear Selection";
btnClearSelection.title = "Clear current selection";
btnClearSelection.disabled = true;
btnClearSelection.style.minWidth = "118px";
btnClearSelection.style.fontWeight = "600";
mapToolbar.insertBefore(btnClearSelection, btnZoomSelection);

let xScale;
let yScale;
let allNodesData = [];
let selectedNodesData = [];
let airlineColorScale = d3.scaleOrdinal(d3.schemeCategory10);
let topicColorScale = d3.scaleOrdinal(d3.schemeCategory10);
let currentColorEncoding = "sentiment";
let interactionMode = "click";
let selectionMode = "point";
let currentSelectionChartView = "sentiment";
let originalClickedNode = null;

const wordBasedPerturbations = ["dict_synonym", "dict_antonym", "dict_remove", "custom_replace"];
const tweetBasedPerturbations = ["llm_paraphrase", "llm_opposite", "noise"];
let brushModeActive = false;
let perturbationResults = [];
let activePerturbationKey = null;
let targetWordForPerturbation = null;

const baseNodeRadius = 6;
const axisTickCount = 8;
const perturbationLabels = {
    dict_synonym: "Synonym",
    dict_antonym: "Antonym",
    llm_paraphrase: "Paraphrase",
    llm_opposite: "Opposite",
    noise: "Noise"
};

function getTopicLabel(topicId) {
    return topicId === -1 ? "Outlier" : (topicLabelMap[topicId] || `Topic ${topicId}`);
}

function normalizeTopicId(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? -1 : parsed;
}

function getUniqueNodes(nodes) {
    return Array.from(new Map(nodes.map(node => [node.id, node])).values());
}

function getTopicDataById(topicId) {
    return allTopicsData.find(topic => topic.id === topicId);
}

function updateBertopicSelectionSummary(nodes) {
    if (!nodes || !nodes.length) {
        renderTopicBarchart(null);
        const selector = document.getElementById("topic-selector");
        if (selector) selector.selectedIndex = -1;
        return;
    }

    const dominantTopicId = getDominantTopicId(nodes);
    if (dominantTopicId === null) {
        renderTopicBarchart(null);
        const selector = document.getElementById("topic-selector");
        if (selector) selector.selectedIndex = -1;
        return;
    }

    const topicData = getTopicDataById(dominantTopicId);
    if (!topicData) return;

    // Auto-select the topic in the dropdown
    const selector = document.getElementById("topic-selector");
    if (selector) {
        selector.value = String(dominantTopicId);
    }

    // Render the bar chart for the dominant topic's keywords
    renderTopicBarchart(topicData.words);
}

function getDominantTopicId(nodes) {
    const topicCounts = new Map();

    nodes.forEach(node => {
        if (node.topic_id === -1 || node.topic_id === undefined || node.topic_id === null) return;
        topicCounts.set(node.topic_id, (topicCounts.get(node.topic_id) || 0) + 1);
    });

    let dominantTopicId = null;
    let maxCount = 0;
    topicCounts.forEach((count, topicId) => {
        if (count > maxCount) {
            maxCount = count;
            dominantTopicId = topicId;
        }
    });

    return dominantTopicId;
}

function getClusterKey(node) {
    switch (currentSelectionChartView) {
        case "sentiment":
            return node.sentiment;
        case "airline":
            return node.airline;
        case "topic":
            return node.topic_id;
        default:
            return node.topic_id;
    }
}

function getDominantClusterKey(nodes) {
    const keyCounts = new Map();

    nodes.forEach(node => {
        const key = getClusterKey(node);
        if (key === -1 || key === undefined || key === null) return;
        keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
    });

    let dominantKey = null;
    let maxCount = 0;
    keyCounts.forEach((count, key) => {
        if (count > maxCount) {
            maxCount = count;
            dominantKey = key;
        }
    });

    return dominantKey;
}

function resolveClickSelectionMode(nodes, originalNode = null) {
    const uniqueNodes = getUniqueNodes(nodes);
    if (selectionMode !== "cluster" || !uniqueNodes.length) {
        return uniqueNodes;
    }

    const nodeToUse = originalNode || uniqueNodes[0];
    const selectedKey = getClusterKey(nodeToUse);
    if (selectedKey === -1 || selectedKey === undefined || selectedKey === null) {
        return uniqueNodes;
    }

    return allNodesData.filter(node => getClusterKey(node) === selectedKey);
}

function resolveBrushSelectionMode(nodes) {
    const uniqueNodes = Array.from(new Map(nodes.map(node => [node.id, node])).values());
    if (selectionMode !== "cluster" || !uniqueNodes.length) {
        return uniqueNodes;
    }

    const dominantKey = getDominantClusterKey(uniqueNodes);
    if (dominantKey === null) {
        return uniqueNodes;
    }

    return allNodesData.filter(node => getClusterKey(node) === dominantKey);
}

function resolveSelectionForCurrentMode(nodes, originalNode = null) {
    if (!nodes || !nodes.length) return [];
    if (selectionMode !== "cluster") {
        return getUniqueNodes(nodes);
    }

    if (interactionMode === "brush") {
        return resolveBrushSelectionMode(nodes);
    }

    return resolveClickSelectionMode(nodes, originalNode);
}

function reapplySelectionMode() {
    if (!selectedNodesData.length) return;
    const resolvedNodes = resolveSelectionForCurrentMode(selectedNodesData, originalClickedNode);
    selectNodes(resolvedNodes, { append: false, toggle: false });
}

function syncModeButtons() {
    interactionClickBtn.classList.toggle("active", interactionMode === "click");
    interactionBrushBtn.classList.toggle("active", interactionMode === "brush");
    selectionPointBtn.classList.toggle("active", selectionMode === "point");
    selectionClusterBtn.classList.toggle("active", selectionMode === "cluster");
}

function setResetButtonVisibility(visible) {
    if (!btnResetZoom) return;
    btnResetZoom.style.display = visible ? "inline-flex" : "none";
    btnResetZoom.disabled = !visible;
}

function setCenterButtonEnabled(enabled) {
    if (!btnPanSelection) return;
    btnPanSelection.disabled = !enabled;
    if (enabled) {
        btnPanSelection.removeAttribute("disabled");
    } else {
        btnPanSelection.setAttribute("disabled", "");
    }
}

function stopViewTransitions() {
    svg.interrupt();
    xAxisGroup.interrupt();
    yAxisGroup.interrupt();
}

function applyZoomTransform(transform, duration = 0) {
    stopViewTransitions();

    if (duration > 0) {
        svg.transition()
            .duration(duration)
            .ease(d3.easeCubicOut)
            .call(zoom.transform, transform);
        return;
    }

    svg.call(zoom.transform, transform);
}

function isViewTransformed() {
    const t = d3.zoomTransform(svg.node());
    return t.k !== 1 || t.x !== 0 || t.y !== 0;
}

function hasOffscreenPerturbedNode() {
    const t = d3.zoomTransform(svg.node());
    let hasOffscreenNode = false;

    nodeLayer.selectAll("circle.node").each(function () {
        if (hasOffscreenNode || this.dataset.perturbed !== "true") return;

        const localX = Number(this.getAttribute("cx"));
        const localY = Number(this.getAttribute("cy"));
        const screenX = t.applyX(localX);
        const screenY = t.applyY(localY);

        if (screenX < 0 || screenX > width || screenY < 0 || screenY > height) {
            hasOffscreenNode = true;
        }
    });

    return hasOffscreenNode;
}

function canPanMap() {
    return !brushModeActive && (isViewTransformed() || hasOffscreenPerturbedNode());
}

function getNodeElement(node) {
    return document.getElementById(`node-${node.id}`);
}

function getCurrentNodePosition(node) {
    const el = getNodeElement(node);
    if (!el) {
        return { x: xScale(node.x), y: yScale(node.y) };
    }

    return {
        x: Number(el.getAttribute("cx")),
        y: Number(el.getAttribute("cy"))
    };
}

function getNodeFillColor(node) {
    if (currentColorEncoding === "airline") {
        return airlineColorScale(node.airline);
    }
    if (currentColorEncoding === "topic") {
        return node.topic_id === -1 ? "#cbd5e1" : topicColorScale(node.topic_id);
    }

    return sentimentColors[node.sentiment] || "#64748b";
}

function updateNodeColors() {
    nodeLayer.selectAll("circle.node").each(function (d) {
        const circle = d3.select(this);
        const isPerturbed = this.dataset.perturbed === "true";

        if (isPerturbed) return;

        if (currentColorEncoding === "airline") {
            circle.style("fill", airlineColorScale(d.airline));
        } else if (currentColorEncoding === "topic") {
            circle.style("fill", d.topic_id === -1 ? "#cbd5e1" : topicColorScale(d.topic_id));
        } else {
            circle.style("fill", null);
        }
    });
}

function setPerturbationDisplay(result) {
    const output = document.getElementById("new-text");
    if (!result) {
        output.innerHTML = "<span>-</span>";
        return;
    }

    const label = perturbationLabels[result.type] || result.type;
    output.innerHTML = `<strong>${label}</strong>${result.nodeId ? ` · <small>Tweet ${result.nodeId}</small>` : ""}<br>${result.text}`;
}

function renderPerturbationCarousel() {
    const carousel = document.getElementById("perturbation-carousel");
    const emptyState = document.getElementById("perturbation-empty");

    carousel.innerHTML = "";

    if (!perturbationResults.length) {
        emptyState.style.display = "block";
        setPerturbationDisplay(null);
        return;
    }

    emptyState.style.display = "block";
    emptyState.style.display = "none";

    perturbationResults.forEach(result => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `perturbation-chip${result.key === activePerturbationKey ? " active" : ""}`;
        chip.textContent = `${perturbationLabels[result.type] || result.type}`;
        chip.addEventListener("click", () => {
            activePerturbationKey = result.key;
            setPerturbationDisplay(result);
            renderPerturbationCarousel();
        });
        carousel.appendChild(chip);
    });

    const activeResult = perturbationResults.find(result => result.key === activePerturbationKey) || perturbationResults[perturbationResults.length - 1];
    activePerturbationKey = activeResult.key;
    setPerturbationDisplay(activeResult);
}

function storePerturbationResult(nodeId, type, text) {
    const key = `${nodeId}-${type}`;
    const nextResult = { key, nodeId, type, text };
    const existingIndex = perturbationResults.findIndex(result => result.key === key);

    if (existingIndex >= 0) {
        perturbationResults[existingIndex] = nextResult;
    } else {
        perturbationResults.push(nextResult);
    }

    activePerturbationKey = key;
    renderPerturbationCarousel();
}

function resetPerturbationResults() {
    perturbationResults = [];
    activePerturbationKey = null;
    renderPerturbationCarousel();
}

async function parseApiResponse(response) {
    const rawText = await response.text();
    let parsed;

    try {
        parsed = rawText ? JSON.parse(rawText) : null;
    } catch (error) {
        parsed = rawText;
    }

    if (!response.ok) {
        const message = parsed && typeof parsed === "object"
            ? (parsed.error || parsed.message || JSON.stringify(parsed))
            : (parsed || `HTTP ${response.status}`);
        throw new Error(message);
    }

    return parsed;
}

function syncSelectionChartButtons() {
    if (selectionViewSentimentBtn) selectionViewSentimentBtn.classList.toggle("active", currentSelectionChartView === "sentiment");
    if (selectionViewAirlineBtn) selectionViewAirlineBtn.classList.toggle("active", currentSelectionChartView === "airline");
    if (selectionViewTopicBtn) selectionViewTopicBtn.classList.toggle("active", currentSelectionChartView === "topic");
}

function getSelectionDistributionConfig(nodes) {
    if (currentSelectionChartView === "airline") {
        return {
            title: "Airlines",
            data: d3.rollups(nodes, values => values.length, d => d.airline).sort((a, b) => d3.descending(a[1], b[1]) || d3.ascending(a[0], b[0])),
            labelAccessor: label => label,
            colorAccessor: label => airlineColorScale(label)
        };
    }

    if (currentSelectionChartView === "topic") {
        return {
            title: "Topics",
            data: d3.rollups(nodes, values => values.length, d => d.topic_id).sort((a, b) => d3.descending(a[1], b[1]) || d3.ascending(a[0], b[0])),
            labelAccessor: label => getTopicLabel(label),
            colorAccessor: label => label === -1 ? "#cbd5e1" : topicColorScale(label)
        };
    }

    return {
        title: "Sentiments",
        data: d3.rollups(nodes, values => values.length, d => d.sentiment).sort((a, b) => d3.descending(a[1], b[1]) || d3.ascending(a[0], b[0])),
        labelAccessor: label => label,
        colorAccessor: label => sentimentColors[label] || "#64748b"
    };
}

function renderSelectionDistributionChart(nodes) {
    syncSelectionChartButtons();

    const container = d3.select("#selection-distribution-chart");
    container.html("");

    if (!nodes.length) {
        topicDistributionTooltip.style("opacity", 0);
        container
            .attr("class", "chart-placeholder")
            .html("<em>Select one or more points to see the selection distribution.</em>");
        return;
    }

    const config = getSelectionDistributionConfig(nodes);
    const chartData = config.data.map(([key, count]) => ({
        key,
        label: config.labelAccessor(key),
        count,
        color: config.colorAccessor(key)
    }));

    const showHistogram = (
        (interactionMode === "brush" && selectionMode === "point")
    ) && (currentSelectionChartView === "sentiment" || currentSelectionChartView === "airline" || (interactionMode === "brush" && selectionMode === "point" && currentSelectionChartView === "topic"));

    container.attr("class", "");

    if (showHistogram) {
        const total = nodes.length;
        const chartWidth = Math.max(document.getElementById("selection-distribution-chart").clientWidth || 0, 320);
        const chartHeight = 250;
        const margin = { top: 18, right: 18, bottom: 78, left: 54 };
        const innerWidth = chartWidth - margin.left - margin.right;
        const innerHeight = chartHeight - margin.top - margin.bottom;

        const svg = container.append("svg")
            .attr("width", chartWidth)
            .attr("height", chartHeight)
            .attr("viewBox", `0 0 ${chartWidth} ${chartHeight}`)
            .attr("preserveAspectRatio", "xMidYMid meet");

        const chart = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`);

        const x = d3.scaleBand()
            .domain(chartData.map(d => d.label))
            .range([0, innerWidth])
            .padding(0.22);

        const y = d3.scaleLinear()
            .domain([0, d3.max(chartData, d => (d.count / total) * 100) || 1])
            .nice()
            .range([innerHeight, 0]);

        chart.append("g")
            .attr("transform", `translate(0,${innerHeight})`)
            .call(d3.axisBottom(x))
            .selectAll("text")
            .style("font-size", "11px")
            .style("fill", "#475569")
            .attr("transform", "rotate(-24)")
            .style("text-anchor", "end");

        chart.append("g")
            .call(d3.axisLeft(y).ticks(5).tickFormat(d => `${d}%`))
            .style("font-size", "11px")
            .style("color", "#475569");

        chart.selectAll(".domain, .tick line")
            .attr("stroke", "#cbd5e1");

        chart.selectAll(".selection-distribution-bar")
            .data(chartData)
            .enter()
            .append("rect")
            .attr("class", "selection-distribution-bar")
            .attr("x", d => x(d.label))
            .attr("y", d => y((d.count / total) * 100))
            .attr("width", x.bandwidth())
            .attr("height", d => innerHeight - y((d.count / total) * 100))
            .attr("rx", 6)
            .attr("fill", d => d.color)
            .on("mousemove", function (event, d) {
                topicDistributionTooltip
                    .style("opacity", 1)
                    .html(`<strong>${config.title}: ${d.label}</strong>${d.count} tweets<br>${((d.count / total) * 100).toFixed(1)}% of selection`)
                    .style("left", `${event.clientX + 14}px`)
                    .style("top", `${event.clientY + 14}px`);
            })
            .on("mouseleave", function () {
                topicDistributionTooltip.style("opacity", 0);
            });

        chart.selectAll(".selection-distribution-label")
            .data(chartData)
            .enter()
            .append("text")
            .attr("class", "selection-distribution-label")
            .attr("x", d => x(d.label) + x.bandwidth() / 2)
            .attr("y", d => y((d.count / total) * 100) - 8)
            .attr("text-anchor", "middle")
            .style("font-size", "11px")
            .style("font-weight", "700")
            .style("fill", "#334155")
            .text(d => `${((d.count / total) * 100).toFixed(0)}%`);

        return;
    }

    const titleDiv = document.createElement("div");
    titleDiv.style.cssText = "font-size: 0.85rem; font-weight: 700; color: #334155; margin-bottom: 12px; text-transform: uppercase;";
    titleDiv.innerText = `SELECTED ${config.title.toUpperCase()}`;
    container.node().appendChild(titleDiv);

    const legendDiv = document.createElement("div");
    legendDiv.style.cssText = "display: flex; flex-direction: column; gap: 8px;";

    chartData.forEach(item => {
        const itemDiv = document.createElement("div");
        itemDiv.style.cssText = "display: flex; align-items: center; gap: 10px; font-size: 0.88rem; color: #334155;";

        const swatch = document.createElement("div");
        swatch.style.cssText = `width: 12px; height: 12px; border-radius: 50%; background-color: ${item.color}; flex-shrink: 0;`;

        const label = document.createElement("span");
        const showCount = !(nodes.length === 1 && item.count === 1);
        label.innerText = showCount ? `${item.label} (${item.count})` : item.label;

        itemDiv.appendChild(swatch);
        itemDiv.appendChild(label);
        legendDiv.appendChild(itemDiv);
    });

    container.node().appendChild(legendDiv);
}

function renderMapLegends(nodes = []) {
    const legendLabel = document.getElementById("map-legend-label");
    const legendItems = document.getElementById("map-legend-items");

    let legendData;
    if (currentColorEncoding === "airline") {
        legendLabel.innerText = "Airline";
        legendData = nodes.length
            ? d3.rollups(nodes, values => values.length, d => d.airline)
            : airlineColorScale.domain().map(label => [label, null]);
    } else if (currentColorEncoding === "topic") {
        legendLabel.innerText = "Topic";
        legendData = nodes.length
            ? d3.rollups(nodes, values => values.length, d => d.topic_id).sort((a, b) => a[0] - b[0])
            : [-1, ...topicColorScale.domain()].map(label => [label, null]);
    } else {
        legendLabel.innerText = "Sentiment";
        legendData = nodes.length
            ? d3.rollups(nodes, values => values.length, d => d.sentiment)
            : Object.keys(sentimentColors).map(label => [label, null]);
    }

    legendItems.innerHTML = legendData.map(([label, count]) => {
        let color = currentColorEncoding === "airline" ? airlineColorScale(label) : (currentColorEncoding === "topic" ? (label === -1 ? "#cbd5e1" : topicColorScale(label)) : (sentimentColors[label] || "#64748b"));
        let displayLabel = currentColorEncoding === "topic" ? getTopicLabel(label) : label;
        
        return `
        <div class="map-legend-item">
            <span class="map-legend-swatch" style="background:${color};"></span>
            <span>${displayLabel}${count !== null ? ` (${count})` : ""}</span>
        </div>
        `;
    }).join("");
}

function updateSelectionUI() {
    const selectedIds = new Set(selectedNodesData.map(node => node.id));

    nodeLayer.selectAll("circle.node")
        .classed("selected", d => selectedIds.has(d.id))
        .classed("selection-muted", d => selectedIds.size > 0 && !selectedIds.has(d.id))
        .each(function (d) {
            if (selectedIds.has(d.id)) {
                d3.select(this).raise();
            }
        });

    const hasSelection = selectedNodesData.length > 0;
    const singleSelection = selectedNodesData.length === 1;

    // if (btnPerturb) btnPerturb.disabled = !hasSelection; // This is now handled by updatePerturbationButtonState()
    if (btnClear) btnClear.disabled = !hasSelection;
    setCenterButtonEnabled(hasSelection);
    if (btnClearSelection) btnClearSelection.disabled = !hasSelection;

    document.getElementById("selection-count").innerText = `${selectedNodesData.length} tweet${selectedNodesData.length === 1 ? "" : "s"} selected`;
    renderSelectionDistributionChart(selectedNodesData);
    renderMapLegends(selectedNodesData);
    updateBertopicSelectionSummary(selectedNodesData);

    if (!hasSelection) {
        document.getElementById("tw-id").innerText = "-";
        document.getElementById("tw-sentiment").innerText = "-";
        document.getElementById("tw-text-simple").innerText = "Select a point on the map to see token weights...";
        document.getElementById("tw-text").innerText = "Select a point on the map to see token weights...";
        d3.select("#heatmap-container").html("<em>Select a single tweet to view heatmap.</em>");
        updatePerturbationButtonState(); // Update button state when selection is cleared
        resetPerturbationResults();
        return;
    }


    if (!singleSelection) {
        document.getElementById("tw-id").innerText = "Multiple";
        document.getElementById("tw-sentiment").innerText = "Mixed";
        document.getElementById("tw-text-simple").innerHTML = `<em>${selectedNodesData.length} tweets selected. Use Zoom Selection or Center Selection to navigate the map, or click a single point to inspect token weights.</em>`;
        document.getElementById("tw-text").innerHTML = `<em>${selectedNodesData.length} tweets selected. Use Zoom Selection or Center Selection to navigate the map, or click a single point to inspect token weights.</em>`;
        d3.select("#heatmap-container").html("<em>Heatmap available for a single selected tweet.</em>");
        updatePerturbationButtonState(); // Update button state for multiple selection
        return;
    }

    const node = selectedNodesData[0];
    document.getElementById("tw-id").innerText = node.id;
    document.getElementById("tw-sentiment").innerText = node.sentiment;
    renderTokenAnalysis(node.text);
    //renderHeatmap(node.text);
    // updatePerturbationButtonState() will be called by renderTokenAnalysis when a token is clicked, or initially here if no token is clicked yet.
}

function clearSelection() {
    selectedNodesData = [];
    originalClickedNode = null;
    clearKeywordHighlight();
    resetPerturbationResults();
    linkLayer.selectAll("*").remove();
    nodeLayer.selectAll("circle.node")
        .classed("selected", false)
        .classed("selection-muted", false)
        .classed("dimmed", false)
        .attr("data-perturbed", "false")
        .transition()
        .duration(800)
        .attr("cx", d => xScale(d.x))
        .attr("cy", d => yScale(d.y))
        .style("fill", d => {
            if (currentColorEncoding === "airline") return airlineColorScale(d.airline);
            if (currentColorEncoding === "topic") return d.topic_id === -1 ? "#cbd5e1" : topicColorScale(d.topic_id);
            return null;
        })
        .style("stroke", null)
        .style("stroke-width", null);

    targetWordForPerturbation = null;
    if (document.getElementById("target-word-info")) document.getElementById("target-word-info").style.display = "none";
    updatePerturbationButtonState(); // Update button state after clearing selection
    updateTFIDFChart([]);
    updateSelectionUI();
}

function selectNodes(nodes, options = {}) {
    const { append = false, toggle = false } = options;
    const uniqueIncomingNodes = Array.from(new Map(nodes.map(node => [node.id, node])).values());

    if (!append && !toggle) {
        selectedNodesData = uniqueIncomingNodes;
    } else {
        const selectedMap = new Map(selectedNodesData.map(node => [node.id, node]));
        uniqueIncomingNodes.forEach(node => {
            if (toggle && selectedMap.has(node.id)) {
                selectedMap.delete(node.id);
            } else {
                selectedMap.set(node.id, node);
            }
        });
        selectedNodesData = Array.from(selectedMap.values());
    }

    updateSelectionUI();

    if (selectedNodesData.length > 0) {
        setCenterButtonEnabled(true);
    }
    updatePerturbationButtonState(); // Update button state after selection changes

    // Gestione TF-IDF
    const loadingText = document.getElementById("tfidf-loading");
    if (selectedNodesData.length > 5) { 
        loadingText.style.display = "block";
        const selectedTexts = selectedNodesData.map(n => n.text);

        postJson("/api/tfidf", { texts: selectedTexts })
        .then(data => {
            loadingText.style.display = "none";
            updateTFIDFChart(data);
        })
        .catch(err => {
            console.error("TF-IDF Error:", err);
            loadingText.style.display = "none";
        });
    } else {
        updateTFIDFChart([]);
    }
}

function fitSelectionToView(nodes, duration = 420) {
    if (!nodes.length) return;

    const points = nodes.map(node => ({
        x: xScale(node.x),
        y: yScale(node.y)
    }));
    const xExtent = d3.extent(points, point => point.x);
    const yExtent = d3.extent(points, point => point.y);
    const dx = Math.max(30, xExtent[1] - xExtent[0]);
    const dy = Math.max(30, yExtent[1] - yExtent[0]);
    const padding = 110;
    const scale = Math.max(0.5, Math.min(8, 0.72 / Math.max(dx / (width - padding), dy / (height - padding))));
    const centerX = (xExtent[0] + xExtent[1]) / 2;
    const centerY = (yExtent[0] + yExtent[1]) / 2;
    const transform = d3.zoomIdentity
        .translate(width / 2 - scale * centerX, height / 2 - scale * centerY)
        .scale(scale);

    applyZoomTransform(transform, duration);
    
}

function centerSelectionInView(nodes, duration = 320) {
    if (!nodes.length) return;

    const currentTransform = d3.zoomTransform(svg.node());
    const points = nodes.map(getCurrentNodePosition);
    const centerX = d3.mean(points, point => point.x);
    const centerY = d3.mean(points, point => point.y);
    const transform = d3.zoomIdentity
        .translate(width / 2 - currentTransform.k * centerX, height / 2 - currentTransform.k * centerY)
        .scale(currentTransform.k);

    applyZoomTransform(transform, duration);
}

function setBrushMode(active) {
    brushModeActive = active;
    brushLayer
        .style("display", active ? null : "none")
        .style("pointer-events", active ? "all" : "none");
}

function setInteractionMode(mode) {
    interactionMode = mode;
    setBrushMode(mode === "brush");
    if (mode !== "brush") {
        brushLayer.call(brush.move, null);
    }
    syncModeButtons();
    if (selectionMode === "cluster") {
        reapplySelectionMode();
    }
}

function setSelectionMode(mode) {
    selectionMode = mode;
    if (mode === "point") {
        originalClickedNode = null;
    }
    syncModeButtons();
    reapplySelectionMode();
}

const zoom = d3.zoom()
    .scaleExtent([0.5, 20])
    .filter(function (event) {
        if (brushModeActive) return false;
        if (event.type === "dblclick") return false;
        if (event.target && event.target.classList && event.target.classList.contains("node")) return false;
        if (event.type === "wheel") return true;
        if (event.type === "mousedown") return !event.ctrlKey && !event.button && canPanMap();
        return !event.ctrlKey && !event.button;
    })
    .on("zoom", function (event) {
        zoomGroup.attr("transform", event.transform);
        setResetButtonVisibility(isViewTransformed() || hasOffscreenPerturbedNode());

        xAxisGroup.call(d3.axisBottom(event.transform.rescaleX(xScale)).ticks(axisTickCount))
            .style("font-size", "13px");

        yAxisGroup.call(d3.axisLeft(event.transform.rescaleY(yScale)).ticks(axisTickCount))
            .style("font-size", "13px");
    });

const brush = d3.brush()
    .extent([[0, 0], [width, height]])
    .on("end", function (event) {
        if (interactionMode !== "brush" || !event.selection) return;

        const [[x0, y0], [x1, y1]] = event.selection;
        const transform = d3.zoomTransform(svg.node());
        const brushedNodes = allNodesData.filter(node => {
            const position = getCurrentNodePosition(node);
            const screenX = transform.applyX(position.x);
            const screenY = transform.applyY(position.y);
            return screenX >= x0 && screenX <= x1 && screenY >= y0 && screenY <= y1;
        });

        const resolvedNodes = resolveBrushSelectionMode(brushedNodes);
        selectNodes(resolvedNodes);
        if (resolvedNodes.length > 0) {
            setCenterButtonEnabled(true);
            fitSelectionToView(resolvedNodes, 380);
        }
        brushLayer.call(brush.move, null);
        console.log("Brushed:", resolvedNodes.length);
    });

svg.call(zoom).on("dblclick.zoom", null);
brushLayer.call(brush);
setInteractionMode("click");

svg.on("mousedown.panCursor", function (event) {
    if (brushModeActive) return;
    if (!(event.target && event.target.classList.contains("node")) && canPanMap()) {
        document.body.classList.add("panning");
    }
});

svg.on("click.resetDim", function (event) {
    if (
        event.target.closest("#map-toolbar") ||
        event.target.closest("#details-panel")
    ) return;

    if (!event.target.classList.contains("node")) {
        clearSelection();
    }
});

document.addEventListener("mouseup", () => document.body.classList.remove("panning"));
document.addEventListener("mouseleave", () => document.body.classList.remove("panning"));

d3.csv("base_map.csv", function (d) {
    const topicId = normalizeTopicId(d.topic_id);
    return {
        id: d.tweet_id,
        text: d.text,
        sentiment: d.sentiment,
        airline: d.airline,
        x: +d.x,
        y: +d.y,
        topic_id: topicId,
        topic_label: d.topic_label || getTopicLabel(topicId)
    };
}).then(function (data) {
    allNodesData = data;

    const margin = { top: 20, right: 30, bottom: 60, left: 60 };
    const xExtent = d3.extent(data, d => d.x);
    const yExtent = d3.extent(data, d => d.y);
    const xPad = (xExtent[1] - xExtent[0]) * 0.05;
    const yPad = (yExtent[1] - yExtent[0]) * 0.05;

    xScale = d3.scaleLinear()
        .domain([xExtent[0] - xPad, xExtent[1] + xPad])
        .range([margin.left, width - margin.right]);

    yScale = d3.scaleLinear()
        .domain([yExtent[0] - yPad, yExtent[1] + yPad])
        .range([height - margin.bottom, margin.top]);

    xAxisGroup.attr("transform", `translate(0,${height - margin.bottom})`)
        .call(d3.axisBottom(xScale).ticks(axisTickCount))
        .style("font-size", "13px");

    yAxisGroup.attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(yScale).ticks(axisTickCount))
        .style("font-size", "13px");

    const bigDataset = data.length > 2000;
    airlineColorScale = d3.scaleOrdinal(d3.schemeCategory10).domain([...new Set(data.map(d => d.airline))]);
    topicColorScale = d3.scaleOrdinal(d3.schemeCategory10).domain([...new Set(data.map(d => d.topic_id))].filter(t => t !== -1).sort((a, b) => a - b));
    renderMapLegends();

    nodeLayer.selectAll("circle.node")
        .data(data)
        .enter()
        .append("circle")
        .attr("class", d => `node ${d.sentiment}`)
        .attr("id", d => `node-${d.id}`)
        .attr("cx", d => xScale(d.x))
        .attr("cy", d => yScale(d.y))
        .attr("r", bigDataset ? 2.6 : baseNodeRadius)
        .attr("shape-rendering", "crispEdges")
        .attr("data-perturbed", "false")
        .style("stroke", "none")
        .style("stroke-width", "0px")
        .style("opacity", bigDataset ? 0.5 : 0.8)
        .on("click", function (event, d) {
            const isMultiAdd = event.ctrlKey || event.metaKey;
            if (!isMultiAdd) {
                originalClickedNode = d;
            }
            const nodesToSelect = resolveClickSelectionMode([d], d);
            // Toggle on single click (no modifiers) and on multi-add with modifiers (only in cluster mode)
            const allowAppend = isMultiAdd && selectionMode === "cluster";
            selectNodes(nodesToSelect, { append: allowAppend, toggle: true });
            event.stopPropagation();
        });

    svg.append("text")
        .attr("class", "axis-label")
        .attr("x", width / 2)
        .attr("y", height - 10)
        .text("UMAP 1");

    svg.append("text")
        .attr("class", "axis-label")
        .attr("transform", "rotate(-90)")
        .attr("y", 20)
        .attr("x", -height / 2)
        .text("UMAP 2");

    colorEncodingSelect.addEventListener("change", event => {
        currentColorEncoding = event.target.value;
        updateNodeColors();
        renderMapLegends(selectedNodesData);
        renderSelectionDistributionChart(selectedNodesData);
    });

    setResetButtonVisibility(false);
    resetPerturbationResults();
    updatePerturbationButtonState(); // Initial call to set button and input states
    updateSelectionUI();
}).catch(function (error) {
    console.error("Error loading CSV:", error);
    alert("Make sure base_map.csv is loaded and you are running a local server.");
});

// Token Analysis
function renderTokenAnalysis(text) {
    // Opzionale: se hai ancora il div per il testo semplice, lascialo, altrimenti puoi rimuovere questa riga
    d3.select("#tw-text-simple").text(text);
    
    const container = d3.select("#tw-text");
    container.html("<em style='color: #64748b;'>Calculating token ablation weights...</em>");

    postJson("/api/token_weights", { text })
        .then(data => {
            if (!Array.isArray(data) || data.length === 0) {
                container.html("<em style='color: #ef4444;'>No token data available for this text.</em>");
                return;
            }

            container.html(""); // Svuota il contenitore
            
            // 1. Calcola il massimo per la scala colori
            const maxWeight = d3.max(data, d => d.weight) || 0.01;
            // DEBUG: print the maximum weight and all token weights
            console.log("Max token weight:", maxWeight);
            console.table(
                data.map(d => ({
                    word: d.word,
                    weight: d.weight
                }))
            );
            const colorScale = d3.scaleSequential()
                .domain([0, maxWeight])
                .interpolator(d3.interpolateRgbBasis([
                    "#0b1026", // very dark blue
                    "#1e3a8a", // deep blue
                    "#2563eb", // blue
                    "#38bdf8", // light blue
                    "#67e8f9", // cyan
                    "#84cc16", // green
                    "#fde047", // yellow
                    "#facc15", // golden yellow
                    "#fef9c3"  // pale yellow
                ]));

            // 2. Disegna gli span (le parole)
            data.forEach(item => {
                container.append("span")
                    .attr("class", "token")
                    // Tooltip nativo al passaggio del mouse!
                    .attr("title", `Impact Score: ${item.weight.toFixed(3)}`) 
                    .style("background-color", colorScale(item.weight))
                    .style("color", item.weight > (maxWeight * 0.5) ?  "#0f172a" : "#ffffff" )
                    .text(`${item.word} `) // Nota lo spazio finale per distanziare le parole
                    .on("click", function(event) {
                        // A. Spegni eventuali altre parole selezionate ripristinando lo stile di default
                        container.selectAll(".token")
                            .style("border", "1.5px solid transparent")
                            .style("box-shadow", "none");
                        
                        // B. Evidenzia QUESTA parola (Bordo nero netto, stile Heatmap)
                        d3.select(this)
                            .style("border", "1.5px solid #000") // Più elegante dell'outline
                            .style("box-shadow", "0 2px 4px rgba(0,0,0,0.2)");

                        // C. Salva la parola come Target globale
                        targetWordForPerturbation = item.word.trim();
                        
                        const displayEl = document.getElementById("target-word-display");
                        if (displayEl) displayEl.innerText = targetWordForPerturbation;
                        
                        const infoEl = document.getElementById("target-word-info");
                        if (infoEl) infoEl.style.display = "block";

                        // D. Aggiorna i bottoni
                        if (typeof updatePerturbationButtonState === "function") {
                            updatePerturbationButtonState();
                        }
                    });
            });
        })
        .catch(err => {
            console.error("Token weight error:", err);
            container.html(`<em style='color: #ef4444;'>Error loading token weights.</em><br><small>${err.message}</small>`);
            if (typeof updatePerturbationButtonState === "function") {
                updatePerturbationButtonState(); 
            }
        });
}

function updatePerturbationButtonState() {
    const hasSingleSelection = selectedNodesData.length === 1;
    const currentPerturbationType = document.getElementById("perturbation-select").value;
    const isWordBased = wordBasedPerturbations.includes(currentPerturbationType);
    const customWordInput = document.getElementById("custom-word-input");
    const targetWordInfo = document.getElementById("target-word-info");

    let canPerturb = false;

    // Manage visibility of custom word input
    if (currentPerturbationType === "custom_replace" && hasSingleSelection && isWordBased) {
        customWordInput.style.display = "block";
    } else {
        customWordInput.style.display = "none";
    }

    // Manage visibility of target word info
    if (isWordBased && targetWordForPerturbation && hasSingleSelection) {
        targetWordInfo.style.display = "block";
        document.getElementById("target-word-display").innerText = targetWordForPerturbation;
    } else {
        targetWordInfo.style.display = "none";
    }

    // Determine if perturbation button should be enabled
    if (hasSingleSelection) {
       if (currentPerturbationType === "custom_replace") {
            canPerturb = customWordInput.value.trim() !== "";
        } else {
            canPerturb = true;
        }
    }
    btnPerturb.disabled = !canPerturb;
}

// Cancella la parola target 
const btnClearTarget = document.getElementById("btn-clear-target");
if (btnClearTarget) {
    btnClearTarget.addEventListener("click", () => {
        targetWordForPerturbation = null;
        document.getElementById("target-word-info").style.display = "none";
        d3.selectAll(".token").style("outline", "none").style("box-shadow", "none").style("transform", "scale(1)"); // Deseleziona tutti i token
        updatePerturbationButtonState(); // Update button state and visibility
    });
}

// Gestisce la visibilità della casella di input custom e lo stato del pulsante
document.getElementById("perturbation-select").addEventListener("change", (e) => {
    updatePerturbationButtonState();
});

// Aggiunge un listener per l'input della parola custom per aggiornare lo stato del pulsante
document.getElementById("custom-word-input").addEventListener("input", () => {
    updatePerturbationButtonState();
});

// Invio dati perturbazione ---
document.getElementById("btn-perturb").addEventListener("click", () => {
    if (selectedNodesData.length !== 1) { // Enforce single selection for perturbation
        console.warn("Perturbation requires a single tweet selection.");
        return;
    }

    const node = selectedNodesData[0]; // Only one node for perturbation
    const perturbType = document.getElementById("perturbation-select").value;
    const replacement = document.getElementById("custom-word-input").value.trim();
    const arrowColor = perturbationColors[perturbType];

    document.getElementById("results-area").style.display = "block";
    document.getElementById("new-text").innerHTML = "<span>Loading perturbation from backend...</span>";

    const payload = {
            text: node.text, 
            type: perturbType === "custom_replace" ? "custom" : perturbType,
    };

    if (wordBasedPerturbations.includes(perturbType)) {
         if (targetWordForPerturbation) {
            payload.target_word = targetWordForPerturbation;
        }
        if (perturbType === "custom_replace") {
            if (!replacement) {
                console.error("No replacement word provided for custom replacement.");
                document.getElementById("new-text").innerHTML = "<span>Error: No replacement word provided.</span>";
                return;
            }
            payload.replacement_word = replacement;
        }
    }

    postJson("/api/perturb", payload)
        .then(data => {
                // Use the new text if available, otherwise fallback to display_text or original text
                const textToShow = data.display_text || data.new_text;
                
                document.getElementById("new-text").innerHTML = textToShow;
                storePerturbationResult(node.id, perturbType, textToShow);

                const startX = xScale(node.x);
                const startY = yScale(node.y);
                const endX = xScale(data.new_x);
                const endY = yScale(data.new_y);

                linkLayer.append("circle")
                    .attr("class", "ghost-node")
                    .attr("cx", startX)
                    .attr("cy", startY)
                    .attr("r", baseNodeRadius);

                const line = linkLayer.append("line")
                    .attr("class", "trajectory")
                    .attr("x1", startX)
                    .attr("y1", startY)
                    .attr("x2", startX)
                    .attr("y2", startY)
                    .attr("stroke", arrowColor)
                    .attr("marker-end", "url(#arrowhead)");

                line.transition().duration(1500).ease(d3.easeCubicOut)
                    .attr("x2", endX)
                    .attr("y2", endY);

                d3.select(`#node-${node.id}`)
                    .attr("data-perturbed", "true")
                    .transition()
                    .duration(1500)
                    .ease(d3.easeCubicOut)
                    .attr("cx", endX)
                    .attr("cy", endY)
                    .style("fill", arrowColor)
                    .style("stroke", null)
                    .style("stroke-width", null);
            })
            .catch(error => {
                console.error("Fetch Error:", error);
                document.getElementById("new-text").innerHTML = `<span>${error.message}</span>`;
            });
});

document.getElementById("btn-clear").addEventListener("click", () => {
    linkLayer.selectAll("*").remove();
    nodeLayer.selectAll("circle.node")
        .classed("selection-muted", false)
        .attr("data-perturbed", "false")
        .transition()
        .duration(800)
        .attr("cx", d => xScale(d.x))
        .attr("cy", d => yScale(d.y))
        .style("fill", d => {
            if (currentColorEncoding === "airline") return airlineColorScale(d.airline);
            if (currentColorEncoding === "topic") return d.topic_id === -1 ? "#cbd5e1" : topicColorScale(d.topic_id);
            return null;
        })
        .style("stroke", null)
        .style("stroke-width", null);

    document.getElementById("results-area").style.display = selectedNodesData.length ? "block" : "none";
    resetPerturbationResults();
});



if (btnResetZoom) {
    btnResetZoom.addEventListener("click", () => {
        applyZoomTransform(d3.zoomIdentity, 320);
    });
}

if (interactionClickBtn) {
    interactionClickBtn.addEventListener("click", () => {
        setInteractionMode("click");
    });
}

if (interactionBrushBtn) {
    interactionBrushBtn.addEventListener("click", () => {
        setInteractionMode("brush");
    });
}

if (selectionPointBtn) {
    selectionPointBtn.addEventListener("click", () => {
        setSelectionMode("point");
    });
}

if (selectionClusterBtn) {
    selectionClusterBtn.addEventListener("click", () => {
        setSelectionMode("cluster");
    });
}

if (selectionViewSentimentBtn) {
    selectionViewSentimentBtn.addEventListener("click", () => {
        currentSelectionChartView = "sentiment";
        renderSelectionDistributionChart(selectedNodesData);
        if (selectedNodesData.length > 0) {
            reapplySelectionMode();
        }
    });
}

if (selectionViewAirlineBtn) {
    selectionViewAirlineBtn.addEventListener("click", () => {
        currentSelectionChartView = "airline";
        renderSelectionDistributionChart(selectedNodesData);
        if (selectedNodesData.length > 0) {
            reapplySelectionMode();
        }
    });
}

if (selectionViewTopicBtn) {
    selectionViewTopicBtn.addEventListener("click", () => {
        currentSelectionChartView = "topic";
        renderSelectionDistributionChart(selectedNodesData);
        if (selectedNodesData.length > 0) {
            reapplySelectionMode();
        }
    });
}

if (btnClearSelection) {
    btnClearSelection.addEventListener("click", (event) => {
        event.stopPropagation();   
        clearSelection();
    });
}

if (btnZoomSelection) {
    btnZoomSelection.addEventListener("click", () => {
        stopViewTransitions();
        svg.transition()
            .duration(220)
            .ease(d3.easeCubicOut)
            .call(zoom.scaleBy, 1.25);
    });
}

if (btnZoomOut) {
    btnZoomOut.addEventListener("click", () => {
        stopViewTransitions();
        svg.transition()
            .duration(220)
            .ease(d3.easeCubicOut)
            .call(zoom.scaleBy, 0.8);
    });
}

if (btnPanSelection) {
    btnPanSelection.addEventListener("click", () => {
        centerSelectionInView(selectedNodesData);
        setCenterButtonEnabled(false);
    });
}

// FEATURE: TF-IDF KEYWORD BAR CHART 

// 1. Setup Struttura SVG per il Bar Chart
const tfMargin = {top: 20, right: 30, bottom: 40, left: 100};
const tfContainer = document.getElementById('tfidf-panel');
let tfWidth = Math.max(tfContainer.clientWidth - 20, 300); // Evita larghezze negative se nascosto
const tfHeight = 300;

const tfSvg = d3.select("#tfidf-chart")
    .append("svg")
    .attr("width", tfWidth)
    .attr("height", tfHeight)
    .attr("viewBox", `0 0 ${tfWidth} ${tfHeight}`)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .append("g")
    .attr("transform", `translate(${tfMargin.left},${tfMargin.top})`);

let tfInnerWidth = tfWidth - tfMargin.left - tfMargin.right;
const tfInnerHeight = tfHeight - tfMargin.top - tfMargin.bottom;

// Scale (Y per le parole, X per il punteggio)
const tfYScale = d3.scaleBand().range([0, tfInnerHeight]).padding(0.2);
let tfXScale = d3.scaleLinear().range([0, tfInnerWidth]);

const tfYAxisGroup = tfSvg.append("g").attr("class", "y-axis");
const tfXAxisGroup = tfSvg.append("g").attr("transform", `translate(0,${tfInnerHeight})`).attr("class", "x-axis");

let activeKeyword = null; // Memorizza la parola attualmente cliccata

function clearKeywordHighlight() {
    activeKeyword = null;
    d3.selectAll(".tfidf-bar")
        .classed("active", false)
        .style("fill", null)
        .style("stroke", null)
        .style("stroke-width", null);
    nodeLayer.selectAll("circle.node")
        .classed("dimmed", false)
        .style("opacity", 0.8)
        .style("stroke", null)
        .style("stroke-width", null);
}

// 2. Funzione per Disegnare e Aggiornare il Grafico
function updateTFIDFChart(data) {
    const placeholder = d3.select("#tfidf-chart em");

    // 1. Normalizza i dati provenienti dal backend
    if (data && !Array.isArray(data) && typeof data === 'object') {
        data = Object.entries(data).map(([word, score]) => ({ word, score }));
    } else if (data && Array.isArray(data) && Array.isArray(data[0])) {
        data = data.map(d => ({ word: d[0], score: d[1] }));
    }

    // Se non ci sono dati (es. selezione vuota o < 6)
    if (!data || data.length === 0) {
        tfSvg.selectAll(".tfidf-bar").remove();
        tfYAxisGroup.selectAll("*").remove();
        tfXAxisGroup.selectAll("*").remove();
        clearKeywordHighlight();
        return;
    }

    // ABBIAMO I DATI! Nascondiamo il testo segnaposto definitivamente
    placeholder.style("display", "none");

    // Ricalcola la larghezza dinamicamente
    if (tfContainer.clientWidth > 0) {
        tfWidth = Math.max(tfContainer.clientWidth, 300) - 20;
        tfInnerWidth = Math.max(tfWidth - tfMargin.left - tfMargin.right, 10);
        
        d3.select("#tfidf-chart svg")
            .attr("width", tfWidth)
            .attr("viewBox", `0 0 ${tfWidth} ${tfHeight}`);
            
        tfXScale.range([0, tfInnerWidth]);
    }

    const getScore = d => d.score !== undefined ? d.score : (d.weight || 0);

    // Aggiorna i domini delle scale
    tfYScale.domain(data.map(d => d.word));
    tfXScale.domain([0, d3.max(data, getScore) || 1]);

    // Animazione assi
    tfYAxisGroup.transition().duration(500).call(d3.axisLeft(tfYScale));
    tfXAxisGroup.transition().duration(500).call(d3.axisBottom(tfXScale).ticks(5));

    // Data Join per le barre
    const bars = tfSvg.selectAll(".tfidf-bar").data(data, d => d.word);

    // Rimuovi le barre vecchie
    bars.exit().transition().duration(300).attr("width", 0).remove();

    // Aggiungi le nuove barre
    const barsEnter = bars.enter()
        .append("rect")
        .attr("class", "tfidf-bar")
        .attr("y", d => tfYScale(d.word))
        .attr("height", tfYScale.bandwidth())
        .attr("x", 0)
        .attr("width", 0) 
        .attr("fill", "#3b82f6"); 

    // Unisci e Anima
    barsEnter.merge(bars)
        .transition().duration(500)
        .attr("y", d => tfYScale(d.word))
        .attr("height", tfYScale.bandwidth())
        .attr("width", d => Math.max(0, tfXScale(getScore(d))));

    // --- INTERAZIONE 2: DAL GRAFICO ALLA MAPPA (Evidenziazione Inversa) ---
    barsEnter.merge(bars).on("click", function(event, d) {
        const clickedWord = d.word.toLowerCase();

        if (activeKeyword === clickedWord) {
            clearKeywordHighlight();
        } else {
            activeKeyword = clickedWord;
            d3.selectAll(".tfidf-bar")
                .classed("active", b => b.word.toLowerCase() === activeKeyword)
                .style("fill", b => b.word.toLowerCase() === activeKeyword ? keywordHighlightColor : null)
                .style("stroke", b => b.word.toLowerCase() === activeKeyword ? "#0f172a" : null)
                .style("stroke-width", b => b.word.toLowerCase() === activeKeyword ? "1.5px" : null);

            d3.selectAll("circle.node")
                .style("opacity", function(nodeData) {
                    const hasWord = nodeData.text.toLowerCase().includes(activeKeyword);
                    return hasWord ? 1 : 0.05; 
                })
                .style("stroke", function(nodeData) {
                    const hasWord = nodeData.text.toLowerCase().includes(activeKeyword);
                    return hasWord ? keywordHighlightColor : null;
                })
                .style("stroke-width", function(nodeData) {
                    return nodeData.text.toLowerCase().includes(activeKeyword) ? "2.5px" : null;
                });
        }
    });
} 




function applyFilters() {
    // 1. Leggiamo i valori attuali dai controlli UI
    const keyword = document.getElementById("filter-keyword").value.toLowerCase().trim();
    const sentiment = document.getElementById("filter-sentiment").value;
    const airline = document.getElementById("filter-airline").value;
    const maxLength = parseInt(document.getElementById("filter-length").value);

    // Aggiorniamo il numeretto dello slider
    document.getElementById("word-count-display").innerText = maxLength === 40 ? "All" : maxLength;

    // 2. Passiamo al setaccio tutti i nodi sulla mappa
    nodeLayer.selectAll("circle.node")
        .classed("dimmed", function(d) {
            // Regola 1: Keyword
            // Se c'è una parola chiave e il testo del tweet NON la contiene -> Dimmed
            if (keyword && !d.text.toLowerCase().includes(keyword)) return true;

            // Regola 2: Sentiment
            // Se non è su "All" e il sentiment non combacia -> Dimmed
            if (sentiment !== "all" && d.sentiment !== sentiment) return true;

            // Regola 3: Airline
            // Se non è su "All" e la compagnia non combacia -> Dimmed
            if (airline !== "all" && d.airline !== airline) return true;

            // Regola 4: Word Count
            // Contiamo gli spazi per stimare velocemente le parole. 
            // Se il limite non è 40 (massimo) e il tweet sfora -> Dimmed
            const wordCount = d.text.split(/\s+/).length;
            if (maxLength < 40 && wordCount > maxLength) return true;

            // Se sopravvive a tutti i test, NON è dimmed (rimane visibile)
            return false;
        });
}

// 3. Attacchiamo i Listener per far scattare i filtri in tempo reale
document.getElementById("filter-keyword").addEventListener("input", applyFilters);
document.getElementById("filter-sentiment").addEventListener("change", applyFilters);
document.getElementById("filter-airline").addEventListener("change", applyFilters);
document.getElementById("filter-length").addEventListener("input", applyFilters);

// 4. Tasto Reset
document.getElementById("btn-reset-filters").addEventListener("click", () => {
    document.getElementById("filter-keyword").value = "";
    document.getElementById("filter-sentiment").value = "all";
    document.getElementById("filter-airline").value = "all";
    document.getElementById("filter-length").value = 40;
    applyFilters(); // Ricalcola per togliere il dimming a tutti
});


// BERTopic
let allTopicsData = [];
let activeTopicSelectionId = null;
let topicSelectorValueBeforeClick = null;

function clearTopicSelection() {
    activeTopicSelectionId = null;

    const selector = document.getElementById("topic-selector");
    if (selector) {
        selector.selectedIndex = -1;
    }

    renderTopicBarchart(null);
    nodeLayer.selectAll("circle.node")
        .style("opacity", null)
        .style("stroke", null)
        .style("stroke-width", null);
}

function applyTopicSelection(selectedId) {
    const topicData = allTopicsData.find(t => t.id === selectedId);
    if (!topicData) return;

    activeTopicSelectionId = selectedId;
    renderTopicBarchart(topicData.words);

    d3.selectAll("circle.node")
        .transition()
        .duration(400)
        .style("opacity", d => d.topic_id === selectedId ? 1.0 : 0.05)
        .style("stroke", d => d.topic_id === selectedId ? "#000" : "none")
        .style("stroke-width", d => d.topic_id === selectedId ? 1.5 : 0);
}

// 1. Scarica i dati all'avvio// Usa la tua variabile globale per puntare al server corretto
fetch(API_BASE_URL + '/api/topics', {
    method: 'GET',
    headers: {
        // Mantiene il bypass per la schermata di sicurezza di Ngrok
        'ngrok-skip-browser-warning': 'true' 
    }
})
.then(res => {
    if (!res.ok) {
        throw new Error(`Errore Server HTTP: ${res.status}`);
    }
    return res.json();
})
.then(data => {
    allTopicsData = data.map(topic => ({
        ...topic,
        label: topic.label || getTopicLabel(normalizeTopicId(topic.id))
    }));
    
    // Popola la lista cliccabile
    const selector = d3.select("#topic-selector");
    allTopicsData.forEach(topic => {
        selector.append("option")
            .attr("value", topic.id)
            .text(`${topic.label} (${topic.count} tweets)`);
    });

    // Ascolta il click
    selector.on("change", function() {
        const selectedId = parseInt(this.value);
        const topicData = allTopicsData.find(t => t.id === selectedId);
        renderTopicBarchart(topicData.words);

        d3.selectAll("circle.node")
        .transition()
        .duration(400) // Animazione fluida
        .style("opacity", d => {
            // Se il topic coincide, massima opacità. Altrimenti quasi trasparenti.
            return d.topic_id === selectedId ? 1.0 : 0.05; 
        })
        .style("stroke", d => d.topic_id === selectedId ? "#000" : "none")
        .style("stroke-width", d => d.topic_id === selectedId ? 1.5 : 0);

    });

    selector.on("change", null);

    const topicSelectorElement = document.getElementById("topic-selector");
    if (topicSelectorElement && !topicSelectorElement.dataset.toggleBound) {
        topicSelectorElement.dataset.toggleBound = "true";

        topicSelectorElement.addEventListener("mousedown", function () {
            topicSelectorValueBeforeClick = this.value;
        });

        topicSelectorElement.addEventListener("change", function () {
            const selectedId = parseInt(this.value, 10);
            if (!Number.isNaN(selectedId)) {
                applyTopicSelection(selectedId);
            }
        });

        topicSelectorElement.addEventListener("click", function () {
            const clickedId = parseInt(this.value, 10);
            if (
                !Number.isNaN(clickedId) &&
                topicSelectorValueBeforeClick === this.value &&
                clickedId === activeTopicSelectionId
            ) {
                clearTopicSelection();
            }
        });
    }
})
.catch(err => {
    console.error("❌ Errore durante il caricamento dei Topic:", err);
});

// 2. Disegna il grafico a barre per le parole
function renderTopicBarchart(words) {
    const container = d3.select("#topic-barchart");
    container.html(""); // Pulisci

    if (!words || !words.length) {
        container.html('<em style="color: #94a3b8; font-size: 0.9rem;">Select a topic to see keywords...</em>');
        return;
    }
    
    // Dimensioni
    const width = document.getElementById("topic-barchart").clientWidth;
    const height = 120;
    const margin = {top: 10, right: 10, bottom: 20, left: 60};

    const svg = container.append("svg")
        .attr("width", width)
        .attr("height", height);

    // Scale
    const x = d3.scaleLinear()
        .domain([0, d3.max(words, d => d.weight)])
        .range([margin.left, width - margin.right]);

    const y = d3.scaleBand()
        .domain(words.map(d => d.word))
        .range([margin.top, height - margin.bottom])
        .padding(0.2);

    // Asse Y (Le parole)
    svg.append("g")
        .attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).tickSize(0))
        .selectAll("text")
        .style("font-size", "11px")
        .style("fill", "#334155");

    // Rimuovi la linea dell'asse per un look più pulito
    svg.selectAll(".domain").remove();

    // Barre orizzontali
    svg.selectAll("rect")
        .data(words)
        .enter()
        .append("rect")
        .attr("x", margin.left)
        .attr("y", d => y(d.word))
        .attr("width", d => x(d.weight) - margin.left)
        .attr("height", y.bandwidth())
        .attr("fill", "#3b82f6") // Blu accattivante
        .attr("border-radius", "4px");
}

const topicDistributionTooltip = d3.select("body")
    .append("div")
    .attr("class", "chart-tooltip");


function updateTopicFromMapSelection(brushedNodes) {
    if (!brushedNodes || brushedNodes.length === 0) return;

    const dominantTopicId = getDominantTopicId(brushedNodes);
    if (dominantTopicId === null) return;

    const selector = document.getElementById("topic-selector");
    if (selector) {
        selector.value = String(dominantTopicId);
    }
    updateBertopicSelectionSummary(brushedNodes);
}
