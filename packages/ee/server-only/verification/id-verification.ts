import { prisma } from '@documenso/prisma';
import { TRPCError } from '@trpc/server';

interface VerifyIDOptions {
  recipientId: number;
  idType: 'passport' | 'driver_license' | 'national_id';
  idImageFront: string; // Base64 encoded image
  idImageBack?: string; // Base64 encoded image, optional for some ID types
}

/**
 * Service for verifying government IDs.
 * In production, this would integrate with services like Jumio, Onfido, or IDology.
 */
export class IDVerificationService {
  /**
   * Verify a government ID for a recipient.
   */
  async verifyID({ recipientId, idType, idImageFront, idImageBack }: VerifyIDOptions) {
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

    // Store verification details and set status to pending
    await prisma.signerVerification.upsert({
      where: { recipientId },
      create: {
        recipientId,
        idVerificationEnabled: true,
        idVerificationType: idType,
        idVerificationStatus: 'pending',
      },
      update: {
        idVerificationEnabled: true,
        idVerificationType: idType,
        idVerificationStatus: 'pending',
      },
    });

    // In a real implementation, this would send the ID images to a verification service
    // For demo purposes, we'll simulate a successful verification after a delay
    
    // For production, uncomment and configure:
    /*
    const verificationService = new VerificationServiceClient({
      apiKey: process.env.ID_VERIFICATION_API_KEY,
    });
    
    const result = await verificationService.verify({
      idType,
      frontImage: idImageFront,
      backImage: idImageBack,
      userData: {
        name: recipient.name,
        email: recipient.email,
      },
    });
    
    const verificationStatus = result.verified ? 'verified' : 'rejected';
    */
    
    // Simulate verification process (in real implementation, this would be handled by a webhook)
    setTimeout(async () => {
      await prisma.signerVerification.update({
        where: { recipientId },
        data: {
          idVerificationStatus: 'verified',
        },
      });
      
      // Log the verification for audit purposes
      await prisma.userSecurityAuditLog.create({
        data: {
          userId: recipient.documentId ? 
            (await prisma.document.findUnique({ where: { id: recipient.documentId } }))?.userId || 0 :
            0,
          type: 'ID_VERIFICATION',
          data: {
            recipientId,
            idType,
            verificationStatus: 'verified',
            timestamp: new Date().toISOString(),
          },
        },
      });
    }, 5000); // Simulate 5-second verification process

    return { 
      success: true, 
      status: 'pending',
      message: 'ID verification submitted and is being processed' 
    };
  }

  /**
   * Check the status of an ID verification.
   */
  async checkVerificationStatus(recipientId: number) {
    const verification = await prisma.signerVerification.findUnique({
      where: { recipientId },
    });

    if (!verification) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'No verification found for this recipient',
      });
    }

    return {
      success: true,
      status: verification.idVerificationStatus,
      type: verification.idVerificationType,
    };
  }
}
