// IMPORTANT: Change with you url
const API_BASE_URL = "https://transdesert-overhugely-alessandra.ngrok-free.dev";

// Get SVG container dimensions
const mapContainer = document.getElementById('scatterplot-container');
const width = mapContainer.clientWidth;
const height = mapContainer.clientHeight;

const svg = d3.select("#map")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

// Create a "Master Group" that will handle zooming and panning
const zoomGroup = svg.append("g").attr("id", "zoom-group");

// Put the layers INSIDE the Master Group 
const linkLayer = zoomGroup.append("g").attr("id", "link-layer");
const brushLayer = zoomGroup.append("g").attr("class", "brush");
const nodeLayer  = zoomGroup.append("g").attr("id", "node-layer");
 

const xAxisGroup = svg.append("g").attr("class", "x-axis");
const yAxisGroup = svg.append("g").attr("class", "y-axis");

// Arrowhead marker
svg.append("defs").append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 8).attr("refY", 0)
    .attr("markerWidth", 6).attr("markerHeight", 6)
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


// Load data and initialize the scatterplot
d3.csv("base_map.csv", function (d) {
    return {
        id:        d.tweet_id,
        text:      d.text,
        sentiment: d.sentiment,
        airline:   d.airline,
        x: +d.x,
        y: +d.y
    };
}).then(function (data) {
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
 
    xAxisGroup.attr("transform", `translate(0,${height - margin.bottom})`).call(d3.axisBottom(xScale));
    yAxisGroup.attr("transform", `translate(${margin.left},0)`).call(d3.axisLeft(yScale));
 
    // Brush 
    let brushTimer = null;
    const brush = d3.brush()
        .extent([[0, 0], [width, height]])
        .on("brush end", function (event) {
            if (!event.selection) return;
            clearTimeout(brushTimer);
            brushTimer = setTimeout(() => {
                const [[x0, y0], [x1, y1]] = event.selection;
                const t = d3.zoomTransform(svg.node());
                const brushed = [];
                nodeLayer.selectAll("circle.node").each(function (d) {
                    const cx = t.applyX(xScale(d.x));
                    const cy = t.applyY(yScale(d.y));
                    if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) brushed.push(d);
                });
                selectNodes(brushed);
            }, 60);
        });
 
    brushLayer.call(brush);
 
    // Draw circles
    const bigDataset = data.length > 2000;
 
    nodeLayer.selectAll("circle.node")
        .data(data)
        .enter()
        .append("circle")
        .attr("class", d => `node ${d.sentiment}`)
        .attr("id",    d => "node-" + d.id)
        .attr("cx", d => xScale(d.x))
        .attr("cy", d => yScale(d.y))
        .attr("r",  bigDataset ? 2 : baseNodeRadius)
        .attr("shape-rendering", "crispEdges")
        .style("stroke-width", bigDataset ? "0px" : "0.5px")
        .style("opacity", bigDataset ? 0.5 : 0.8)
        .on("click", function (event, d) {
            // pulisce la brush selection visiva
            brushLayer.call(brush.move, null);
            selectNodes([d]);
        });
 
    // ── Color buttons ──────────────────────────────────────────────────────
    const colorAirline = d3.scaleOrdinal(d3.schemeCategory10);
 
    document.getElementById("btn-color-airline").addEventListener("click", () => {
        nodeLayer.selectAll("circle.node")
            .transition().duration(800)
            .style("fill", d => colorAirline(d.airline))
            .style("opacity", 0.8);
    });
 
    document.getElementById("btn-color-sentiment").addEventListener("click", () => {
        nodeLayer.selectAll("circle.node")
            .transition().duration(800)
            .style("fill", null)
            .style("opacity", null);
    });
 
}).catch(function(error){
    console.error("Error loading CSV:", error);
    alert("Make sure base_map.csv is loaded and you are running a local server.");
});


