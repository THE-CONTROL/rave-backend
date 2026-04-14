// src/utils/jwt.ts
import jwt from "jsonwebtoken";
import { config } from "../config";
import { TokenPayload, TokenPair } from "../types";
import { Role } from "@prisma/client";

export const signAccessToken = (payload: Omit<TokenPayload, "iat" | "exp">): string =>
  jwt.sign(payload, config.jwt.accessSecret, {
    expiresIn: config.jwt.accessExpiresIn as jwt.SignOptions["expiresIn"],
  });

export const signRefreshToken = (payload: Omit<TokenPayload, "iat" | "exp">): string =>
  jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn as jwt.SignOptions["expiresIn"],
  });

export const verifyAccessToken = (token: string): TokenPayload =>
  jwt.verify(token, config.jwt.accessSecret) as TokenPayload;

export const verifyRefreshToken = (token: string): TokenPayload =>
  jwt.verify(token, config.jwt.refreshSecret) as TokenPayload;

export const issueTokenPair = (
  userId: string,
  role: Role,
  email: string,
): TokenPair => {
  const payload: Omit<TokenPayload, "iat" | "exp"> = {
    sub: userId,
    role,
    email,
  };

  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);

  // Decode to get the actual expiry set by jsonwebtoken
  const decoded = jwt.decode(accessToken) as TokenPayload;

  return {
    accessToken,
    refreshToken,
    expiresAt: decoded.exp ?? Math.floor(Date.now() / 1000) + 900,
  };
};
