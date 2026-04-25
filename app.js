// IMPORTANT: Change with your URL
const API_BASE_URL = "https://strike-happily-lurk.ngrok-free.dev";

const sentimentColors = {
    positive: "#22c55e",
    negative: "#ef4444",
    neutral: "#94a3b8"
};

const perturbationColors = {
    dict_synonym: "#2ca02c",
    dict_antonym: "#d62728",
    llm_paraphrase: "#1f77b4",
    llm_opposite: "#ff7f0e",
    noise: "#7f7f7f"
};

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
    .append("path").attr("d", "M0,-5L10,0L0,5").attr("fill", "#555");

let xScale, yScale;
let selectedNodesData = [];
const baseNodeRadius = 5;
 
const perturbationColors = {
    dict_synonym:   "#2ca02c",
    dict_antonym:   "#d62728",
    llm_paraphrase: "#1f77b4",
    llm_opposite:   "#ff7f0e",
    noise:          "#7f7f7f"
};

// Define the zoom behavior
const zoom = d3.zoom()
    .scaleExtent([0.5, 20])
    .filter(function (event) {
        // blocca doppio-click zoom
        if (event.type === "dblclick") return false;
        // rotellina: sempre ok
        if (event.type === "wheel") return true;
        // mousedown: ok solo se NON siamo in brush mode e NON su un nodo
        if (event.type === "mousedown") {
            return !document.body.classList.contains("brushing") &&
                   !event.target.classList.contains("node");
        }
        // touchstart/touchmove ecc: passa
        return !event.ctrlKey && !event.button;
    })
    .on("zoom", function (event) {
        zoomGroup.attr("transform", event.transform);
        xAxisGroup.call(d3.axisBottom(event.transform.rescaleX(xScale)));
        yAxisGroup.call(d3.axisLeft(event.transform.rescaleY(yScale)));
    });
 
svg.call(zoom)
    // disabilita il doppio-click zoom nativo di d3
   .on("dblclick.zoom", null);

// Aggiungiamo "panning" sul body solo durante il drag su area vuota
svg.on("mousedown.panCursor", function (event) {
    if (!document.body.classList.contains("brushing") &&
        !event.target.classList.contains("node")) {
        document.body.classList.add("panning");
    }
});
window.addEventListener("mouseup",    () => document.body.classList.remove("panning"));
window.addEventListener("mouseleave", () => document.body.classList.remove("panning"));
 
// SHIFT key toggles brushing mode
let isMouseDown = false;
window.addEventListener("mousedown", () => { isMouseDown = true; });
window.addEventListener("mouseup",   () => { isMouseDown = false; });
 
window.addEventListener("keydown", (e) => {
    if (e.key === "Shift" && !isMouseDown) {
        document.body.classList.add("brushing");
    }
});
window.addEventListener("keyup", (e) => {
    if (e.key === "Shift" && !isMouseDown) {
        document.body.classList.remove("brushing");
    }
});

const btnPerturb = document.getElementById("btn-perturb");
const btnClear = document.getElementById("btn-clear");
const btnResetZoom = document.getElementById("btn-reset-zoom");
const btnMultiSelect = document.getElementById("btn-multi-select");
const btnZoomSelection = document.getElementById("btn-zoom-selection");
const btnZoomOut = document.getElementById("btn-zoom-out");
const btnPanSelection = document.getElementById("btn-pan-selection");
const colorEncodingSelect = document.getElementById("color-encoding-select");

let xScale;
let yScale;
let allNodesData = [];
let selectedNodesData = [];
let airlineColorScale = d3.scaleOrdinal(d3.schemeCategory10);
let currentColorEncoding = "sentiment";
let brushModeActive = false;

const baseNodeRadius = 5;

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
        throw new Error(`HTTP ${response.status}: ${message}`);
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

    if (btnPerturb) btnPerturb.disabled = !hasSelection;
    if (btnClear) btnClear.disabled = !hasSelection;
    if (btnPanSelection) btnPanSelection.disabled = !hasSelection;

    document.getElementById("selection-count").innerText = `${selectedNodesData.length} tweet${selectedNodesData.length === 1 ? "" : "s"} selected`;
    renderSelectionLegend(selectedNodesData);
    renderMapLegends(selectedNodesData);

    if (!hasSelection) {
        document.getElementById("tw-id").innerText = "-";
        document.getElementById("tw-sentiment").innerText = "-";
        document.getElementById("tw-text").innerText = "Select a point on the map to see token weights...";
        document.getElementById("results-area").style.display = "none";
        d3.select("#heatmap-container").html("<em>Select a single tweet to view heatmap.</em>");
        return;
    }

    document.getElementById("results-area").style.display = "block";

    if (!singleSelection) {
        document.getElementById("tw-id").innerText = "Multiple";
        document.getElementById("tw-sentiment").innerText = "Mixed";
        document.getElementById("tw-text").innerHTML = `<em>${selectedNodesData.length} tweets selected. Use Zoom Selection or Center Selection to navigate the map, or click a single point to inspect token weights.</em>`;
        d3.select("#heatmap-container").html("<em>Heatmap available for a single selected tweet.</em>");
        return;
    }

    const node = selectedNodesData[0];
    document.getElementById("tw-id").innerText = node.id;
    document.getElementById("tw-sentiment").innerText = node.sentiment;
    renderTokenAnalysis(node.text);
    renderHeatmap(node.text);
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
}

