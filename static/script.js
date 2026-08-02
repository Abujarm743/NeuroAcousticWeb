// Same four chapters as the desktop version's main.py, source: Wikipedia-style
// placeholder sci-fi text.
const CHAPTERS = [
  `Chapter 1: The spacecraft entered orbit around the uncharted moon, its sensors
  sweeping slowly across the cratered gray surface below. Commander Reyes studied the
  readouts in silence, tracing a strange metallic signature buried deep beneath the
  southern ice fields. No natural formation could explain a signal that precise, that
  regular. She ordered the crew to begin preparations for a landing, unaware that
  something far below had already registered their arrival.`,

  `Chapter 2: Scanners detected a massive underground electrical anomaly pulsing
  once every eleven seconds, like a slow and patient heartbeat. The engineering team
  traced the source to a hollow chamber nearly a kilometer beneath the ice, far past
  the depth their equipment was rated to survive. Reyes weighed the risk of a descent
  against the scientific value of whatever lay down there, knowing that once the crew
  went below the surface, there might be no simple way back up.`,

  `Chapter 3: The crew prepared the landing module for immediate descent, running
  final systems checks under the dim red emergency lighting. Nobody spoke much. The
  pulse from below had grown steadily stronger over the last hour, and twice now the
  ship's outer hull sensors had picked up something that almost looked like a response
  — a faint answering rhythm, matching their own approach vector. Reyes gave the order
  to launch anyway. Turning back was no longer really an option.`,

  `Chapter 4: Contact with the surface team was suddenly lost at midnight, the
  comm channel dissolving into a wash of static and something underneath it that
  almost sounded like a voice. The ship's remaining crew waited in the dark, watching
  the last known coordinates blink uselessly on the display. Whatever had happened
  down there in that buried chamber, it had happened fast, and it had happened
  silently. Nobody up above had any idea it was already too late.`,
];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let sessionId = null;
let threshold = 1.5;
let eventSource = null;
let currentChapter = 0;
let isDaydreaming = false;
let waveHistory = [];
const WAVE_POINTS = 120;

// ---------------------------------------------------------------------------
// DOM refs
// ---------------------------------------------------------------------------
const fileInput = document.getElementById("fileInput");
const sampleBtn = document.getElementById("sampleBtn");
const startBtn = document.getElementById("startBtn");
const setupStatus = document.getElementById("setupStatus");
const thresholdSlider = document.getElementById("thresholdSlider");
const thresholdVal = document.getElementById("thresholdVal");

const statePill = document.getElementById("statePill");
const stateLabel = document.getElementById("stateLabel");

const alphaVal = document.getElementById("alphaVal");
const betaVal = document.getElementById("betaVal");
const scoreVal = document.getElementById("scoreVal");
const scoreReadout = document.querySelector(".readout-score");
const elapsedVal = document.getElementById("elapsedVal");

const storyText = document.getElementById("storyText");
const chapterLabel = document.getElementById("chapterLabel");
const recapBanner = document.getElementById("recapBanner");
const recapText = document.getElementById("recapText");

const canvas = document.getElementById("waveCanvas");
const ctx = canvas.getContext("2d");

// ---------------------------------------------------------------------------
// Setup: file upload / sample selection
// ---------------------------------------------------------------------------
thresholdSlider.addEventListener("input", () => {
  threshold = parseFloat(thresholdSlider.value);
  thresholdVal.textContent = threshold.toFixed(1);
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  setupStatus.textContent = "Uploading…";
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch("/api/upload-eeg", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Upload failed");
    sessionId = data.session_id;
    setupStatus.textContent = `Loaded ${data.rows} rows from ${file.name}`;
    startBtn.disabled = false;
  } catch (e) {
    setupStatus.textContent = `Error: ${e.message}`;
    startBtn.disabled = true;
  }
});

