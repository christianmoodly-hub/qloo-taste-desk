export function createRateLimiter({ windowMs = 60_000, max = 20, now = () => Date.now() } = {}) {
  const buckets = new Map();

  return function rateLimit(req, res, next) {
    const ip = req.ip || "local";
    const recent = (buckets.get(ip) || []).filter((stamp) => now() - stamp < windowMs);
    if (recent.length >= max) {
      res.status(429).json({
        ok: false,
        error: {
          code: "RATE_LIMIT",
          message: "This demo allows 20 plans a minute per person so the shared Qloo key lasts through judging. Wait a minute, or open a saved preset.",
        },
      });
      return;
    }
    recent.push(now());
    buckets.set(ip, recent);
    next();
  };
}
