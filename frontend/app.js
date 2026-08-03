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
  currentDifficulty: "medium",
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

let stagedResumeFile = null;
let stagedJdFile = null;
let stagedJdText = "";

$("resumeFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  stagedResumeFile = file;
  $("indexResumeBtn").disabled = false;
  $(`panel-resume`).querySelector(".panel-state").dataset.state = "pending";
  $(`panel-resume`).querySelector(".panel-state").textContent = `${file.name} ready — click Index`;
});

$("indexResumeBtn").addEventListener("click", async () => {
  if (!stagedResumeFile) return;
  markPanelLoading("panel-resume");
  $("indexResumeBtn").disabled = true;
  const form = new FormData();
  form.append("file", stagedResumeFile);
  try {
    const res = await fetch(`${API_BASE}/upload-resume`, { method: "POST", body: form });
    const data = await res.json();
    markPanelLoaded("panel-resume", `${data.chunks_indexed} chunks indexed`);
    state.resumeLoaded = true;
    maybeEnableStart();
  } catch (err) {
    markPanelLoaded("panel-resume", "failed — retry");
    $("indexResumeBtn").disabled = false;
    console.error(err);
  }
});

$("jdFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  stagedJdFile = file;
  stagedJdText = ""; // file takes precedence over any typed text
  $("indexJdBtn").disabled = false;
  $(`panel-jd`).querySelector(".panel-state").dataset.state = "pending";
  $(`panel-jd`).querySelector(".panel-state").textContent = `${file.name} ready — click Index`;
});

$("jdText").addEventListener("input", (e) => {
  const text = e.target.value.trim();
  stagedJdText = text;
  stagedJdFile = null; // typed text takes precedence over any staged file
  $("indexJdBtn").disabled = text.length < 40;
  if (text.length >= 40) {
    $(`panel-jd`).querySelector(".panel-state").dataset.state = "pending";
    $(`panel-jd`).querySelector(".panel-state").textContent = "text ready — click Index";
  }
});

