# Visual_Analytics_Project

## Repository Setup & Configuration

### Ngrok Configuration
#### Eduroam blocca ngrok !!!

#### Step 1: Get Your Ngrok Token
1. Go to [ngrok.com](https://ngrok.com) and sign in (or create a free account)
2. On the left-hand menu of your dashboard, click on **Getting Started** → **Your Authtoken**
3. Click the **Copy** button to copy the authentication token string

#### Step 2: Store it Securely in Kaggle
1. Open your Kaggle Notebook
2. At the top of the screen, click on the **Add-ons** menu
3. Select **Secrets** from the dropdown
4. A side panel will open. Click **Add a new secret**
5. In the **Label** field, type exactly: `NGROK_TOKEN`
6. In the **Value** field, paste the token you copied from ngrok
7. Click **Save**, and ensure the toggle switch next to your new secret is set to **Attached** (grants the notebook permission to read it)

### API Base URL Configuration

The frontend reads the API base URL in this order:

1. `?apiBaseUrl=https://your-ngrok-url.ngrok-free.dev` in the page URL
2. The last `apiBaseUrl` value saved in `localStorage`
3. The fallback `DEFAULT_API_BASE_URL` at the top of `app.js`

Example:

```text
http://localhost:5500/?apiBaseUrl=https://your-ngrok-url.ngrok-free.dev
```

> **Note:** This makes ngrok URL changes much easier to test without editing code every time you restart Kaggle.

### Input Files Management

To avoid recomputing embeddings and other processed files every time, save them as inputs. The code will automatically check for existing files before recomputing.

#### Required Input Structure

- `tweets` file
- `embeddings/` folder containing:
  - `base_map.csv`
  - `umap_mapper.joblib` (note: using UMAP)


### Important Reminders

#### UMAP Workflow

When using UMAP, always remember to:

1. **Update `base_map.csv`** in both Visual Studio and Kaggle
2. **Press `Ctrl + F5`** in your browser - this forces a hard refresh, as browsers may cache the old `base_map.csv` file

> **Note:** The browser sometimes maintains the old `base_map.csv` in cache, requiring a full refresh to load the updated version.


## Visualization explanation
### BERTopic (Global Topic Modeling)
- **Purpose**: Extracts and labels underlying semantic clusters across the entire dataset. It uses c-TF-IDF to find the most representative words for each topic, helping users understand the broad themes (e.g., Customer Service, Cancellations) identified by the embedding model.
- **Bidirectional interaction**: Selecting a topic from the dropdown highlights all its corresponding tweets on the scatterplot. Conversely, brushing/selecting a group of tweets on the map automatically detects and displays their dominant topic.
Additionally, clicking a keyword within a topic's bar chart filters the highlighted map nodes, brightening only the tweets that contain that exact word. This visually demonstrates the difference between semantic clustering (the model's spatial grouping) and lexical matching (exact word occurrence).

### TF-IDF 
- **Purpose**: Identifies the most distinctive keywords for a custom user selection. Unlike BERTopic (which defines static global clusters), this dynamically calculates which words make your currently selected subset of tweets unique compared to the rest of the tweets.
- **Dynamic generation**: Brushing or selecting more than 5 tweets on the map triggers the backend to compute and display the TF-IDF bar chart for that specific group.
- **Bidirectional interaction**: Clicking a keyword in the TF-IDF chart instantly highlights the specific tweets containing that word on the map

### Word heatmap (single tweet inspection)
- **Purpose**: Evaluates the "semantic weight" of individual words within a single selected tweet. The system calculates the embedding shift by temporarily removing each word (ablation) to see how drastically the cosine similarity changes compared to the original embedding. This reveals which words are most critical for the model's understanding of that tweet.
- **Visual encoding**: it is used a sequential color scale (Dark Blue to Bright Yellow)
  - 🟨 Bright Yellow: High Semantic Shift. This word is a "semantic pillar"; modifying it drastically alters the tweet's embedding vector.
  - 🟦 Dark Blue: Low/No impact on the overall meaning.
- **Interactions**: Clicking a colored word selects it as the target word for targeted perturbations (e.g., swapping it with a synonym, antonym, or custom word), acting as a bridge to the perturbation panel.


## Perturbation Types
To evaluate the robustness of the embedding model and determine if it truly captures underlying semantics rather than superficial patterns, the system features a suite of real-time adversarial attacks. Users can select a specific word within a tweet's heatmap to trigger these perturbations:
1. **Lexical Swaps (Synonyms/Antonyms/Removals)**: Replaces the target token with a synonym or antonym retrieved via WordNet and the Datamuse API, or completely removes it from the sentence.
2. **Custom Lexical Replacements**: Allows users to manually substitute a specific token with arbitrary, custom text to test tailored adversarial hypotheses.
3. **Noise Injection**: Inserts conversational fillers (e.g., "uhm", "literally") or synthetic noise (e.g., "blah", "xyz") to test the model's resistance to cumulative structural noise.
4. **Character-Level Typos**: Swaps adjacent letters within a word to evaluate the robustness of the model's tokenizer.
5. **Syntax-Level Shuffling**: Randomly permutes the word order of the tweet to evaluate the model's reliance on attention mechanisms versus a strict "Bag-of-Words" approach.
6. **Generative Attacks (LLM-Driven)**: Utilizes an external LLM (Gemma) to completely rewrite the tweet by generating paraphrased counterfactuals (same meaning, different words) or sentiment-inverted variations.

When a perturbation is applied, the system draws a visual trajectory (an arrow) on the scatterplot from the original tweet's position to its new perturbed coordinate. It is crucial to interpret these arrows topologically rather than strictly geometrically. Because the latent space is visualized using UMAP (Uniform Manifold Approximation and Projection)—a non-linear dimensionality reduction technique—the absolute visual length of the arrow is less important than the neighborhood boundaries it crosses.
- *Short Trajectories (Intra-cluster Drift)*: If the perturbed tweet moves but remains within its original local neighborhood (e.g., staying within the "Flight Delays" cluster), the model exhibits robustness. It successfully recognized that despite the typo, noise, or synonym swap, the core semantic meaning remained unchanged.
- *Long Trajectories (Inter-cluster Drift)*: If the arrow jumps across the map into a completely different neighborhood (e.g., moving from "Flight Delays" to "Customer Service"), the model exhibits a vulnerability. It indicates that the specific perturbation (such as a shuffled syntax or a single changed word) was enough to completely alter the model's understanding of the sentence, proving a reliance on structural heuristics over true semantic comprehension.

### New coordinate calculation

When a perturbation is executed, the system calculates the new 2D coordinates (`new_x`, `new_y`) of the modified tweet using a  three-step pipeline running on the backend:

1. **Adversarial Text Generation:** The selected perturbation function processes the original tweet and applies the text modification, producing the altered string (`new_text`).
2. **High-Dimensional Embedding:** The `new_text` is passed back to the *qwen3-embedding:0.6B* model via Ollama. The model generates a new high-dimensional dense vector representing the altered semantic state.
3. **Frozen UMAP Projection (`.transform()`):** To precisely isolate the effect of the perturbation, the system avoids recalculating the entire dimensionality reduction map (which would recalculate all points and destroy the baseline structure). Instead, it calls the `.transform()` method on the pre-trained `global_umap_mapper`. 

This projects the new high-dimensional vector directly into the stable, existing 2D coordinate space, guaranteeing that the baseline geometry remains fixed and that the visual trajectory arrow accurately reflects only the pure semantic "drift" caused by the attack.
