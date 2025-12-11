'use strict';

// Constants with default values
let EAR_THRESHOLD = 0.18;
let CONSEC_FRAMES_DROWSY = 30;
let ALARM_VOLUME = 0.5;
let USE_FRONT_CAMERA = false;
let MIRROR_VIDEO = false; // Default mirror is OFF

// Elements
const videoEl = document.getElementById('video');
const canvasEl = document.getElementById('canvas');
const ctx = canvasEl.getContext('2d');
const btnStart = document.getElementById('btnStart');
const btnStop = document.getElementById('btnStop');
const btnSwitchCamera = document.getElementById('btnSwitchCamera');
const btnTestAlarm = document.getElementById('btnTestAlarm');
const btnMirror = document.getElementById('btnMirror');
const btnSilence = document.getElementById('btnSilence');
const badge = document.getElementById('statusBadge');
const earValue = document.getElementById('earValue');
const drowsyCounterEl = document.getElementById('drowsyCounter');
const earProgress = document.getElementById('earProgress');
const drowsyProgress = document.getElementById('drowsyProgress');
const themeToggle = document.getElementById('themeToggle');
const cameraStatus = document.getElementById('cameraStatus');
const cameraLabel = document.getElementById('cameraLabel');
const cameraType = document.getElementById('cameraType');
const faceDetected = document.getElementById('faceDetected');
const fpsCounter = document.getElementById('fpsCounter');
const alarmIndicator = document.getElementById('alarmIndicator');

// Range input elements
const earThresholdInput = document.getElementById('earThreshold');
const earThresholdValue = document.getElementById('earThresholdValue');
const frameThresholdInput = document.getElementById('frameThreshold');
const frameThresholdValue = document.getElementById('frameThresholdValue');
const alarmVolumeInput = document.getElementById('alarmVolume');
const alarmVolumeValue = document.getElementById('alarmVolumeValue');

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
let frameCount = 0;
let lastTime = performance.now();
let currentFPS = 0;
let alarmActive = false;
let currentStream = null;

// Initialize theme from localStorage or default to light
function initTheme() {
  const savedTheme = localStorage.getItem('theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);
  themeToggle.checked = savedTheme === 'dark';
  
  // Update button icons based on theme
  updateThemeIcons();
}

// Toggle theme between light and dark
function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme');
  const newTheme = currentTheme === 'light' ? 'dark' : 'light';
  
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  themeToggle.checked = newTheme === 'dark';
  
  updateThemeIcons();
}

// Update theme-related icons
function updateThemeIcons() {
  const themeIcon = document.querySelector('.theme-label i');
  if (themeIcon) {
    themeIcon.className = document.documentElement.getAttribute('data-theme') === 'dark' 
      ? 'fas fa-sun' 
      : 'fas fa-moon';
  }
}

// Calculate EAR (Eye Aspect Ratio)
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

// Draw eye landmarks on canvas
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

// Update status badge
function setStatusNormal() {
  badge.classList.remove('badge-red');
  badge.classList.add('badge-green');
  badge.innerHTML = '<i class="fas fa-check-circle"></i> STATUS: NORMAL';
  badge.classList.remove('pulse-animation');
}

function setStatusDrowsy() {
  badge.classList.remove('badge-green');
  badge.classList.add('badge-red');
  badge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> STATUS: DROWSY';
  badge.classList.add('pulse-animation');
}

// Update camera status display
function updateCameraStatus(status, type = '') {
  cameraStatus.textContent = status;
  cameraStatus.className = `status-indicator ${type}`;
  
  if (type === 'active') {
    cameraStatus.classList.add('active');
  } else if (type === 'warning') {
    cameraStatus.classList.add('warning');
  } else {
    cameraStatus.classList.add('idle');
  }
}

// Update face detection status
function updateFaceDetectionStatus(detected) {
  faceDetected.textContent = detected ? 'Yes' : 'No';
  faceDetected.style.color = detected ? '#10b981' : '#ef4444';
}