function fitSelectionToView(nodes) {
    if (!nodes.length) return;

    const points = nodes.map(getCurrentNodePosition);
    const xExtent = d3.extent(points, point => point.x);
    const yExtent = d3.extent(points, point => point.y);
    const dx = Math.max(30, xExtent[1] - xExtent[0]);
    const dy = Math.max(30, yExtent[1] - yExtent[0]);
    const padding = 60;
    const scale = Math.max(0.5, Math.min(20, 0.9 / Math.max(dx / (width - padding), dy / (height - padding))));
    const centerX = (xExtent[0] + xExtent[1]) / 2;
    const centerY = (yExtent[0] + yExtent[1]) / 2;
    const transform = d3.zoomIdentity
        .translate(width / 2 - scale * centerX, height / 2 - scale * centerY)
        .scale(scale);

    svg.transition()
        .duration(750)
        .ease(d3.easeCubicOut)
        .call(zoom.transform, transform);
}

function centerSelectionInView(nodes) {
    if (!nodes.length) return;

    const currentTransform = d3.zoomTransform(svg.node());
    const points = nodes.map(getCurrentNodePosition);
    const centerX = d3.mean(points, point => point.x);
    const centerY = d3.mean(points, point => point.y);
    const transform = d3.zoomIdentity
        .translate(width / 2 - currentTransform.k * centerX, height / 2 - currentTransform.k * centerY)
        .scale(currentTransform.k);

    svg.transition()
        .duration(600)
        .ease(d3.easeCubicOut)
        .call(zoom.transform, transform);
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

        xAxisGroup.call(d3.axisBottom(event.transform.rescaleX(xScale)).ticks(10))
            .style("font-size", "12px");

        yAxisGroup.call(d3.axisLeft(event.transform.rescaleY(yScale)).ticks(10))
            .style("font-size", "12px");
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
        brushLayer.call(brush.move, null);
        setBrushMode(false);
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
    if (!event.target.classList.contains("node")) {
        nodeLayer.selectAll("circle.node").classed("dimmed", false);
    }
});

document.addEventListener("mouseup", () => document.body.classList.remove("panning"));
document.addEventListener("mouseleave", () => document.body.classList.remove("panning"));

d3.csv("base_map.csv", function (d) {
    return {
        id:        d.tweet_id,
        text:      d.text,
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
        .call(d3.axisBottom(xScale).ticks(10))
        .style("font-size", "12px");

    yAxisGroup.attr("transform", `translate(${margin.left},0)`)
        .call(d3.axisLeft(yScale).ticks(10))
        .style("font-size", "12px");

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
        .attr("r", bigDataset ? 2 : baseNodeRadius)
        .attr("shape-rendering", "crispEdges")
        .attr("data-perturbed", "false")
        .style("stroke-width", bigDataset ? "0px" : "0.5px")
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

    document.getElementById("results-area").style.display = "none";
    updateSelectionUI();
}).catch(function (error) {
    console.error("Error loading CSV:", error);
    alert("Make sure base_map.csv is loaded and you are running a local server.");
});

function renderTokenAnalysis(text) {
    const container = d3.select("#tw-text");
    container.html("<em>Calculating token weights...</em>");

    fetch(`${API_BASE_URL}/api/token_weights`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
        body: JSON.stringify({ text })
    })
        .then(parseApiResponse)
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
                    .style("text-shadow", "none")
                    .text(`${item.word} `);
            });
        })
        .catch(err => {
            console.error("Token weight error:", err);
            container.html(`<em>Error loading token weights.</em><br><small>${err.message}</small>`);
        });
}

document.getElementById("btn-perturb").addEventListener("click", () => {
    if (selectedNodesData.length === 0) return;

    const perturbType = document.getElementById("perturbation-select").value;
    const arrowColor = perturbationColors[perturbType];

    document.getElementById("results-area").style.display = "block";
    document.getElementById("new-text").innerText = "Loading perturbation from backend...";

    selectedNodesData.forEach(node => {
        fetch(`${API_BASE_URL}/api/perturb`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
            body: JSON.stringify({ text: node.text, type: perturbType })
        })
            .then(parseApiResponse)
            .then(data => {
                document.getElementById("new-text").innerText = data.new_text;

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
                    .style("stroke", "#000")
                    .style("stroke-width", "2px");
            })
            .catch(error => {
                console.error("Fetch Error:", error);
                document.getElementById("new-text").innerText = error.message;
            });
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
});

function renderHeatmap(text) {
    const container = d3.select("#heatmap-container");
    container.html("<em>Generating heatmap matrix...</em>");

    fetch(`${API_BASE_URL}/api/heatmap`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "true" },
        body: JSON.stringify({ text })
    })
        .then(parseApiResponse)
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
                .style("font-size", "10px");

            hmSvg.append("g")
                .attr("transform", `translate(${margin.left},0)`)
                .call(d3.axisLeft(yBand))
                .style("font-size", "10px");

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
        svg.transition()
            .duration(750)
            .ease(d3.easeCubicOut)
            .call(zoom.transform, d3.zoomIdentity);
    });
}

if (btnMultiSelect) {
    btnMultiSelect.addEventListener("click", () => {
        setBrushMode(!brushModeActive);
    });
}

if (btnZoomSelection) {
    btnZoomSelection.addEventListener("click", () => {
        svg.transition()
            .duration(350)
            .ease(d3.easeCubicOut)
            .call(zoom.scaleBy, 1.25);
    });
}

if (btnZoomOut) {
    btnZoomOut.addEventListener("click", () => {
        svg.transition()
            .duration(350)
            .ease(d3.easeCubicOut)
            .call(zoom.scaleBy, 0.8);
    });
}

if (btnPanSelection) {
    btnPanSelection.addEventListener("click", () => centerSelectionInView(selectedNodesData));
}
