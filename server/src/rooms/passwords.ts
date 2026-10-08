import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize("NFC"), salt, KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** Room passwords are stored only as salted scrypt hashes. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltText, keyText] = stored.split("$");
  if (scheme !== "scrypt" || !saltText || !keyText) return false;
  const expected = Buffer.from(keyText, "base64url");
  const actual = await derive(password, Buffer.from(saltText, "base64url"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
