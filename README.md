# Visual_Analytics_Project

## Repository Setup & Configuration

### Ngrok Configuration

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
  - `umap_mapper.joblib` (note: using UMAP, not PCA)

> **Important:** When changing the embedding model or dimensionality reduction technique, allow the code to recompute once. The file will be named `umap_mapper.joblib` (not PCA).

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

1. **Synonym Replacement**: Replaces the user selected word with a synonym, if no synonym is available the text remains unchanged and if the user doesn't select any word the first available word with a synonym will be used.
2. **Antonym Replacement**: Replaces the user selected word with an antonym if no antonym is available the text remains unchanged and if the user doesn't select any word the first available word with an antonym will be used.
3. **Remove Word**: Removes the user selected word from the text, if the user doesn't select any word the first available word will be removed.
4. **Custom Replacement**: Replaces the user selected word with a custom word entered by the user.
5. **LLM Paraphrase**: The entire tweet is paraphrased by the LLM, no word selection is needed.
6. **LLM Opposite**: The entire tweet is transformed to its opposite meaning by the LLM, no word selection is needed.
7. **Noise**: Adds a random word to the text