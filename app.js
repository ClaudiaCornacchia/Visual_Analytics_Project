// Set up connection to Kaggle/Ngrok backend
// IMPORTANT: Update the fallback URL when Kaggle/ngrok gives you a new public endpoint.
const DEFAULT_API_BASE_URL = "https://transdesert-overhugely-alessandra.ngrok-free.dev";
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

// Define color palettes for standard visualization 
const sentimentColors = {
    positive: "#91cf60",
    negative: "#fc8d59",
    neutral: "#ffffbf"
};

const topicPalette = [
    "#a6cee3",
    "#1f78b4",
    "#b2df8a",
    "#33a02c",
    "#fb9a99",
    "#e31a1c",
    "#fdbf6f",
    "#ff7f00",
    "#cab2d6",
    "#6a3d9a",
    "#ffff99",
    "#b15928"
];

const airlinePalette = [
    "#7fc97f",
    "#beaed4",
    "#fdc086",
    "#ffff99",
    "#386cb0",
    "#f0027f"
];

const outlierTopicColor = "#d3d3d3a6";

// Map manual labels to algorithmically generated topic IDs
const manualTopicNames = {
    "-1": "Outliers",

    "0": "Flight Cancellations",              // flight, cancelled, cancelled flightled
    "1": "Flight Delays",                     // delayed, late, plane, flight
    "2": "Call Center Hold Times",          // hold, phone, hours, hung
    "3": "General Feedback",                  // flight, hold, great, good (mixed feedback)
    "4": "Lost Luggage",            // bag, luggage, lost, bags, baggage
    "5": "Customer Service",                  // customer, service, weather
    "6": "Promotions",       // destinationdragons, imaginedragons, companion pass
    "7": "Emails",            // email, appreciate, confirmation, message
    "8": "Inflight Wi-Fi",                    // wifi, inflight wifi, slow, power
    "9": "En Route Updates",                  // flytpa, enroute, departs, arrives
    "10": "Corporate",          // wall, ceo, street, wall street
    "11": "Crew Praise"                       // crew, flt, great, professionals
};

// Define colors for each specific XAI perturbation type
const perturbationColors = {
    dict_synonym: "#2ca02c",
    dict_antonym: "#d62728",
    dict_remove: "#9333ea",
    custom_replace: "#edef4b",
    llm_paraphrase: "#1f77b4",
    llm_opposite: "#ff7f0e",
    noise: "#7f7f7f",
    typo: "#06b6d4",
    shuffle: "#ec4899",
    leetspeak: "#84cc16"
};

const keywordHighlightColor = "#facc15";

// Rendering setup

const mapContainer = document.getElementById("map-panel");
const rect = mapContainer.getBoundingClientRect();
let width = rect.width;
let height = rect.height;

// Canvas is used for fast rendering of the 10k nodes. SVG is used for axes, brushes, and arrows
const svg = d3.select("#map")
    .attr("width", width)
    .attr("height", height);

const mapCanvas = document.getElementById("map-canvas");
const mapContext = mapCanvas.getContext("2d");

const zoomGroup = svg.append("g").attr("id", "zoom-group");
const linkLayer = zoomGroup.append("g").attr("id", "link-layer"); // for perturbation trajectory arrows
const nodeLayer = zoomGroup.append("g").attr("id", "node-layer"); // for standard nodes
const brushLayer = svg.append("g").attr("class", "brush").style("display", "none"); // for user selection rectangle

const xAxisGroup = svg.append("g").attr("class", "x-axis");
const yAxisGroup = svg.append("g").attr("class", "y-axis");

svg.append("defs").append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 8)
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("markerUnits", "userSpaceOnUse")
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#555");

// UI references
const btnPerturb = document.getElementById("btn-perturb");
const btnClear = document.getElementById("btn-clear");
const btnResetZoom = document.getElementById("btn-reset-zoom");
const btnZoomSelection = document.getElementById("btn-zoom-selection");
const btnZoomOut = document.getElementById("btn-zoom-out");
const btnMapNavigation = document.getElementById("btn-map-navigation");
let btnPanSelection = document.getElementById("btn-pan-selection");
const colorEncodingSelect = document.getElementById("color-encoding-select");
const mapToolbar = document.getElementById("map-toolbar");
const interactionClickBtn = document.getElementById("interaction-click");
const interactionBrushBtn = document.getElementById("interaction-brush");
const selectionPointBtn = document.getElementById("selection-point");
const selectionClusterBtn = document.getElementById("selection-cluster");

const clusterEncodingToggle = document.createElement("div");
clusterEncodingToggle.id = "cluster-encoding-toggle";
clusterEncodingToggle.className = "toolbar-toggle";
clusterEncodingToggle.title = "Cluster grouping";
clusterEncodingToggle.style.display = "none";
clusterEncodingToggle.style.cssText = "display: none; align-items: center; gap: 8px; margin: 10px 0 12px; flex-wrap: wrap;";
clusterEncodingToggle.innerHTML = `
    <span class="toolbar-toggle-label">Select View</span>
    <div class="toolbar-toggle-group">
        <button id="cluster-by-sentiment" class="toolbar-toggle-btn active" type="button" data-encoding="sentiment">Sentiment</button>
        <button id="cluster-by-airline" class="toolbar-toggle-btn" type="button" data-encoding="airline">Airline</button>
        <button id="cluster-by-topic" class="toolbar-toggle-btn" type="button" data-encoding="topic">Topic</button>
    </div>
`;
const selectionDistributionChart = document.getElementById("selection-distribution-chart");
const selectionClusterIndicator = document.getElementById("selection-cluster-indicator");
if (selectionClusterIndicator && selectionClusterIndicator.parentNode) {
    selectionClusterIndicator.parentNode.insertBefore(clusterEncodingToggle, selectionClusterIndicator);
} else if (selectionDistributionChart && selectionDistributionChart.parentNode) {
    selectionDistributionChart.parentNode.insertBefore(clusterEncodingToggle, selectionDistributionChart);
}
const clusterEncodingButtons = Array.from(clusterEncodingToggle.querySelectorAll("[data-encoding]"));

const centerButton = document.createElement("button");
centerButton.id = "btn-pan-selection";
centerButton.className = "toolbar-pill";
centerButton.textContent = "Center";
centerButton.title = "Center current selection";
centerButton.disabled = true;
centerButton.style.minWidth = "58px";
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

// Global state
let xScale;
let yScale;
let allNodesData = []; // stores the entire dataset
let selectedNodesData = []; // stores currently selected tweets 
let selectedNodeIds = new Set();
let brushClusterSourceNodes = [];
let canvasNodeRadius = 6;
let airlineColorScale = d3.scaleOrdinal().range(airlinePalette);
let topicColorScale = d3.scaleOrdinal().range(topicPalette);

// Interaction flags: control how the user is exploring the map 
let currentColorEncoding = "sentiment"; // current color map (sentiment, airline, topic)
let interactionMode = "click"; // can be 'click' (mouse) or 'brush' (rectangle)
let selectionMode = "point"; // 'point' (single tweet) or 'cluster' (group)
let mapNavigationMode = false; // True if user is panning/zooming
let originalClickedNode = null;

const wordBasedPerturbations = ["dict_synonym", "dict_antonym", "dict_remove", "custom_replace"];
const tweetBasedPerturbations = ["llm_paraphrase", "llm_opposite", "noise", "typo", "shuffle", "leetspeak"];
let brushModeActive = false;
let perturbationResults = [];
let activePerturbationKey = null;
let targetWordForPerturbation = null;
let perturbationTrajectories = [];
let perturbationVisualNodes = [];

let currentTopicLens = "words_operational";

const baseNodeRadius = 6;
const normalNodeOpacity = 0.72;
const highlightedNodeOpacity = 0.86;
const normalNodeStrokeColor = "rgba(15, 23, 42, 0.78)";
const normalNodeStrokeWidth = 1.25;
const selectedNodeStrokeColor = "#111827";
const selectedNodeStrokeWidth = 3.0;
const selectedWordMatchStrokeWidth = 13.0;
const anchorNodeStrokeWidth = 9.0;
const perturbationOutlineStrokeWidth = 8.0;
const inactivePerturbationOpacity = 0.35;
const keywordNodeStrokeWidth = 2.6;
const brushSelectedKeywordNodeStrokeWidth = 8.0;
const bertopicNodeStrokeWidth = 3.8;
const brushSelectedBertopicNodeStrokeWidth = 8.0;
const brushPointSelectedNodeStrokeWidth = 4.4;
const brushPointKeywordNodeStrokeWidth = 4.0;
const mapMargin = { top: 34, right: 44, bottom: 132, left: 86 };
const axisTickCount = 8;
const perturbationLabels = {
    dict_synonym: "Synonym",
    dict_antonym: "Antonym",
    llm_paraphrase: "Paraphrase",
    llm_opposite: "Opposite",
    noise: "Noise",
    typo: "Typo",
    shuffle: "Shuffled",
    leetspeak: "Leetspeak"
};

function getTopicLabel(topicId) {
    return topicId === -1 ? "Outlier" : (manualTopicNames[topicId] || `Topic ${topicId}`);
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

   
    const selector = document.getElementById("topic-selector");
    if (selector) {
        selector.value = String(dominantTopicId);
    }

    renderTopicBarchart(topicData[currentTopicLens]);
}

