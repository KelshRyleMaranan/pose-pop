import {
  FilesetResolver,
  GestureRecognizer,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";

// How many hands to track at the same time.
const MAX_HANDS = 2;

// How easily the tracker accepts a hand (0 to 1). Lower = catches more hands
// but may rarely see a "hand" that isn't one. The default is 0.5.
const HAND_SENSITIVITY = 0.5;

// true  = show a small label with the detected gesture (for testing).
// false = no label. Temporary, we remove it in the cleanup commit.
const SHOW_DEBUG_LABEL = true;

const stage = document.getElementById("stage");
const video = document.getElementById("video");
const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");

let stream = null;
let gestureRecognizer = null;
let animationId = null;
let lastVideoTime = -1;
let lastHandCount = -1;
let fpsFrames = 0;
let fpsStart = 0;

// Temporary label for testing (see SHOW_DEBUG_LABEL).
const debugLabel = document.createElement("p");
debugLabel.hidden = true;
debugLabel.style.cssText =
  "position:absolute;top:12px;left:12px;margin:0;padding:4px 10px;" +
  "border-radius:6px;background:rgba(0,0,0,0.55);color:#fff;" +
  "font-size:0.85rem;pointer-events:none;";
stage.appendChild(debugLabel);

function setDebugLabel(text) {
  if (!SHOW_DEBUG_LABEL) return;
  if (debugLabel.textContent !== text) debugLabel.textContent = text;
  debugLabel.hidden = false;
}

function setStatus(message) {
  statusEl.textContent = message;
  statusEl.hidden = false;
}

function friendlyError(error) {
  switch (error.name) {
    case "NotAllowedError":
      return "Camera is blocked. In Windows, open Settings > Privacy & security > Camera and turn on \"Let desktop apps access your camera\".";
    case "NotFoundError":
      return "No camera was found on this laptop.";
    case "NotReadableError":
      return "Your camera is being used by another app. Close it and try again.";
    default:
      return "Could not start the camera. Please try again.";
  }
}

// ---------- Hand tracker ----------

async function createGestureRecognizer(vision, delegate) {
  return GestureRecognizer.createFromOptions(vision, {
    baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
    runningMode: "VIDEO",
    numHands: MAX_HANDS,
    minHandDetectionConfidence: HAND_SENSITIVITY,
    minHandPresenceConfidence: HAND_SENSITIVITY,
    minTrackingConfidence: HAND_SENSITIVITY,
  });
}

async function loadHandTracker() {
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    try {
      gestureRecognizer = await createGestureRecognizer(vision, "GPU");
      console.log("Gesture recognizer ready (GPU)");
    } catch (gpuError) {
      console.warn("GPU not available, using CPU instead.", gpuError);
      gestureRecognizer = await createGestureRecognizer(vision, "CPU");
      console.log("Gesture recognizer ready (CPU)");
    }
    startTracking();
  } catch (error) {
    console.error("Hand tracker failed to load:", error);
  }
}

function trackLoop() {
  if (!stream || !gestureRecognizer) {
    animationId = null;
    return;
  }

  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    const result = gestureRecognizer.recognizeForVideo(
      video,
      performance.now()
    );

    // One entry per hand: the best gesture guess and how sure it is.
    const gestures = result.landmarks.map((_, i) => {
      const top = result.gestures[i] && result.gestures[i][0];
      return {
        name: top ? top.categoryName : "None",
        score: top ? Math.round(top.score * 100) / 100 : 0,
      };
    });

    // Debug helpers for the Console. We remove them in a later commit.
    window.latestHands = result.landmarks;
    window.latestGestures = gestures;

    const count = gestures.length;
    if (count !== lastHandCount) {
      lastHandCount = count;
      console.log("Hands found:", count);
    }

    setDebugLabel(
      count
        ? gestures.map((g) => `${g.name} ${g.score}`).join("   |   ")
        : "No hand"
    );

    // Debug helper: frames per second, updated once a second.
    fpsFrames++;
    const now = performance.now();
    if (now - fpsStart >= 1000) {
      window.latestFps = Math.round((fpsFrames * 1000) / (now - fpsStart));
      fpsFrames = 0;
      fpsStart = now;
    }
  }

  animationId = requestAnimationFrame(trackLoop);
}

function startTracking() {
  if (animationId !== null || !stream || !gestureRecognizer) return;
  lastVideoTime = -1;
  lastHandCount = -1;
  fpsFrames = 0;
  fpsStart = performance.now();
  animationId = requestAnimationFrame(trackLoop);
}

function stopTracking() {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  window.latestHands = [];
  window.latestGestures = [];
  window.latestFps = 0;
  debugLabel.hidden = true;
}

// ---------- Camera ----------

function stopCamera() {
  stopTracking();
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  video.srcObject = null;
  video.hidden = true;
  startBtn.setAttribute("aria-label", "Start camera");
  setStatus("Camera is off");
}

async function startCamera() {
  startBtn.disabled = true;
  setStatus("Starting camera...");

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user",
      },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();

    video.hidden = false;
    statusEl.hidden = true;
    startBtn.setAttribute("aria-label", "Stop camera");

    startTracking();
  } catch (error) {
    console.error("Camera error:", error);
    stopCamera();
    setStatus(friendlyError(error));
  } finally {
    startBtn.disabled = false;
  }
}

// ---------- Buttons ----------

startBtn.addEventListener("click", () => {
  if (stream) {
    stopCamera();
  } else {
    startCamera();
  }
});

// ---------- Start ----------

loadHandTracker();
console.log("Pose Pop loaded");