import { prisma } from '@documenso/prisma';
import { FormFieldType } from '@documenso/prisma/client';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';

// Define schema for form field creation
const FormFieldSchema = z.object({
  type: z.nativeEnum(FormFieldType),
  label: z.string().min(1),
  placeholder: z.string().optional(),
  helpText: z.string().optional(),
  isRequired: z.boolean().default(false),
  defaultValue: z.string().optional(),
  validationRules: z.string().optional(), // JSON string
  options: z.string().optional(), // JSON string for select/radio options
  order: z.number().default(0),
});

type FormFieldInput = z.infer<typeof FormFieldSchema>;

// Define schema for form creation
const DynamicFormSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  templateId: z.number().optional(),
  accessControl: z.string().optional(), // JSON string
  expiresAt: z.date().optional(),
  customSlug: z.string().optional(),
  redirectUrl: z.string().optional(),
  fields: z.array(FormFieldSchema),
});

type DynamicFormInput = z.infer<typeof DynamicFormSchema>;

/**
 * Service for managing dynamic forms (PowerForms equivalent).
 */
export class DynamicFormService {
  /**
   * Create a new dynamic form.
   */
  async createForm(userId: number, teamId: number | null, data: DynamicFormInput) {
    // Validate the form data
    const validatedData = DynamicFormSchema.parse(data);
    
    // Create the form
    const form = await prisma.dynamicForm.create({
      data: {
        title: validatedData.title,
        description: validatedData.description,
        userId,
        teamId,
        templateId: validatedData.templateId,
        accessControl: validatedData.accessControl,
        expiresAt: validatedData.expiresAt,
        customSlug: validatedData.customSlug,
        redirectUrl: validatedData.redirectUrl,
      },
    });
    
    // Create the form fields
    const fields = await Promise.all(
      validatedData.fields.map(async (field) => {
        return prisma.formField.create({
          data: {
            formId: form.id,
            type: field.type,
            label: field.label,
            placeholder: field.placeholder,
            helpText: field.helpText,
            isRequired: field.isRequired,
            defaultValue: field.defaultValue,
            validationRules: field.validationRules,
            options: field.options,
            order: field.order,
          },
        });
      })
    );
    
    return { form, fields };
  }
  
