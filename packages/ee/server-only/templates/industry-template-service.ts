import { prisma } from '@documenso/prisma';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

// Define schema for industry template
const IndustryTemplateSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  industry: z.string().min(1),
  subCategory: z.string().optional(),
  tags: z.array(z.string()).optional(),
  templateId: z.number(),
});

type IndustryTemplateInput = z.infer<typeof IndustryTemplateSchema>;

/**
 * Service for managing industry-specific templates.
 */
export class IndustryTemplateService {
  /**
   * Create a new industry template.
   */
  async createIndustryTemplate(userId: number, data: IndustryTemplateInput) {
    // Validate the template data
    const validatedData = IndustryTemplateSchema.parse(data);
    
    // Check if the template exists and the user has access to it
    const template = await prisma.template.findFirst({
      where: {
        id: validatedData.templateId,
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
    
    if (!template) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Template not found or you do not have permission to use it',
      });
    }
    
    // Create the industry template
    const industryTemplate = await prisma.industryTemplate.create({
      data: {
        name: validatedData.name,
        description: validatedData.description,
        industry: validatedData.industry,
        subCategory: validatedData.subCategory,
        tags: validatedData.tags ? JSON.stringify(validatedData.tags) : null,
        templateId: validatedData.templateId,
        userId,
      },
    });
    
    return industryTemplate;
  }
  
  /**
   * Get industry templates by industry.
   */
  async getTemplatesByIndustry(industry: string) {
    return prisma.industryTemplate.findMany({
      where: {
        industry,
        isPublished: true,
      },
      include: {
        template: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  
  /**
   * Get industry templates by user.
   */
  async getTemplatesByUser(userId: number) {
    return prisma.industryTemplate.findMany({
      where: { userId },
      include: {
        template: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  
  /**
   * Update an industry template.
   */
  async updateIndustryTemplate(id: number, userId: number, data: Partial<IndustryTemplateInput>) {
    // Check if the template exists and belongs to the user
    const industryTemplate = await prisma.industryTemplate.findFirst({
      where: {
        id,
        userId,
      },
    });
    
    if (!industryTemplate) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Industry template not found or you do not have permission to update it',
      });
    }
    
    // If templateId is being updated, check if the user has access to the new template
    if (data.templateId) {
      const template = await prisma.template.findFirst({
        where: {
          id: data.templateId,
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
      
      if (!template) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Template not found or you do not have permission to use it',
        });
      }
    }
    
    // Update the industry template
    return prisma.industryTemplate.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        industry: data.industry,
        subCategory: data.subCategory,
        tags: data.tags ? JSON.stringify(data.tags) : undefined,
        templateId: data.templateId,
      },
    });
  }
  
  /**
   * Delete an industry template.
   */
  async deleteIndustryTemplate(id: number, userId: number) {
    // Check if the template exists and belongs to the user
    const industryTemplate = await prisma.industryTemplate.findFirst({
      where: {
        id,
        userId,
      },
    });
    
    if (!industryTemplate) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Industry template not found or you do not have permission to delete it',
      });
    }
    
    // Delete the industry template
    await prisma.industryTemplate.delete({
      where: { id },
    });
    
    return { success: true };
  }
  
  /**
   * Publish or unpublish an industry template.
   */
  async togglePublishTemplate(id: number, userId: number, isPublished: boolean) {
    // Check if the template exists and belongs to the user
    const industryTemplate = await prisma.industryTemplate.findFirst({
      where: {
        id,
        userId,
      },
    });
    
    if (!industryTemplate) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Industry template not found or you do not have permission to publish/unpublish it',
      });
    }
    
    // Update the industry template
    return prisma.industryTemplate.update({
      where: { id },
      data: { isPublished },
    });
  }
  
  /**
   * Search industry templates.
   */
  async searchIndustryTemplates(query: string) {
    return prisma.industryTemplate.findMany({
      where: {
        isPublished: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { industry: { contains: query, mode: 'insensitive' } },
          { subCategory: { contains: query, mode: 'insensitive' } },
        ],
      },
      include: {
        template: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  
  /**
   * Get featured industry templates.
   */
  async getFeaturedTemplates() {
    return prisma.industryTemplate.findMany({
      where: {
        isPublished: true,
        isFeatured: true,
      },
      include: {
        template: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  
  /**
   * Create a document from an industry template.
   */
  async createDocumentFromIndustryTemplate(industryTemplateId: number, userId: number) {
    // Get the industry template
    const industryTemplate = await prisma.industryTemplate.findUnique({
      where: {
        id: industryTemplateId,
        isPublished: true,
      },
      include: {
        template: {
          include: {
            documentData: true,
          },
        },
      },
    });
    
    if (!industryTemplate || !industryTemplate.template) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Industry template not found',
      });
    }
    
    // Create a document from the template
    const document = await prisma.document.create({
      data: {
        title: `${industryTemplate.name} - ${new Date().toLocaleDateString()}`,
        userId,
        status: 'DRAFT',
        documentDataId: industryTemplate.template.documentData?.id || '',
        source: 'TEMPLATE',
      },
    });
    
    // Log the document creation
    await prisma.documentAuditLog.create({
      data: {
        documentId: document.id,
        userId,
        type: 'CREATED_FROM_INDUSTRY_TEMPLATE',
        data: JSON.stringify({
          industryTemplateId,
          industryTemplateName: industryTemplate.name,
        }),
      },
    });
    
    return document;
  }
}