// Handle D3 Brush event
let brushTimer = null;
function handleBrush(event) {
    if (!event.selection) return;
    // throttle: evita calcoli ad ogni pixel durante il drag
    clearTimeout(brushTimer);
    brushTimer = setTimeout(() => {
        const [[x0, y0], [x1, y1]] = event.selection;
        const t = d3.zoomTransform(svg.node());
        const brushedNodes = [];
        d3.selectAll("circle.node").each(function(d) {
            const cx = t.applyX(xScale(d.x));
            const cy = t.applyY(yScale(d.y));
            if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) {
                brushedNodes.push(d);
            }
        });
        selectNodes(brushedNodes);
    }, 80);
}

// Master function to handle UI updates for selected nodes
function selectNodes(nodes) {
    selectedNodesData = nodes;
    document.getElementById("selection-count").innerText = nodes.length;
 
    nodeLayer.selectAll("circle.node").classed("selected", false);
 
    const hasSelection = nodes.length > 0;
    document.getElementById("btn-perturb").disabled = !hasSelection;
    document.getElementById("btn-clear").disabled   = !hasSelection;
 
    if (!hasSelection) {
        document.getElementById("single-tweet-details").style.display = "none";
        document.getElementById("results-area").style.display = "none";
        d3.select("#heatmap-container").html("");
        return;
    }
 
    nodes.forEach(n => d3.select("#node-" + n.id).classed("selected", true));
 
    if (nodes.length === 1) {
        const d = nodes[0];
        document.getElementById("single-tweet-details").style.display = "block";
        document.getElementById("tw-id").innerText        = d.id;
        document.getElementById("tw-sentiment").innerText = d.sentiment;
        renderTokenAnalysis(d.text);
        renderHeatmap(d.text);
    } else {
        document.getElementById("single-tweet-details").style.display = "none";
        d3.select("#heatmap-container").html("<p><em> Select a single tweet to view token heatmap.</em></p>");
    }
}

// Feature 2: Token Diverging Color Scale
function renderTokenAnalysis(text) {
    const container = d3.select("#tw-text");
    container.html("<em>Calculating token weights...</em>"); // Loading state

    const apiUrl = `${API_BASE_URL}/api/token_weights`;

    fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json','ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ text: text })
    })
    .then(response => response.json())
    .then(data => {
        container.html(""); // Clear loading text

        // Find the max absolute weight for scaling 
        const maxWeight = d3.max(data, d => d.weight) || 0.01;

        // Diverging scale: Red -> White -> Blue
        const colorScale = d3.scaleSequential(d3.interpolateReds)
            .domain([0, maxWeight]); 

        data.forEach(item => {
            container.append("span")
                .attr("class", "token")
                .style("background-color", colorScale(item.weight))
                // If the background is dark (strong weight), use white text, otherwise black
                .style("color", item.weight > maxWeight * 0.5 ? "white" : "black")
                .style("text-shadow", "none") 
                .text(item.word + " ");
        });
    })
    .catch(err => {
        console.error("Token weight error:", err);
        container.html("<em>Error loading token weights.</em>");
    });
}

// Feature 1: Trajectory Arrows, Animations, and Ghost Points
// Map perturbation types to distinct colors for visual encoding

