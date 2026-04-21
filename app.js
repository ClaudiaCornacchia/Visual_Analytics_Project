// Get SVG container dimensions
const mapContainer = document.getElementById('scatterplot-container');
const width = mapContainer.clientWidth;
const height = mapContainer.clientHeight;
const svg = d3.select("#map");

// Create a "Master Group" that will handle zooming and panning
const zoomGroup = svg.append("g").attr("id", "zoom-group");

// Put the layers INSIDE the Master Group 
const linkLayer = zoomGroup.append("g").attr("id", "link-layer");
const nodeLayer = zoomGroup.append("g").attr("id", "node-layer");

// Define the zoom behavior
const zoom = d3.zoom()
    .scaleExtent([0.5, 20]) // Limits: you can zoom out to 0.5x and zoom in up to 20x
    .on("zoom", function(event) {
        // Apply the mathematical transformation (scale and translation) to the Master Group
        zoomGroup.attr("transform", event.transform);
    });

// Activate the zoom behavior on the SVG container
svg.call(zoom);

// Global states
let selectedNodesData = []; // Array to handle both single clicks and brushing
let xScale, yScale;
const baseNodeRadius = 5;

// Set up SVG Defs for the trajectory arrowheads (Feature 1)
svg.append("defs").append("marker")
    .attr("id", "arrowhead")
    .attr("viewBox", "0 -5 10 10")
    .attr("refX", 8) // Offset to not overlap the circle
    .attr("refY", 0)
    .attr("markerWidth", 6)
    .attr("markerHeight", 6)
    .attr("orient", "auto")
    .append("path")
    .attr("d", "M0,-5L10,0L0,5")
    .attr("fill", "#555");


console.log("Starting to load base_map.csv...");

d3.csv("base_map.csv", function(d) {
    return {
        id: d.tweet_id,
        text: d.text,
        sentiment: d.sentiment,
        airline: d.airline,
        x: +d.x, 
        y: +d.y
    };
}).then(function(data) {
    console.log(`Loaded ${data.length} points. Drawing the map...`);
    
    const xExtent = d3.extent(data, d => d.x);
    const yExtent = d3.extent(data, d => d.y);


    const xRange = xExtent[1] - xExtent[0];
    const yRange = yExtent[1] - yExtent[0];
    const xPadding = xRange * 0.05; 
    const yPadding = yRange * 0.05;
    
    xScale = d3.scaleLinear()
        .domain([xExtent[0] - xPadding, xExtent[1] + xPadding])
        .range([50, width - 50]);

    yScale = d3.scaleLinear()
        .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
        .range([height - 50, 50]);

    // Feature 3: Brushing (Cluster Selection)
    const brush = d3.brush()
        .extent([[0, 0], [width, height]])
        .on("end", handleBrush);

    // Add brush layer behind nodes but in front of links
    zoomGroup.insert("g", "#node-layer")
        .attr("class", "brush")
        .call(brush);

    const dynamicRadius = data.length > 2000 ? 2 : 5;

    // Draw circles
    const circles = nodeLayer.selectAll("circle.node")
        .data(data)
        .enter()
        .append("circle")
        .attr("class", d => `node ${d.sentiment}`) 
        .attr("id", d => "node-" + d.id) 
        .attr("cx", d => xScale(d.x))
        .attr("cy", d => yScale(d.y))
        .attr("r", baseNodeRadius)
        .on("click", function(event, d) {
            // Ignore click if holding shift (optional brush combo), otherwise select single
            svg.select(".brush").call(brush.move, null); // Clear brush
            selectNodes([d]);
        });
        
    // Coloring logic
    const colorScaleAirline = d3.scaleOrdinal(d3.schemeCategory10);
    document.getElementById("btn-color-airline").addEventListener("click", () => {
        d3.selectAll("circle.node").transition().duration(800)
            .style("fill", d => colorScaleAirline(d.airline)).style("opacity", 0.8); 
    });

    document.getElementById("btn-color-sentiment").addEventListener("click", () => {
        d3.selectAll("circle.node").transition().duration(800)
            .style("fill", null).style("opacity", null); 
    });

}).catch(function(error){
    console.error("Error loading CSV:", error);
    alert("Make sure base_map.csv is loaded and you are running a local server.");
});


