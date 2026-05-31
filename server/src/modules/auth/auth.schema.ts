import { z } from "zod";

export const registerSchema = z.object({
  body: z.object({
    email: z.email("Invalid email address format"),
    username: z
      .string()
      .min(3, "Username must be at least 3 characters")
      .max(30, "Username cannot exceed 30 characters")
      .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain alphanumeric characters and underscores"),
    password: z.string().min(8, "Password must be at least 8 characters long"),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.email("Invalid email address format"),
    password: z.string().min(1, "Password is required"),
  }),
});
