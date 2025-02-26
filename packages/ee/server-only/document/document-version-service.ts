import { prisma } from '@documenso/prisma';
import { TRPCError } from '@trpc/server';
import { PDFDocument } from 'pdf-lib';
import { createHash } from 'crypto';

/**
 * Service for managing document versions.
 */
export class DocumentVersionService {
  /**
   * Create a new version of a document.
   */
  async createDocumentVersion(documentId: number, userId: number, reason: string) {
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
                  role: {
                    in: ['ADMIN', 'OWNER'],
                  },
                },
              },
            },
          },
        ],
      },
      include: {
        documentData: true,
      },
    });
    
    if (!document || !document.documentData) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Document not found or you do not have permission to create a version',
      });
    }
    
    // Calculate document hash
    const documentHash = this.calculateDocumentHash(document.documentData.data);
    
    // Check if a version with this hash already exists
    const existingVersion = await prisma.documentVersion.findFirst({
      where: {
        documentId,
        hash: documentHash,
      },
    });
    
    if (existingVersion) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A version with identical content already exists',
      });
    }
    
    // Create the document version
    const version = await prisma.documentVersion.create({
      data: {
        documentId,
        createdByUserId: userId,
        documentDataId: document.documentData.id,
        versionNumber: await this.getNextVersionNumber(documentId),
        reason,
        hash: documentHash,
      },
    });
    
    // Log the version creation
    await prisma.documentAuditLog.create({
      data: {
        documentId,
        userId,
        type: 'DOCUMENT_VERSION_CREATED',
        data: JSON.stringify({
          versionId: version.id,
          versionNumber: version.versionNumber,
          reason,
        }),
      },
    });
    
    return version;
  }
  
  /**
   * Get all versions of a document.
   */
  async getDocumentVersions(documentId: number, userId: number) {
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
        ],
      },
    });
    
    if (!document) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Document not found or you do not have permission to view versions',
      });
    }
    
    // Get all versions of the document
    return prisma.documentVersion.findMany({
      where: { documentId },
      include: {
        createdByUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: { versionNumber: 'desc' },
    });
  }
  
  /**
   * Get a specific version of a document.
   */
  async getDocumentVersion(versionId: number, userId: number) {
    // Get the version with document info
    const version = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: {
        document: true,
        documentData: true,
        createdByUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
    
    if (!version) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Document version not found',
      });
    }
    
    // Check if the user has access to the document
    const hasAccess = await this.userHasAccessToDocument(version.documentId, userId);
    
    if (!hasAccess) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to view this document version',
      });
    }
    
    return version;
  }
  
  /**
   * Restore a document to a specific version.
   */
  async restoreDocumentVersion(versionId: number, userId: number) {
    // Get the version with document info
    const version = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: {
        document: true,
        documentData: true,
      },
    });
    
    if (!version || !version.documentData) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Document version not found',
      });
    }
    
    // Check if the user has permission to modify the document
    const hasPermission = await this.userCanModifyDocument(version.documentId, userId);
    
    if (!hasPermission) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to restore this document version',
      });
    }
    
    // Create a new document data entry with the version's data
    const newDocumentData = await prisma.documentData.create({
      data: {
        type: 'PDF',
        data: version.documentData.data,
      },
    });
    
    // Update the document to use the new document data
    const updatedDocument = await prisma.document.update({
      where: { id: version.documentId },
      data: {
        documentDataId: newDocumentData.id,
      },
    });
    
    // Log the version restoration
    await prisma.documentAuditLog.create({
      data: {
        documentId: version.documentId,
        userId,
        type: 'DOCUMENT_VERSION_RESTORED',
        data: JSON.stringify({
          versionId,
          versionNumber: version.versionNumber,
        }),
      },
    });
    
    return updatedDocument;
  }
  
  /**
   * Compare two document versions.
   */
  async compareDocumentVersions(versionId1: number, versionId2: number, userId: number) {
    // Get both versions
    const version1 = await prisma.documentVersion.findUnique({
      where: { id: versionId1 },
      include: {
        documentData: true,
      },
    });
    
    const version2 = await prisma.documentVersion.findUnique({
      where: { id: versionId2 },
      include: {
        documentData: true,
      },
    });
    
    if (!version1 || !version2 || !version1.documentData || !version2.documentData) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'One or both document versions not found',
      });
    }
    
    // Check if the user has access to the document
    const hasAccess = await this.userHasAccessToDocument(version1.documentId, userId);
    
    if (!hasAccess) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to compare these document versions',
      });
    }
    
    // Check if the versions belong to the same document
    if (version1.documentId !== version2.documentId) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot compare versions from different documents',
      });
    }
    
    // In a real implementation, you would perform a detailed comparison of the PDF content
    // For now, we'll just return a simple comparison based on metadata
    return {
      version1: {
        id: version1.id,
        versionNumber: version1.versionNumber,
        createdAt: version1.createdAt,
        reason: version1.reason,
        hash: version1.hash,
      },
      version2: {
        id: version2.id,
        versionNumber: version2.versionNumber,
        createdAt: version2.createdAt,
        reason: version2.reason,
        hash: version2.hash,
      },
      isDifferent: version1.hash !== version2.hash,
      // In a real implementation, you would include more detailed differences
    };
  }
  
  /**
   * Delete a document version.
   */
  async deleteDocumentVersion(versionId: number, userId: number) {
    // Get the version
    const version = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      include: {
        document: true,
      },
    });
    
    if (!version) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Document version not found',
      });
    }
    
    // Check if the user has permission to modify the document
    const hasPermission = await this.userCanModifyDocument(version.documentId, userId);
    
    if (!hasPermission) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'You do not have permission to delete this document version',
      });
    }
    
    // Delete the version
    await prisma.documentVersion.delete({
      where: { id: versionId },
    });
    
    // Log the version deletion
    await prisma.documentAuditLog.create({
      data: {
        documentId: version.documentId,
        userId,
        type: 'DOCUMENT_VERSION_DELETED',
        data: JSON.stringify({
          versionId,
          versionNumber: version.versionNumber,
        }),
      },
    });
    
    return { success: true };
  }
  
  /**
   * Get the next version number for a document.
   */
  private async getNextVersionNumber(documentId: number): Promise<number> {
    // Get the highest version number for the document
    const highestVersion = await prisma.documentVersion.findFirst({
      where: { documentId },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });
    
    return (highestVersion?.versionNumber || 0) + 1;
  }
  
  /**
   * Calculate a hash for a document.
   */
  private calculateDocumentHash(documentData: string): string {
    return createHash('sha256').update(documentData).digest('hex');
  }
  
  /**
   * Check if a user has access to a document.
   */
  private async userHasAccessToDocument(documentId: number, userId: number): Promise<boolean> {
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
    
    return !!document;
  }
  
  /**
   * Check if a user can modify a document.
   */
  private async userCanModifyDocument(documentId: number, userId: number): Promise<boolean> {
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
                  role: {
                    in: ['ADMIN', 'OWNER'],
                  },
                },
              },
            },
          },
        ],
      },
    });
    
    return !!document;
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
}
