import { useEffect, useRef } from "react";

const ACTIVITY_EVENTS = [
  "mousemove",
  "mousedown",
  "keydown",
  "touchstart",
  "wheel",
  "scroll",
];

/**
 * Fire `onIdle` after `minutes` of no user input. Listens to mouse, keyboard,
 * touch, and scroll events on `window`. Resets on every event.
 *
 * Pass `enabled = false` to disable (e.g. when no user is signed in).
 */
export const useIdleTimeout = (minutes, onIdle, { enabled = true } = {}) => {
  const timerRef = useRef(null);
  const onIdleRef = useRef(onIdle);

  // Keep onIdle reference fresh without resetting the timer on every render.
  useEffect(() => {
    onIdleRef.current = onIdle;
  }, [onIdle]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;

    const ms = Math.max(0, minutes) * 60 * 1000;
    if (!ms) return undefined;

    const arm = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        try {
          onIdleRef.current?.();
        } catch (err) {
          console.error("useIdleTimeout onIdle handler threw:", err);
        }
      }, ms);
    };

    const handle = () => arm();

    arm();
    ACTIVITY_EVENTS.forEach((ev) =>
      window.addEventListener(ev, handle, { passive: true })
    );

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      ACTIVITY_EVENTS.forEach((ev) => window.removeEventListener(ev, handle));
    };
  }, [enabled, minutes]);
};

export default useIdleTimeout;
