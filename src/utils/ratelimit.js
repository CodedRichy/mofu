const buckets = new Map();

function rateLimit(key, maxHits, windowMs) {
  const now = Date.now();
  if (!buckets.has(key)) buckets.set(key, []);
  const hits = buckets.get(key).filter((t) => now - t < windowMs);
  if (hits.length >= maxHits) return false;
  hits.push(now);
  buckets.set(key, hits);
  return true;
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of buckets) {
    const fresh = hits.filter((t) => now - t < 300000);
    if (fresh.length === 0) buckets.delete(key);
    else buckets.set(key, fresh);
  }
}, 300000).unref(); // housekeeping only: never keep a process (tests, scripts) alive on its own

module.exports = { rateLimit };
