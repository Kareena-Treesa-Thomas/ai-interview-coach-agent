/* =========================================================
   CONFIG
========================================================= */
const API_BASE = ""; // same-origin: Flask serves this frontend directly
const TOTAL_QUESTIONS = 5;

/* =========================================================
   STATE
========================================================= */
const state = {
  sessionId: null,
  resumeLoaded: false,
  jdLoaded: false,
  questionIndex: 0,
  currentTopic: "general background",
  currentQuestion: "",
  weakAreas: {},          // topic -> latest content_score
  history: [],            // {topic, contentScore}
};

/* =========================================================
   DOM SHORTCUTS
========================================================= */
const $ = (id) => document.getElementById(id);
const screens = {
  setup: $("screen-setup"),
  session: $("screen-session"),
  summary: $("screen-summary"),
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.dataset.active = key === name ? "true" : "false";
  });
}

function setStatus(state_, label) {
  $("statusDot").dataset.state = state_;
  $("statusLabel").textContent = label;
}

/* =========================================================
   SETUP SCREEN — resume + JD upload
========================================================= */
function markPanelLoaded(panelId, text) {
  const panel = $(panelId).querySelector(".panel-state");
  panel.dataset.state = "loaded";
  panel.textContent = text;
}
function markPanelLoading(panelId) {
  $(panelId).querySelector(".panel-state").dataset.state = "loading";
  $(panelId).querySelector(".panel-state").textContent = "reading…";
}

function maybeEnableStart() {
  $("startBtn").disabled = !(state.resumeLoaded && state.jdLoaded);
}

$("resumeFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  markPanelLoading("panel-resume");
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch(`${API_BASE}/upload-resume`, { method: "POST", body: form });
    const data = await res.json();
    markPanelLoaded("panel-resume", `${data.chunks_indexed} chunks indexed`);
    state.resumeLoaded = true;
    maybeEnableStart();
  } catch (err) {
    markPanelLoaded("panel-resume", "failed — retry");
    console.error(err);
  }
});

$("jdFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  markPanelLoading("panel-jd");
  const form = new FormData();
  form.append("file", file);
  try {
    const res = await fetch(`${API_BASE}/upload-jd`, { method: "POST", body: form });
    const data = await res.json();
    markPanelLoaded("panel-jd", `${data.chunks_indexed} chunks indexed`);
    state.jdLoaded = true;
    maybeEnableStart();
  } catch (err) {
    markPanelLoaded("panel-jd", "failed — retry");
    console.error(err);
  }
});

