// Shows and hides the pop-out picture. It doesn't know about poses or
// tracking. It only knows how to pop an image in and out, and when it is
// busy (showing, leaving, or cooling down).
export function createPopper({
  img,
  showWhileHeld,
  showSeconds,
  cooldownSeconds,
  popInMs,
  popOutMs,
  sizePercent,
}) {
  // The animation speeds and the size are set here and used by style.css.
  img.style.setProperty("--pop-in", `${popInMs}ms`);
  img.style.setProperty("--pop-out", `${popOutMs}ms`);
  img.style.setProperty("--pop-size", `${sizePercent}%`);

  let phase = "idle"; // "idle", "showing" or "leaving"
  let cooldownUntil = 0;
  let showTimer = null;
  let leaveTimer = null;

  img.addEventListener("error", () => {
    console.warn("Could not load image:", img.getAttribute("src"));
  });

  // Loads every picture early so the first pop doesn't flash.
  function preload(poses) {
    poses.forEach((pose) => {
      const pre = new Image();
      pre.onerror = () => console.warn("Missing image file:", pose.image);
      pre.src = pose.image;
    });
  }

  function show(pose) {
    if (phase !== "idle") return;
    phase = "showing";

    img.src = pose.image;
    img.alt = pose.name;
    img.classList.remove("is-leaving");
    img.hidden = false;
    void img.offsetWidth; // restarts the animation from the start
    img.classList.add("is-visible");

    if (!showWhileHeld) {
      showTimer = setTimeout(hide, showSeconds * 1000);
    }
  }

  function hide() {
    clearTimeout(showTimer);
    showTimer = null;
    if (phase !== "showing") return;
    phase = "leaving";

    img.classList.remove("is-visible");
    img.classList.add("is-leaving");

    leaveTimer = setTimeout(() => {
      img.hidden = true;
      img.classList.remove("is-leaving");
      phase = "idle";
      cooldownUntil = performance.now() + cooldownSeconds * 1000;
    }, popOutMs);
  }

  // Hides right away with no animation and no cooldown (camera turned off).
  function reset() {
    clearTimeout(showTimer);
    clearTimeout(leaveTimer);
    showTimer = null;
    leaveTimer = null;
    img.hidden = true;
    img.classList.remove("is-visible", "is-leaving");
    phase = "idle";
    cooldownUntil = 0;
  }

  // true while an image is showing or leaving, or the cooldown is running.
  function isBusy(now) {
    return phase !== "idle" || now < cooldownUntil;
  }

  return { preload, show, hide, reset, isBusy };
}