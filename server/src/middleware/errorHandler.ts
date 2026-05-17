import { Request, Response, NextFunction } from "express";
import { HttpException } from "../utils/errors";

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const statusCode = err instanceof HttpException ? err.statusCode : 500;
  const message = err.message || "Internal Server Error";
  const details = err instanceof HttpException ? err.details : undefined;

  // Internal logging (Log error stack in dev environment, or use structured logging in production)
  console.error(`[Error] ${req.method} ${req.url} - Status: ${statusCode} - Msg: ${message}`);
  if (statusCode === 500) {
    console.error(err.stack);
  }

  res.status(statusCode).json({
    status: "error",
    statusCode,
    message: statusCode === 500 && process.env.NODE_ENV === "production" ? "Internal Server Error" : message,
    ...(details && { errors: details }),
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
};
