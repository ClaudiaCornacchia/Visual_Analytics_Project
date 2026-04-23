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

To manage the ngrok URL efficiently, declare it as a global constant at the very top of your `app.js` file:

```javascript
const API_BASE_URL = "the url given by the main in the kaggle notebook"

Note: This allows you to update the link in only one place each time you restart Kaggle.

Input Files
> **Note:** This allows you to update the link in only one place each time you restart Kaggle.

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
