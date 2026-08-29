# Calorie Tracker — phone app (no computer needed)

This is a fully self-contained version of the calorie tracker: no backend, no database, no
server to run. It's a static web page that:

- calls Google's **Gemini API** directly from your phone's browser to analyze a meal
  photo/description — Gemini has a genuinely free tier, unlike Claude's API, so this costs
  nothing to run
- stores your log, goal, and API key locally on your phone (nothing leaves your phone except
  the photo/text sent to Google for analysis)
- can be installed via Safari's **Add to Home Screen** to behave like a real app icon —
  full-screen, no browser bar

## One-time setup

You need a free Gemini API key: sign up at
[aistudio.google.com](https://aistudio.google.com) (no credit card required), click
**Get API key**, create one. You'll paste it into the app itself the first time you open it;
it's saved only in that browser's local storage on your phone.

The free tier has rate limits (a fixed number of requests per minute/day) — plenty for
logging your own meals, but if you ever hit the limit you'll see an error and can just wait
and retry.

## Deploying this to GitHub Pages

1. Create a new **public** repository on [github.com/new](https://github.com/new) (GitHub
   Pages' free tier requires public repos). Don't initialize it with a README.
2. From this folder, push it to that repo:

   ```bash
   cd ~/Projects/calorie-tracker/pwa
   git init
   git add -A
   git commit -m "Calorie tracker phone app"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```

3. On GitHub, go to your repo's **Settings → Pages**. Under "Build and deployment", set
   **Source** to "Deploy from a branch", branch `main`, folder `/ (root)`. Save.
4. GitHub will publish it at `https://<your-username>.github.io/<your-repo-name>/` — it can
   take a minute or two the first time.

## Installing it on your iPhone

1. Open that URL in **Safari** on your iPhone (must be Safari, not Chrome, for Add to Home
   Screen to work fully on iOS).
2. Tap the **Share** icon → **Add to Home Screen**.
3. Open it from the home screen icon — it launches full-screen, just like a regular app.
4. The first time, paste your Gemini API key in when prompted.

## Notes and limits

- Your log and goal live in that one browser's local storage — they don't sync to any other
  device or browser, and clearing Safari's site data for this app (or reinstalling) erases
  them. There's no backup/export yet.
- The Gemini API key lives in local storage too. Anyone with access to your unlocked phone
  could see it (e.g. via Safari's web inspector) — this is a normal trade-off for a personal,
  single-device tool with no backend, but don't reuse a key that's also used somewhere more
  sensitive.
- No internet connection at your location = no photo analysis (it needs to reach Google's
  API), but everything else (viewing past logs, progress) still works offline since it's all
  local.