sampleBtn.addEventListener("click", async () => {
  setupStatus.textContent = "Loading sample…";
  try {
    const res = await fetch("/api/use-sample", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load sample");
    sessionId = data.session_id;
    setupStatus.textContent = `Loaded ${data.rows} rows (sample recording)`;
    startBtn.disabled = false;
  } catch (e) {
    setupStatus.textContent = `Error: ${e.message}`;
  }
});

startBtn.addEventListener("click", startSession);

// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------
function startSession() {
  if (!sessionId) return;
  startBtn.disabled = true;
  fileInput.disabled = true;
  sampleBtn.disabled = true;
  thresholdSlider.disabled = true;

  currentChapter = 0;
  waveHistory = [];
  setState("listening");
  renderChapter(currentChapter);
  speakChapter(currentChapter);
  openEegStream();
  requestAnimationFrame(drawWave);
}

function openEegStream() {
  const url = `/api/eeg-stream?session=${encodeURIComponent(sessionId)}&threshold=${threshold}`;
  eventSource = new EventSource(url);

  eventSource.onmessage = (evt) => {
    const payload = JSON.parse(evt.data);
    if (payload.done) {
      eventSource.close();
      return;
    }
    alphaVal.textContent = payload.alpha.toFixed(1);
    betaVal.textContent = payload.beta.toFixed(1);
    scoreVal.textContent = payload.score.toFixed(2);
    elapsedVal.textContent = `${payload.t}s`;

    waveHistory.push(payload.score);
    if (waveHistory.length > WAVE_POINTS) waveHistory.shift();

    scoreReadout.classList.toggle("alert", payload.score > threshold);

    if (payload.daydream && !isDaydreaming) {
      handleDaydream();
    }
  };

  eventSource.onerror = () => {
    // Stream ended or connection dropped — stop cleanly.
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    if (waveHistory.length === 0) {
      elapsedVal.textContent = "error";
      stateLabel.textContent = "signal connection failed — try restarting";
    }
  };
}

// ---------------------------------------------------------------------------
// Narration (Web Speech API)
// ---------------------------------------------------------------------------
function speakChapter(index) {
  if (index >= CHAPTERS.length) {
    setState("done");
    stateLabel.textContent = "session finished";
    return;
  }
  const utterance = new SpeechSynthesisUtterance(CHAPTERS[index].replace(/\s+/g, " ").trim());
  utterance.rate = 1.0;
  utterance.onend = () => {
    if (!isDaydreaming) {
      currentChapter += 1;
      if (currentChapter < CHAPTERS.length) {
        renderChapter(currentChapter);
        speakChapter(currentChapter);
      } else {
        setState("done");
        stateLabel.textContent = "session finished";
        if (eventSource) eventSource.close();
      }
    }
  };
  speechSynthesis.speak(utterance);
}

async function handleDaydream() {
  isDaydreaming = true;
  setState("daydream");
  speechSynthesis.pause();

  try {
    const res = await fetch("/api/recap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ missed_text: CHAPTERS[currentChapter] }),
    });
    const data = await res.json();
    const recap = data.recap || "(Recap unavailable right now.)";
    showRecap(recap);

    // Speak the recap as its own utterance, then resume the chapter.
    const recapUtterance = new SpeechSynthesisUtterance(recap);
    recapUtterance.onend = () => {
      isDaydreaming = false;
      setState("listening");
      speechSynthesis.resume();
    };
    speechSynthesis.speak(recapUtterance);
  } catch (e) {
    showRecap("(Recap unavailable — connection error.)");
    isDaydreaming = false;
    setState("listening");
    speechSynthesis.resume();
  }
}

function showRecap(text) {
  recapText.textContent = text;
  recapBanner.hidden = false;
}

function renderChapter(index) {
  chapterLabel.textContent = `— chapter ${index + 1} of ${CHAPTERS.length}`;
  recapBanner.hidden = true;
  const words = CHAPTERS[index].replace(/\s+/g, " ").trim().split(" ");
  storyText.innerHTML = words
    .map((w) => `<span class="word unheard">${w}</span>`)
    .join(" ");

  // Rough word-by-word "heard" highlight, paced to an average speaking rate.
  const msPerWord = 320;
  const spans = storyText.querySelectorAll(".word");
  spans.forEach((span, i) => {
    setTimeout(() => {
      if (currentChapter === index) span.classList.replace("unheard", "heard");
    }, i * msPerWord);
  });
}

// ---------------------------------------------------------------------------
// UI state pill
// ---------------------------------------------------------------------------
function setState(mode) {
  statePill.classList.remove("listening", "daydream");
  if (mode === "listening") {
    statePill.classList.add("listening");
    stateLabel.textContent = "listening";
  } else if (mode === "daydream") {
    statePill.classList.add("daydream");
    stateLabel.textContent = "daydreaming — pausing";
  } else if (mode === "done") {
    stateLabel.textContent = "finished";
  } else {
    stateLabel.textContent = "idle";
  }
}

// ---------------------------------------------------------------------------
// Oscilloscope canvas — the signature visual: a live waveform that shifts
// from focus-cyan to daydream-amber as the alpha/beta ratio rises.
// ---------------------------------------------------------------------------
function drawWave() {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // faint center line
  ctx.strokeStyle = "#1a1f2c";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  if (waveHistory.length > 1) {
    const maxScore = Math.max(threshold * 1.6, ...waveHistory, 0.1);
    const stepX = w / (WAVE_POINTS - 1);
    const offset = WAVE_POINTS - waveHistory.length;

    ctx.lineWidth = 2.5;
    ctx.beginPath();
    waveHistory.forEach((score, i) => {
      const x = (offset + i) * stepX;
      const amp = (score / maxScore) * (h * 0.42);
      const y = h / 2 - amp;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    const latest = waveHistory[waveHistory.length - 1];
    const hot = latest > threshold;
    ctx.strokeStyle = hot ? "#ff8b5e" : "#5eead4";
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = hot ? 10 : 4;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // threshold line
    const threshY = h / 2 - (threshold / maxScore) * (h * 0.42);
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#3d4356";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, threshY);
    ctx.lineTo(w, threshY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (eventSource || isDaydreaming) {
    requestAnimationFrame(drawWave);
  }
}
