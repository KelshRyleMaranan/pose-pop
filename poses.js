// ---------- Settings you can tune ----------

// How long a pose must be held before it triggers, in seconds.
export const HOLD_SECONDS = 0.5;

// If tracking loses the pose for less than this many seconds, the hold
// keeps counting. This stops a tracking flicker from resetting the timer.
export const GRACE_SECONDS = 0.15;

// How sure the hand model must be (0 to 1) before a built-in gesture counts.
export const MIN_GESTURE_SCORE = 0.6;

// true  = the picture stays while you hold the pose, and hides when you stop.
// false = the picture shows for SHOW_SECONDS, then hides by itself.
export const SHOW_WHILE_HELD = true;

// How long the picture shows when SHOW_WHILE_HELD is false, in seconds.
export const SHOW_SECONDS = 3;

// After a picture hides, no picture can pop for this many seconds.
export const COOLDOWN_SECONDS = 2;

// How fast the picture pops in and shrinks away, in milliseconds.
export const POP_IN_MS = 240;
export const POP_OUT_MS = 160;

// The biggest the picture can be, as a percent of the video area.
export const POP_SIZE_PERCENT = 55;

// ---------- Helpers for writing rules ----------

// true if any hand is making this built-in gesture. The names are:
// Open_Palm, Closed_Fist, Pointing_Up, Thumb_Up, Thumb_Down, Victory, ILoveYou
function hasGesture(state, name) {
  return state.hands.some(
    (hand) => hand.gesture === name && hand.score >= MIN_GESTURE_SCORE
  );
}

// ---------- The pose list ----------

// To add a pose: put the picture in the images folder, then add one entry.
//   id:    a short unique name
//   name:  the name shown while testing
//   image: the picture that pops out
//   check: a rule that gets the tracking data (state) and returns true or false
//          state.hands = [{ gesture, score, landmarks }]
//          state.face  = { found, landmarks, blendshapes }
// The first pose in the list that matches wins, so put the most specific
// poses at the top.
export const POSES = [
  {
    id: "wait",
    name: "Wait",
    image: "images/wait_sticker.jpg",
    check: (state) => hasGesture(state, "Open_Palm"),
  },
];