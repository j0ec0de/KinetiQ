import "dotenv/config";
import { PrismaClient } from "./generated/prisma/client";

// Instantiates a single PrismaClient with appropriate query logging based on the environment
const prisma = new PrismaClient({
  accelerateUrl: process.env.DATABASE_URL || "",
  log: process.env.NODE_ENV === "development" ? ["query", "info", "warn", "error"] : ["error"],
} as any);

export default prisma;
