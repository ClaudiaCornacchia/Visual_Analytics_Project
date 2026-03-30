// Get SVG container dimensions
const mapContainer = document.getElementById('scatterplot-container');
const width = mapContainer.clientWidth;
const height = mapContainer.clientHeight;
const svg = d3.select("#map");

// Global states for the selected node and scales (needed later for animations)
let selectedNodeData = null;
let xScale, yScale;

console.log("Starting to load base_map.csv...");

// Load CSV asynchronously and parse string coordinates to numbers
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

    // Find min and max for dynamic scaling
    const xExtent = d3.extent(data, d => d.x);
    const yExtent = d3.extent(data, d => d.y);
    
    // Add semantic padding so points don't touch the SVG borders
    const semanticPadding = 5;
    
    xScale = d3.scaleLinear()
        .domain([xExtent[0] - semanticPadding, xExtent[1] + semanticPadding])
        .range([50, width - 50]);

    // Y-axis is inverted in SVG (0 is at the top)
    yScale = d3.scaleLinear()
        .domain([yExtent[0] - semanticPadding, yExtent[1] + semanticPadding])
        .range([height - 50, 50]);

    const circles = svg.selectAll("circle")
        .data(data)
        .enter()
        .append("circle")
        .attr("id", d => "node-" + d.id) 
        .attr("cx", d => xScale(d.x))
        .attr("cy", d => yScale(d.y))
        .attr("r", 5)
        .attr("class", d => d.sentiment) // Applies default CSS color classes
        .on("click", function(event, d) {
            handleNodeClick(this, d);
        });
        
    console.log("Base map completed.");

    // Automatic color scale for airlines
    const colorScaleAirline = d3.scaleOrdinal(d3.schemeCategory10);

    // Override CSS classes with inline airline colors
    document.getElementById("btn-color-airline").addEventListener("click", () => {
        d3.selectAll("circle")
            .transition()
            .duration(800)
            .style("fill", d => colorScaleAirline(d.airline))
            .style("opacity", 0.8); 
    });

    // Remove inline styles to revert back to default sentiment CSS classes
    document.getElementById("btn-color-sentiment").addEventListener("click", () => {
        d3.selectAll("circle")
            .transition()
            .duration(800)
            .style("fill", null)
            .style("opacity", null); 
    });

}).catch(function(error){
    console.error("Error loading CSV:", error);
    alert("Error loading data. Make sure you have started a local server in the project folder.");
});


function handleNodeClick(circleElement, d) {
    selectedNodeData = d;
    console.log("Selected tweet:", d.id);
    
    // Update details panel
    document.getElementById("tw-id").innerText = d.id;
    document.getElementById("tw-sentiment").innerText = d.sentiment;
    document.getElementById("tw-text").innerText = d.text;
    
    document.getElementById("btn-synonym").disabled = false;
    document.getElementById("btn-noise").disabled = false;
    document.getElementById("results-area").style.display = "none";
    
    // Visual feedback: reset all strokes, then highlight only the selected node
    d3.selectAll("circle").classed("selected", false);
    d3.selectAll("circle").style("stroke", "#333").style("stroke-width", "0.5px");
    d3.select(circleElement).style("stroke", "black").style("stroke-width", "3px");
}

document.getElementById("btn-synonym").addEventListener("click", () => {
    if (!selectedNodeData) return;

    // SIMULATION: In production, this would be an actual fetch() call to the backend
    const mockBackendResponse = {
        new_text: "[SYNONYM SIMULATION] " + selectedNodeData.text.replace(" flight ", " journey ").replace("Delayed", "postponed"),
        similarity: 0.9123,
        new_x: selectedNodeData.x + (xScale.domain()[1] - xScale.domain()[0]) * 0.1, 
        new_y: selectedNodeData.y - (yScale.domain()[0] - yScale.domain()[1]) * 0.05
    };

    document.getElementById("results-area").style.display = "block";
    document.getElementById("new-text").innerText = mockBackendResponse.new_text;
    document.getElementById("similarity-score").innerText = mockBackendResponse.similarity;

    // Animate the node moving to its new latent coordinates
    console.log(`Animating node ${selectedNodeData.id} to new coordinates.`);
    d3.select("#node-" + selectedNodeData.id)
        .transition()
        .duration(1500)
        .ease(d3.easeCubicOut)
        .attr("cx", xScale(mockBackendResponse.new_x))
        .attr("cy", yScale(mockBackendResponse.new_y))
        .style("fill", "orange")
        .style("stroke-width", "4px"); 
});