document.getElementById("btn-perturb").addEventListener("click", () => {
    if (selectedNodesData.length === 0) return;
    
    // Get selected type and its corresponding color
    const perturbType = document.getElementById("perturbation-select").value;
    const arrowColor = perturbationColors[perturbType];
    
    document.getElementById("results-area").style.display = "block";
    document.getElementById("new-text").innerText = "Loading perturbation from backend...";

    selectedNodesData.forEach(d => {
        // IMPORTANT: Change this URL to your ngrok URL if running on Kaggle
        const apiUrl = `${API_BASE_URL}/api/perturb`;
        
        fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
            body: JSON.stringify({ text: d.text, type: perturbType })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                console.error("Backend Error:", data.error);
                document.getElementById("new-text").innerText = "Error: Check console.";
                return;
            }

            // Update UI with the new text generated by Python
            document.getElementById("new-text").innerText = data.new_text;

            // Setup D3 Coordinates
            const startX = xScale(d.x);
            const startY = yScale(d.y);
            const endX = xScale(data.new_x);
            const endY = yScale(data.new_y);

            // 1. Draw Ghost Point (original position)
            linkLayer.append("circle")
                .attr("class", "ghost-node")
                .attr("cx", startX)
                .attr("cy", startY)
                .attr("r", baseNodeRadius);

            // 2. Draw Trajectory Line (Arrow) matching the perturbation color
            const line = linkLayer.append("line")
                .attr("class", "trajectory")
                .attr("x1", startX)
                .attr("y1", startY)
                .attr("x2", startX) // Start at 0 for animation
                .attr("y2", startY)
                .attr("stroke", arrowColor) // Apply categorical color
                .attr("marker-end", "url(#arrowhead)");

            // Animate Line
            line.transition().duration(1500).ease(d3.easeCubicOut)
                .attr("x2", endX)
                .attr("y2", endY);

            // 3. Move the Node and color it based on the perturbation
            d3.select("#node-" + d.id)
                .transition().duration(1500).ease(d3.easeCubicOut)
                .attr("cx", endX)
                .attr("cy", endY)
                .style("fill", arrowColor) 
                .style("stroke", "#000")
                .style("stroke-width", "2px"); 
        })
        .catch(error => {
            console.error('Fetch Error:', error);
            document.getElementById("new-text").innerText = "Failed to connect to backend.";
        });
    });
});

// Clear perturbations and reset
document.getElementById("btn-clear").addEventListener("click", () => {
    linkLayer.selectAll("*").remove(); // Remove arrows and ghosts
    nodeLayer.selectAll("circle.node")
        .transition().duration(800)
        .attr("cx", d => xScale(d.x))
        .attr("cy", d => yScale(d.y))
        .style("fill", null)
        .style("stroke", null)
        .style("stroke-width", null);
    document.getElementById("results-area").style.display = "none";
});



// Feature 4: Token vs Perturbation Heatmap
function renderHeatmap(text) {
    const container = d3.select("#heatmap-container");
    container.html("<em>Generating heatmap matrix...</em>"); // Loading state

   const apiUrl = `${API_BASE_URL}/api/heatmap`; // Update to ngrok if on Kaggle

    fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ text: text })
    })
    .then(response => response.json())
    .then(heatmapData => {
        container.html(""); 

        // Extract unique tokens and perturbations dynamically from the backend data
        const tokens = [...new Set(heatmapData.map(d => d.token))];
        const perturbations = [...new Set(heatmapData.map(d => d.perturbation))];

        const hmWidth = document.getElementById("details-panel").clientWidth - 40;
        const hmHeight = 150;
        const margin = {top: 20, right: 10, bottom: 40, left: 60};

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

        const colorHm = d3.scaleSequential(d3.interpolateBlues).domain([0, 1]);

        // Add X axis
        hmSvg.append("g")
            .attr("transform", `translate(0,${hmHeight - margin.bottom})`)
            .call(d3.axisBottom(xBand))
            .selectAll("text")
            .attr("transform", "rotate(-20)")
            .style("text-anchor", "end")
            .style("font-size", "10px");

        // Add Y axis
        hmSvg.append("g")
            .attr("transform", `translate(${margin.left},0)`)
            .call(d3.axisLeft(yBand))
            .style("font-size", "10px");

        // Draw Heatmap Rectangles using backend data
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
    })
    .catch(err => {
        console.error("Heatmap error:", err);
        container.html("<em>Error loading heatmap.</em>");
    });
}

// Reset Zoom to the initial zoom
document.getElementById("btn-reset-zoom").addEventListener("click", () => {
    svg.transition().duration(750).call(zoom.transform, d3.zoomIdentity);
});
