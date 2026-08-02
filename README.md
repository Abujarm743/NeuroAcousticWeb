# Neuro-Acoustic Reader — Web Edition

Browser version of the Neuro-Acoustic Audio-Book Controller. The backend
(Flask) streams EEG-derived "daydream scores" over SSE and calls Gemini for
recaps; the browser handles all audio playback via the Web Speech API, so
nothing needs local speaker/mic access on the server.

```
neuro-audio-web/
├── app.py              # Flask backend: SSE stream, upload, recap endpoint
├── gemini_recap.py      # Server-side Gemini call (reads GEMINI_API_KEY only)
├── templates/index.html
├── static/style.css
├── static/script.js     # SSE handling, Web Speech narration, canvas waveform
├── sample_data/EEG_sample.csv
├── requirements.txt
└── Dockerfile
```

## Run locally

```bash
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
export GEMINI_API_KEY=your-key-here
python app.py
```

Open http://localhost:8080 — click "Use sample recording" or upload your own
CSV (needs `Alpha1/Alpha2/Beta1/Beta2`-style columns, same as the Kaggle
"Confused Student EEG" dataset used before), then "Start session."

## Deploy to Google Cloud Run

**1. One-time setup**

```bash
gcloud auth login
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
```

**2. Store the Gemini key in Secret Manager (never in the image)**

```bash
printf "%s" "your-gemini-api-key" | gcloud secrets create gemini-api-key --data-file=-
```

If you've already used a key anywhere outside Secret Manager (e.g. it was
ever committed to a file or pasted in a chat), rotate it in Google AI Studio
first and store the *new* one here.

**3. Build and deploy**

From inside `neuro-audio-web/`:

```bash
gcloud run deploy neuro-acoustic-reader \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest
```

`--source .` builds the `Dockerfile` in place via Cloud Build — no manual
`docker build`/`push` needed. Cloud Run prints a `*.run.app` URL when it's
done; that's your live site.

**4. Redeploying after changes**

```bash
gcloud run deploy neuro-acoustic-reader --source . --region us-central1
```

## Notes / limitations

- **EEG data**: this reads a CSV, same as the desktop version — swap
  `_load_rows()` in `app.py` for a live headset feed later if you want
  real-time input; the SSE/JSON shape downstream stays the same.
- **Session storage is in-memory** (a Python dict) — fine for a demo on a
  single Cloud Run instance, but sessions won't survive a restart or scale
  past one instance. For real multi-user use, swap `_SESSIONS` for
  Firestore/Redis.
- **Web Speech API pause/resume**: some browsers (notably Chrome) can behave
  oddly resuming a `speechSynthesis` utterance paused for a long time. If you
  hit that, an alternative is to pre-generate chapter audio server-side and
  stream `<audio>` files instead of live TTS.
- **Cost**: Cloud Run + Secret Manager have small usage-based costs; the free
  tier covers light personal/demo traffic, but check current pricing before
  leaving it publicly deployed long-term.
