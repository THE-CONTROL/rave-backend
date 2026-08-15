import crypto from "crypto";
import { config } from "../config";

// AES-256-GCM — authenticated encryption. Unlike the previous aes-256-cbc,
// GCM produces an auth tag that lets decrypt() detect tampering/corruption
// instead of silently returning garbage (or throwing an opaque padding
// error) for ciphertext that was modified after the fact.
const ALGO = "aes-256-gcm";
const IV_LENGTH = 16;

// Salt is sourced from config (ENCRYPTION_SALT, required in production, with
// a dev-only fallback) instead of the hardcoded literal "salt" — see
// src/config/index.ts#resolveEncryptionSalt.
const KEY = crypto.scryptSync(config.encryption.key, config.encryption.salt, 32);

/**
 * Encrypt with a random IV — the default, most-secure mode. Two encryptions
 * of the same plaintext produce different ciphertext. Use this for anything
 * that never needs to be looked up/compared by its encrypted value in the DB.
 */
export const encrypt = (text: string): string => {
  const iv = crypto.randomBytes(IV_LENGTH);
  return _encryptWithIv(text, iv);
};

/**
 * Deterministic encryption: the IV is derived from HMAC(key, plaintext), so
 * the same plaintext always encrypts to the same ciphertext. This trades a
 * small amount of confidentiality (equal inputs are visibly equal in the
 * ciphertext) for the ability to keep using plain SQL/Prisma equality —
 * `@@unique([vendorId, accountNumber])`, `findFirst({ accountNumber })`,
 * duplicate-account checks — without a schema change or a second lookup
 * column. Used specifically for BankAccount.accountNumber.
 */
export const encryptSearchable = (text: string): string => {
  const iv = crypto
    .createHmac("sha256", KEY)
    .update(text)
    .digest()
    .subarray(0, IV_LENGTH);
  return _encryptWithIv(text, iv);
};

const _encryptWithIv = (text: string, iv: Buffer): string => {
  const cipher = crypto.createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
};

export const decrypt = (payload: string): string => {
  const [ivHex, tagHex, encHex] = payload.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGO, KEY, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
};

/**
 * One-way SHA-256 hash (hex) — used for refresh tokens and, optionally, OTP
 * codes: values that are only ever looked up by exact match and never need
 * to be recovered/displayed, so a one-way hash (rather than reversible
 * encryption) is the right tool.
 */
export const sha256Hex = (value: string): string =>
  crypto.createHash("sha256").update(value).digest("hex");