// Update FPS counter
function updateFPSCounter() {
  frameCount++;
  const now = performance.now();
  const delta = now - lastTime;
  
  if (delta >= 1000) {
    currentFPS = Math.round((frameCount * 1000) / delta);
    fpsCounter.textContent = currentFPS;
    frameCount = 0;
    lastTime = now;
  }
}

// Alarm functions
function startAlarm() {
  if (!audioCtx || alarmActive) return;
  
  alarmActive = true;
  alarmIndicator.classList.add('alarm-active');
  alarmIndicator.innerHTML = '<div class="indicator-dot"></div><span>Alarm Active</span>';
  btnSilence.disabled = false;
  
  if (oscillatorNode) return; // already playing
  
  try {
    oscillatorNode = audioCtx.createOscillator();
    gainNode = audioCtx.createGain();
    
    oscillatorNode.type = 'sawtooth';
    oscillatorNode.frequency.setValueAtTime(800, audioCtx.currentTime);
    oscillatorNode.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.5);
    
    gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
    gainNode.gain.linearRampToValueAtTime(ALARM_VOLUME, audioCtx.currentTime + 0.1);
    
    oscillatorNode.connect(gainNode).connect(audioCtx.destination);
    oscillatorNode.start();
    
    // Create pulsing effect
    setInterval(() => {
      if (gainNode && audioCtx) {
        gainNode.gain.setValueAtTime(ALARM_VOLUME * 0.3, audioCtx.currentTime);
        gainNode.gain.linearRampToValueAtTime(ALARM_VOLUME, audioCtx.currentTime + 0.5);
      }
    }, 1000);
  } catch (e) {
    console.error('Error starting alarm:', e);
  }
}

function stopAlarm() {
  alarmActive = false;
  alarmIndicator.classList.remove('alarm-active');
  alarmIndicator.innerHTML = '<div class="indicator-dot"></div><span>Alarm Inactive</span>';
  btnSilence.disabled = true;
  
  if (oscillatorNode) {
    try {
      if (gainNode && audioCtx) {
        gainNode.gain.setValueAtTime(gainNode.gain.value, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5);
      }
      
      setTimeout(() => {
        if (oscillatorNode) {
          oscillatorNode.stop();
          oscillatorNode.disconnect();
          if (gainNode) gainNode.disconnect();
          oscillatorNode = null;
          gainNode = null;
        }
      }, 500);
    } catch (e) {
      console.error('Error stopping alarm:', e);
      oscillatorNode = null;
      gainNode = null;
    }
  }
}

// Test alarm function
function testAlarm() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  
  startAlarm();
  
  // Auto stop after 2 seconds
  setTimeout(() => {
    stopAlarm();
  }, 2000);
}

// Update EAR display and progress bar
function updateEARDisplay(val) {
  if (val != null) {
    earValue.textContent = val.toFixed(3);
    
    // Update progress bar (0-0.4 range for visualization)
    const progressPercent = Math.min(val / 0.4, 1) * 100;
    earProgress.style.width = `${progressPercent}%`;
    
    // Change color based on threshold
    if (val < EAR_THRESHOLD) {
      earProgress.style.background = 'var(--status-warn)';
    } else {
      earProgress.style.background = 'var(--status-ok)';
    }
  } else {
    earValue.textContent = '-';
    earProgress.style.width = '0%';
  }
}

// Update drowsy counter display
function updateDrowsyCounter(val) {
  drowsyCounterEl.textContent = val;
  
  // Update progress bar
  const progressPercent = Math.min(val / CONSEC_FRAMES_DROWSY, 1) * 100;
  drowsyProgress.style.width = `${progressPercent}%`;
}

// Initialize MediaPipe FaceMesh
async function initFaceMesh() {
  faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
  });
  
  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  
  faceMesh.onResults(onResults);
}

