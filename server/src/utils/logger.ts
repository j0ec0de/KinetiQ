import winston from "winston";
import { env } from "../config/env";

const logger = winston.createLogger({
  level: env.nodeEnv === "production" ? "http" : "debug",
  format:
    env.nodeEnv === "production"
      ? winston.format.combine(winston.format.timestamp(), winston.format.json())
      : winston.format.combine(
          winston.format.colorize(),
          winston.format.timestamp({ format: "HH:mm:ss" }),
          winston.format.printf(({ timestamp, level, message }) => `${timestamp} ${level}: ${message}`)
        ),
  transports: [new winston.transports.Console()],
});

export default logger;
