import {
  FilesetResolver,
  GestureRecognizer,
  FaceLandmarker,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs";
import {
  POSES,
  HOLD_SECONDS,
  GRACE_SECONDS,
  SHOW_WHILE_HELD,
  SHOW_SECONDS,
  COOLDOWN_SECONDS,
  POP_IN_MS,
  POP_OUT_MS,
  POP_SIZE_PERCENT,
} from "./poses.js";
import { createPoseEngine } from "./pose-engine.js";
import { createPopper } from "./pop.js";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const HAND_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

// How many hands to track at the same time.
const MAX_HANDS = 2;

// How easily the tracker accepts a hand (0 to 1). Lower = catches more hands
// but may rarely see a "hand" that isn't one. The default is 0.5.
const HAND_SENSITIVITY = 0.5;

// How easily the tracker accepts a face (0 to 1). The default is 0.5.
const FACE_SENSITIVITY = 0.5;

// The face is checked on every Nth video frame. 1 = every frame (smoothest
// but heaviest). 2 = every second frame (lighter). If the FPS is low on your
// laptop, try 2 or 3. The hands are always checked on every frame.
const FACE_EVERY_N_FRAMES = 1;

// true  = show a small label with the detected gesture, face scores and pose
//         (for testing).
// false = no label. Temporary, we remove it in the cleanup commit.
const SHOW_DEBUG_LABEL = true;

const stage = document.getElementById("stage");
const video = document.getElementById("video");
const popImage = document.getElementById("popImage");
const startBtn = document.getElementById("startBtn");
const statusEl = document.getElementById("status");

let stream = null;
let gestureRecognizer = null;
let faceLandmarker = null;
let animationId = null;
let lastVideoTime = -1;
let lastHandCount = -1;
let lastFaceFound = null;
let frameCount = 0;
let lastFace = { found: false, landmarks: null, blendshapes: {} };
let handMs = 0;
let faceMs = 0;
let fpsFrames = 0;
let fpsStart = 0;

// Shows and hides the pop-out picture.
const popper = createPopper({
  img: popImage,
  showWhileHeld: SHOW_WHILE_HELD,
  showSeconds: SHOW_SECONDS,
  cooldownSeconds: COOLDOWN_SECONDS,
  popInMs: POP_IN_MS,
  popOutMs: POP_OUT_MS,
  sizePercent: POP_SIZE_PERCENT,
});
popper.preload(POSES);

// Counts how long a pose is held, then pops the picture.
const poseEngine = createPoseEngine({
  poses: POSES,
  holdSeconds: HOLD_SECONDS,
  graceSeconds: GRACE_SECONDS,
  onStart: (pose) => {
    console.log("Pose started:", pose.name);
    popper.show(pose);
  },
  onEnd: (pose) => {
    console.log("Pose ended:", pose.name);
    if (SHOW_WHILE_HELD) popper.hide();
  },
});

// Temporary label for testing (see SHOW_DEBUG_LABEL).
const debugLabel = document.createElement("p");
debugLabel.hidden = true;
debugLabel.style.cssText =
  "position:absolute;top:12px;left:12px;margin:0;padding:4px 10px;" +
  "max-width:calc(100% - 24px);border-radius:6px;" +
  "background:rgba(0,0,0,0.55);color:#fff;font-size:0.85rem;" +
  "white-space:pre-wrap;pointer-events:none;";
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

// ---------- Trackers ----------

// Tries the graphics card first, then falls back to the normal processor.
async function createWithFallback(name, create) {
  try {
    const tracker = await create("GPU");
    console.log(`${name} ready (GPU)`);
    return tracker;
  } catch (gpuError) {
    console.warn(`${name}: GPU not available, using CPU instead.`, gpuError);
    const tracker = await create("CPU");
    console.log(`${name} ready (CPU)`);
    return tracker;
  }
}

async function loadTrackers() {
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);

    gestureRecognizer = await createWithFallback("Gesture recognizer", (delegate) =>
      GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: HAND_MODEL_URL, delegate },
        runningMode: "VIDEO",
        numHands: MAX_HANDS,
        minHandDetectionConfidence: HAND_SENSITIVITY,
        minHandPresenceConfidence: HAND_SENSITIVITY,
        minTrackingConfidence: HAND_SENSITIVITY,
      })
    );
    startTracking();

    faceLandmarker = await createWithFallback("Face landmarker", (delegate) =>
      FaceLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
        runningMode: "VIDEO",
        numFaces: 1,
        outputFaceBlendshapes: true,
        minFaceDetectionConfidence: FACE_SENSITIVITY,
        minFacePresenceConfidence: FACE_SENSITIVITY,
        minTrackingConfidence: FACE_SENSITIVITY,
      })
    );
  } catch (error) {
    console.error("Tracker failed to load:", error);
  }
}

