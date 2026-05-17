import { Request, Response } from "express";
import { AuthService } from "./auth.service";
import { asyncHandler } from "../../utils/asyncHandler";

const authService = new AuthService();

export class AuthController {
  /**
   * Registers a new user. Throws standard BadRequestException/ConflictException handled globally.
   */
  register = asyncHandler(async (req: Request, res: Response) => {
    const { email, username, password } = req.body;
    const user = await authService.register({
      email,
      username,
      passwordHash: password,
    });
    res.status(201).json({
      status: "success",
      message: "User registered successfully",
      data: { user },
    });
  });

  /**
   * Authenticates user, issues short-lived JWT, and writes a long-lived Session database record.
   */
  login = asyncHandler(async (req: Request, res: Response) => {
    const { email, password } = req.body;
    const result = await authService.login({
      email,
      passwordHash: password,
    });
    res.status(200).json({
      status: "success",
      message: "User logged in successfully",
      data: result,
    });
  });

  /**
   * Processes token refresh. Validates the signature, rotates the session, and issues new tokens.
   */
  refresh = asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      res.status(400).json({
        status: "error",
        message: "Refresh token is required in request body",
      });
      return;
    }
    const result = await authService.refresh(refreshToken);
    res.status(200).json({
      status: "success",
      message: "Token refreshed successfully",
      data: result,
    });
  });

  /**
   * Revokes the active refresh session from the database.
   */
  logout = asyncHandler(async (req: Request, res: Response) => {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await authService.logout(refreshToken);
    }
    res.status(200).json({
      status: "success",
      message: "Logged out successfully from session",
    });
  });
}
