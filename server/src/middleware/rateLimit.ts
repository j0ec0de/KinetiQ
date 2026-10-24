import { rateLimit } from "express-rate-limit";

const limiter = (windowMs: number, limit: number, message: string) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ status: "error", statusCode: 429, message });
    },
  });

export const globalLimiter = limiter(60_000, 100, "Too many requests, please slow down");

export const authLimiter = limiter(15 * 60_000, 5, "Too many authentication attempts, try again later");