// Process FaceMesh results
function onResults(results) {
  const w = canvasEl.width = videoEl.videoWidth || 640;
  const h = canvasEl.height = videoEl.videoHeight || 480;
  
  // Clear canvas and apply mirror if needed
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  
  // Apply mirror transformation if enabled
  if (MIRROR_VIDEO) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  
  // Draw video frame
  ctx.drawImage(results.image, 0, 0, w, h);
  
  let earVal = null;
  let faceDetectedFlag = false;
  
  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    faceDetectedFlag = true;
    const lm = results.multiFaceLandmarks[0];
    const left = computeEAR(lm, LEFT_EYE_IDX, w, h);
    const right = computeEAR(lm, RIGHT_EYE_IDX, w, h);
    earVal = (left.ear + right.ear) / 2.0;
    
    // Draw eye landmarks
    drawEyePoints(left.pts, 'rgba(0, 255, 255, 0.9)');
    drawEyePoints(right.pts, 'rgba(0, 255, 255, 0.9)');
    
    // Drowsiness detection logic
    if (earVal < EAR_THRESHOLD) {
      closedCounter += 1;
    } else {
      closedCounter = 0;
    }
    
    updateDrowsyCounter(closedCounter);
    
    if (closedCounter >= CONSEC_FRAMES_DROWSY) {
      setStatusDrowsy();
      startAlarm();
    } else {
      setStatusNormal();
      if (closedCounter === 0) {
        stopAlarm();
      }
    }
  } else {
    // No face detected
    faceDetectedFlag = false;
    closedCounter = 0;
    setStatusNormal();
    stopAlarm();
    updateDrowsyCounter(0);
  }
  
  updateFaceDetectionStatus(faceDetectedFlag);
  updateEARDisplay(earVal);
  updateFPSCounter();
  ctx.restore();
}

// Get camera constraints based on selected camera
function getCameraConstraints() {
  const constraints = {
    video: {
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30 }
    }
  };
  
  if (USE_FRONT_CAMERA) {
    constraints.video.facingMode = { ideal: 'user' };
  } else {
    constraints.video.facingMode = { ideal: 'environment' };
  }
  
  return constraints;
}

// Start camera with selected camera type
async function startCamera() {
  if (running) return;
  
  try {
    // Initialize FaceMesh if not already done
    if (!faceMesh) {
      await initFaceMesh();
    }
    
    // Initialize audio context
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      try {
        await audioCtx.resume();
      } catch (e) {
        console.warn('Audio context resume failed:', e);
      }
    }
    
    // Get camera stream
    const constraints = getCameraConstraints();
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = stream;
    videoEl.srcObject = stream;
    
    // Wait for video to be ready
    await new Promise((resolve) => {
      videoEl.onloadedmetadata = () => {
        videoEl.play();
        resolve();
      };
    });
    
    // Update UI
    running = true;
    updateCameraStatus('Active', 'active');
    cameraType.textContent = USE_FRONT_CAMERA ? 'Front' : 'Rear';
    cameraLabel.textContent = USE_FRONT_CAMERA ? '(Front)' : '(Rear)';
    
    // Enable/disable buttons
    btnStart.disabled = true;
    btnStop.disabled = false;
    btnSwitchCamera.disabled = false;
    btnMirror.disabled = false;
    
    // Start processing frames with MediaPipe Camera
    camera = new Camera(videoEl, {
      onFrame: async () => {
        if (running && faceMesh) {
          await faceMesh.send({ image: videoEl });
        }
      },
      width: 640,
      height: 480
    });
    
    await camera.start();
    
  } catch (error) {
    console.error('Error starting camera:', error);
    alert('Failed to start camera. Please check camera permissions and try again.');
    stopCamera();
  }
}