// Turns the face result into: found, the face points, and a simple
// { blendshapeName: score } list (scores are 0 to 1).
// "Left" and "Right" mean the person's own left and right.
function readFace(result) {
  if (!result.faceLandmarks.length) {
    return { found: false, landmarks: null, blendshapes: {} };
  }

  const blendshapes = {};
  const categories =
    (result.faceBlendshapes[0] && result.faceBlendshapes[0].categories) || [];
  categories.forEach((c) => {
    blendshapes[c.categoryName] = Math.round(c.score * 1000) / 1000;
  });

  return { found: true, landmarks: result.faceLandmarks[0], blendshapes };
}

function score(value) {
  return (value || 0).toFixed(2);
}

function trackLoop() {
  if (!stream || !gestureRecognizer) {
    animationId = null;
    return;
  }

  if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
    lastVideoTime = video.currentTime;
    frameCount++;

    // Hands: every frame.
    const handStart = performance.now();
    const handResult = gestureRecognizer.recognizeForVideo(video, handStart);
    handMs = handMs * 0.9 + (performance.now() - handStart) * 0.1;

    // One entry per hand: the best gesture guess and how sure it is.
    const gestures = handResult.landmarks.map((_, i) => {
      const top = handResult.gestures[i] && handResult.gestures[i][0];
      return {
        name: top ? top.categoryName : "None",
        score: Math.round((top ? top.score : 0) * 100) / 100,
      };
    });

    // Face: every Nth frame. In between, the last result is reused.
    if (faceLandmarker && frameCount % FACE_EVERY_N_FRAMES === 0) {
      const faceStart = performance.now();
      const faceResult = faceLandmarker.detectForVideo(video, faceStart);
      faceMs = faceMs * 0.9 + (performance.now() - faceStart) * 0.1;
      lastFace = readFace(faceResult);
    }

    // Everything the pose rules can look at, in one place.
    const state = {
      hands: handResult.landmarks.map((landmarks, i) => ({
        gesture: gestures[i].name,
        score: gestures[i].score,
        landmarks,
      })),
      face: lastFace,
    };

    // A pose can only trigger when no picture is showing or cooling down.
    const poseNow = performance.now();
    const blocked = popper.isBusy(poseNow);
    const pose = poseEngine.update(state, poseNow, !blocked);

    // Debug helpers for the Console. We remove them in a later commit.
    window.latestHands = handResult.landmarks;
    window.latestGestures = gestures;
    window.latestFace = lastFace.landmarks;
    window.latestBlendshapes = lastFace.blendshapes;
    window.latestPose = pose;
    window.latestPopBusy = blocked;
    window.latestHandMs = Math.round(handMs);
    window.latestFaceMs = Math.round(faceMs);

    if (gestures.length !== lastHandCount) {
      lastHandCount = gestures.length;
      console.log("Hands found:", gestures.length);
    }
    if (lastFace.found !== lastFaceFound) {
      lastFaceFound = lastFace.found;
      console.log("Face found:", lastFace.found);
    }

    const handLine = gestures.length
      ? gestures.map((g) => `${g.name} ${g.score}`).join("   |   ")
      : "No hand";

    const b = lastFace.blendshapes;
    const smile = ((b.mouthSmileLeft || 0) + (b.mouthSmileRight || 0)) / 2;
    const faceLine = lastFace.found
      ? `smile ${score(smile)}  jaw ${score(b.jawOpen)}  brows ${score(b.browInnerUp)}  ` +
        `tongue ${score(b.tongueOut)}  blinkL ${score(b.eyeBlinkLeft)}  blinkR ${score(b.eyeBlinkRight)}`
      : "No face";

    let poseLine = "Pose: -";
    if (pose.active) {
      poseLine = `Pose: ${pose.active} (triggered)`;
    } else if (pose.candidate) {
      poseLine =
        `Pose: ${pose.candidate} ${Math.round(pose.progress * 100)}%` +
        (blocked && pose.progress >= 1 ? " (waiting)" : "");
    }

    setDebugLabel(`${handLine}\n${faceLine}\n${poseLine}`);

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
  lastFaceFound = null;
  frameCount = 0;
  lastFace = { found: false, landmarks: null, blendshapes: {} };
  poseEngine.reset();
  popper.reset();
  fpsFrames = 0;
  fpsStart = performance.now();
  animationId = requestAnimationFrame(trackLoop);
}

function stopTracking() {
  if (animationId !== null) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  lastFace = { found: false, landmarks: null, blendshapes: {} };
  poseEngine.reset();
  popper.reset();
  window.latestHands = [];
  window.latestGestures = [];
  window.latestFace = null;
  window.latestBlendshapes = {};
  window.latestPose = null;
  window.latestPopBusy = false;
  window.latestHandMs = 0;
  window.latestFaceMs = 0;
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

loadTrackers();
console.log("Pose Pop loaded");