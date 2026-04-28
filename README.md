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

- **Heatmap**: When you select a tweet, the system calculates how much its semantic meaning would shift if you removed or swapped specific words with synonyms or antonyms.
   - 🟥 Deep Red: High Semantic Shift. This word is a "semantic pillar" of the tweet; modifying it drastically alters the model's understanding.
   - ⬜ White: Low/No impact on the overall meaning.   

  Note: If a word lacks a direct synonym or antonym (e.g., proper nouns, stop words), the text remains unchanged. The semantic shift is exactly 0.0, and the heatmap cell will be white.