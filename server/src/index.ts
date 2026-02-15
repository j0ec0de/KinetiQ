import express, { Request, Response } from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000

app.get("/", (req: Request, res: Response) => {
    res.status(200).send("Hello World with typescript and express!");
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}/`);
}).on("error", (error: Error) => {
    throw new Error(error.message);
});