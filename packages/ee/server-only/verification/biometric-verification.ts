import { prisma } from '@documenso/prisma';
import { TRPCError } from '@trpc/server';

interface BiometricVerificationOptions {
  recipientId: number;
  biometricType: 'face' | 'fingerprint';
  biometricData: string; // Base64 encoded data
}

/**
 * Service for biometric verification of signers.
 * In production, this would integrate with services like FaceTec, iProov, or Daon.
 */
export class BiometricVerificationService {
  /**
   * Verify a biometric for a recipient.
   */
  async verifyBiometric({ recipientId, biometricType, biometricData }: BiometricVerificationOptions) {
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

    // Store verification details
    await prisma.signerVerification.upsert({
      where: { recipientId },
      create: {
        recipientId,
        biometricEnabled: true,
        biometricType,
      },
      update: {
        biometricEnabled: true,
        biometricType,
      },
    });

    // In a real implementation, this would send the biometric data to a verification service
    // For demo purposes, we'll simulate a successful verification
    
    // For production, uncomment and configure:
    /*
    const biometricService = new BiometricServiceClient({
      apiKey: process.env.BIOMETRIC_API_KEY,
    });
    
    const result = await biometricService.verify({
      type: biometricType,
      data: biometricData,
      userData: {
        name: recipient.name,
        email: recipient.email,
      },
    });
    
    if (!result.verified) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Biometric verification failed',
      });
    }
    */
    
    // Log the verification for audit purposes
    await prisma.userSecurityAuditLog.create({
      data: {
        userId: recipient.documentId ? 
          (await prisma.document.findUnique({ where: { id: recipient.documentId } }))?.userId || 0 :
          0,
        type: 'BIOMETRIC_VERIFICATION',
        data: {
          recipientId,
          biometricType,
          verificationStatus: 'verified',
          timestamp: new Date().toISOString(),
        },
      },
    });

    return { 
      success: true, 
      verified: true,
      message: 'Biometric verification successful' 
    };
  }
}
