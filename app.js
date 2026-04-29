// IMPORTANT: Update the fallback URL when Kaggle/ngrok gives you a new public endpoint.
const DEFAULT_API_BASE_URL = "https://transdesert-overhugely-alessandra.ngrok-free.dev";
const DEFAULT_API_BASE_URL = "https://strike-happily-lurk.ngrok-free.dev";
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
const btnMultiSelect = document.getElementById("btn-multi-select");
const btnZoomSelection = document.getElementById("btn-zoom-selection");
const btnZoomOut = document.getElementById("btn-zoom-out");
let btnPanSelection = document.getElementById("btn-pan-selection");
const colorEncodingSelect = document.getElementById("color-encoding-select");
const mapToolbar = document.getElementById("map-toolbar");

btnMultiSelect.classList.remove("icon-btn");
btnMultiSelect.textContent = "Box Select";
btnMultiSelect.title = "Select multiple tweets with a box";
btnMultiSelect.style.minWidth = "92px";
btnMultiSelect.style.fontWeight = "600";

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
let currentColorEncoding = "sentiment";

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

    return sentimentColors[node.sentiment] || "#64748b";
}

function updateNodeColors() {
    nodeLayer.selectAll("circle.node").each(function (d) {
        const circle = d3.select(this);
        const isPerturbed = this.dataset.perturbed === "true";

        if (isPerturbed) return;

        if (currentColorEncoding === "airline") {
            circle.style("fill", airlineColorScale(d.airline));
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

function renderSelectionLegend(nodes) {
    const container = document.getElementById("selection-legend");

    if (!nodes.length) {
        container.innerHTML = '<div class="selection-empty">Select one or more points to see selected sentiment and airline legend.</div>';
        return;
    }

    const sentimentCounts = d3.rollups(nodes, values => values.length, d => d.sentiment)
        .sort((a, b) => d3.ascending(a[0], b[0]));
    const airlineCounts = d3.rollups(nodes, values => values.length, d => d.airline)
        .sort((a, b) => d3.ascending(a[0], b[0]));

    const renderItems = (items, colorFn) => items.map(([label, count]) => `
        <div class="legend-item">
            <span class="legend-swatch" style="background:${colorFn(label)};"></span>
            <span>${label} (${count})</span>
        </div>
    `).join("");

    container.innerHTML = `
        <div class="legend-group">
            <div class="legend-title">Selected Sentiments</div>
            <div class="legend-items">${renderItems(sentimentCounts, label => sentimentColors[label] || "#64748b")}</div>
        </div>
        <div class="legend-group">
            <div class="legend-title">Selected Airlines</div>
            <div class="legend-items">${renderItems(airlineCounts, label => airlineColorScale(label))}</div>
        </div>
    `;
}

function renderMapLegends(nodes = []) {
    const legendLabel = document.getElementById("map-legend-label");
    const legendItems = document.getElementById("map-legend-items");

    const legendData = currentColorEncoding === "airline"
        ? (
            nodes.length
                ? d3.rollups(nodes, values => values.length, d => d.airline)
                : airlineColorScale.domain().map(label => [label, null])
        )
        : (
            nodes.length
                ? d3.rollups(nodes, values => values.length, d => d.sentiment)
                : Object.keys(sentimentColors).map(label => [label, null])
        );

    legendLabel.innerText = currentColorEncoding === "airline" ? "Airline" : "Sentiment";
    legendItems.innerHTML = legendData.map(([label, count]) => `
        <div class="map-legend-item">
            <span class="map-legend-swatch" style="background:${currentColorEncoding === "airline" ? airlineColorScale(label) : (sentimentColors[label] || "#64748b")};"></span>
            <span>${label}${count !== null ? ` (${count})` : ""}</span>
        </div>
    `).join("");
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
    renderSelectionLegend(selectedNodesData);
    renderMapLegends(selectedNodesData);

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
    renderHeatmap(node.text);
    // updatePerturbationButtonState() will be called by renderTokenAnalysis when a token is clicked, or initially here if no token is clicked yet.
}

function clearSelection() {
    selectedNodesData = [];
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
        .style("fill", d => currentColorEncoding === "airline" ? airlineColorScale(d.airline) : null)
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
    brushLayer.style("display", active ? null : "none");
    btnMultiSelect.classList.toggle("active", active);
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
        if (!event.selection) return;

        const [[x0, y0], [x1, y1]] = event.selection;
        const transform = d3.zoomTransform(svg.node());
        const brushedNodes = allNodesData.filter(node => {
            const position = getCurrentNodePosition(node);
            const screenX = transform.applyX(position.x);
            const screenY = transform.applyY(position.y);
            return screenX >= x0 && screenX <= x1 && screenY >= y0 && screenY <= y1;
        });

        selectNodes(brushedNodes);
        if (brushedNodes.length > 0) {
            setCenterButtonEnabled(true);
        }
        brushLayer.call(brush.move, null);
        setBrushMode(false);
        
        fitSelectionToView(brushedNodes, 380);
        console.log("Brushed:", brushedNodes.length);
    });

svg.call(zoom).on("dblclick.zoom", null);
brushLayer.call(brush);

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
    return {
        id: d.tweet_id,
        text: d.text,
        sentiment: d.sentiment,
        airline: d.airline,
        x: +d.x,
        y: +d.y
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
            selectNodes([d], { append: isMultiAdd, toggle: isMultiAdd });
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
        renderSelectionLegend(selectedNodesData);
    });

    setResetButtonVisibility(false);
    resetPerturbationResults();
    updatePerturbationButtonState(); // Initial call to set button and input states
    updateSelectionUI();
}).catch(function (error) {
    console.error("Error loading CSV:", error);
    alert("Make sure base_map.csv is loaded and you are running a local server.");
});