  /**
   * Get a form by ID.
   */
  async getFormById(formId: number) {
    const form = await prisma.dynamicForm.findUnique({
      where: { id: formId },
      include: {
        fields: {
          orderBy: { order: 'asc' },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        team: {
          select: {
            id: true,
            name: true,
          },
        },
        template: true,
      },
    });
    
    if (!form) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Form not found',
      });
    }
    
    return form;
  }
  
  /**
   * Get forms by user ID.
   */
  async getFormsByUserId(userId: number) {
    return prisma.dynamicForm.findMany({
      where: { userId },
      include: {
        fields: {
          orderBy: { order: 'asc' },
        },
        _count: {
          select: {
            submissions: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  
  /**
   * Get forms by team ID.
   */
  async getFormsByTeamId(teamId: number) {
    return prisma.dynamicForm.findMany({
      where: { teamId },
      include: {
        fields: {
          orderBy: { order: 'asc' },
        },
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        _count: {
          select: {
            submissions: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
  
  /**
   * Update a form.
   */
  async updateForm(formId: number, userId: number, data: Partial<DynamicFormInput>) {
    // Check if the form exists and belongs to the user
    const form = await prisma.dynamicForm.findFirst({
      where: {
        id: formId,
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
    
    if (!form) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Form not found or you do not have permission to update it',
      });
    }
    
    // Update the form
    const updatedForm = await prisma.dynamicForm.update({
      where: { id: formId },
      data: {
        title: data.title,
        description: data.description,
        templateId: data.templateId,
        accessControl: data.accessControl,
        expiresAt: data.expiresAt,
        customSlug: data.customSlug,
        redirectUrl: data.redirectUrl,
      },
    });
    
    // Update fields if provided
    if (data.fields) {
      // Delete existing fields
      await prisma.formField.deleteMany({
        where: { formId },
      });
      
      // Create new fields
      const fields = await Promise.all(
        data.fields.map(async (field) => {
          return prisma.formField.create({
            data: {
              formId,
              type: field.type,
              label: field.label,
              placeholder: field.placeholder,
              helpText: field.helpText,
              isRequired: field.isRequired,
              defaultValue: field.defaultValue,
              validationRules: field.validationRules,
              options: field.options,
              order: field.order,
            },
          });
        })
      );
      
      return { form: updatedForm, fields };
    }
    
    return { form: updatedForm };
  }
  
  /**
   * Delete a form.
   */
  async deleteForm(formId: number, userId: number) {
    // Check if the form exists and belongs to the user
    const form = await prisma.dynamicForm.findFirst({
      where: {
        id: formId,
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
    
    if (!form) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Form not found or you do not have permission to delete it',
      });
    }
    
    // Delete the form (cascades to fields and submissions)
    await prisma.dynamicForm.delete({
      where: { id: formId },
    });
    
    return { success: true };
  }
  
  /**
   * Submit a form and create a document.
   */
  async submitForm(formId: number, data: Record<string, string>, ip?: string) {
    // Get the form with fields
    const form = await prisma.dynamicForm.findUnique({
      where: { id: formId },
      include: {
        fields: true,
        template: {
          include: {
            documentData: true,
          },
        },
      },
    });
    
    if (!form) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Form not found',
      });
    }
    
    // Check if form is published
    if (!form.isPublished) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Form is not published',
      });
    }
    
    // Check if form has expired
    if (form.expiresAt && form.expiresAt < new Date()) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Form has expired',
      });
    }
    
    // Validate required fields
    const requiredFields = form.fields.filter((field) => field.isRequired);
    for (const field of requiredFields) {
      if (!data[field.id.toString()]) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Field "${field.label}" is required`,
        });
      }
    }
    
    // Extract submitter information
    const emailField = form.fields.find((field) => field.type === FormFieldType.EMAIL);
    const nameField = form.fields.find((field) => field.label.toLowerCase().includes('name'));
    
    const submitterEmail = emailField ? data[emailField.id.toString()] : '';
    const submitterName = nameField ? data[nameField.id.toString()] : '';
    
    if (!submitterEmail) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Email is required',
      });
    }
    
    // Create a document from the template if available
    let documentId: number | undefined;
    
    if (form.template && form.templateId) {
      // Logic to create a document from the template
      // This would typically call an existing service to create a document from a template
      // For now, we'll just create a placeholder
      const document = await prisma.document.create({
        data: {
          title: `${form.title} Submission - ${submitterName || submitterEmail}`,
          userId: form.userId,
          teamId: form.teamId,
          status: 'DRAFT',
          documentDataId: form.template.documentData?.id || '',
          source: 'UPLOAD',
        },
      });
      
      documentId = document.id;
    }
    
    // Create the submission
    const submission = await prisma.formSubmission.create({
      data: {
        formId,
        documentId,
        submitterEmail,
        submitterName: submitterName || null,
        submitterIp: ip || null,
      },
    });
    
    // Create field submissions
    const fieldSubmissions = await Promise.all(
      Object.entries(data).map(async ([fieldId, value]) => {
        return prisma.formFieldSubmission.create({
          data: {
            submissionId: submission.id,
            fieldId: parseInt(fieldId),
            value,
          },
        });
      })
    );
    
    return {
      submission,
      fieldSubmissions,
      documentId,
      redirectUrl: form.redirectUrl,
    };
  }
  
  /**
   * Get form submissions.
   */
  async getFormSubmissions(formId: number, userId: number) {
    // Check if the form exists and belongs to the user
    const form = await prisma.dynamicForm.findFirst({
      where: {
        id: formId,
        OR: [
          { userId },
          {
            team: {
              members: {
                some: {
                  userId,
                  role: {
                    in: ['ADMIN', 'OWNER', 'MEMBER'],
                  },
                },
              },
            },
          },
        ],
      },
    });
    
    if (!form) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Form not found or you do not have permission to view submissions',
      });
    }
    
    // Get submissions with field values
    return prisma.formSubmission.findMany({
      where: { formId },
      include: {
        fieldSubmissions: {
          include: {
            field: true,
          },
        },
        document: {
          select: {
            id: true,
            title: true,
            status: true,
          },
        },
      },
      orderBy: { submittedAt: 'desc' },
    });
  }
  
  /**
   * Publish or unpublish a form.
   */
  async togglePublishForm(formId: number, userId: number, isPublished: boolean) {
    // Check if the form exists and belongs to the user
    const form = await prisma.dynamicForm.findFirst({
      where: {
        id: formId,
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
    
    if (!form) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Form not found or you do not have permission to publish/unpublish it',
      });
    }
    
    // Update the form
    return prisma.dynamicForm.update({
      where: { id: formId },
      data: { isPublished },
    });
  }
}