let jdDebounce;
$("jdText").addEventListener("input", (e) => {
  clearTimeout(jdDebounce);
  const text = e.target.value.trim();
  if (text.length < 40) return; // wait for meaningful content
  jdDebounce = setTimeout(async () => {
    markPanelLoading("panel-jd");
    try {
      const res = await fetch(`${API_BASE}/upload-jd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      markPanelLoaded("panel-jd", `${data.chunks_indexed} chunks indexed`);
      state.jdLoaded = true;
      maybeEnableStart();
    } catch (err) {
      markPanelLoaded("panel-jd", "failed — retry");
      console.error(err);
    }
  }, 700);
});

$("startBtn").addEventListener("click", async () => {
  const res = await fetch(`${API_BASE}/start-session`, { method: "POST" });
  const data = await res.json();
  state.sessionId = data.session_id;
  buildRail();
  showScreen("session");
  fetchNextQuestion();
});

/* =========================================================
   SESSION RAIL (progress list)
========================================================= */
function buildRail() {
  const rail = $("railList");
  rail.innerHTML = "";
  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    const li = document.createElement("li");
    li.dataset.current = i === 0 ? "true" : "false";
    li.innerHTML = `<span class="rail-dot"></span><span>Q${i + 1}</span>`;
    rail.appendChild(li);
  }
}

function updateRail(index, contentScore) {
  const items = $("railList").querySelectorAll("li");
  items.forEach((li, i) => {
    li.dataset.current = i === index ? "true" : "false";
  });
  if (index > 0) {
    const prevDot = items[index - 1].querySelector(".rail-dot");
    prevDot.dataset.score = contentScore >= 7 ? "high" : contentScore >= 4 ? "mid" : "low";
  }
}

function updateSignalMeter() {
  const scores = Object.values(state.weakAreas);
  if (scores.length === 0) return;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const pct = Math.max(0, Math.min(100, (avg / 10) * 100));
  $("signalFill").style.width = `${pct}%`;

  const weakest = Object.entries(state.weakAreas).sort((a, b) => a[1] - b[1])[0];
  $("signalCaption").textContent = weakest
    ? `weakest: ${weakest[0]} (${weakest[1].toFixed(1)}/10)`
    : "gathering data…";
}

/* =========================================================
   TTS PLAYBACK + waveform (question audio)
========================================================= */
function playBase64Audio(b64) {
  const audio = new Audio(`data:audio/wav;base64,${b64}`);
  animateIdleWave(true);
  audio.play();
  audio.onended = () => animateIdleWave(false);
  return audio;
}

let currentAudio = null;

async function fetchNextQuestion() {
  $("feedbackCard").hidden = true;
  $("qText").textContent = "Thinking of your next question…";
  setStatus("live", "GENERATING");

  // Pick weakest topic once we have data, else default rotation
  const topics = ["background & experience", "core technical skills", "system design",
                   "past projects", "behavioral / teamwork"];
  const weakest = Object.entries(state.weakAreas).sort((a, b) => a[1] - b[1])[0];
  const topic = weakest ? weakest[0] : topics[state.questionIndex % topics.length];
  const difficulty = weakest && weakest[1] < 5 ? "hard" : "medium";
  state.currentTopic = topic;

  const res = await fetch(`${API_BASE}/next-question`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: state.sessionId, topic, difficulty }),
  });
  const data = await res.json();
  state.currentQuestion = data.question;

  $("qTopic").textContent = topic;
  $("qText").textContent = data.question;
  $("questionCounter").textContent = `${state.questionIndex + 1} / ${TOTAL_QUESTIONS}`;

  currentAudio = playBase64Audio(data.audio_base64);
  setStatus("ready", "LISTENING");
}

$("replayBtn").addEventListener("click", () => {
  if (currentAudio) { currentAudio.currentTime = 0; currentAudio.play(); }
});

/* =========================================================
   WAVEFORM CANVAS — idle pulse + live mic levels
========================================================= */
const canvas = $("waveform");
const ctx = canvas.getContext("2d");
let waveMode = "idle"; // idle | tts | recording
let analyser = null;
let dataArray = null;

function drawFrame() {
  requestAnimationFrame(drawFrame);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const midY = canvas.height / 2;
  const barCount = 48;
  const barWidth = canvas.width / barCount;

  if (waveMode === "recording" && analyser) {
    analyser.getByteTimeDomainData(dataArray);
  }

  for (let i = 0; i < barCount; i++) {
    let h;
    if (waveMode === "recording" && analyser) {
      const slice = dataArray[Math.floor((i / barCount) * dataArray.length)];
      h = Math.abs(slice - 128) / 128 * canvas.height * 0.9 + 4;
    } else if (waveMode === "tts") {
      h = (Math.sin(Date.now() / 120 + i * 0.5) * 0.5 + 0.5) * canvas.height * 0.5 + 6;
    } else {
      h = 4 + Math.sin(Date.now() / 900 + i) * 2;
    }
    const color = waveMode === "recording" ? "#ff5d5d" : waveMode === "tts" ? "#ff9f1c" : "#2a2f3a";
    ctx.fillStyle = color;
    const x = i * barWidth + barWidth * 0.25;
    ctx.fillRect(x, midY - h / 2, barWidth * 0.5, h);
  }
}
drawFrame();

function animateIdleWave(active) { waveMode = active ? "tts" : "idle"; }

/* =========================================================
   MIC RECORDING — captures 16kHz mono PCM WAV directly
========================================================= */
let audioCtx = null;
let mediaStream = null;
let sourceNode = null;
let processorNode = null;
let recordedSamples = [];
let isRecording = false;

async function startRecording() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  sourceNode = audioCtx.createMediaStreamSource(mediaStream);

  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  dataArray = new Uint8Array(analyser.frequencyBinCount);
  sourceNode.connect(analyser);

  processorNode = audioCtx.createScriptProcessor(4096, 1, 1);
  recordedSamples = [];
  processorNode.onaudioprocess = (e) => {
    recordedSamples.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  sourceNode.connect(processorNode);
  processorNode.connect(audioCtx.destination); // required for onaudioprocess to fire in most browsers

  waveMode = "recording";
  isRecording = true;
}

function stopRecording() {
  isRecording = false;
  waveMode = "idle";
  processorNode.disconnect();
  sourceNode.disconnect();
  mediaStream.getTracks().forEach((t) => t.stop());

  const originalRate = audioCtx.sampleRate;
  const merged = mergeBuffers(recordedSamples);
  const downsampled = downsampleBuffer(merged, originalRate, 16000);
  const wavBlob = encodeWAV(downsampled, 16000);
  audioCtx.close();
  return wavBlob;
}

function mergeBuffers(buffers) {
  const length = buffers.reduce((sum, b) => sum + b.length, 0);
  const result = new Float32Array(length);
  let offset = 0;
  for (const b of buffers) { result.set(b, offset); offset += b.length; }
  return result;
}

function downsampleBuffer(buffer, fromRate, toRate) {
  if (toRate === fromRate) return buffer;
  const ratio = fromRate / toRate;
  const newLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0, offsetBuffer = 0;
  while (offsetResult < newLength) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0, count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) { accum += buffer[i]; count++; }
    result[offsetResult] = count > 0 ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function encodeWAV(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);       // PCM
  view.setUint16(22, 1, true);       // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([view], { type: "audio/wav" });
}

/* =========================================================
   MIC BUTTON + SUBMIT FLOW
========================================================= */
$("micBtn").addEventListener("click", async () => {
  if (!isRecording) {
    $("micBtn").dataset.recording = "true";
    $("micCaption").textContent = "Recording — tap to stop";
    setStatus("live", "RECORDING");
    await startRecording();
  } else {
    $("micBtn").dataset.recording = "false";
    $("micCaption").textContent = "Processing…";
    setStatus("live", "SCORING");
    const wavBlob = stopRecording();
    await submitAnswer(wavBlob);
  }
});

async function submitAnswer(wavBlob) {
  const form = new FormData();
  form.append("session_id", state.sessionId);
  form.append("question", state.currentQuestion);
  form.append("topic", state.currentTopic);
  form.append("audio", wavBlob, "answer.wav");

  const res = await fetch(`${API_BASE}/submit-answer`, { method: "POST", body: form });
  const data = await res.json();

  state.weakAreas[state.currentTopic] = data.content_score ?? 5;
  state.history.push({ topic: state.currentTopic, contentScore: data.content_score });

  $("scoreContent").textContent = (data.content_score ?? "-") + "/10";
  $("scoreDelivery").textContent = (data.delivery_score ?? "-") + "/10";
  $("feedbackText").textContent = data.feedback ?? "";
  $("transcriptText").textContent = `"${data.transcript ?? ""}"`;
  $("feedbackCard").hidden = false;

  updateRail(state.questionIndex, data.content_score ?? 5);
  updateSignalMeter();
  $("micCaption").textContent = "Tap to answer";
  setStatus("ready", "REVIEWING");
}

$("nextBtn").addEventListener("click", () => {
  state.questionIndex++;
  if (state.questionIndex >= TOTAL_QUESTIONS) {
    finishSession();
  } else {
    updateRail(state.questionIndex, null);
    fetchNextQuestion();
  }
});

/* =========================================================
   SUMMARY
========================================================= */
async function finishSession() {
  setStatus("live", "WRAPPING UP");
  showScreen("summary");
  const res = await fetch(`${API_BASE}/summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: state.sessionId }),
  });
  const data = await res.json();

  fillList("strengthsList", data.strengths);
  fillList("weakList", data.weak_areas);
  fillList("focusList", data.focus_points);
  setStatus("ready", "COMPLETE");
}

function fillList(id, items) {
  const el = $(id);
  el.innerHTML = "";
  (items || []).forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    el.appendChild(li);
  });
}

$("restartBtn").addEventListener("click", () => location.reload());