function renderTokenAnalysis(text) {
    // Mostra il testo originale semplice
    d3.select("#tw-text-simple").text(text);
    
    const container = d3.select("#tw-text");
    container.html("<em>Calculating token weights...</em>");

    postJson("/api/token_weights", { text })
        .then(data => {
            if (!Array.isArray(data) || data.length === 0) {
                container.html("<em>No token data available.</em>");
                return;
            }

            container.html("");
            const maxWeight = d3.max(data, d => d.weight) || 0.01;
            const colorScale = d3.scaleSequential(d3.interpolateReds).domain([0, maxWeight]);

            data.forEach(item => {
                container.append("span")
                    .attr("class", "token")
                    .style("background-color", colorScale(item.weight))
                    .style("color", item.weight > maxWeight * 0.5 ? "white" : "black")
                    .style("cursor", "pointer") // Puntatore a manina
                    .text(`${item.word} `)
                    .on("click", function() {
                        // 1. Spegni eventuali altre parole selezionate
                        container.selectAll(".token").style("outline", "none").style("box-shadow", "none").style("transform", "scale(1)");
                        
                        // 2. Evidenzia questa parola (bordo blu)
                        d3.select(this)
                          .style("outline", "2px solid #1d4ed8")
                          .style("box-shadow", "0 2px 5px rgba(0,0,0,0.2)")
                          .style("transform", "scale(1.05)");

                        // 3. Salva la parola e mostra il banner
                        targetWordForPerturbation = item.word.trim();
                        updatePerturbationButtonState(); // Update button state and visibility
                    });
            });
        })
        .catch(err => {
            console.error("Token weight error:", err);
            container.html(`<em>Error loading token weights.</em><br><small>${err.message}</small>`);
            updatePerturbationButtonState(); // Ensure button state is updated even on error
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
        .style("fill", d => currentColorEncoding === "airline" ? airlineColorScale(d.airline) : null)
        .style("stroke", null)
        .style("stroke-width", null);

    document.getElementById("results-area").style.display = selectedNodesData.length ? "block" : "none";
    resetPerturbationResults();
});

function renderHeatmap(text) {
    const container = d3.select("#heatmap-container");
    container.html("<em>Generating heatmap matrix...</em>");

    postJson("/api/heatmap", { text })
        .then(heatmapData => {
            if (heatmapData.error) {
                container.html(`<div style="color: red; padding: 10px;"><strong>Backend Error:</strong> ${heatmapData.error}</div>`);
                console.error("Heatmap backend error:", heatmapData.error);
                return;
            }

            container.html("");

            const tokens = [...new Set(heatmapData.map(d => d.token))];
            const perturbations = [...new Set(heatmapData.map(d => d.perturbation))];
            const hmWidth = document.getElementById("details-panel").clientWidth - 40;
            const hmHeight = 150;
            const margin = { top: 20, right: 10, bottom: 40, left: 60 };

            const hmSvg = container.append("svg")
                .attr("width", hmWidth)
                .attr("height", hmHeight);

            const xBand = d3.scaleBand()
                .domain(tokens)
                .range([margin.left, hmWidth - margin.right])
                .padding(0.05);

            const yBand = d3.scaleBand()
                .domain(perturbations)
                .range([margin.top, hmHeight - margin.bottom])
                .padding(0.05);

            const maxImportance = d3.max(heatmapData, d => d.importance) || 0.01;
            const colorHm = d3.scaleSequential(d3.interpolateReds).domain([0, maxImportance]);

            hmSvg.append("g")
                .attr("transform", `translate(0,${hmHeight - margin.bottom})`)
                .call(d3.axisBottom(xBand))
                .selectAll("text")
                .attr("transform", "rotate(-20)")
                .style("text-anchor", "end")
                .style("font-size", "11px");

            hmSvg.append("g")
                .attr("transform", `translate(${margin.left},0)`)
                .call(d3.axisLeft(yBand))
                .style("font-size", "11px");

            hmSvg.selectAll("rect")
                .data(heatmapData)
                .enter()
                .append("rect")
                .attr("x", d => xBand(d.token))
                .attr("y", d => yBand(d.perturbation))
                .attr("width", xBand.bandwidth())
                .attr("height", yBand.bandwidth())
                .style("fill", d => colorHm(d.importance))
                .style("stroke", "#ccc")
                .style("stroke-width", 0.5)
                .append("title")
                .text(d => `Token: ${d.token}\nPerturbation: ${d.perturbation}\nImportance: ${d.importance.toFixed(2)}`);

            hmSvg.selectAll(".tick text")
                .style("cursor", "pointer")
                .style("font-weight", "bold")
                .on("mouseover", function () { d3.select(this).style("fill", "#ef4444"); })
                .on("mouseout", function () { d3.select(this).style("fill", "#475569"); })
                .on("click", function (event, selectedToken) {
                    nodeLayer.selectAll("circle.node").classed("dimmed", false);
                    nodeLayer.selectAll("circle.node")
                        .classed("dimmed", d => !d.text.toLowerCase().includes(selectedToken.toLowerCase()));
                });
        })
        .catch(err => {
            console.error("Heatmap error:", err);
            container.html(`<em>Error loading heatmap.</em><br><small>${err.message}</small>`);
        });
}

if (btnResetZoom) {
    btnResetZoom.addEventListener("click", () => {
        applyZoomTransform(d3.zoomIdentity, 320);
    });
}

if (btnMultiSelect) {
    btnMultiSelect.addEventListener("click", () => {
        setBrushMode(!brushModeActive);
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