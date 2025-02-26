import { prisma } from '@documenso/prisma';
import { TRPCError } from '@trpc/server';

interface SendSMSVerificationOptions {
  recipientId: number;
  phoneNumber: string;
}

interface VerifySMSCodeOptions {
  recipientId: number;
  code: string;
}

/**
 * Service for SMS verification of signers.
 * This would typically integrate with a service like Twilio.
 */
export class SMSVerificationService {
  private readonly VERIFICATION_CODE_EXPIRY = 10 * 60 * 1000; // 10 minutes

  /**
   * Send a verification code to the recipient's phone number.
   */
  async sendVerificationCode({ recipientId, phoneNumber }: SendSMSVerificationOptions) {
    // Check if recipient exists
    const recipient = await prisma.recipient.findUnique({
      where: { id: recipientId },
      include: { verification: true },
    });

    if (!recipient) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Recipient not found',
      });
    }

    // Generate a random 6-digit code
    const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + this.VERIFICATION_CODE_EXPIRY);

    // Store verification details
    await prisma.signerVerification.upsert({
      where: { recipientId },
      create: {
        recipientId,
        smsVerificationEnabled: true,
        smsVerificationPhone: phoneNumber,
      },
      update: {
        smsVerificationEnabled: true,
        smsVerificationPhone: phoneNumber,
      },
    });

    // Store the verification code (in a real implementation, this would be hashed)
    await prisma.$executeRaw`
      INSERT INTO "VerificationCode" ("recipientId", "code", "expiresAt")
      VALUES (${recipientId}, ${verificationCode}, ${expiresAt})
      ON CONFLICT ("recipientId") DO UPDATE
      SET "code" = ${verificationCode}, "expiresAt" = ${expiresAt}
    `;

    // In a real implementation, this would send an SMS via Twilio or similar
    console.log(`Sending verification code ${verificationCode} to ${phoneNumber}`);

    // For production, uncomment and configure:
    /*
    const twilio = new Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    await twilio.messages.create({
      body: `Your Documenso verification code is: ${verificationCode}`,
      to: phoneNumber,
      from: process.env.TWILIO_PHONE_NUMBER,
    });
    */

    return { success: true };
  }

  /**
   * Verify a code sent to the recipient.
   */
  async verifyCode({ recipientId, code }: VerifySMSCodeOptions) {
    // Get the stored verification code
    const [storedCode] = await prisma.$queryRaw<
      { code: string; expiresAt: Date }[]
    >`SELECT "code", "expiresAt" FROM "VerificationCode" WHERE "recipientId" = ${recipientId}`;

    if (!storedCode) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'No verification code found',
      });
    }

    // Check if the code has expired
    if (storedCode.expiresAt < new Date()) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Verification code has expired',
      });
    }

    // Check if the code matches
    if (storedCode.code !== code) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid verification code',
      });
    }

    // Mark the verification as complete
    await prisma.$executeRaw`DELETE FROM "VerificationCode" WHERE "recipientId" = ${recipientId}`;

    return { success: true, verified: true };
  }
}
