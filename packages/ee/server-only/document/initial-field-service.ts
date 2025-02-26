import { prisma } from '@documenso/prisma';
import { TRPCError } from '@trpc/server';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

// Add a new field type for initials in the Field model
// This requires updating the FieldType enum in the Prisma schema

interface AddInitialFieldOptions {
  documentId: number;
  recipientId: number;
  pageNumber: number;
  positionX: number;
  positionY: number;
  width: number;
  height: number;
}

interface SignInitialFieldOptions {
  fieldId: number;
  value: string; // The initials text
}

/**
 * Service for managing initial fields in documents.
 */
export class InitialFieldService {
  /**
   * Add an initial field to a document.
   */
  async addInitialField({
    documentId,
    recipientId,
    pageNumber,
    positionX,
    positionY,
    width,
    height,
  }: AddInitialFieldOptions) {
    // Check if document exists
    const document = await prisma.document.findUnique({
      where: { id: documentId },
      include: {
        recipients: true,
      },
    });

    if (!document) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Document not found',
      });
    }

    // Check if recipient exists and is associated with the document
    const recipient = document.recipients.find((r) => r.id === recipientId);
    if (!recipient) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Recipient not found for this document',
      });
    }

    // Create the initial field
    // Note: We're assuming a new field type 'INITIAL' has been added to the FieldType enum
    const field = await prisma.field.create({
      data: {
        documentId,
        recipientId,
        type: 'INITIAL', // This requires updating the FieldType enum
        page: pageNumber,
        positionX,
        positionY,
        width,
        height,
      },
    });

    return field;
  }

  /**
   * Sign an initial field.
   */
  async signInitialField({ fieldId, value }: SignInitialFieldOptions) {
    // Check if field exists
    const field = await prisma.field.findUnique({
      where: { id: fieldId },
      include: {
        document: {
          include: {
            documentData: true,
          },
        },
        recipient: true,
      },
    });

    if (!field) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Field not found',
      });
    }

    if (field.type !== 'INITIAL') {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Field is not an initial field',
      });
    }

    // Check if the field has already been signed
    if (field.inserted) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Field has already been signed',
      });
    }

    // Get document data
    const documentData = field.document.documentData;
    if (!documentData) {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Document data not found',
      });
    }

    // Load the PDF document
    const pdfBytes = Buffer.from(documentData.data, 'base64');
    const pdfDoc = await PDFDocument.load(pdfBytes);

    // Get the page
    const page = pdfDoc.getPage(field.page - 1); // PDF pages are 0-indexed
    const { width: pageWidth, height: pageHeight } = page.getSize();

    // Calculate position (convert from relative to absolute)
    const x = field.positionX * pageWidth;
    const y = (1 - field.positionY) * pageHeight - field.height * pageHeight; // Flip Y coordinate

    // Add the initials to the PDF
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    page.drawText(value, {
      x,
      y,
      size: field.height * pageHeight * 0.8, // Scale font size to fit in the field
      font,
      color: rgb(0, 0, 0),
    });

    // Save the modified PDF
    const modifiedPdfBytes = await pdfDoc.save();
    const modifiedPdfBase64 = Buffer.from(modifiedPdfBytes).toString('base64');

    // Update document data
    await prisma.documentData.update({
      where: { id: documentData.id },
      data: {
        data: modifiedPdfBase64,
      },
    });

    // Update field as inserted
    const updatedField = await prisma.field.update({
      where: { id: fieldId },
      data: {
        inserted: true,
        customText: value,
      },
    });

    // Create a signature record
    await prisma.signature.create({
      data: {
        fieldId,
        recipientId: field.recipientId,
        signatureImageAsBase64: '', // No image for initials
        typedSignature: value,
      },
    });

    return updatedField;
  }

  /**
   * Get all initial fields for a document.
   */
  async getInitialFieldsForDocument(documentId: number) {
    return prisma.field.findMany({
      where: {
        documentId,
        type: 'INITIAL', // This requires updating the FieldType enum
      },
      include: {
        recipient: true,
      },
    });
  }

  /**
   * Get all initial fields for a recipient.
   */
  async getInitialFieldsForRecipient(documentId: number, recipientId: number) {
    return prisma.field.findMany({
      where: {
        documentId,
        recipientId,
        type: 'INITIAL', // This requires updating the FieldType enum
      },
    });
  }
}