// Handle D3 Brush event
function handleBrush(event) {
    if (!event.selection) return; // Ignore clear
    const [[x0, y0], [x1, y1]] = event.selection;
    
    const brushedNodes = [];
    d3.selectAll("circle.node").each(function(d) {
        const cx = xScale(d.x);
        const cy = yScale(d.y);
        if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) {
            brushedNodes.push(d);
        }
    });
    
    selectNodes(brushedNodes);
}

// Master function to handle UI updates for selected nodes
function selectNodes(nodes) {
    selectedNodesData = nodes;
    
    document.getElementById("selection-count").innerText = nodes.length;
    d3.selectAll("circle.node").classed("selected", false);
    
    if (nodes.length === 0) {
        document.getElementById("single-tweet-details").style.display = "none";
        document.getElementById("btn-perturb").disabled = true;
        document.getElementById("btn-clear").disabled = true;
        d3.select("#heatmap-container").html(""); 
        
        document.getElementById("results-area").style.display = "none";
        return;
    }

    // Highlight selected on map
    nodes.forEach(n => d3.select("#node-" + n.id).classed("selected", true));

    // ENABLE the buttons when nodes are selected
    document.getElementById("btn-perturb").disabled = false;
    document.getElementById("btn-clear").disabled = false;

    // Feature 2: Token Level Analysis (Only show if 1 node is selected for clarity)
    if (nodes.length === 1) {
        const d = nodes[0];
        document.getElementById("single-tweet-details").style.display = "block";
        document.getElementById("tw-id").innerText = d.id;
        document.getElementById("tw-sentiment").innerText = d.sentiment;
        
        renderTokenAnalysis(d.text);
        renderHeatmap(d.text);
    } else {
        document.getElementById("single-tweet-details").style.display = "none";
        d3.select("#heatmap-container").html("<p><em>Select a single tweet to view token heatmap.</em></p>");
    }
}

// Feature 2: Token Diverging Color Scale
function renderTokenAnalysis(text) {
    const container = d3.select("#tw-text");
    container.html("<em>Calculating token weights...</em>"); // Loading state

    const apiUrl = 'https://transdesert-overhugely-alessandra.ngrok-free.dev/api/token_weights';// Update to ngrok if on Kaggle

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
const perturbationColors = {
    "dict_synonym": "#2ca02c",   // Green
    "dict_antonym": "#d62728",   // Red
    "llm_paraphrase": "#1f77b4", // Blue
    "llm_opposite": "#ff7f0e",   // Orange
    "noise": "#7f7f7f"           // Gray
};

document.getElementById("btn-perturb").addEventListener("click", () => {
    if (selectedNodesData.length === 0) return;
    
    // Get selected type and its corresponding color
    const perturbType = document.getElementById("perturbation-select").value;
    const arrowColor = perturbationColors[perturbType];
    
    document.getElementById("results-area").style.display = "block";
    document.getElementById("new-text").innerText = "Loading perturbation from backend...";

    selectedNodesData.forEach(d => {
        // IMPORTANT: Change this URL to your ngrok URL if running on Kaggle
        const apiUrl = 'https://transdesert-overhugely-alessandra.ngrok-free.dev/api/perturb';
        
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
    
    // Reset nodes to original coordinates
    d3.selectAll("circle.node").transition().duration(1000)
        .attr("cx", d => xScale(d.x))
        .attr("cy", d => yScale(d.y))
        .style("fill", null); // Revert to CSS class colors
        
    document.getElementById("results-area").style.display = "none";
});

// Feature 4: Token vs Perturbation Heatmap
function renderHeatmap(text) {
    const container = d3.select("#heatmap-container");
    container.html("<em>Generating heatmap matrix...</em>"); // Loading state

   const apiUrl = 'https://transdesert-overhugely-alessandra.ngrok-free.dev/api/heatmap'; // Update to ngrok if on Kaggle

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
    svg.transition()
        .duration(750) // Animation duration 750 ms
        .call(zoom.transform, d3.zoomIdentity); // zoomIdentity means "scale 1x, coordinate x=0, y=0"
});