// Stop camera
function stopCamera() {
  if (!running) return;
  
  running = false;
  
  // Stop camera and stream
  try {
    if (camera) {
      camera.stop();
    }
    
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
      currentStream = null;
    }
    
    videoEl.srcObject = null;
  } catch (e) {
    console.error('Error stopping camera:', e);
  }
  
  // Stop alarm
  stopAlarm();
  
  // Update UI
  updateCameraStatus('Idle', 'idle');
  cameraType.textContent = '-';
  btnStart.disabled = false;
  btnStop.disabled = true;
  btnSwitchCamera.disabled = true;
  btnMirror.disabled = true;
  
  // Reset counters
  closedCounter = 0;
  updateDrowsyCounter(0);
  updateEARDisplay(null);
  updateFaceDetectionStatus(false);
  
  // Clear canvas
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
}

// Switch between front and rear camera
async function switchCamera() {
  if (!running) return;
  
  // Stop current camera
  try {
    if (camera) {
      camera.stop();
    }
    
    if (currentStream) {
      currentStream.getTracks().forEach(track => track.stop());
    }
  } catch (e) {
    console.error('Error stopping camera for switch:', e);
  }
  
  // Toggle camera type
  USE_FRONT_CAMERA = !USE_FRONT_CAMERA;
  
  // Restart camera with new type
  await startCamera();
}

// Toggle mirror effect
function toggleMirror() {
  MIRROR_VIDEO = !MIRROR_VIDEO;
  
  if (MIRROR_VIDEO) {
    btnMirror.innerHTML = '<i class="fas fa-exchange-alt"></i> Mirror On';
    btnMirror.classList.add('primary');
  } else {
    btnMirror.innerHTML = '<i class="fas fa-exchange-alt"></i> Mirror Off';
    btnMirror.classList.remove('primary');
  }
  
  // Update video element style for immediate feedback
  videoEl.style.transform = MIRROR_VIDEO ? 'scaleX(-1)' : 'scaleX(1)';
}

// Update threshold values from range inputs
function updateThresholds() {
  EAR_THRESHOLD = parseFloat(earThresholdInput.value);
  CONSEC_FRAMES_DROWSY = parseInt(frameThresholdInput.value);
  ALARM_VOLUME = parseInt(alarmVolumeInput.value) / 100;
  
  // Update display values
  earThresholdValue.textContent = EAR_THRESHOLD.toFixed(2);
  frameThresholdValue.textContent = CONSEC_FRAMES_DROWSY;
  alarmVolumeValue.textContent = `${parseInt(alarmVolumeInput.value)}%`;
  
  // Update threshold indicators
  document.getElementById('thVal').textContent = EAR_THRESHOLD.toFixed(2);
  document.getElementById('cfVal').textContent = CONSEC_FRAMES_DROWSY;
}

// Initialize event listeners
function initEventListeners() {
  // Theme toggle
  themeToggle.addEventListener('change', toggleTheme);
  
  // Camera controls
  btnStart.addEventListener('click', startCamera);
  btnStop.addEventListener('click', stopCamera);
  btnSwitchCamera.addEventListener('click', switchCamera);
  btnMirror.addEventListener('click', toggleMirror);
  
  // Alarm controls
  btnTestAlarm.addEventListener('click', testAlarm);
  btnSilence.addEventListener('click', stopAlarm);
  
  // Range input listeners
  earThresholdInput.addEventListener('input', updateThresholds);
  frameThresholdInput.addEventListener('input', updateThresholds);
  alarmVolumeInput.addEventListener('input', updateThresholds);
  
  // Initialize thresholds display
  updateThresholds();
  
  // Click anywhere to enable audio (for browsers with autoplay restrictions)
  document.addEventListener('click', async () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
  });
  
  // Handle page visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && running) {
      // Page is hidden, stop alarm to prevent annoyance
      stopAlarm();
    }
  });
}

// Initialize the application
function initApp() {
  // Initialize theme
  initTheme();
  
  // Initialize event listeners
  initEventListeners();
  
  // Set canvas initial size
  canvasEl.width = 640;
  canvasEl.height = 480;
  
  // Display initial status
  updateCameraStatus('Idle', 'idle');
  updateFaceDetectionStatus(false);
  
  console.log('Drowsiness Detection App initialized');
}

// Start the app when DOM is loaded
document.addEventListener('DOMContentLoaded', initApp);
