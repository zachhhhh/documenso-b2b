import { prisma } from '@documenso/prisma';
import { TRPCError } from '@trpc/server';
import { createHash } from 'crypto';

/**
 * Enhanced audit trail service for compliance requirements.
 * Provides detailed audit logging with tamper-evident records.
 */
export class EnhancedAuditService {
  /**
   * Log a document event with detailed information.
   */
  async logDocumentEvent({
    documentId,
    userId,
    recipientId,
    eventType,
    data,
    ip,
    userAgent,
  }: {
    documentId: number;
    userId?: number;
    recipientId?: number;
    eventType: string;
    data?: Record<string, any>;
    ip?: string;
    userAgent?: string;
  }) {
    // Get previous audit entry for hash chaining
    const previousEntry = await prisma.documentAuditLog.findFirst({
      where: { documentId },
      orderBy: { createdAt: 'desc' },
    });
    
    const timestamp = new Date();
    
    // Create a hash of the current entry that includes the previous hash
    // This creates a tamper-evident chain
    const entryData = {
      documentId,
      userId,
      recipientId,
      eventType,
      data: data ? JSON.stringify(data) : null,
      timestamp: timestamp.toISOString(),
      ip,
      userAgent,
      previousHash: previousEntry?.hash || '',
    };
    
    const hash = this.createEntryHash(entryData);
    
    // Create the audit log entry
    const auditLog = await prisma.documentAuditLog.create({
      data: {
        documentId,
        userId,
        recipientId,
        type: eventType,
        data: data ? JSON.stringify(data) : null,
        ip,
        userAgent,
        hash,
      },
    });
    
    return auditLog;
  }
  
  /**
   * Get the complete audit trail for a document.
   */
  async getDocumentAuditTrail(documentId: number, userId: number) {
    // Check if the user has access to the document
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        OR: [
          { userId },
          {
            team: {
              members: {
                some: {
                  userId,
                },
              },
            },
          },
        ],
      },
    });
    
    if (!document) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Document not found or you do not have permission to view its audit trail',
      });
    }
    
    // Get all audit log entries for the document
    const auditLogs = await prisma.documentAuditLog.findMany({
      where: { documentId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        recipient: {
          select: {
            id: true,
            email: true,
            name: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    
    // Verify the integrity of the audit trail
    const isValid = this.verifyAuditTrailIntegrity(auditLogs);
    
    return {
      auditLogs,
      isValid,
    };
  }
  
  /**
   * Export the audit trail as a PDF.
   */
  async exportAuditTrailAsPdf(documentId: number, userId: number) {
    // Get the audit trail
    const { auditLogs, isValid } = await this.getDocumentAuditTrail(documentId, userId);
    
    // Get the document details
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });
    
    if (!document) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Document not found',
      });
    }
    
    // In a real implementation, you would generate a PDF here
    // For now, we'll just return the data that would go into the PDF
    return {
      documentTitle: document.title,
      documentOwner: document.user?.name || document.user?.email || 'Unknown',
      auditTrailValid: isValid,
      events: auditLogs.map((log) => ({
        timestamp: log.createdAt.toISOString(),
        eventType: log.type,
        user: log.user?.name || log.user?.email || 'System',
        recipient: log.recipient?.email || 'N/A',
        ip: log.ip || 'N/A',
        userAgent: log.userAgent || 'N/A',
        data: log.data ? JSON.parse(log.data) : null,
      })),
    };
  }
  
  /**
   * Generate a certificate of completion for a document.
   */
  async generateCompletionCertificate(documentId: number, userId: number) {
    // Check if the document is completed
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        status: 'COMPLETED',
        OR: [
          { userId },
          {
            team: {
              members: {
                some: {
                  userId,
                },
              },
            },
          },
        ],
      },
      include: {
        recipients: true,
        user: {
          select: {
            name: true,
            email: true,
          },
        },
      },
    });
    
    if (!document) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Completed document not found or you do not have permission to generate a certificate',
      });
    }
    
    // Get the audit trail to verify completion events
    const { auditLogs, isValid } = await this.getDocumentAuditTrail(documentId, userId);
    
    if (!isValid) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot generate certificate: audit trail integrity check failed',
      });
    }
    
    // Get completion events for each recipient
    const completionEvents = auditLogs.filter((log) => log.type === 'COMPLETED_SIGNING');
    
    // In a real implementation, you would generate a PDF certificate here
    // For now, we'll just return the data that would go into the certificate
    return {
      documentId,
      documentTitle: document.title,
      documentOwner: document.user?.name || document.user?.email || 'Unknown',
      completedAt: document.completedAt?.toISOString() || new Date().toISOString(),
      recipients: document.recipients.map((recipient) => {
        const completionEvent = completionEvents.find((event) => event.recipientId === recipient.id);
        return {
          name: recipient.name || recipient.email,
          email: recipient.email,
          completedAt: completionEvent?.createdAt.toISOString() || 'N/A',
          ip: completionEvent?.ip || 'N/A',
        };
      }),
      certificateId: this.generateCertificateId(document),
    };
  }
  
  /**
   * Create a hash for an audit entry.
   */
  private createEntryHash(entryData: Record<string, any>): string {
    const dataString = JSON.stringify(entryData);
    return createHash('sha256').update(dataString).digest('hex');
  }
  
  /**
   * Verify the integrity of the audit trail.
   */
  private verifyAuditTrailIntegrity(auditLogs: any[]): boolean {
    if (auditLogs.length === 0) return true;
    
    let previousHash = '';
    
    for (const log of auditLogs) {
      // Reconstruct the data that was hashed
      const entryData = {
        documentId: log.documentId,
        userId: log.userId,
        recipientId: log.recipientId,
        eventType: log.type,
        data: log.data,
        timestamp: log.createdAt.toISOString(),
        ip: log.ip,
        userAgent: log.userAgent,
        previousHash,
      };
      
      // Calculate the hash
      const calculatedHash = this.createEntryHash(entryData);
      
      // Compare with the stored hash
      if (log.hash !== calculatedHash) {
        return false;
      }
      
      // Update previous hash for the next iteration
      previousHash = log.hash;
    }
    
    return true;
  }
  
  /**
   * Generate a unique certificate ID.
   */
  private generateCertificateId(document: any): string {
    const baseString = `${document.id}-${document.title}-${document.completedAt?.toISOString() || new Date().toISOString()}`;
    return createHash('sha256').update(baseString).digest('hex').substring(0, 16);
  }
}
