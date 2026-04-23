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
