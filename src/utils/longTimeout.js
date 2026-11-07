// setTimeout fires immediately (1ms) when the delay exceeds 2^31-1 ms (~24.8 days). Re-arm in chunks instead.
const MAX_DELAY = 2 ** 31 - 1;

function setLongTimeout(fn, ms) {
  const endAt = Date.now() + ms;
  let handle;
  const arm = () => {
    const remaining = endAt - Date.now();
    if (remaining <= 0) return fn();
    handle = setTimeout(arm, Math.min(remaining, MAX_DELAY));
  };
  arm();
  return { clear: () => clearTimeout(handle) };
}

module.exports = { setLongTimeout, MAX_DELAY };
