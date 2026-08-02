"""
Neuro-Acoustic Audio-Book Controller — Web Edition
Flask backend. Browser handles audio (Web Speech API); this server handles
EEG scoring (streamed over SSE) and the Gemini recap call (kept server-side
so the API key never reaches the client).
"""

import io
import json
import os
import time
import uuid

import pandas as pd
from flask import Flask, Response, jsonify, request, send_from_directory

app = Flask(__name__, static_folder="static", template_folder="templates")

MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5MB CSV cap
SAMPLE_CSV_PATH = os.path.join(os.path.dirname(__file__), "sample_data", "EEG_sample.csv")

# In-memory session store: session_id -> list[dict] rows. Fine for a single
# Cloud Run instance / demo use; swap for Redis/Firestore for multi-instance.
_SESSIONS = {}


# ---------------------------------------------------------------------------
# EEG column detection (ported from the desktop eeg_monitor.py)
# ---------------------------------------------------------------------------
def _detect_bands(columns):
    cols_lower = {c.lower(): c for c in columns}

    if "alpha" in cols_lower and "beta" in cols_lower:
        return [cols_lower["alpha"]], [cols_lower["beta"]]

    alpha_split = [c for c in columns if c.lower().startswith("alpha")]
    beta_split = [c for c in columns if c.lower().startswith("beta")]
    if alpha_split and beta_split:
        return alpha_split, beta_split

    if "fft_1_alpha" in cols_lower and "fft_1_beta" in cols_lower:
        return [cols_lower["fft_1_alpha"]], [cols_lower["fft_1_beta"]]

    alpha_any = [c for c in columns if "alpha" in c.lower()]
    beta_any = [c for c in columns if "beta" in c.lower()]
    if alpha_any and beta_any:
        return alpha_any, beta_any

    return None, None


def _load_rows(csv_bytes: bytes):
    df = pd.read_csv(io.BytesIO(csv_bytes))
    alpha_cols, beta_cols = _detect_bands(df.columns)
    if alpha_cols is None:
        raise ValueError(
            f"No alpha/beta-style columns found. Columns present: {list(df.columns)[:10]}"
        )
    rows = []
    for _, row in df.iterrows():
        alpha = sum(float(row[c]) for c in alpha_cols if pd.notna(row.get(c)))
        beta = sum(float(row[c]) for c in beta_cols if pd.notna(row.get(c)))
        rows.append({"alpha": alpha, "beta": beta})
    return rows


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(app.template_folder, "index.html")


@app.route("/api/upload-eeg", methods=["POST"])
def upload_eeg():
    """Accept a CSV upload, parse it, stash it under a session id."""
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    data = file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        return jsonify({"error": "File too large (5MB max)"}), 400

    try:
        rows = _load_rows(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

    session_id = uuid.uuid4().hex
    _SESSIONS[session_id] = rows
    return jsonify({"session_id": session_id, "rows": len(rows)})


@app.route("/api/use-sample", methods=["POST"])
def use_sample():
    """Use the bundled sample dataset instead of an upload."""
    with open(SAMPLE_CSV_PATH, "rb") as f:
        rows = _load_rows(f.read())
    session_id = uuid.uuid4().hex
    _SESSIONS[session_id] = rows
    return jsonify({"session_id": session_id, "rows": len(rows)})


@app.route("/api/eeg-stream")
def eeg_stream():
    """Server-Sent Events stream of alpha/beta/daydream-score, one tick/sec."""
    session_id = request.args.get("session")
    threshold = float(request.args.get("threshold", 1.5))
    rows = _SESSIONS.get(session_id)
    if rows is None:
        return jsonify({"error": "Unknown or expired session"}), 404

    def generate():
        cooldown = 0
        for i, row in enumerate(rows):
            alpha, beta = row["alpha"], row["beta"]
            score = alpha / max(beta, 1.0)
            is_daydream = score > threshold and cooldown == 0
            payload = {
                "t": i + 1,
                "alpha": round(alpha, 2),
                "beta": round(beta, 2),
                "score": round(score, 3),
                "daydream": is_daydream,
            }
            yield f"data: {json.dumps(payload)}\n\n"
            cooldown = 3 if is_daydream else max(0, cooldown - 1)
            time.sleep(1.0)
        yield f"data: {json.dumps({'done': True})}\n\n"

    return Response(generate(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@app.route("/api/recap", methods=["POST"])
def recap():
    """Call Gemini server-side and return a one-sentence recap."""
    body = request.get_json(silent=True) or {}
    missed_text = (body.get("missed_text") or "").strip()
    if not missed_text:
        return jsonify({"error": "missed_text is required"}), 400

    try:
        from gemini_recap import generate_recap
        text = generate_recap(missed_text)
        return jsonify({"recap": text})
    except Exception as e:
        return jsonify({"recap": None, "error": str(e)}), 502


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    app.run(host="0.0.0.0", port=port, debug=False)
