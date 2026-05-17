import { Router } from "express";
import { AuthController } from "./auth.controller";
import { validateRequest } from "../../middleware/validate";
import { registerSchema, loginSchema } from "./auth.schema";

const router = Router();
const controller = new AuthController();

// Authentication Endpoints
router.post("/register", validateRequest(registerSchema), controller.register);
router.post("/login", validateRequest(loginSchema), controller.login);
router.post("/refresh", controller.refresh);
router.post("/logout", controller.logout);

export default router;
