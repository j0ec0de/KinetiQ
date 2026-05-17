import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import prisma from "../../prisma";
import {
  ConflictException,
  UnauthorizedException,
  NotFoundException,
} from "../../utils/errors";

export class AuthService {
  private jwtAccessSecret = process.env.JWT_ACCESS_SECRET || "access_secret";
  private jwtRefreshSecret = process.env.JWT_REFRESH_SECRET || "refresh_secret";

  /**
   * Registers a brand-new user securely, hashing their password and establishing a usage record.
   */
  async register(data: { email: string; username: string; passwordHash: string }) {
    // Check if user already exists
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email: data.email },
          { username: data.username }
        ],
      },
    });

    if (existingUser) {
      throw new ConflictException("A user with this email or username already exists");
    }

    // Hash the password with bcrypt (10 rounds)
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(data.passwordHash, saltRounds);

    // Create the user and their associated Usage tracking record inside a transaction
    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: data.email,
          username: data.username,
          passwordHash,
        },
      });

      // Create a default usage record for the user (starts with 0 generated decks/tokens)
      await tx.usage.create({
        data: {
          userId: user.id,
        },
      });

      return user;
    });

    return {
      id: newUser.id,
      email: newUser.email,
      username: newUser.username,
      role: newUser.role,
      createdAt: newUser.createdAt,
    };
  }

  /**
   * Verifies credentials, signs access tokens, and creates a database-backed session token.
   */
  async login(data: { email: string; passwordHash: string }) {
    const user = await prisma.user.findUnique({
      where: { email: data.email },
    });

    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }

    // Verify password hash
    const isPasswordValid = await bcrypt.compare(data.passwordHash, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException("Invalid email or password");
    }

    // Generate tokens
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user);

    // Persist refresh token in the Session table (valid for 7 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await prisma.session.create({
      data: {
        userId: user.id,
        refreshToken,
        expiresAt,
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
      },
      accessToken,
      refreshToken,
    };
  }

  /**
   * Refreshes access and refresh tokens. Implements secure refresh token rotation.
   */
  async refresh(oldRefreshToken: string) {
    try {
      // 1. Verify token signature
      const payload = jwt.verify(oldRefreshToken, this.jwtRefreshSecret) as {
        sub: string;
        email: string;
      };

      // 2. Fetch session from the database
      const session = await prisma.session.findFirst({
        where: {
          userId: payload.sub,
          refreshToken: oldRefreshToken,
        },
        include: { user: true },
      });

      if (!session) {
        // High-security warning: This suggests refresh token reuse or session hijack.
        // In a true production app, we would revoke all active sessions for this userId.
        await prisma.session.deleteMany({ where: { userId: payload.sub } });
        throw new UnauthorizedException("Refresh token was compromised. All sessions revoked.");
      }

      if (session.expiresAt < new Date()) {
        await prisma.session.delete({ where: { id: session.id } });
        throw new UnauthorizedException("Session has expired. Please log in again.");
      }

      // 3. Generate brand-new tokens (Rotation)
      const accessToken = this.generateAccessToken(session.user);
      const newRefreshToken = this.generateRefreshToken(session.user);

      // Rotate session: Delete old session, create a new one
      await prisma.$transaction([
        prisma.session.delete({ where: { id: session.id } }),
        prisma.session.create({
          data: {
            userId: session.user.id,
            refreshToken: newRefreshToken,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
          },
        }),
      ]);

      return {
        accessToken,
        refreshToken: newRefreshToken,
      };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedException("Invalid refresh token");
      }
      throw error;
    }
  }

  /**
   * Deletes a session upon logout to invalidate refresh abilities.
   */
  async logout(refreshToken: string) {
    const session = await prisma.session.findFirst({
      where: { refreshToken },
    });

    if (session) {
      await prisma.session.delete({ where: { id: session.id } });
    }
  }

  private generateAccessToken(user: { id: string; email: string; role: string }): string {
    return jwt.sign(
      { email: user.email, role: user.role },
      this.jwtAccessSecret,
      { subject: user.id, expiresIn: "15m" } // 15 Minutes
    );
  }

  private generateRefreshToken(user: { id: string; email: string }): string {
    return jwt.sign(
      { email: user.email },
      this.jwtRefreshSecret,
      { subject: user.id, expiresIn: "7d" } // 7 Days
    );
  }
}