// Identifies the most frequent topic in a user's brushed area
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
    switch (currentColorEncoding) {
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

function getNodeAirlineLabel(node) {
    return node.airline || node.Airline || node.carrier || "Unknown";
}

function getNodeTopicLabel(node) {
    const rawTopicId = node.topic_id ?? node.topicId ?? node.Topic ?? node.topic;
    const topicId = normalizeTopicId(rawTopicId);
    return node.topic_label || node.topicLabel || getTopicLabel(topicId);
}

function getDominantClusterKey(nodes) {
    const keyCounts = new Map();

    nodes.forEach(node => {
        const key = getClusterKey(node);
        if (key === undefined || key === null) return;
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

// Resolves click selection, if 'cluster' mode is active, selects all nodes sharing the same key
function resolveClickSelectionMode(nodes, originalNode = null) {
    const uniqueNodes = getUniqueNodes(nodes);
    if (selectionMode !== "cluster" || !uniqueNodes.length) {
        return uniqueNodes;
    }

    const nodeToUse = originalNode || uniqueNodes[0];
    const selectedKey = getClusterKey(nodeToUse);
    if (selectedKey === undefined || selectedKey === null) {
        return uniqueNodes;
    }

    return allNodesData.filter(node => getClusterKey(node) === selectedKey);
}

// Resolves brush selection, finds the dominant cluster in the drawn rectangle
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
    const sourceNodes = interactionMode === "brush" && selectionMode === "cluster" && brushClusterSourceNodes.length
        ? brushClusterSourceNodes
        : selectedNodesData;
    const resolvedNodes = resolveSelectionForCurrentMode(sourceNodes, originalClickedNode);
    selectNodes(resolvedNodes, { append: false, toggle: false });
}

function setClusterEncoding(encoding, options = {}) {
    const { clearSelectionOnChange = false } = options;
    const encodingChanged = currentColorEncoding !== encoding;
    currentColorEncoding = encoding;
    if (encodingChanged) {
        clearPerturbationState();
        if (clearSelectionOnChange && selectedNodesData.length) {
            clearSelection({ resetPerturbations: true });
        }
    }
    if (colorEncodingSelect) {
        colorEncodingSelect.value = encoding;
    }
    syncModeButtons();
    updateNodeColors();
    renderMapLegends(selectedNodesData);

    if (selectionMode === "cluster" && selectedNodesData.length) {
        reapplySelectionMode();
        return;
    }

    renderSelectionDistributionChart(selectedNodesData);
    updateSelectionClusterIndicator();
}

// updates UI buttons and visibility depending on selected modes
function syncModeButtons() {
    interactionClickBtn.classList.toggle("active", interactionMode === "click");
    interactionBrushBtn.classList.toggle("active", interactionMode === "brush");
    selectionPointBtn.classList.toggle("active", selectionMode === "point");
    selectionClusterBtn.classList.toggle("active", selectionMode === "cluster");
    if (clusterEncodingToggle) {
        const showEncodingButtons = selectionMode === "cluster"
            || (interactionMode === "brush" && selectionMode === "point")
            || (interactionMode === "click" && selectionMode === "point");
        clusterEncodingToggle.style.display = showEncodingButtons ? "flex" : "none";
    }
    clusterEncodingButtons.forEach(button => {
        button.classList.toggle("active", button.dataset.encoding === currentColorEncoding);
    });
    if (btnMapNavigation) {
        btnMapNavigation.classList.toggle("active", mapNavigationMode);
        btnMapNavigation.setAttribute("aria-pressed", String(mapNavigationMode));
    }
}

function setMapNavigationMode(active) {
    mapNavigationMode = active;
    setBrushMode(interactionMode === "brush" && !mapNavigationMode);
    syncModeButtons();
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

function keepAxesVisible(transform = d3.zoomTransform(svg.node())) {
    if (!xScale || !yScale) return;

    xAxisGroup
        .attr("transform", `translate(0,${height - mapMargin.bottom})`)
        .call(d3.axisBottom(transform.rescaleX(xScale)).ticks(axisTickCount))
        .style("font-size", "13px");

    yAxisGroup
        .attr("transform", `translate(${mapMargin.left},0)`)
        .call(d3.axisLeft(transform.rescaleY(yScale)).ticks(axisTickCount))
        .style("font-size", "13px");

    svg.select("#umap-x-label")
        .attr("x", width / 2)
        .attr("y", height - mapMargin.bottom + 60);

    svg.select("#umap-y-label")
        .attr("x", -height / 2)
        .attr("y", 24);

    xAxisGroup.raise();
    yAxisGroup.raise();
    svg.selectAll(".axis-label").raise();
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
    return allNodesData.some(node => {
        if (!node._perturbed) return false;

        const position = getCurrentNodePosition(node);
        const screenX = t.applyX(position.x);
        const screenY = t.applyY(position.y);
        return screenX < 0 || screenX > width || screenY < 0 || screenY > height;
    });
}

function canPanMap() {
    return mapNavigationMode || (!brushModeActive && (isViewTransformed() || hasOffscreenPerturbedNode()));
}

function getCurrentNodePosition(node) {
    return {
        x: node._canvasX ?? xScale(node.x),
        y: node._canvasY ?? yScale(node.y)
    };
}

// Visual encodings 
// returns the correct color for a point based on the active encoding toggle
function getNodeFillColor(node) {
    if (node._fillOverride) return node._fillOverride;
    if (currentColorEncoding === "airline") {
        return airlineColorScale(node.airline);
    }
    if (currentColorEncoding === "topic") {
        return node.topic_id === -1 ? "#d3d3d3a6" : topicColorScale(node.topic_id);
    }

    return sentimentColors[node.sentiment] || "#64748b";
}

function resizeMapCanvas() {
    const pixelRatio = window.devicePixelRatio || 1;
    mapCanvas.width = Math.max(1, Math.floor(width * pixelRatio));
    mapCanvas.height = Math.max(1, Math.floor(height * pixelRatio));
    mapCanvas.style.width = `${width}px`;
    mapCanvas.style.height = `${height}px`;
    mapContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
}

function resetNodeVisuals({ resetPerturbations = false } = {}) {
    allNodesData.forEach(node => {
        node._selected = false;
        node._selectionAnchor = false;
        node._selectionMuted = false;
        node._dimmed = false;
        node._keywordHighlight = false;
        node._brushSelectedKeywordHighlight = false;
        node._bertopicHighlight = false;
        node._brushSelectedBertopicHighlight = false;
        node._perturbationOutline = false;
        node._opacity = normalNodeOpacity;
        node._stroke = normalNodeStrokeColor;
        node._strokeWidth = normalNodeStrokeWidth;
        if (resetPerturbations) {
            node._perturbed = false;
            node._canvasX = null;
            node._canvasY = null;
            node._fillOverride = null;
        }
    });
}

function isBrushPointTfidfHighlightActive() {
    return interactionMode === "brush" && selectionMode === "point" && Boolean(activeKeyword);
}

function getSelectedNodeStrokeWidth() {
    return isBrushPointTfidfHighlightActive() ? brushPointSelectedNodeStrokeWidth : selectedNodeStrokeWidth;
}

function getKeywordNodeStrokeWidth() {
    return isBrushPointTfidfHighlightActive() ? brushPointKeywordNodeStrokeWidth : keywordNodeStrokeWidth;
}

function getCanvasStrokeWidth(strokeWidth, zoomK, isEmphasized = false) {
    const distanceScale = zoomK < 1 ? zoomK * zoomK * 0.22 : 0.22;
    const maxStrokeWidth = isEmphasized ? 3.8 : 0.55;
    return Math.max(0.05, Math.min(maxStrokeWidth, strokeWidth * distanceScale));
}

function getRelativeLuminance(colorString) {
    const color = d3.color(colorString);
    if (!color) return 0;

    const channels = [color.r, color.g, color.b].map(value => {
        const normalized = value / 255;
        return normalized <= 0.03928
            ? normalized / 12.92
            : Math.pow((normalized + 0.055) / 1.055, 2.4);
    });

    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function getContrastRatio(colorA, colorB) {
    const luminanceA = getRelativeLuminance(colorA);
    const luminanceB = getRelativeLuminance(colorB);
    const lighter = Math.max(luminanceA, luminanceB);
    const darker = Math.min(luminanceA, luminanceB);
    return (lighter + 0.05) / (darker + 0.05);
}

function getDynamicAnchorStrokeColor(node) {
    const fillColor = getNodeFillColor(node);
    const candidates = ["#111827", "#ffffff", "#0f766e", "#2563eb", "#c026d3", "#facc15"];
    return candidates.reduce((bestColor, candidate) => (
        getContrastRatio(fillColor, candidate) > getContrastRatio(fillColor, bestColor)
            ? candidate
            : bestColor
    ), candidates[0]);
}

function getBrushSelectedKeywordStrokeColor(node) {
    const fillColor = getNodeFillColor(node);
    const candidates = ["#ffffff", "#2563eb", "#c026d3", "#0f766e", "#f97316"];
    return candidates.reduce((bestColor, candidate) => (
        getContrastRatio(fillColor, candidate) > getContrastRatio(fillColor, bestColor)
            ? candidate
            : bestColor
    ), candidates[0]);
}

function getBertopicStrokeColor(node) {
    const fillColor = getNodeFillColor(node);
    const candidates = ["#ffffff", "#7c3aed", "#0891b2", "#dc2626", "#111827"];
    return candidates.reduce((bestColor, candidate) => (
        getContrastRatio(fillColor, candidate) > getContrastRatio(fillColor, bestColor)
            ? candidate
            : bestColor
    ), candidates[0]);
}

function applySelectionVisualState() {
    const hasSelection = selectedNodeIds.size > 0;
    allNodesData.forEach(node => {
            node._selected = selectedNodeIds.has(node.id);
            node._selectionAnchor = interactionMode === "click"
                && selectionMode === "cluster"
                && originalClickedNode
                && node.id === originalClickedNode.id;
            node._selectionMuted = hasSelection && !node._selected;
            if (node._selected) {
                node._opacity = highlightedNodeOpacity;
                node._stroke = node._selectionAnchor ? getDynamicAnchorStrokeColor(node) : selectedNodeStrokeColor;
            node._strokeWidth = node._perturbationOutline
                ? perturbationOutlineStrokeWidth
                : (node._selectionAnchor ? anchorNodeStrokeWidth : getSelectedNodeStrokeWidth());
        } else if (node._selectionMuted) {
            node._opacity = 0.14;
            node._stroke = normalNodeStrokeColor;
            node._strokeWidth = normalNodeStrokeWidth;
        } else if (!node._keywordHighlight && !node._dimmed) {
            node._opacity = normalNodeOpacity;
            node._stroke = normalNodeStrokeColor;
            node._strokeWidth = normalNodeStrokeWidth;
        }
    });
}

function drawCanvasNode(node, transform, forceHighlight = false) {
    const position = getCurrentNodePosition(node);
    const x = transform.applyX(position.x);
    const y = transform.applyY(position.y);
    const radius = Math.max(1.2, canvasNodeRadius * transform.k);
    const opacity = forceHighlight ? (node._opacity ?? highlightedNodeOpacity) : (node._opacity ?? normalNodeOpacity);
    const stroke = forceHighlight
        ? (node._brushSelectedBertopicHighlight ? (node._stroke ?? getBertopicStrokeColor(node)) : (node._bertopicHighlight ? (node._stroke ?? getBertopicStrokeColor(node)) : (node._brushSelectedKeywordHighlight ? (node._stroke ?? getBrushSelectedKeywordStrokeColor(node)) : (node._keywordHighlight ? keywordHighlightColor : (node._stroke ?? selectedNodeStrokeColor)))))
        : (node._stroke ?? normalNodeStrokeColor);
    const strokeWidth = forceHighlight
        ? (node._brushSelectedBertopicHighlight ? (node._strokeWidth ?? brushSelectedBertopicNodeStrokeWidth) : (node._bertopicHighlight ? (node._strokeWidth ?? bertopicNodeStrokeWidth) : (node._brushSelectedKeywordHighlight ? (node._strokeWidth ?? brushSelectedKeywordNodeStrokeWidth) : (node._keywordHighlight ? getKeywordNodeStrokeWidth() : (node._strokeWidth ?? getSelectedNodeStrokeWidth())))))
        : (node._strokeWidth ?? normalNodeStrokeWidth);
    const renderedStrokeWidth = getCanvasStrokeWidth(
        strokeWidth,
        transform.k,
        node._selectionAnchor || node._brushSelectedKeywordHighlight || node._brushSelectedBertopicHighlight || node._perturbationOutline
    );

    mapContext.globalAlpha = opacity;
    mapContext.beginPath();
    mapContext.arc(x, y, radius, 0, Math.PI * 2);
    mapContext.fillStyle = getNodeFillColor(node);
    mapContext.fill();

    if (renderedStrokeWidth > 0) {
        mapContext.globalAlpha = Math.min(1, opacity + 0.1);
        mapContext.lineWidth = renderedStrokeWidth;
        mapContext.strokeStyle = stroke;
        mapContext.stroke();
    }
}

// Core rendering loop, clears canvas and redraws all nodes based on current zoom transform
function drawMapCanvas() {
    if (!xScale || !yScale) return;

    mapContext.clearRect(0, 0, width, height);
    const transform = d3.zoomTransform(svg.node());
    const highlightedNodes = [];

    allNodesData.forEach(node => {
        if (node._selected || node._keywordHighlight || node._bertopicHighlight) {
            highlightedNodes.push(node);
            return;
        }
        drawCanvasNode(node, transform);
    });

    // Sort highlighted nodes so they are drawn on top
    highlightedNodes
        .sort((a, b) => {
            const getHighlightWeight = node =>
                Number(Boolean(node._bertopicHighlight))
                + Number(Boolean(node._brushSelectedKeywordHighlight)) * 2
                + Number(Boolean(node._brushSelectedBertopicHighlight)) * 3
                + Number(Boolean(node._selectionAnchor)) * 4;
            return getHighlightWeight(a) - getHighlightWeight(b);
        })
        .forEach(node => drawCanvasNode(node, transform, true));
    perturbationVisualNodes.forEach(node => drawCanvasNode(node, transform, true));
    mapContext.globalAlpha = 1;
}

function getInsetLineEndpoints(startX, startY, endX, endY, inset) {
    const dx = endX - startX;
    const dy = endY - startY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (!distance || distance <= inset * 2) {
        return { x1: startX, y1: startY, x2: endX, y2: endY };
    }

    const ux = dx / distance;
    const uy = dy / distance;
    return {
        x1: startX + ux * inset,
        y1: startY + uy * inset,
        x2: endX - ux * inset,
        y2: endY - uy * inset
    };
}

// Perturbation handling 

// Calculates math for trajectory arrows, accounting for zoom scale to keep arrows proportional
function updatePerturbationTrajectories() {
    const transform = d3.zoomTransform(svg.node());
    const zoomK = Math.max(transform.k || 1, 0.001);
    const screenGap = 2 / zoomK;
    const zoomVisualScale = Math.sqrt(zoomK);
    const screenLineWidth = Math.max(0.35, Math.min(2.2, 0.85 * zoomVisualScale));
    const screenArrowLength = Math.max(4.0, Math.min(15, 7.0 * zoomVisualScale));
    const screenArrowHalfWidth = Math.max(1.8, Math.min(6.2, 3.2 * zoomVisualScale));
    const screenGhostStrokeWidth = Math.max(1.0, Math.min(3.0, 1.35 * zoomVisualScale));
    const lineWidth = screenLineWidth / zoomK;
    const arrowLength = screenArrowLength / zoomK;
    const arrowHalfWidth = screenArrowHalfWidth / zoomK;
    const ghostRadius = Math.max(2.4, canvasNodeRadius * 1.05);
    const ghostStrokeWidth = screenGhostStrokeWidth / zoomK;
    const startInset = canvasNodeRadius + screenGap;
    const endInset = canvasNodeRadius;

    perturbationTrajectories.forEach(trajectory => {
        const trajectoryOpacity = trajectory._active ? 1 : inactivePerturbationOpacity;
        const ghostOpacity = trajectory._active ? 0.78 : inactivePerturbationOpacity;
        const startPoint = getInsetLineEndpoints(
            trajectory.startX,
            trajectory.startY,
            trajectory.endX,
            trajectory.endY,
            startInset
        );
        const endPoint = getInsetLineEndpoints(
            trajectory.startX,
            trajectory.startY,
            trajectory.endX,
            trajectory.endY,
            endInset
        );
        const endpoints = {
            x1: startPoint.x1,
            y1: startPoint.y1,
            x2: endPoint.x2,
            y2: endPoint.y2
        };
        const dx = endpoints.x2 - endpoints.x1;
        const dy = endpoints.y2 - endpoints.y1;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / distance;
        const uy = dy / distance;
        const baseX = endpoints.x2 - ux * arrowLength;
        const baseY = endpoints.y2 - uy * arrowLength;
        const perpX = -uy;
        const perpY = ux;
        const arrowPath = [
            `M${endpoints.x2},${endpoints.y2}`,
            `L${baseX + perpX * arrowHalfWidth},${baseY + perpY * arrowHalfWidth}`,
            `L${baseX - perpX * arrowHalfWidth},${baseY - perpY * arrowHalfWidth}`,
            "Z"
        ].join("");

        trajectory.ghost
            .attr("cx", trajectory.startX)
            .attr("cy", trajectory.startY)
            .attr("r", ghostRadius)
            .attr("stroke-width", ghostStrokeWidth)
            .attr("opacity", ghostOpacity);

        trajectory.line
            .attr("x1", endpoints.x1)
            .attr("y1", endpoints.y1)
            .attr("x2", baseX)
            .attr("y2", baseY)
            .attr("stroke-width", lineWidth)
            .attr("opacity", trajectoryOpacity);

        trajectory.head
            .attr("d", arrowPath)
            .attr("opacity", trajectoryOpacity);
    });
}

function findCanvasNodeAt(screenX, screenY) {
    if (!allNodesData.length || brushModeActive || mapNavigationMode) return null;
    const transform = d3.zoomTransform(svg.node());
    const hitRadius = Math.max(5, canvasNodeRadius * transform.k + 3);
    let nearest = null;
    let nearestDistance = Infinity;

    const hitNodes = [...perturbationVisualNodes].reverse().concat(allNodesData);
    for (const node of hitNodes) {
        const position = getCurrentNodePosition(node);
        const dx = transform.applyX(position.x) - screenX;
        const dy = transform.applyY(position.y) - screenY;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= hitRadius && distance < nearestDistance) {
            nearest = node;
            nearestDistance = distance;
        }
    }

    return nearest;
}

function updateNodeColors() {
    drawMapCanvas();
}

function escapeHtml(text) {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function highlightChangedText(original, perturbed) {
    const originalWords = original.split(/\s+/);
    const perturbedWords = perturbed.split(/\s+/);
    const maxLen = Math.max(originalWords.length, perturbedWords.length);
    const highlighted = [];

    for (let i = 0; i < maxLen; i++) {
        const orig = originalWords[i] || "";
        const pert = perturbedWords[i] || "";
        const escaped = escapeHtml(pert);

        if (orig !== pert) {
            highlighted.push(`<span class="perturbation-diff">${escaped}</span>`);
        } else {
            highlighted.push(escaped);
        }
    }

    return highlighted.join(" ");
}

function highlightRemovedText(original, perturbed) {
    const originalWords = original.split(/\s+/).filter(Boolean);
    const perturbedWords = perturbed.split(/\s+/).filter(Boolean);
    const lcs = Array.from({ length: originalWords.length + 1 }, () =>
        Array(perturbedWords.length + 1).fill(0)
    );

    for (let i = originalWords.length - 1; i >= 0; i--) {
        for (let j = perturbedWords.length - 1; j >= 0; j--) {
            lcs[i][j] = originalWords[i] === perturbedWords[j]
                ? lcs[i + 1][j + 1] + 1
                : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
        }
    }

    const highlighted = [];
    let j = 0;
    for (let i = 0; i < originalWords.length; i++) {
        if (j < perturbedWords.length && originalWords[i] === perturbedWords[j]) {
            highlighted.push(escapeHtml(originalWords[i]));
            j++;
            continue;
        }

        if (j >= perturbedWords.length) {
            highlighted.push(`<span class="perturbation-removed">${escapeHtml(originalWords[i])}</span>`);
        } else if (lcs[i][j + 1] >= lcs[i + 1][j]) {
            highlighted.push(`<span class="perturbation-removed">${escapeHtml(originalWords[i])}</span>`);
        } else if (lcs[i + 1][j] >= lcs[i][j]) {
            highlighted.push(`<span class="perturbation-removed">${escapeHtml(originalWords[i])}</span>`);
        } else {
            highlighted.push(escapeHtml(originalWords[i]));
        }
    }

    return highlighted.join(" ");
}

function normalizePerturbationHighlight(html) {
    return html
        .replace(/<(strong|b)\b[^>]*>/gi, '<span class="perturbation-diff">')
        .replace(/<\/(strong|b)>/gi, "</span>");
}

function setPerturbationDisplay(result) {
    const output = document.getElementById("new-text");
    const resultsArea = document.getElementById("results-area");
    if (!result) {
        output.innerHTML = "<span>-</span>";
        if (resultsArea) resultsArea.style.display = "none";
        return;
    }
    if (resultsArea) resultsArea.style.display = "block";

    const label = perturbationLabels[result.type] || result.type;
    let perturbedHtml = "";
    const noHighlightTypes = [
        "llm_paraphrase",
        "llm_opposite",
        "shuffle",
    ];

    if (result.type === "dict_remove") {
        const originalText = result.originalText || result.text;
        perturbedHtml = highlightRemovedText(originalText, result.text);
    } else if (result.type === "noise" || result.type === "typo" || result.type === "leetspeak") {
        const originalText = result.originalText || result.text;
        perturbedHtml = highlightChangedText(originalText, result.text);
    } else if (noHighlightTypes.includes(result.type)) {
        perturbedHtml = escapeHtml(result.text);
    } else if (result.displayText && result.displayText !== result.text) {
        perturbedHtml = normalizePerturbationHighlight(result.displayText);
    } else {
        const originalText = result.originalText || result.text;
        perturbedHtml = highlightChangedText(originalText, result.text);
    }

    output.innerHTML = `<strong>${label}</strong><br>${perturbedHtml}`;
}

function syncActivePerturbationVisualState() {
    allNodesData.forEach(node => {
        node._perturbationOutline = false;
    });

    perturbationVisualNodes.forEach(node => {
        const isActive = node._perturbationResult?.key === activePerturbationKey;
        node._opacity = isActive ? highlightedNodeOpacity : inactivePerturbationOpacity;
        node._stroke = isActive ? selectedNodeStrokeColor : "transparent";
        node._strokeWidth = isActive ? perturbationOutlineStrokeWidth : 0;
        node._perturbationOutline = isActive;
    });

    perturbationTrajectories.forEach(trajectory => {
        trajectory._active = trajectory.key === activePerturbationKey;
    });

    const activeResult = perturbationResults.find(result => result.key === activePerturbationKey);
    if (activeResult) {
        const sourceNode = allNodesData.find(node => node.id === activeResult.nodeId);
        if (sourceNode) {
            sourceNode._perturbationOutline = true;
            sourceNode._stroke = selectedNodeStrokeColor;
            sourceNode._strokeWidth = perturbationOutlineStrokeWidth;
            sourceNode._opacity = highlightedNodeOpacity;
        }
    }

    applySelectionVisualState();
    updatePerturbationTrajectories();
    drawMapCanvas();
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
        
        if (result.key === activePerturbationKey) {
            const color = perturbationColors[result.type] || "#334155";
            chip.style.borderColor = color;
            chip.style.color = color;
            chip.style.fontWeight = "600";
        }
        
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
    syncActivePerturbationVisualState();
}

function storePerturbationResult(nodeId, type, text, originalText, displayText) {
    const key = `${nodeId}-${type}`;
    const nextResult = { key, nodeId, type, text, originalText, displayText }; 
    const existingIndex = perturbationResults.findIndex(result => result.key === key);

    if (existingIndex >= 0) {
        perturbationResults[existingIndex] = nextResult;
    } else {
        perturbationResults.push(nextResult);
    }

    activePerturbationKey = key;
    renderPerturbationCarousel();
    return nextResult;
}

function resetPerturbationResults() {
    perturbationResults = [];
    activePerturbationKey = null;
    renderPerturbationCarousel();
}

function removePerturbationVisualsByKey(key) {
    perturbationTrajectories = perturbationTrajectories.filter(trajectory => {
        if (trajectory.key !== key) return true;
        trajectory.ghost.remove();
        trajectory.line.remove();
        trajectory.head.remove();
        return false;
    });

    perturbationVisualNodes = perturbationVisualNodes.filter(node => node._perturbationResult?.key !== key);
}

// stores results and populates the perturbation carousel at the bottom
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

function getSelectionDistributionConfigs(nodes) {
    const countBySentiment = d3.rollup(nodes, values => values.length, d => d.sentiment);
    const countByAirline = d3.rollup(nodes, values => values.length, d => d.airline);
    const countByTopic = d3.rollup(nodes, values => values.length, d => d.topic_id);
    const sentimentOrder = ["positive", "negative", "neutral"];
    const airlineOrder = airlineColorScale.domain();
    const topicOrder = [-1, ...topicColorScale.domain()];

    function buildDistributionData(countMap, orderedKeys) {
        const seen = new Set(orderedKeys.map(key => String(key)));
        const extraKeys = Array.from(countMap.keys()).filter(key => !seen.has(String(key)));
        return [...orderedKeys, ...extraKeys]
            .map(key => [key, countMap.get(key) || 0])
            .filter(([, count]) => count > 0);
    }

    return {
        sentiment: {
            title: "Sentiments",
            data: buildDistributionData(countBySentiment, sentimentOrder),
            labelAccessor: label => label,
            colorAccessor: label => sentimentColors[label] || "#64748b"
        },
        airline: {
            title: "Airlines",
            data: buildDistributionData(countByAirline, airlineOrder),
            labelAccessor: label => label,
            colorAccessor: label => airlineColorScale(label)
        },
        topic: {
            title: "Topics",
            data: buildDistributionData(countByTopic, topicOrder),
            labelAccessor: label => getTopicLabel(label),
            colorAccessor: label => label === -1 ? outlierTopicColor : topicColorScale(label)
        }
    };
}

function renderSelectionVerticalBarChart(container, nodes) {
    const configs = getSelectionDistributionConfigs(nodes);
    const config = configs[currentColorEncoding] || configs.sentiment;
    const chartNode = container.node();
    const containerWidth = chartNode ? chartNode.getBoundingClientRect().width : 280;
    const totalCount = nodes.length || 1;
    const percentFormat = d3.format(".2f");

    if (config.data.length === 1 && config.data[0][1] === nodes.length) {
        const [key] = config.data[0];
        const categoryLabel = config.labelAccessor(key);
        const summary = document.createElement("div");
        summary.style.cssText = "padding: 8px 0 4px; color: #334155; font-size: 0.92rem; line-height: 1.45;";
        const percent = document.createElement("strong");
        percent.textContent = "100.00%";
        const category = document.createElement("strong");
        category.textContent = categoryLabel;
        summary.append(percent, " of selected tweets belong to ", category, ".");
        container.node().appendChild(summary);
        return;
    }

    const margin = { top: 34, right: 10, bottom: 69, left: 48 };
    const chartWidth = Math.max(containerWidth || 280, 260);
    const chartHeight = 220;
    const innerWidth = chartWidth - margin.left - margin.right;
    const innerHeight = chartHeight - margin.top - margin.bottom;

    const svg = container
        .append("svg")
        .attr("width", chartWidth)
        .attr("height", chartHeight)
        .attr("viewBox", `0 0 ${chartWidth} ${chartHeight}`)
        .style("width", "100%")
        .style("height", "auto");

    svg.append("text")
        .attr("x", margin.left)
        .attr("y", 14)
        .attr("fill", "#334155")
        .attr("font-size", "12px")
        .attr("font-weight", "700")
        .attr("text-transform", "uppercase")
        .text(`${config.title.toUpperCase()} DISTRIBUTION`);

    const x = d3.scaleBand()
        .domain(config.data.map(([key]) => String(key)))
        .range([0, innerWidth])
        .padding(0.28);

    const y = d3.scaleLinear()
        .domain([0, 100])
        .range([innerHeight, 0]);

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    g.append("g")
        .call(d3.axisLeft(y).ticks(5).tickFormat(value => `${value}%`).tickSize(-innerWidth))
        .call(axis => axis.select(".domain").remove())
        .call(axis => axis.selectAll(".tick line").attr("stroke", "#e2e8f0"))
        .call(axis => axis.selectAll(".tick text").attr("fill", "#64748b").attr("font-size", "11px"));

    g.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).tickFormat(key => {
            const rawKey = config.data.find(([label]) => String(label) === key)?.[0];
            const label = config.labelAccessor(rawKey);
            return label.length > 12 ? `${label.slice(0, 11)}...` : label;
        }))
        .call(axis => axis.select(".domain").attr("stroke", "#cbd5e1"))
        .call(axis => axis.selectAll(".tick line").remove())
        .call(axis => axis.selectAll(".tick text")
            .attr("fill", "#475569")
            .attr("font-size", "11px")
            .attr("transform", "rotate(-28)")
            .style("text-anchor", "end"));

    
    svg.append("text")
        .attr("class", "selection-x-label")
        .attr("x", margin.left + innerWidth / 2)
        .attr("y", chartHeight - 8)
        .attr("text-anchor", "middle")
        .style("font-size", "0.95rem")
        .style("font-weight", "600")
        .style("fill", "#475569")
        .text(config.title);

    svg.append("text")
        .attr("class", "selection-y-label")
        .attr("transform", `rotate(-90)`)
        .attr("x", -(margin.top + innerHeight / 2))
        .attr("y", 14)
        .attr("text-anchor", "middle")
        .style("font-size", "0.95rem")
        .style("font-weight", "600")
        .style("fill", "#475569")
        .text("Percentage (%)");

    g.selectAll("rect")
        .data(config.data)
        .enter()
        .append("rect")
        .attr("x", ([key]) => x(String(key)))
        .attr("y", ([, count]) => y((count / totalCount) * 100))
        .attr("width", x.bandwidth())
        .attr("height", ([, count]) => innerHeight - y((count / totalCount) * 100))
        .attr("rx", 3)
        .attr("fill", ([key]) => config.colorAccessor(key))
        .on("mousemove", function (event, [key, count]) {
            topicDistributionTooltip
                .style("opacity", 1)
                .style("left", `${event.clientX + 12}px`)
                .style("top", `${event.clientY + 12}px`)
                .html(`<strong>${config.labelAccessor(key)}</strong>${count} tweet${count === 1 ? "" : "s"}`);
        })
        .on("mouseleave", () => topicDistributionTooltip.style("opacity", 0));

    g.selectAll("text.bar-value")
        .data(config.data)
        .enter()
        .append("text")
        .attr("class", "bar-value")
        .attr("x", ([key]) => x(String(key)) + x.bandwidth() / 2)
        .attr("y", ([, count]) => y((count / totalCount) * 100) - 8)
        .attr("text-anchor", "middle")
        .attr("fill", "#334155")
        .attr("font-size", "11px")
        .attr("font-weight", "700")
        .text(([, count]) => `${percentFormat((count / totalCount) * 100)}%`);
}

function renderBrushClusterSummary(container, nodes) {
    const configs = getSelectionDistributionConfigs(nodes);
    const config = configs[currentColorEncoding] || configs.sentiment;
    const clusterKey = getClusterKey(nodes[0]);
    const label = config.labelAccessor(clusterKey);
    const color = config.colorAccessor(clusterKey);
    const clusterTotal = allNodesData.filter(node => getClusterKey(node) === clusterKey).length;
    const typeLabel = currentColorEncoding === "airline"
        ? "Airline"
        : (currentColorEncoding === "topic" ? "Topic" : "Sentiment");

    const summary = document.createElement("div");
    summary.style.cssText = "display: flex; align-items: center; gap: 12px; padding: 10px 0; color: #334155;";

    const swatch = document.createElement("span");
    swatch.style.cssText = `width: 14px; height: 14px; border-radius: 50%; background: ${color}; border: 1px solid rgba(15,23,42,0.35); flex-shrink: 0;`;

    const text = document.createElement("div");
    text.style.cssText = "display: grid; gap: 2px; font-size: 0.9rem;";
    text.innerHTML = `
        <strong>${typeLabel}: ${label}</strong>
        <span>${clusterTotal} tweet${clusterTotal === 1 ? "" : "s"} total</span>
    `;

    summary.appendChild(swatch);
    summary.appendChild(text);
    container.node().appendChild(summary);
}

function renderSelectionDistributionChart(nodes) {
    const container = d3.select("#selection-distribution-chart");
    const indicator = d3.select("#selection-cluster-indicator");
    container.html("");

    if (interactionMode === "click" && selectionMode === "point") {
        indicator.style("display", "flex");
        container.style("display", "none");
        return;
    }

    indicator.style("display", "none");
    container.style("display", null);

    if (!nodes.length) {
        topicDistributionTooltip.style("opacity", 0);
        container
            .attr("class", "chart-placeholder")
            .html("<em>Select one or more points to see the selection distribution.</em>");
        return;
    }

    container.attr("class", "");

    if (selectionMode === "cluster") {
        renderBrushClusterSummary(container, nodes);
        return;
    }

    if (interactionMode === "brush" && selectionMode === "point") {
        renderSelectionVerticalBarChart(container, nodes);
        return;
    }

    container
        .attr("class", "chart-placeholder")
        .html("<em>Brush multiple points to see the selection distribution.</em>");
}

function getClusterColor(node) {
    if (!node) return "#cbd5e1";
    switch (currentColorEncoding) {
        case "sentiment":
            return sentimentColors[node.sentiment] || "#64748b";
        case "airline":
            return airlineColorScale(node.airline || "Unknown");
        case "topic":
            return node.topic_id === -1 ? outlierTopicColor : topicColorScale(node.topic_id);
        default:
            return "#64748b";
    }
}

function getClusterLabel(node) {
    if (!node) return "-";
    switch (currentColorEncoding) {
        case "sentiment":
            return node.sentiment;
        case "airline":
            return getNodeAirlineLabel(node);
        case "topic":
            return getNodeTopicLabel(node);
        default:
            return getNodeTopicLabel(node);
    }
}

function updateSelectionClusterIndicator() {
    const indicator = document.getElementById("selection-cluster-indicator");
    const swatch = document.getElementById("selection-cluster-swatch");
    const text = document.getElementById("selection-cluster-text");
    if (!indicator || !swatch || !text) return;

    const isPointClickMode = interactionMode === "click" && selectionMode === "point";
    if (!isPointClickMode) {
        indicator.style.display = "none";
        return;
    }

    indicator.style.display = "flex";
    const titleCaseEncoding = currentColorEncoding.charAt(0).toUpperCase() + currentColorEncoding.slice(1);
    if (selectedNodesData.length !== 1) {
        swatch.style.background = "#cbd5e1";
        text.textContent = `Click a point to select a tweet and view ${titleCaseEncoding} cluster details.`;
        return;
    }

    const node = selectedNodesData[0];
    swatch.style.background = getClusterColor(node);
    text.textContent = `${titleCaseEncoding}: ${getClusterLabel(node)}`;
}

function renderMapLegends(nodes = []) {
    const legendLabel = document.getElementById("map-legend-label");
    const legendItems = document.getElementById("map-legend-items");
    const totalCount = document.getElementById("map-total-count");
    const detailsTotalCount = document.getElementById("details-total-count");
    const legendSource = allNodesData.length ? allNodesData : nodes;

    if (totalCount) {
        totalCount.innerText = `Total: ${legendSource.length} tweet${legendSource.length === 1 ? "" : "s"}`;
    }
    if (detailsTotalCount) {
        detailsTotalCount.innerText = `Total: ${legendSource.length} tweet${legendSource.length === 1 ? "" : "s"}`;
    }

    let legendData;
    if (currentColorEncoding === "airline") {
        legendLabel.innerText = "Airline";
        legendData = legendSource.length
            ? d3.rollups(legendSource, values => values.length, d => d.airline)
            : airlineColorScale.domain().map(label => [label, null]);
    } else if (currentColorEncoding === "topic") {
        legendLabel.innerText = "Topic";
        legendData = legendSource.length
            ? d3.rollups(legendSource, values => values.length, d => d.topic_id).sort((a, b) => a[0] - b[0])
            : [-1, ...topicColorScale.domain()].map(label => [label, null]);
    } else {
        legendLabel.innerText = "Sentiment";
        legendData = legendSource.length
            ? d3.rollups(legendSource, values => values.length, d => d.sentiment)
            : Object.keys(sentimentColors).map(label => [label, null]);
    }

    legendItems.innerHTML = legendData.map(([label, count]) => {
        let color = currentColorEncoding === "airline" ? airlineColorScale(label) : (currentColorEncoding === "topic" ? (label === -1 ? outlierTopicColor : topicColorScale(label)) : (sentimentColors[label] || "#64748b"));
        let displayLabel = currentColorEncoding === "topic" ? getTopicLabel(label) : label;
        
        return `
        <div class="map-legend-item" title="${displayLabel}">
            <span class="map-legend-swatch" style="background:${color};"></span>
            <span>${displayLabel}</span>
        </div>
        `;
    }).join("");
}

function updateSelectionUI() {
    selectedNodeIds = new Set(selectedNodesData.map(node => node.id));
    const selectionAttributeGrid = document.getElementById("tw-sentiment")?.closest("div")?.parentElement;

    applySelectionVisualState();
    drawMapCanvas();
    updateOriginalTextVisibility();

    const hasSelection = selectedNodesData.length > 0;
    const singleSelection = selectedNodesData.length === 1;

    
    if (btnClear) btnClear.disabled = !hasSelection;
    setCenterButtonEnabled(hasSelection);
    if (btnClearSelection) btnClearSelection.disabled = !hasSelection;

    document.getElementById("selection-count").innerText = `${selectedNodesData.length} tweet${selectedNodesData.length === 1 ? "" : "s"} selected`;
    renderSelectionDistributionChart(selectedNodesData);
    updateSelectionClusterIndicator();
    renderMapLegends(selectedNodesData);
    updateBertopicSelectionSummary(selectedNodesData);
    const selectionCountLine = document.getElementById("selection-count-line");
    if (selectionCountLine) {
        selectionCountLine.style.display = (interactionMode === "click" && selectionMode === "point") || (selectionMode === "cluster") ? "none" : "block";
    }
    if (selectionAttributeGrid) {
        selectionAttributeGrid.style.display = (singleSelection && !(interactionMode === "click" && selectionMode === "point")) ? "grid" : "none";
    }

    if (!hasSelection) {
        document.getElementById("tw-id").innerText = "-";
        document.getElementById("tw-sentiment").innerText = "-";
        document.getElementById("tw-airline").innerText = "-";
        document.getElementById("tw-topic").innerText = "-";
        document.getElementById("tw-text-simple").innerText = "Select a point on the map to see token weights...";
        document.getElementById("tw-text").innerText = "Select a point on the map to see token weights...";
        d3.select("#heatmap-container").html("<em>Select a single tweet to view heatmap.</em>");
        updatePerturbationButtonState(); 
        return;
    }


    if (!singleSelection) {
        document.getElementById("tw-id").innerText = "Multiple";
        document.getElementById("tw-sentiment").innerText = "Mixed";
        document.getElementById("tw-airline").innerText = "Mixed";
        document.getElementById("tw-topic").innerText = "Mixed";
        document.getElementById("tw-text-simple").innerHTML = `<em>${selectedNodesData.length} tweets selected. Use Zoom Selection or Center Selection to navigate the map, or click a single point to inspect token weights.</em>`;
        document.getElementById("tw-text").innerHTML = `<em>${selectedNodesData.length} tweets selected. Use Zoom Selection or Center Selection to navigate the map, or click a single point to inspect token weights.</em>`;
        d3.select("#heatmap-container").html("<em>Heatmap available for a single selected tweet.</em>");
        updatePerturbationButtonState(); 
        return;
    }

    const node = selectedNodesData[0];
    document.getElementById("tw-id").innerText = node.id;
    document.getElementById("tw-sentiment").innerText = node.sentiment;
    document.getElementById("tw-airline").innerText = getNodeAirlineLabel(node);
    document.getElementById("tw-topic").innerText = getNodeTopicLabel(node);
    renderTokenAnalysis(node.text);
    if (node._lastPerturbationResult) {
        activePerturbationKey = node._lastPerturbationResult.key;
        renderPerturbationCarousel();
        setPerturbationDisplay(node._lastPerturbationResult);
        document.getElementById("results-area").style.display = "block";
    } else {
        setPerturbationDisplay(null);
    }
    //renderHeatmap(node.text);
    // updatePerturbationButtonState() .
}

function showPerturbedTweetDetails(visualNode) {
    const result = visualNode._perturbationResult;
    if (!result) return;

    const selectionAttributeGrid = document.getElementById("tw-sentiment")?.closest("div")?.parentElement;
    if (selectionAttributeGrid) {
        selectionAttributeGrid.style.display = "grid";
    }

    document.getElementById("selection-count").innerText = "1 perturbed tweet selected";
    document.getElementById("tw-id").innerText = `${result.nodeId} · perturbed`;
    document.getElementById("tw-sentiment").innerText = visualNode.sentiment;
    document.getElementById("tw-airline").innerText = getNodeAirlineLabel(visualNode);
    document.getElementById("tw-topic").innerText = getNodeTopicLabel(visualNode);
    d3.select("#heatmap-container").html("<em>Token analysis is shown for the perturbed tweet.</em>");

    activePerturbationKey = result.key;
    renderPerturbationCarousel();
    setPerturbationDisplay(result);
    document.getElementById("results-area").style.display = "block";

    targetWordForPerturbation = null;
    if (document.getElementById("target-word-info")) {
        document.getElementById("target-word-info").style.display = "none";
    }
    updatePerturbationButtonState();
    renderTokenAnalysis(result.text);
}

function clearPerturbationState() {
    linkLayer.selectAll("*").remove();
    perturbationTrajectories = [];
    perturbationVisualNodes = [];
    allNodesData.forEach(node => {
        node._perturbed = false;
        node._canvasX = null;
        node._canvasY = null;
        node._fillOverride = null;
        node._perturbationOutline = false;
        node._lastPerturbationResult = null;
    });
    resetPerturbationResults();
}

function clearSelection(options = {}) {
    const { resetPerturbations = false } = options;
    selectedNodesData = [];
    brushClusterSourceNodes = [];
    originalClickedNode = null;
    clearKeywordHighlight();
    selectedNodeIds = new Set();
    resetNodeVisuals({ resetPerturbations });
    if (resetPerturbations) {
        clearPerturbationState();
    }
    drawMapCanvas();

    targetWordForPerturbation = null;
    if (document.getElementById("target-word-info")) document.getElementById("target-word-info").style.display = "none";
    updatePerturbationButtonState(); 
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
    updatePerturbationButtonState(); 

    // TF-IDF
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

// switch between TF-IDF and BERTopic
let activeSelectionInspector = "tfidf";

function setSelectionInspector(view) {
    activeSelectionInspector = view;
    renderSelectionInspectorToggle();
    updatePanelVisibility();
}

function renderSelectionInspectorToggle() {
    const tfidfBtn = document.getElementById("toggle-tfidf");
    const bertopicBtn = document.getElementById("toggle-bertopic");
    if (tfidfBtn) tfidfBtn.classList.toggle("active", activeSelectionInspector === "tfidf");
    if (bertopicBtn) bertopicBtn.classList.toggle("active", activeSelectionInspector === "bertopic");
}

function updatePanelVisibility() {
    const tokenPanel = document.getElementById("token-analysis-perturbation-card");
    const tfidfPanel = document.getElementById("tfidf-panel");
    const bertopicPanel = document.getElementById("bertopic-card");
    const inspectorCard = document.getElementById("selection-inspector-card");
    const showInspector = !(interactionMode === "click" && selectionMode === "point");

    if (inspectorCard) {
        inspectorCard.style.display = showInspector ? "block" : "none";
    }

    if (interactionMode === "click" && selectionMode === "point") {
        if (tokenPanel) tokenPanel.style.display = "block";
        if (tfidfPanel) tfidfPanel.style.display = "none";
        if (bertopicPanel) bertopicPanel.style.display = "none";
    } else {
        if (tokenPanel) tokenPanel.style.display = "none";
        if (tfidfPanel) tfidfPanel.style.display = activeSelectionInspector === "tfidf" ? "block" : "none";
        if (bertopicPanel) bertopicPanel.style.display = activeSelectionInspector === "bertopic" ? "block" : "none";
    }

    renderSelectionInspectorToggle();
    updateOriginalTextVisibility();
}

function updateOriginalTextVisibility() {
    const originalTextBlock = document.getElementById("original-text-block");
    const selectionCountLine = document.getElementById("selection-count-line");

    const hideBrushClusterDetails = selectionMode === "cluster"
        || (interactionMode === "brush" && selectionMode === "point");
    const hideSelectionLine = hideBrushClusterDetails || (interactionMode === "click" && selectionMode === "point");

    if (originalTextBlock) {
        originalTextBlock.style.display = hideBrushClusterDetails ? "none" : "block";
    }
    if (selectionCountLine) {
        selectionCountLine.style.display = hideSelectionLine || (selectionMode === "cluster") ? "none" : "block";
    }
}

function setInteractionMode(mode) {
    const modeChanged = interactionMode !== mode;
    interactionMode = mode;
    setBrushMode(mode === "brush" && !mapNavigationMode);
    if (mode !== "brush") {
        brushLayer.call(brush.move, null);
    }
    if (modeChanged) {
        clearSelection({ resetPerturbations: true });
    }
    syncModeButtons();
    updatePanelVisibility();
}

function setSelectionMode(mode) {
    const modeChanged = selectionMode !== mode;
    selectionMode = mode;
    if (mode === "point") {
        originalClickedNode = null;
    }
    if (modeChanged) {
        clearSelection({ resetPerturbations: true });
    }
    syncModeButtons();
    updatePanelVisibility();
}

// Initialize D3 behaviors
const zoom = d3.zoom()
    .scaleExtent([0.5, 20])
    .filter(function (event) {
        if (mapNavigationMode && event.type === "mousedown") return !event.ctrlKey && !event.button;
        if (brushModeActive) return false;
        if (event.type === "dblclick") return false;
        if (event.target && event.target.classList && event.target.classList.contains("node")) return false;
        if (event.type === "wheel") return true;
        if (event.type === "mousedown") return !event.ctrlKey && !event.button && canPanMap();
        return !event.ctrlKey && !event.button;
    })
    .on("zoom", function (event) {
        zoomGroup.attr("transform", event.transform);
        drawMapCanvas();
        updatePerturbationTrajectories();
        setResetButtonVisibility(isViewTransformed() || hasOffscreenPerturbedNode());

        keepAxesVisible(event.transform);
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

        brushClusterSourceNodes = selectionMode === "cluster" ? getUniqueNodes(brushedNodes) : [];
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

svg.on("mousemove.clickCursor", function (event) {
    if (interactionMode !== "click" || mapNavigationMode || brushModeActive) {
        svg.style("cursor", null);
        return;
    }

    const [pointerX, pointerY] = d3.pointer(event, svg.node());
    svg.style("cursor", findCanvasNodeAt(pointerX, pointerY) ? "pointer" : "default");
});

svg.on("mouseleave.clickCursor", function () {
    svg.style("cursor", null);
});

svg.on("click.resetDim", function (event) {
    if (
        mapNavigationMode ||
        event.target.closest("#map-toolbar") ||
        event.target.closest("#details-panel")
    ) return;

    const [pointerX, pointerY] = d3.pointer(event, svg.node());
    const clickedNode = findCanvasNodeAt(pointerX, pointerY);
    if (clickedNode) {
        if (clickedNode._perturbationResult) {
            showPerturbedTweetDetails(clickedNode);
            return;
        }

        clearSelection({ resetPerturbations: true });
        originalClickedNode = clickedNode;
        brushClusterSourceNodes = [];
        const nodesToSelect = resolveClickSelectionMode([clickedNode], clickedNode);
        selectNodes(nodesToSelect, { append: false, toggle: false });
        return;
    }

    clearSelection();
});

document.addEventListener("mouseup", () => document.body.classList.remove("panning"));
document.addEventListener("mouseleave", () => document.body.classList.remove("panning"));

// asynchronously load the dataset from CSV [
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

    const margin = mapMargin;
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

    const bigDataset = data.length > 2000;
    airlineColorScale = d3.scaleOrdinal().domain([...new Set(data.map(d => d.airline))]).range(airlinePalette);
    topicColorScale = d3.scaleOrdinal().domain([...new Set(data.map(d => d.topic_id))].filter(t => t !== -1).sort((a, b) => a - b)).range(topicPalette);
    renderMapLegends();
    canvasNodeRadius = bigDataset ? 2.6 : baseNodeRadius;
    resizeMapCanvas();
    resetNodeVisuals({ resetPerturbations: true });
    drawMapCanvas();

    svg.append("text")
        .attr("id", "umap-x-label")
        .attr("class", "axis-label")
        .attr("x", width / 2)
        .attr("y", height - mapMargin.bottom + 70)
        .text("UMAP 1");

    svg.append("text")
        .attr("id", "umap-y-label")
        .attr("class", "axis-label")
        .attr("transform", "rotate(-90)")
        .attr("y", 24)
        .attr("x", -height / 2)
        .text("UMAP 2");

    keepAxesVisible(d3.zoomIdentity);

    colorEncodingSelect.addEventListener("change", event => {
        const shouldResetView = interactionMode === "brush" && selectionMode === "point";
        setClusterEncoding(event.target.value, { clearSelectionOnChange: true });
        if (shouldResetView) {
            applyZoomTransform(d3.zoomIdentity, 320);
        }
    });

    setResetButtonVisibility(false);
    resetPerturbationResults();
    updatePerturbationButtonState(); 
    updateSelectionUI();
}).catch(function (error) {
    console.error("Error loading CSV:", error);
    alert("Make sure base_map.csv is loaded and you are running a local server.");
});

// Token Analysis
function renderTokenAnalysis(text) {
    
    d3.select("#tw-text-simple").text(text);
    
    const container = d3.select("#tw-text");
    container.html("<em style='color: #64748b;'>Calculating token ablation weights...</em>");

    postJson("/api/token_weights", { text })
        .then(data => {
            if (!Array.isArray(data) || data.length === 0) {
                container.html("<em style='color: #ef4444;'>No token data available for this text.</em>");
                return;
            }

            container.html(""); 
            
            const maxWeight = d3.max(data, d => d.weight) || 0.01;
        
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

        
            function colorToLuminance(cssColor) {
                if (!cssColor) return 1;
                let r, g, b;
                cssColor = cssColor.trim();
                if (cssColor.startsWith('rgb')) {
                    const nums = cssColor.match(/\d+/g).map(Number);
                    [r, g, b] = nums;
                } else if (cssColor[0] === '#') {
                    const hex = cssColor.slice(1);
                    if (hex.length === 3) {
                        r = parseInt(hex[0] + hex[0], 16);
                        g = parseInt(hex[1] + hex[1], 16);
                        b = parseInt(hex[2] + hex[2], 16);
                    } else {
                        r = parseInt(hex.slice(0, 2), 16);
                        g = parseInt(hex.slice(2, 4), 16);
                        b = parseInt(hex.slice(4, 6), 16);
                    }
                } else {
                    try {
                        const c = d3.color(cssColor);
                        if (c) { r = c.r; g = c.g; b = c.b; }
                    } catch (e) {
                        return 1;
                    }
                }

                const srgb = [r, g, b].map(v => {
                    const s = v / 255;
                    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
                });
                return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
            }

        
            data.forEach(item => {
                const bg = colorScale(item.weight);
                const fg = item.weight > (maxWeight * 0.5) ?  "#0f172a" : "#ffffff";

                container.append("span")
                    .attr("class", "token")
                    .attr("title", `Impact Score: ${item.weight.toFixed(3)}`)
                    .style("background-color", bg)
                    .style("color", fg)
                    .style("padding", "0 6px")
                    .style("border-radius", "6px")
                    .style("margin-right", "4px")
                    .style("box-shadow", "none")
                    .text(`${item.word} `)
                    .on("click", function(event) {
                      
                        container.selectAll(".token")
                            .style("box-shadow", "none")
                            .style("outline", "none");

                       
                        const lum = colorToLuminance(bg);
                        const innerColor = lum < 0.5 ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.85)';

                       
                        d3.select(this)
                            .style("box-shadow", `inset 0 0 0 3px ${innerColor}, 0 2px 6px rgba(0,0,0,0.12)`)
                            .style("outline", "none");

                    
                        targetWordForPerturbation = item.word.trim();
                        const displayEl = document.getElementById("target-word-display");
                        if (displayEl) displayEl.innerText = targetWordForPerturbation;
                        const infoEl = document.getElementById("target-word-info");
                        if (infoEl) infoEl.style.display = "block";

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

   
    if (isWordBased && targetWordForPerturbation && hasSingleSelection) {
        targetWordInfo.style.display = "block";
        document.getElementById("target-word-display").innerText = targetWordForPerturbation;
    } else {
        targetWordInfo.style.display = "none";
    }

    if (hasSingleSelection) {
       if (currentPerturbationType === "custom_replace") {
            canPerturb = customWordInput.value.trim() !== "";
        } else {
            canPerturb = true;
        }
    }
    btnPerturb.disabled = !canPerturb;
}

const btnClearTarget = document.getElementById("btn-clear-target");
if (btnClearTarget) {
    btnClearTarget.addEventListener("click", () => {
        targetWordForPerturbation = null;
        document.getElementById("target-word-info").style.display = "none";
        d3.selectAll(".token").style("outline", "none").style("box-shadow", "none").style("transform", "scale(1)"); 
        updatePerturbationButtonState(); 
    });
}


document.getElementById("perturbation-select").addEventListener("change", (e) => {
    updatePerturbationButtonState();
});

document.getElementById("custom-word-input").addEventListener("input", () => {
    updatePerturbationButtonState();
});


document.getElementById("btn-perturb").addEventListener("click", () => {
    if (selectedNodesData.length !== 1) { 
        console.warn("Perturbation requires a single tweet selection.");
        return;
    }

    const node = selectedNodesData[0];
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
                const perturbationResult = storePerturbationResult(node.id, perturbType, data.new_text, node.text, data.display_text);
                removePerturbationVisualsByKey(perturbationResult.key);

                const startX = xScale(node.x);
                const startY = yScale(node.y);
                const endX = xScale(data.new_x);
                const endY = yScale(data.new_y);

                const ghost = linkLayer.append("circle")
                    .attr("class", "ghost-node")
                    .attr("cx", startX)
                    .attr("cy", startY)
                    .attr("r", baseNodeRadius)
                    .attr("fill", getNodeFillColor(node))
                    .attr("fill-opacity", 0.28)
                    .attr("stroke", "none");

                const line = linkLayer.append("line")
                    .attr("class", "trajectory")
                    .attr("x1", startX)
                    .attr("y1", startY)
                    .attr("x2", startX)
                    .attr("y2", startY)
                    .attr("stroke", arrowColor)
                    .attr("stroke-linecap", "butt");

                const head = linkLayer.append("path")
                    .attr("class", "trajectory-head")
                    .attr("fill", arrowColor);

                perturbationTrajectories.push({ key: perturbationResult.key, sourceNodeId: node.id, startX, startY, endX, endY, ghost, line, head, _active: true });
                updatePerturbationTrajectories();

                node._perturbed = true;
                node._perturbationOutline = true;
                node._stroke = selectedNodeStrokeColor;
                node._strokeWidth = perturbationOutlineStrokeWidth;
                node._lastPerturbationResult = perturbationResult;
                perturbationVisualNodes.push({
                    id: `${node.id}-${perturbationResult.key}`,
                    text: perturbationResult.text,
                    sentiment: node.sentiment,
                    airline: node.airline,
                    topic_id: node.topic_id,
                    topic_label: node.topic_label,
                    _canvasX: endX,
                    _canvasY: endY,
                    _fillOverride: getNodeFillColor(node),
                    _opacity: highlightedNodeOpacity,
                    _stroke: selectedNodeStrokeColor,
                    _strokeWidth: perturbationOutlineStrokeWidth,
                    _keywordHighlight: false,
                    _perturbationOutline: true,
                    _perturbationResult: perturbationResult,
                    _sourceNodeId: node.id
                });
                syncActivePerturbationVisualState();
            })
            .catch(error => {
                console.error("Fetch Error:", error);
                document.getElementById("new-text").innerHTML = `<span>${error.message}</span>`;
            });
});

document.getElementById("btn-clear").addEventListener("click", () => {
    clearPerturbationState();
    applySelectionVisualState();
    drawMapCanvas();

    document.getElementById("results-area").style.display = selectedNodesData.length ? "block" : "none";
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

const toggleTfidfBtn = document.getElementById("toggle-tfidf");
const toggleBertopicBtn = document.getElementById("toggle-bertopic");
if (toggleTfidfBtn) {
    toggleTfidfBtn.addEventListener("click", () => {
        setSelectionInspector("tfidf");
    });
}
if (toggleBertopicBtn) {
    toggleBertopicBtn.addEventListener("click", () => {
        setSelectionInspector("bertopic");
    });
}

clusterEncodingButtons.forEach(button => {
    button.addEventListener("click", () => {
        setClusterEncoding(button.dataset.encoding);
    });
});

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

if (btnMapNavigation) {
    btnMapNavigation.addEventListener("click", () => {
        setMapNavigationMode(!mapNavigationMode);
    });
}

if (btnPanSelection) {
    btnPanSelection.addEventListener("click", () => {
        centerSelectionInView(selectedNodesData);
        setCenterButtonEnabled(false);
    });
}


const tfMargin = {top: 20, right: 30, bottom: 40, left: 100};
const tfContainer = document.getElementById('tfidf-panel');
let tfWidth = Math.max(tfContainer.clientWidth - 20, 300); 
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

const tfYScale = d3.scaleBand().range([0, tfInnerHeight]).padding(0.2);
let tfXScale = d3.scaleLinear().range([0, tfInnerWidth]);

const tfYAxisGroup = tfSvg.append("g").attr("class", "y-axis");
const tfXAxisGroup = tfSvg.append("g").attr("transform", `translate(0,${tfInnerHeight})`).attr("class", "x-axis");

let activeKeyword = null; 
let currentTfidfData = null;

function clearKeywordHighlight() {
    activeKeyword = null;
    d3.selectAll(".tfidf-bar")
        .classed("active", false)
        .style("fill", null)
        .style("stroke", null)
        .style("stroke-width", null);
    allNodesData.forEach(node => {
        node._keywordHighlight = false;
        node._brushSelectedKeywordHighlight = false;
        if (!node._selected && !node._selectionMuted && !node._dimmed) {
            node._opacity = normalNodeOpacity;
            node._stroke = normalNodeStrokeColor;
            node._strokeWidth = normalNodeStrokeWidth;
        }
    });
    applySelectionVisualState();
    drawMapCanvas();
}

function updateTFIDFChart(data) {
    currentTfidfData = data;
    const placeholder = d3.select("#tfidf-chart em");


    if (data && !Array.isArray(data) && typeof data === 'object') {
        data = Object.entries(data).map(([word, score]) => ({ word, score }));
    } else if (data && Array.isArray(data) && Array.isArray(data[0])) {
        data = data.map(d => ({ word: d[0], score: d[1] }));
    }


    if (!data || data.length === 0) {
        tfSvg.selectAll(".tfidf-bar").remove();
        tfYAxisGroup.selectAll("*").remove();
        tfXAxisGroup.selectAll("*").remove();
        clearKeywordHighlight();
        
        placeholder.style("display", "block").text("Select a tweet or more to see the keywords.");
        document.getElementById("tfidf-chart").style.minHeight = "40px";
        d3.select("#tfidf-chart svg").style("display", "none");
        
        return;
    }


    placeholder.style("display", "none");
    document.getElementById("tfidf-chart").style.minHeight = "250px";
    d3.select("#tfidf-chart svg").style("display", "block");


    if (tfContainer.clientWidth > 0) {
        tfWidth = Math.max(tfContainer.clientWidth, 300) - 20;
        tfInnerWidth = Math.max(tfWidth - tfMargin.left - tfMargin.right, 10);
        
        d3.select("#tfidf-chart svg")
            .attr("width", tfWidth)
            .attr("viewBox", `0 0 ${tfWidth} ${tfHeight}`);
            
        tfXScale.range([0, tfInnerWidth]);
    }

    const getScore = d => d.score !== undefined ? d.score : (d.weight || 0);

    tfYScale.domain(data.map(d => d.word));
    tfXScale.domain([0, d3.max(data, getScore) || 1]);

  
    tfYAxisGroup.transition().duration(500).call(d3.axisLeft(tfYScale));
    tfXAxisGroup.transition().duration(500).call(d3.axisBottom(tfXScale).ticks(5));


    let xAxisLabel = tfSvg.selectAll(".tfidf-x-label").data([0]);
    xAxisLabel.enter()
        .append("text")
        .attr("class", "tfidf-x-label")
        .merge(xAxisLabel)
        .transition().duration(500)
        .attr("x", tfInnerWidth)
        .attr("y", tfInnerHeight + 35) 
        .attr("text-anchor", "end")
        .style("font-size", "11px")
        .style("font-weight", "600")
        .style("fill", "#475569")
        .text("TF-IDF Score");
        

    tfXAxisGroup.selectAll("text").style("fill", "#64748b");


    const bars = tfSvg.selectAll(".tfidf-bar").data(data, d => d.word);

  
    bars.exit().transition().duration(300).attr("width", 0).remove();

   
    const barsEnter = bars.enter()
        .append("rect")
        .attr("class", "tfidf-bar")
        .attr("y", d => tfYScale(d.word))
        .attr("height", tfYScale.bandwidth())
        .attr("x", 0)
        .attr("width", 0) 
        .attr("fill", "#3b82f6"); 

 
    barsEnter.merge(bars)
        .transition().duration(500)
        .attr("y", d => tfYScale(d.word))
        .attr("height", tfYScale.bandwidth())
        .attr("width", d => Math.max(0, tfXScale(getScore(d))));

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

            allNodesData.forEach(nodeData => {
                const hasWord = nodeData.text.toLowerCase().includes(activeKeyword);
                const isBrushPointSelection = interactionMode === "brush" && selectionMode === "point";
                const isInsideBrushSelection = isBrushPointSelection && selectedNodeIds.has(nodeData.id);
                nodeData._keywordHighlight = hasWord;
                nodeData._brushSelectedKeywordHighlight = hasWord && isInsideBrushSelection;

                if (hasWord && isInsideBrushSelection) {
                    nodeData._opacity = highlightedNodeOpacity;
                    nodeData._stroke = getBrushSelectedKeywordStrokeColor(nodeData);
                    nodeData._strokeWidth = brushSelectedKeywordNodeStrokeWidth;
                } else if (hasWord) {
                    nodeData._opacity = isBrushPointSelection ? (nodeData._opacity ?? normalNodeOpacity) : highlightedNodeOpacity;
                    nodeData._stroke = keywordHighlightColor;
                    nodeData._strokeWidth = getKeywordNodeStrokeWidth();
                } else if (isInsideBrushSelection) {
                    nodeData._keywordHighlight = false;
                    nodeData._opacity = highlightedNodeOpacity;
                    nodeData._stroke = selectedNodeStrokeColor;
                    nodeData._strokeWidth = getSelectedNodeStrokeWidth();
                } else {
                    nodeData._opacity = isBrushPointSelection ? (nodeData._opacity ?? normalNodeOpacity) : 0.05;
                    nodeData._stroke = normalNodeStrokeColor;
                    nodeData._strokeWidth = normalNodeStrokeWidth;
                }
            });
            drawMapCanvas();
        }
    });
} 




function applyFilters() {
    
    const keyword = document.getElementById("filter-keyword").value.toLowerCase().trim();
    const sentiment = document.getElementById("filter-sentiment").value;
    const airline = document.getElementById("filter-airline").value;
    const maxLength = parseInt(document.getElementById("filter-length").value);

    document.getElementById("word-count-display").innerText = maxLength === 40 ? "All" : maxLength;

    allNodesData.forEach(d => {
        const wordCount = d.text.split(/\s+/).length;
        const isDimmed = Boolean(
            (keyword && !d.text.toLowerCase().includes(keyword)) ||
            (sentiment !== "all" && d.sentiment !== sentiment) ||
            (airline !== "all" && d.airline !== airline) ||
            (maxLength < 40 && wordCount > maxLength)
        );

        d._dimmed = isDimmed;
        if (isDimmed) {
            d._opacity = 0.1;
        } else if (!d._selected && !d._selectionMuted && !d._keywordHighlight) {
            d._opacity = normalNodeOpacity;
            d._stroke = normalNodeStrokeColor;
            d._strokeWidth = normalNodeStrokeWidth;
        }
    });
    applySelectionVisualState();
    drawMapCanvas();
    return;


    nodeLayer.selectAll("circle.node")
        .classed("dimmed", function(d) {
            
            if (keyword && !d.text.toLowerCase().includes(keyword)) return true;

           
            if (sentiment !== "all" && d.sentiment !== sentiment) return true;

          
            if (airline !== "all" && d.airline !== airline) return true;

            
            const wordCount = d.text.split(/\s+/).length;
            if (maxLength < 40 && wordCount > maxLength) return true;

            
            return false;
        });
}



// BERTopic
let currentTopicWords = null;
let allTopicsData = [];
let activeTopicSelectionId = null;
let topicSelectorValueBeforeClick = null;

function clearBertopicMapHighlight() {
    allNodesData.forEach(node => {
        node._bertopicHighlight = false;
        node._brushSelectedBertopicHighlight = false;
    });
}

function clearTopicSelection() {
    activeTopicSelectionId = null;

    const selector = document.getElementById("topic-selector");
    if (selector) {
        selector.selectedIndex = -1;
    }

    renderTopicBarchart(null);
    if (interactionMode === "brush" && selectionMode === "point") {
        clearBertopicMapHighlight();
    } else {
        resetNodeVisuals();
    }
    applySelectionVisualState();
    drawMapCanvas();
}

function applyTopicSelection(selectedId) {
    selectedWordFilter = null;
    const topicData = allTopicsData.find(t => t.id === selectedId);
    if (!topicData) return;

    activeTopicSelectionId = selectedId;
    
    renderTopicBarchart(topicData[currentTopicLens]);

    if (interactionMode === "brush" && selectionMode === "point") {
        clearBertopicMapHighlight();
        applySelectionVisualState();
        allNodesData.forEach(d => {
            const matchesTopic = d.topic_id === selectedId;
            const isInsideBrushSelection = selectedNodeIds.has(d.id);

            if (!matchesTopic) {
                return;
            }

            d._bertopicHighlight = true;
            d._brushSelectedBertopicHighlight = isInsideBrushSelection;
            d._stroke = getBertopicStrokeColor(d);
            d._strokeWidth = isInsideBrushSelection ? brushSelectedBertopicNodeStrokeWidth : bertopicNodeStrokeWidth;
            if (isInsideBrushSelection) {
                d._opacity = highlightedNodeOpacity;
            }
        });
        drawMapCanvas();
        return;
    }

    allNodesData.forEach(d => {
        const matchesTopic = d.topic_id === selectedId;
        d._opacity = matchesTopic ? highlightedNodeOpacity : 0.05;
        d._stroke = matchesTopic ? selectedNodeStrokeColor : normalNodeStrokeColor;
        d._strokeWidth = matchesTopic ? selectedNodeStrokeWidth : normalNodeStrokeWidth;
    });
    drawMapCanvas();
}
d3.selectAll('input[name="topicLens"]').on("change", function() {
    
    currentTopicLens = this.value; 


    if (activeTopicSelectionId !== null) {
        const topicData = allTopicsData.find(t => t.id === activeTopicSelectionId);
        if (topicData) {
            selectedWordFilter = null; 
            
        
            renderTopicBarchart(topicData[currentTopicLens]);
            
            if (interactionMode === "brush" && selectionMode === "point") {
                applyTopicSelection(activeTopicSelectionId);
            } else {
                
                highlightTweetsByWord(null);
            }
        }
    }
});


fetch('bertopic_data.json') 
.then(res => {
    if (!res.ok) {
        throw new Error(`Errore caricamento JSON: ${res.status}`);
    }
    return res.json();
})
.then(data => {
   
    allTopicsData = data.map(topic => ({
        ...topic,
        label: topic.label || getTopicLabel(normalizeTopicId(topic.id))
    }));
    
    
    const selector = d3.select("#topic-selector");
    allTopicsData.forEach(topic => {
        selector.append("option")
            .attr("value", topic.id)
            .text(`${getTopicDisplayName(topic.id, topic.words_operational)} (${topic.count} tweets)`);
    });

   
    selector.on("change", function() {
        const selectedId = parseInt(this.value);
        const topicData = allTopicsData.find(t => t.id === selectedId);
        renderTopicBarchart(topicData[currentTopicLens]);

        d3.selectAll("circle.node")
        .transition()
        .duration(400) 
        .style("opacity", d => {
           
            return d.topic_id === selectedId ? highlightedNodeOpacity : 0.05; 
        })
        .style("stroke", d => d.topic_id === selectedId ? selectedNodeStrokeColor : normalNodeStrokeColor)
        .style("stroke-width", d => d.topic_id === selectedId ? selectedNodeStrokeWidth : normalNodeStrokeWidth);

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



function getTopicDisplayName(topicId, wordsArray = []) {
    const manualName = manualTopicNames[topicId] || `Topic ${topicId}`;
    
    return manualName;
}


let selectedWordFilter = null;

function renderTopicBarchart(words) {
    currentTopicWords = words;

    const container = d3.select("#topic-barchart");
    container.html(""); 

    if (!words || !words.length) {
        container.html('<em style="color: #94a3b8; font-size: 0.9rem;">Select a topic to see the keywords.</em>');
        selectedWordFilter = null; 
        return;
    }
    
    
    const width = Math.max(document.getElementById("topic-barchart").clientWidth, 200);
    const height = 160;
    const margin = {top: 15, right: 20, bottom: 35, left: 75}; 

    const svg = container.append("svg")
        .attr("width", width)
        .attr("height", height);

   
    const x = d3.scaleLinear()
        .domain([0, d3.max(words, d => d.weight) * 1.05]) 
        .range([margin.left, width - margin.right]);

    const y = d3.scaleBand()
        .domain(words.map(d => d.word))
        .range([margin.top, height - margin.bottom])
        .padding(0.25); 

   
    svg.append("g")
        svg.append("g")
        .attr("transform", `translate(0, ${height - margin.bottom})`)
        
        .call(d3.axisBottom(x).ticks(4).tickFormat(d3.format(".3f"))) 
        .selectAll("text")
        .style("font-size", "11px")     
        .style("fill", "#475569")        
        .style("font-weight", "500");

   
    svg.selectAll(".x-axis path, .x-axis line").attr("stroke", "#94a3b8");

    
    svg.append("text")
        .attr("x", width - margin.right)
        .attr("y", height - 8)         
        .attr("text-anchor", "end")
        .style("font-size", "11px")      
        .style("font-weight", "600")    
        .style("fill", "#334155")        
        .text("c-TF-IDF score");

    svg.append("g")
        .attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(y).tickSize(0)) 
        .selectAll("text")
        .style("font-size", "12px")      
        .style("font-weight", "500")
        .style("fill", "#1e293b");      


    svg.select(".domain").remove();


    const bars = svg.selectAll("rect")
        .data(words)
        .enter()
        .append("rect")
        .attr("x", margin.left)
        .attr("y", d => y(d.word))
        .attr("width", d => x(d.weight) - margin.left)
        .attr("height", y.bandwidth())
        .attr("cursor", "pointer") 
        .attr("fill", d => (selectedWordFilter === d.word) ? "#1d4ed8" : "#3b82f6") 
        .attr("rx", 3); 

    
    bars.on("click", function(event, d) {
        
        if (selectedWordFilter === d.word) {
            selectedWordFilter = null;
        } else {
            selectedWordFilter = d.word;
        }

     
        bars.attr("fill", b => (selectedWordFilter === b.word) ? "#1d4ed8" : "#94a3b8"); 
        
        if (selectedWordFilter === null) {
            
            bars.attr("fill", "#3b82f6");
        }

        
        highlightTweetsByWord(selectedWordFilter);
    });
}

function highlightTweetsByWord(word) {
    if (!word) {
        if (interactionMode === "brush" && selectionMode === "point") {
            clearBertopicMapHighlight();
            applySelectionVisualState();
            drawMapCanvas();
            return;
        }

        allNodesData.forEach(d => {
            const matchesTopic = d.topic_id === activeTopicSelectionId;
            d._opacity = matchesTopic ? highlightedNodeOpacity : 0.05;
            d._stroke = matchesTopic ? selectedNodeStrokeColor : normalNodeStrokeColor;
            d._strokeWidth = matchesTopic ? selectedNodeStrokeWidth : normalNodeStrokeWidth;
        });
        drawMapCanvas();
        return;
    }

    const lowerWordForCanvas = word.toLowerCase();
    const isBrushPointSelection = interactionMode === "brush" && selectionMode === "point";
    if (isBrushPointSelection) {
        clearBertopicMapHighlight();
        applySelectionVisualState();
    }

    allNodesData.forEach(d => {
        const textContainsWord = d.text && d.text.toLowerCase().includes(lowerWordForCanvas);
        const isSelectedByBrush = isBrushPointSelection && selectedNodeIds.has(d.id);

        if (isBrushPointSelection) {
            if (isSelectedByBrush) {
                d._opacity = highlightedNodeOpacity;
                d._stroke = textContainsWord ? getBertopicStrokeColor(d) : normalNodeStrokeColor;
                d._strokeWidth = textContainsWord ? selectedWordMatchStrokeWidth : normalNodeStrokeWidth;
                d._brushSelectedBertopicHighlight = textContainsWord;
            } else if (textContainsWord) {
                d._bertopicHighlight = true;
                d._opacity = d._opacity ?? normalNodeOpacity;
                d._stroke = getBertopicStrokeColor(d);
                d._strokeWidth = bertopicNodeStrokeWidth;
            }
            return;
        }

        if (d.topic_id !== activeTopicSelectionId) {
            d._opacity = 0.05;
            d._stroke = normalNodeStrokeColor;
            d._strokeWidth = normalNodeStrokeWidth;
            return;
        }

        d._opacity = textContainsWord ? highlightedNodeOpacity : 0.2;
        d._stroke = textContainsWord ? selectedNodeStrokeColor : normalNodeStrokeColor;
        d._strokeWidth = textContainsWord ? selectedNodeStrokeWidth : normalNodeStrokeWidth;
    });
    drawMapCanvas();
    return;

    const dots = d3.selectAll("circle.node"); 

    if (!word) {
        
        dots.transition().duration(300)
            .style("opacity", d => d.topic_id === activeTopicSelectionId ? highlightedNodeOpacity : 0.05)
            .style("stroke", d => d.topic_id === activeTopicSelectionId ? selectedNodeStrokeColor : normalNodeStrokeColor)
            .style("stroke-width", d => d.topic_id === activeTopicSelectionId ? selectedNodeStrokeWidth : normalNodeStrokeWidth);
        return;
    }

   
    const lowerWord = word.toLowerCase();
    
    dots.transition().duration(300)
        .style("opacity", d => {
           
            if (d.topic_id !== activeTopicSelectionId) return 0.05; 
            
          
            const textContainsWord = d.text && d.text.toLowerCase().includes(lowerWord);
            
            
            return textContainsWord ? highlightedNodeOpacity : 0.2; 
        })
        .style("stroke", d => {
            if (d.topic_id !== activeTopicSelectionId) return normalNodeStrokeColor;
            const textContainsWord = d.text && d.text.toLowerCase().includes(lowerWord);
            return textContainsWord ? selectedNodeStrokeColor : normalNodeStrokeColor;
        })
        .style("stroke-width", d => {
            if (d.topic_id !== activeTopicSelectionId) return normalNodeStrokeWidth;
            const textContainsWord = d.text && d.text.toLowerCase().includes(lowerWord);
            return textContainsWord ? selectedNodeStrokeWidth : normalNodeStrokeWidth; 
        });
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


window.addEventListener("resize", () => {
    
    const rect = mapContainer.getBoundingClientRect();
    width = rect.width;
    height = rect.height;

    svg.attr("width", width).attr("height", height);
    resizeMapCanvas();

    if (allNodesData && allNodesData.length > 0) {
        const margin = mapMargin;
        
    
        xScale.range([margin.left, width - margin.right]);
        yScale.range([height - margin.bottom, margin.top]);

       
        brush.extent([[0, 0], [width, height]]);
        brushLayer.call(brush);

    
        linkLayer.selectAll("*").remove();
        perturbationTrajectories = [];
        perturbationVisualNodes = [];
        allNodesData.forEach(node => {
            node._perturbed = false;
            node._canvasX = null;
            node._canvasY = null;
            node._fillOverride = null;
        });


        const currentTransform = d3.zoomTransform(svg.node());
        keepAxesVisible(currentTransform);
        drawMapCanvas();
    }

  
    if (selectedNodesData && selectedNodesData.length > 0) {
        renderSelectionDistributionChart(selectedNodesData);
    }
    
    if (currentTfidfData) {
        updateTFIDFChart(currentTfidfData);
    }
    
    if (currentTopicWords) {
        renderTopicBarchart(currentTopicWords);
    }
});
