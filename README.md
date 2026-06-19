# Cache Simulator

An interactive cache hierarchy simulator (Set-Associative vs V-Way caches) that runs entirely in the browser. Upload a memory trace file and compare miss rates, writebacks, and victim distances across configurations, visualized with Chart.js.

## 🚀 Live Demo

Once deployed (see below), your simulator will be live at:
`https://<your-github-username>.github.io/<your-repo-name>/`

## 📁 Project Structure

```
.
├── index.html   # Page structure/markup
├── style.css    # All styling
├── app.js       # Simulation logic, charts, and UI rendering
└── README.md
```

No build step, no dependencies to install — it's plain HTML/CSS/JS. Chart.js and fonts are loaded via free public CDNs.

## 🆓 Deploy for Free with GitHub Pages

1. **Create a new GitHub repository** (e.g. `cache-simulator`) at https://github.com/new — public repo, free tier is enough.
2. **Push these files to the repo root**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: cache simulator"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```
3. **Enable GitHub Pages**:
   - Go to your repo on GitHub → **Settings** → **Pages** (left sidebar).
   - Under "Build and deployment" → **Source**, select **Deploy from a branch**.
   - Under **Branch**, select `main` and folder `/ (root)`, then click **Save**.
4. Wait ~1 minute. GitHub will show a banner with your live URL:
   `https://<your-username>.github.io/<your-repo-name>/`

That's it — 100% free, no server, no build pipeline required. GitHub Pages automatically redeploys whenever you push changes to `main`.

## 🧪 Local Preview

Just open `index.html` directly in a browser, or serve it locally:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## 📊 Usage

1. Upload a memory trace file (lines like `r 0x1A2B3C` / `w 0x1A2B3C`).
2. Configure L1/L2 cache size, block size, associativity, and TDR (V-Way) parameters.
3. Click **Run Simulation** to compare Set-Associative vs V-Way (TDR=2, TDR=3) caches.
4. View comparison charts, stat cards, a metrics table, and raw per-config output.
