import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";
import { BadRequestException } from "../utils/errors";

// 1. We add <T> to make the function generic
export const validateRequest = <T>(schema: ZodSchema<T>) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 2. TypeScript now knows 'parsed' matches the exact structure of T
      const parsed = await schema.parseAsync({
        body: req.body,
        query: req.query,
        params: req.params,
      });

      // 3. Cast to 'any' temporarily just to allow assignment back onto Express objects
      const safeParsed = parsed as any;

      req.body = safeParsed.body;
      req.params = safeParsed.params;

      if (safeParsed.query) {
        for (const key in req.query) {
          delete req.query[key];
        }
        Object.assign(req.query, safeParsed.query);
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const formattedErrors = error.issues.map((err) => ({
          field: err.path.slice(1).join("."), 
          message: err.message,
        }));
        next(new BadRequestException("Validation failed", formattedErrors));
      } else {
        next(error);
      }
    }
  };
};