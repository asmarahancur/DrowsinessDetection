'use strict';

// Constants
const EAR_THRESHOLD = 0.18;
const CONSEC_FRAMES_DROWSY = 30;

// Elements
const videoEl = document.getElementById('video');
const canvasEl = document.getElementById('canvas');
const ctx = canvasEl.getContext('2d');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const badge = document.getElementById('statusBadge');
const earValue = document.getElementById('earValue');

// Eye landmark indices (MediaPipe FaceMesh, 468 points)
const LEFT_EYE_IDX = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE_IDX = [362, 385, 387, 263, 373, 380];

// State
let running = false;
let closedCounter = 0;
let camera = null; // MediaPipe camera utils
let faceMesh = null;
let audioCtx = null;
let oscillatorNode = null;
let gainNode = null;

function euclidean(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return Math.hypot(dx, dy);
}

function computeEAR(landmarks, indices, w, h) {
  const pts = indices.map(i => [landmarks[i].x * w, landmarks[i].y * h]);
  const [p1, p2, p3, p4, p5, p6] = pts;
  const ear = (euclidean(p2, p6) + euclidean(p3, p5)) / (2.0 * euclidean(p1, p4));
  return { ear, pts };
}

function drawEyePoints(points, color = 'rgba(255, 255, 0, 0.95)') {
  ctx.save();
  ctx.fillStyle = color;
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p[0], p[1], 2.0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function setStatusNormal() {
  badge.classList.remove('badge-red');
  badge.classList.add('badge-green');
  badge.textContent = 'STATUS: NORMAL';
}

function setStatusDrowsy() {
  badge.classList.remove('badge-green');
  badge.classList.add('badge-red');
  badge.textContent = 'STATUS: NGANTUK';
}

function startAlarm() {
  if (!audioCtx) return;
  if (oscillatorNode) return; // already playing
  oscillatorNode = audioCtx.createOscillator();
  gainNode = audioCtx.createGain();
  oscillatorNode.type = 'sine';
  oscillatorNode.frequency.value = 1000; // 1kHz beep
  gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime);
  oscillatorNode.connect(gainNode).connect(audioCtx.destination);
  oscillatorNode.start();
}

function stopAlarm() {
  if (oscillatorNode) {
    try { oscillatorNode.stop(); } catch(e) {}
    oscillatorNode.disconnect();
    if (gainNode) gainNode.disconnect();
    oscillatorNode = null;
    gainNode = null;
  }
}

function updateEARDisplay(val) {
  earValue.textContent = (val != null) ? val.toFixed(3) : '-';
}

async function initFaceMesh() {
  faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  faceMesh.onResults(onResults);
}

function onResults(results) {
  const w = canvasEl.width = videoEl.videoWidth || 640;
  const h = canvasEl.height = videoEl.videoHeight || 480;

  // Draw current video frame
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(results.image, 0, 0, w, h);

  let earVal = null;
  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    const lm = results.multiFaceLandmarks[0];
    const left = computeEAR(lm, LEFT_EYE_IDX, w, h);
    const right = computeEAR(lm, RIGHT_EYE_IDX, w, h);
    earVal = (left.ear + right.ear) / 2.0;

    drawEyePoints(left.pts);
    drawEyePoints(right.pts);

    if (earVal < EAR_THRESHOLD) {
      closedCounter += 1;
    } else {
      closedCounter = 0;
    }

    if (closedCounter >= CONSEC_FRAMES_DROWSY) {
      setStatusDrowsy();
      startAlarm();
    } else {
      setStatusNormal();
      stopAlarm();
    }
  } else {
    // No face
    closedCounter = 0;
    setStatusNormal();
    stopAlarm();
  }

  updateEARDisplay(earVal);
  ctx.restore();
}

async function startCamera() {
  if (running) return;
  running = true;

  // Prepare audio context on user gesture for autoplay policy
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    try { await audioCtx.resume(); } catch (e) {}
  }

  // Use MediaPipe CameraUtils for consistent frames
  camera = new Camera(videoEl, {
    onFrame: async () => {
      await faceMesh.send({ image: videoEl });
    },
    width: 640,
    height: 480
  });
  await camera.start();

  btnStart.disabled = true;
  btnStop.disabled = false;
}

function stopCamera() {
  if (!running) return;
  running = false;
  try { camera && camera.stop(); } catch (e) {}
  stopAlarm();
  btnStart.disabled = false;
  btnStop.disabled = true;
}

btnStart.addEventListener('click', async () => {
  try {
    await initFaceMesh();
    await startCamera();
  } catch (e) {
    console.error(e);
    alert('Gagal memulai kamera atau FaceMesh. Periksa izin kamera pada browser.');
  }
});

btnStop.addEventListener('click', () => {
  stopCamera();
});
