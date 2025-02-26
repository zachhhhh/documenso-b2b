import { prisma } from '@documenso/prisma';
import { TRPCError } from '@trpc/server';

/**
 * Service for managing document locking to prevent concurrent modifications.
 */
export class DocumentLockService {
  /**
   * Lock a document for signing or editing.
   */
  async lockDocument(documentId: number, userId: number, lockDurationMinutes = 15) {
    // Check if the document exists and the user has access to it
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
          {
            recipients: {
              some: {
                email: {
                  equals: await this.getUserEmail(userId),
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
        message: 'Document not found or you do not have permission to lock it',
      });
    }
    
    // Check if the document is already locked by someone else
    if (document.isLocked && document.lockedByUserId !== userId && document.lockExpiresAt && document.lockExpiresAt > new Date()) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Document is already locked by another user',
      });
    }
    
    // Calculate lock expiry time
    const lockExpiry = new Date();
    lockExpiry.setMinutes(lockExpiry.getMinutes() + lockDurationMinutes);
    
    // Lock the document
    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        isLocked: true,
        lockedByUserId: userId,
        lockExpiresAt: lockExpiry,
      },
    });
    
    // Log the lock action
    await prisma.documentAuditLog.create({
      data: {
        documentId,
        userId,
        type: 'DOCUMENT_LOCKED',
        data: JSON.stringify({
          expiresAt: lockExpiry.toISOString(),
        }),
      },
    });
    
    return updatedDocument;
  }
  
  /**
   * Extend the lock on a document.
   */
  async extendLock(documentId: number, userId: number, lockDurationMinutes = 15) {
    // Check if the document is locked by the user
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        isLocked: true,
        lockedByUserId: userId,
      },
    });
    
    if (!document) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Document not found or not locked by you',
      });
    }
    
    // Calculate new lock expiry time
    const lockExpiry = new Date();
    lockExpiry.setMinutes(lockExpiry.getMinutes() + lockDurationMinutes);
    
    // Extend the lock
    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        lockExpiresAt: lockExpiry,
      },
    });
    
    // Log the lock extension
    await prisma.documentAuditLog.create({
      data: {
        documentId,
        userId,
        type: 'DOCUMENT_LOCK_EXTENDED',
        data: JSON.stringify({
          expiresAt: lockExpiry.toISOString(),
        }),
      },
    });
    
    return updatedDocument;
  }
  
  /**
   * Unlock a document.
   */
  async unlockDocument(documentId: number, userId: number) {
    // Check if the document is locked by the user
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        isLocked: true,
        lockedByUserId: userId,
      },
    });
    
    if (!document) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Document not found or not locked by you',
      });
    }
    
    // Unlock the document
    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        isLocked: false,
        lockedByUserId: null,
        lockExpiresAt: null,
      },
    });
    
    // Log the unlock action
    await prisma.documentAuditLog.create({
      data: {
        documentId,
        userId,
        type: 'DOCUMENT_UNLOCKED',
      },
    });
    
    return updatedDocument;
  }
  
  /**
   * Force unlock a document (admin only).
   */
  async forceUnlockDocument(documentId: number, adminUserId: number) {
    // Check if the user is an admin
    const isAdmin = await this.isUserAdmin(adminUserId);
    
    if (!isAdmin) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only administrators can force unlock documents',
      });
    }
    
    // Force unlock the document
    const updatedDocument = await prisma.document.update({
      where: { id: documentId },
      data: {
        isLocked: false,
        lockedByUserId: null,
        lockExpiresAt: null,
      },
    });
    
    // Log the force unlock action
    await prisma.documentAuditLog.create({
      data: {
        documentId,
        userId: adminUserId,
        type: 'DOCUMENT_FORCE_UNLOCKED',
      },
    });
    
    return updatedDocument;
  }
  
  /**
   * Clean up expired locks.
   */
  async cleanupExpiredLocks() {
    const now = new Date();
    
    // Find all documents with expired locks
    const expiredLocks = await prisma.document.findMany({
      where: {
        isLocked: true,
        lockExpiresAt: {
          lt: now,
        },
      },
    });
    
    if (expiredLocks.length === 0) {
      return { success: true, count: 0 };
    }
    
    // Unlock all documents with expired locks
    await prisma.document.updateMany({
      where: {
        id: {
          in: expiredLocks.map((doc) => doc.id),
        },
      },
      data: {
        isLocked: false,
        lockedByUserId: null,
        lockExpiresAt: null,
      },
    });
    
    // Log the cleanup action for each document
    await Promise.all(
      expiredLocks.map((doc) =>
        prisma.documentAuditLog.create({
          data: {
            documentId: doc.id,
            type: 'DOCUMENT_LOCK_EXPIRED',
          },
        })
      )
    );
    
    return { success: true, count: expiredLocks.length };
  }
  
  /**
   * Check if a document is locked.
   */
  async isDocumentLocked(documentId: number): Promise<boolean> {
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      select: { isLocked: true, lockExpiresAt: true },
    });
    
    if (!document) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Document not found',
      });
    }
    
    // Document is considered locked if isLocked is true and lockExpiresAt is in the future
    return document.isLocked && document.lockExpiresAt ? document.lockExpiresAt > new Date() : false;
  }
  
  /**
   * Get user email by ID.
   */
  private async getUserEmail(userId: number): Promise<string> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    
    return user?.email || '';
  }
  
  /**
   * Check if a user is an admin.
   */
  private async isUserAdmin(userId: number): Promise<boolean> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { roles: true },
    });
    
    return user?.roles.includes('ADMIN') || false;
  }
}
