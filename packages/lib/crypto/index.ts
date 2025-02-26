import crypto from 'crypto';

// Environment variables for encryption
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'default-encryption-key-32-characters';
const ENCRYPTION_IV_LENGTH = 16; // For AES, this is always 16 bytes
const ENCRYPTION_ALGORITHM = 'aes-256-cbc';

/**
 * Encrypt a string using AES-256-CBC.
 * 
 * @param text The plain text to encrypt
 * @returns The encrypted text as a base64 string with IV prepended
 */
export function encrypt(text: string): string {
  // Generate a random initialization vector
  const iv = crypto.randomBytes(ENCRYPTION_IV_LENGTH);
  
  // Create cipher with key and iv
  const cipher = crypto.createCipheriv(
    ENCRYPTION_ALGORITHM,
    Buffer.from(ENCRYPTION_KEY),
    iv
  );
  
  // Encrypt the text
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  // Prepend the IV to the encrypted text (IV is needed for decryption)
  return iv.toString('hex') + ':' + encrypted;
}

/**
 * Decrypt a string that was encrypted using the encrypt function.
 * 
 * @param encryptedText The encrypted text with IV prepended
 * @returns The decrypted plain text
 */
export function decrypt(encryptedText: string): string {
  // Split the encrypted text to get the IV and the actual encrypted data
  const textParts = encryptedText.split(':');
  
  if (textParts.length !== 2) {
    throw new Error('Invalid encrypted text format');
  }
  
  const iv = Buffer.from(textParts[0], 'hex');
  const encryptedData = textParts[1];
  
  // Create decipher with key and iv
  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    Buffer.from(ENCRYPTION_KEY),
    iv
  );
  
  // Decrypt the text
  let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

/**
 * Hash a string using SHA-256.
 * 
 * @param text The text to hash
 * @returns The hashed text as a hex string
 */
export function hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Generate a secure random token.
 * 
 * @param length The length of the token in bytes (default: 32)
 * @returns The random token as a hex string
 */
export function generateToken(length = 32): string {
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Create an HMAC signature for data.
 * 
 * @param data The data to sign
 * @param secret The secret key for the HMAC
 * @returns The HMAC signature as a hex string
 */
export function createHmacSignature(data: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
}

/**
 * Verify an HMAC signature.
 * 
 * @param data The data that was signed
 * @param signature The signature to verify
 * @param secret The secret key for the HMAC
 * @returns True if the signature is valid, false otherwise
 */
export function verifyHmacSignature(data: string, signature: string, secret: string): boolean {
  const expectedSignature = createHmacSignature(data, secret);
  return crypto.timingSafeEqual(
    Buffer.from(signature, 'hex'),
    Buffer.from(expectedSignature, 'hex')
  );
}

/**
 * Generate a secure password hash using bcrypt.
 * 
 * @param password The password to hash
 * @returns The hashed password
 */
export async function hashPassword(password: string): Promise<string> {
  const bcrypt = require('bcryptjs');
  const saltRounds = 10;
  return bcrypt.hash(password, saltRounds);
}

/**
 * Verify a password against a bcrypt hash.
 * 
 * @param password The password to verify
 * @param hash The hash to verify against
 * @returns True if the password matches the hash, false otherwise
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  const bcrypt = require('bcryptjs');
  return bcrypt.compare(password, hash);
}
