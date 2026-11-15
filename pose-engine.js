// Decides when a pose has been held long enough to trigger.
// It doesn't know what the poses are. It only counts time.
export function createPoseEngine({
  poses,
  holdSeconds,
  graceSeconds,
  onStart,
  onEnd,
}) {
  const holdMs = holdSeconds * 1000;
  const graceMs = graceSeconds * 1000;

  let candidate = null; // the pose being counted
  let candidateSince = 0; // when counting started
  let lastSeen = 0; // last time the candidate matched
  let active = null; // the pose that triggered and is still held

  function endActive() {
    if (active) {
      const ended = active;
      active = null;
      onEnd(ended);
    }
  }

  // Call this every frame. "now" is performance.now().
  // canTrigger = false keeps counting but holds back the trigger
  // (used while a picture is showing or cooling down).
  function update(state, now, canTrigger = true) {
    const match = poses.find((pose) => pose.check(state)) || null;

    if (match) {
      if (!candidate || candidate.id !== match.id) {
        candidate = match;
        candidateSince = now;
      }
      lastSeen = now;
    } else if (candidate && now - lastSeen > graceMs) {
      candidate = null;
    }

    // The triggered pose ends when it is no longer the candidate.
    if (active && (!candidate || candidate.id !== active.id)) {
      endActive();
    }

    // Trigger once, after the pose has been held long enough.
    if (candidate && !active && canTrigger && now - candidateSince >= holdMs) {
      active = candidate;
      onStart(active);
    }

    return {
      candidate: candidate ? candidate.id : null,
      active: active ? active.id : null,
      progress: candidate ? Math.min(1, (now - candidateSince) / holdMs) : 0,
    };
  }

  function reset() {
    endActive();
    candidate = null;
  }

  return { update, reset };
}