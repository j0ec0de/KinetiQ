import "dotenv/config";
import express, { Request, Response } from "express";
import { errorHandler } from "./middleware/errorHandler";
import authRoutes from "./modules/auth/auth.routes";

const app = express();
const PORT = process.env.PORT || 3000;

// Core Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use("/api/auth", authRoutes);

// Core Health Check
app.get("/", (req: Request, res: Response) => {
    res.status(200).send("Hello World with typescript and express!");
});

// Global Error Handler Middleware
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
}).on("error", (error: Error) => {
    throw new Error(error.message);
});