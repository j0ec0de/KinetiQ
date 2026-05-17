import { Request, Response, NextFunction } from "express";

/**
 * Wraps async Express handlers to automatically forward thrown errors to the global error middleware.
 */
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
