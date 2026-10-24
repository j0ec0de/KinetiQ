import express, { Request, Response } from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import { env } from "./config/env";
import logger from "./utils/logger";
import { errorHandler } from "./middleware/errorHandler";
import { globalLimiter } from "./middleware/rateLimit";
import authRoutes from "./modules/auth/auth.routes";

const app = express();

// Core Middleware (order matters: headers, origin check, logging, parsing, throttling)
app.use(helmet());
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(morgan("tiny", { stream: { write: (line) => logger.http(line.trim()) } }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(globalLimiter);

// API Routes
app.use("/api/auth", authRoutes);

// Core Health Check
app.get("/", (req: Request, res: Response) => {
    res.status(200).send("Hello World with typescript and express!");
});

// Global Error Handler Middleware
app.use(errorHandler);

app.listen(env.port, () => {
    logger.info(`Server running at http://localhost:${env.port}/`);
}).on("error", (error: Error) => {
    throw new Error(error.message);
});