$("indexJdBtn").addEventListener("click", async () => {
  if (!stagedJdFile && !stagedJdText) return;
  markPanelLoading("panel-jd");
  $("indexJdBtn").disabled = true;
  try {
    let res;
    if (stagedJdFile) {
      const form = new FormData();
      form.append("file", stagedJdFile);
      res = await fetch(`${API_BASE}/upload-jd`, { method: "POST", body: form });
    } else {
      res = await fetch(`${API_BASE}/upload-jd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: stagedJdText }),
      });
    }
    const data = await res.json();
    markPanelLoaded("panel-jd", `${data.chunks_indexed} chunks indexed`);
    state.jdLoaded = true;
    maybeEnableStart();
  } catch (err) {
    markPanelLoaded("panel-jd", "failed — retry");
    $("indexJdBtn").disabled = false;
    console.error(err);
  }
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
  buildStepper();
}

function buildStepper() {
  const stepper = $("qStepper");
  stepper.innerHTML = "";
  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    const step = document.createElement("div");
    step.className = "q-step";
    step.dataset.current = i === 0 ? "true" : "false";
    step.textContent = i + 1;
    step.id = `qStep-${i}`;
    stepper.appendChild(step);
    if (i < TOTAL_QUESTIONS - 1) {
      const connector = document.createElement("div");
      connector.className = "q-connector";
      stepper.appendChild(connector);
    }
  }
}

function scoreTier(score) {
  if (score == null) return null;
  return score >= 6 ? "high" : score >= 4 ? "mid" : "low";
}

function signalBand(score) {
  if (score == null) return null;
  return score >= 6 ? "strong" : score >= 4 ? "medium" : "weak";
}

function scoreToCEFR(score) {
  if (score == null) return "—";
  if (score < 3) return "A1";
  if (score < 4) return "A2";
  if (score < 6) return "B1";
  return "B2";
}

function signalAdvice(band, gap, feedback) {
  const cleanGap = (gap || "").trim();
  const cleanFeedback = (feedback || "").trim();

  if (band === "strong") {
    return cleanGap ? `strong signal · keep doing: ${cleanGap}` : "strong signal · keep doing what works";
  }
  if (band === "medium") {
    return cleanGap ? `medium signal · improve: ${cleanGap}` : "medium signal · improve structure and detail";
  }
  if (band === "weak") {
    return cleanGap ? `weak signal · issue: ${cleanGap}` : "weak signal · improve structure, accuracy, and clarity";
  }
  return cleanFeedback || "gathering data…";
}

function setSignalLegend(activeBand) {
  ["weak", "medium", "strong"].forEach((band) => {
    const el = $(`signal${band.charAt(0).toUpperCase()}${band.slice(1)}`);
    if (!el) return;
    if (activeBand) {
      el.dataset.active = band === activeBand ? "true" : "false";
    } else {
      delete el.dataset.active;
    }
  });
}

function updateRail(index, contentScore) {
  const items = $("railList").querySelectorAll("li");
  items.forEach((li, i) => {
    li.dataset.current = i === index ? "true" : "false";
  });
  if (contentScore != null) {
    const dot = items[index].querySelector(".rail-dot");
    dot.dataset.score = scoreTier(contentScore);
  }
  updateStepper(index, contentScore);
}

function updateStepper(index, contentScore) {
  for (let i = 0; i < TOTAL_QUESTIONS; i++) {
    const step = $(`qStep-${i}`);
    if (!step) continue;
    step.dataset.current = i === index ? "true" : "false";
  }
  if (contentScore != null) {
    const step = $(`qStep-${index}`);
    const tier = scoreTier(contentScore);
    if (step && tier) {
      step.dataset.score = tier;
      step.dataset.done = "true";
    }
  }
}

function updateSignalMeter(latestScore = null, gap = "", feedback = "") {
  const scores = Object.values(state.weakAreas);
  if (scores.length === 0) return;
  const scoreForSignal = latestScore ?? scores.reduce((a, b) => a + b, 0) / scores.length;
  const pct = Math.max(0, Math.min(100, (scoreForSignal / 10) * 100));
  $("signalFill").style.width = `${pct}%`;

  const band = signalBand(scoreForSignal);
  setSignalLegend(band);

  const bandLabel = band ? `${band} signal` : "gathering data…";
  $("signalCaption").dataset.signal = band || "";
  $("signalCaption").textContent = band
    ? signalAdvice(band, gap, feedback)
    : bandLabel;
}

/* =========================================================
   QUESTION PLAYBACK + waveform
========================================================= */
function playQuestionAudio(text) {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return null;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 1;
  utterance.pitch = 1;
  utterance.onstart = () => animateIdleWave(true);
  utterance.onend = () => animateIdleWave(false);
  utterance.onerror = () => animateIdleWave(false);
  window.speechSynthesis.speak(utterance);
  return utterance;
}

let currentAudio = null;

async function fetchNextQuestion() {
  $("feedbackCard").hidden = true;
  $("qText").textContent = "Thinking of your next question…";
  setStatus("live", "GENERATING");

  let topic, difficulty;
  const isFinalQuestion = state.questionIndex === TOTAL_QUESTIONS - 1;
  const weakest = Object.entries(state.weakAreas).sort((a, b) => a[1] - b[1])[0];

  if (isFinalQuestion && weakest) {
    // Final question: revisit the weakest-scoring topic as a harder follow-up
    topic = weakest[0];
    difficulty = "hard";
  } else {
    difficulty = "medium";
  }
  if (topic) state.currentTopic = topic;
  state.currentDifficulty = difficulty;

  const requestBody = { session_id: state.sessionId, difficulty };
  if (topic) requestBody.topic = topic;

  const res = await fetch(`${API_BASE}/next-question`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody),
  });
  const data = await res.json();
  state.currentQuestion = data.question;
  state.currentTopic = data.topic ?? state.currentTopic;
  state.currentDifficulty = data.level ?? state.currentDifficulty;

  $("qTopic").textContent = `${state.currentTopic} · ${state.currentDifficulty}`;
  $("qText").textContent = data.question;
  $("questionCounter").textContent = `${state.questionIndex + 1} / ${TOTAL_QUESTIONS}`;

  currentAudio = playQuestionAudio(data.question);
  setStatus("ready", "LISTENING");
}

$("replayBtn").addEventListener("click", () => {
  if (state.currentQuestion) {
    currentAudio = playQuestionAudio(state.currentQuestion);
  }
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
  form.append("difficulty", state.currentDifficulty);
  form.append("audio", wavBlob, "answer.wav");

  const res = await fetch(`${API_BASE}/submit-answer`, { method: "POST", body: form });
  const data = await res.json();

  const contentScore = data.content_score ?? 5;
  state.weakAreas[state.currentTopic] = contentScore;
  state.history.push({ topic: state.currentTopic, contentScore: data.content_score });

  $("scoreContent").textContent = (data.content_score ?? "-") + "/10";
  $("scoreDelivery").textContent = (data.delivery_score ?? "-") + "/10";
  $("scoreCEFR").textContent = scoreToCEFR(data.content_score);
  $("feedbackMeta").textContent = `Topic: ${data.topic ?? state.currentTopic} · Level: ${data.level ?? state.currentDifficulty} · CEFR: ${scoreToCEFR(data.content_score)}`;
  $("feedbackText").textContent = data.feedback ?? "";
  $("transcriptText").textContent = `"${data.transcript ?? ""}"`;
  $("feedbackCard").hidden = false;

  updateRail(state.questionIndex, contentScore);
  updateSignalMeter(contentScore, data.gap ?? "", data.feedback ?? "");
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
  renderReviews(data.question_reviews);
  setStatus("ready", "COMPLETE");
}

function renderReviews(reviews) {
  const container = $("reviewsList");
  container.innerHTML = "";
  (reviews || []).forEach((r) => {
    const card = document.createElement("div");
    card.className = "review-card";
    card.innerHTML = `
      <p class="review-topic">${r.topic ?? ""}</p>
      <p class="review-question">${r.question ?? ""}</p>
      <div class="review-row"><span class="review-icon">→</span><span class="review-text"><strong>Better approach:</strong> ${r.better_approach ?? ""}</span></div>
      <div class="review-row"><span class="review-icon">◆</span><span class="review-text"><strong>Delivery tip:</strong> ${r.delivery_tip ?? ""}</span></div>
    `;
    container.appendChild(card);
  });
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

async function downloadSummaryAsPDF() {
  const printBtn = $("printBtn");
  const originalLabel = printBtn.innerHTML;
  printBtn.disabled = true;
  printBtn.innerHTML = "<span>Generating PDF…</span>";

  try {
    const summaryEl = $("screen-summary");

    // Temporarily hide the action buttons so they don't appear in the capture
    const actionsEl = document.querySelector(".summary-actions");
    const prevDisplay = actionsEl.style.display;
    actionsEl.style.display = "none";

    const canvas = await html2canvas(summaryEl, {
      backgroundColor: "#12151b",
      scale: 2,
      useCORS: true,
    });

    actionsEl.style.display = prevDisplay;

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "px", format: "a4" });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const imgWidth = pageWidth;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    const imgData = canvas.toDataURL("image/png");

    if (imgHeight <= pageHeight) {
      pdf.addImage(imgData, "PNG", 0, 0, imgWidth, imgHeight);
    } else {
      // Content taller than one page: slice the canvas across multiple pages
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
      while (heightLeft > 0) {
        position -= pageHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }
    }

    pdf.save(`interview-debrief-${new Date().toISOString().slice(0, 10)}.pdf`);
  } catch (err) {
    console.error("PDF generation failed:", err);
    alert("Couldn't generate the PDF — check the console for details.");
  } finally {
    printBtn.disabled = false;
    printBtn.innerHTML = originalLabel;
  }
}

$("printBtn").addEventListener("click", downloadSummaryAsPDF);
$("restartBtn").addEventListener("click", () => location.reload());