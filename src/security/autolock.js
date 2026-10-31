// Locks the vault after inactivity (and when the tab has been hidden for the same period).
export function createIdleLock({ timeoutMs, onLock }) {
  let timer = null;
  let hiddenAt = null;
  const reset = () => {
    clearTimeout(timer);
    if (timeoutMs > 0) timer = setTimeout(onLock, timeoutMs);
  };
  const onVisibility = () => {
    if (document.hidden) hiddenAt = Date.now();
    else {
      if (hiddenAt && Date.now() - hiddenAt >= timeoutMs) onLock();
      hiddenAt = null;
      reset();
    }
  };
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'];
  events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
  document.addEventListener('visibilitychange', onVisibility);
  reset();
  return () => {
    clearTimeout(timer);
    events.forEach((e) => window.removeEventListener(e, reset));
    document.removeEventListener('visibilitychange', onVisibility);
  };
}
