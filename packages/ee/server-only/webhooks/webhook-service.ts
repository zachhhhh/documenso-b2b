import { prisma } from '@documenso/prisma';
import { TRPCError } from '@trpc/server';
import axios from 'axios';
import { createHmac } from 'crypto';
import { z } from 'zod';

// Define schema for webhook creation
const WebhookSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()),
  description: z.string().optional(),
  isActive: z.boolean().default(true),
  secret: z.string().optional(),
});

type WebhookInput = z.infer<typeof WebhookSchema>;

// Define webhook event types
export enum WebhookEventType {
  DOCUMENT_CREATED = 'document.created',
  DOCUMENT_UPDATED = 'document.updated',
  DOCUMENT_COMPLETED = 'document.completed',
  DOCUMENT_DELETED = 'document.deleted',
  RECIPIENT_VIEWED = 'recipient.viewed',
  RECIPIENT_COMPLETED = 'recipient.completed',
  FORM_SUBMITTED = 'form.submitted',
  USER_CREATED = 'user.created',
  USER_UPDATED = 'user.updated',
}

interface WebhookPayload {
  id: string;
  event: WebhookEventType;
  createdAt: string;
  data: Record<string, any>;
}

/**
 * Service for managing webhooks.
 */
export class WebhookService {
  /**
   * Create a new webhook.
   */
  async createWebhook(userId: number, teamId: number | null, data: WebhookInput) {
    // Validate the webhook data
    const validatedData = WebhookSchema.parse(data);
    
    // Generate a secret if not provided
    const secret = validatedData.secret || this.generateSecret();
    
    // Create the webhook
    const webhook = await prisma.webhook.create({
      data: {
        url: validatedData.url,
        events: validatedData.events,
        description: validatedData.description,
        isActive: validatedData.isActive,
        secret,
        userId,
        teamId,
      },
    });
    
    return webhook;
  }
  
  /**
   * Get webhooks by user ID.
   */
  async getWebhooksByUserId(userId: number) {
    return prisma.webhook.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }
  
  /**
   * Get webhooks by team ID.
   */
  async getWebhooksByTeamId(teamId: number) {
    return prisma.webhook.findMany({
      where: { teamId },
      orderBy: { createdAt: 'desc' },
    });
  }
  
  /**
   * Update a webhook.
   */
  async updateWebhook(webhookId: number, userId: number, data: Partial<WebhookInput>) {
    // Check if the webhook exists and belongs to the user
    const webhook = await prisma.webhook.findFirst({
      where: {
        id: webhookId,
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
    
    if (!webhook) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Webhook not found or you do not have permission to update it',
      });
    }
    
    // Update the webhook
    return prisma.webhook.update({
      where: { id: webhookId },
      data: {
        url: data.url,
        events: data.events,
        description: data.description,
        isActive: data.isActive,
        secret: data.secret,
      },
    });
  }
  
  /**
   * Delete a webhook.
   */
  async deleteWebhook(webhookId: number, userId: number) {
    // Check if the webhook exists and belongs to the user
    const webhook = await prisma.webhook.findFirst({
      where: {
        id: webhookId,
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
    
    if (!webhook) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Webhook not found or you do not have permission to delete it',
      });
    }
    
    // Delete the webhook
    await prisma.webhook.delete({
      where: { id: webhookId },
    });
    
    return { success: true };
  }
  
  /**
   * Trigger webhooks for an event.
   */
  async triggerWebhooks(event: WebhookEventType, data: Record<string, any>, teamId?: number) {
    // Find all active webhooks that are subscribed to this event
    const webhooks = await prisma.webhook.findMany({
      where: {
        isActive: true,
        events: {
          has: event,
        },
        ...(teamId ? { teamId } : {}),
      },
    });
    
    if (webhooks.length === 0) {
      return { success: true, count: 0 };
    }
    
    // Prepare the webhook payload
    const payload: WebhookPayload = {
      id: this.generateId(),
      event,
      createdAt: new Date().toISOString(),
      data,
    };
    
    // Send the webhook requests
    const results = await Promise.allSettled(
      webhooks.map(async (webhook) => {
        try {
          // Create signature
          const signature = this.createSignature(webhook.secret, JSON.stringify(payload));
          
          // Send the webhook request
          const response = await axios.post(webhook.url, payload, {
            headers: {
              'Content-Type': 'application/json',
              'X-Documenso-Signature': signature,
              'X-Documenso-Event': event,
              'X-Documenso-Delivery': payload.id,
            },
            timeout: 10000, // 10 seconds timeout
          });
          
          // Log the webhook delivery
          await this.logWebhookDelivery(webhook.id, payload.id, true, response.status, response.statusText);
          
          return {
            webhookId: webhook.id,
            success: true,
            statusCode: response.status,
          };
        } catch (error) {
          // Log the failed webhook delivery
          const statusCode = error.response?.status || 0;
          const statusText = error.response?.statusText || error.message;
          
          await this.logWebhookDelivery(webhook.id, payload.id, false, statusCode, statusText);
          
          // Add to retry queue if appropriate
          if (this.shouldRetry(statusCode)) {
            await this.addToRetryQueue(webhook.id, payload);
          }
          
          return {
            webhookId: webhook.id,
            success: false,
            statusCode,
            error: statusText,
          };
        }
      })
    );
    
    return {
      success: true,
      count: webhooks.length,
      results,
    };
  }
  
  /**
   * Log a webhook delivery.
   */
  private async logWebhookDelivery(
    webhookId: number,
    deliveryId: string,
    success: boolean,
    statusCode: number,
    statusText: string
  ) {
    return prisma.webhookDelivery.create({
      data: {
        webhookId,
        deliveryId,
        success,
        statusCode,
        statusText,
      },
    });
  }
  
  /**
   * Add a webhook to the retry queue.
   */
  private async addToRetryQueue(webhookId: number, payload: WebhookPayload) {
    return prisma.webhookRetry.create({
      data: {
        webhookId,
        payload: JSON.stringify(payload),
        nextRetryAt: this.calculateNextRetryTime(0),
        retryCount: 0,
      },
    });
  }
  
  /**
   * Process the webhook retry queue.
   */
  async processRetryQueue() {
    const now = new Date();
    
    // Find all webhooks that need to be retried
    const retries = await prisma.webhookRetry.findMany({
      where: {
        nextRetryAt: {
          lte: now,
        },
        retryCount: {
          lt: 5, // Max 5 retries
        },
      },
      include: {
        webhook: true,
      },
    });
    
    if (retries.length === 0) {
      return { success: true, count: 0 };
    }
    
    // Process each retry
    const results = await Promise.allSettled(
      retries.map(async (retry) => {
        try {
          const webhook = retry.webhook;
          
          if (!webhook || !webhook.isActive) {
            // Delete the retry if the webhook is no longer active
            await prisma.webhookRetry.delete({
              where: { id: retry.id },
            });
            
            return {
              retryId: retry.id,
              success: false,
              reason: 'Webhook no longer active',
            };
          }
          
          // Parse the payload
          const payload: WebhookPayload = JSON.parse(retry.payload);
          
          // Create signature
          const signature = this.createSignature(webhook.secret, retry.payload);
          
          // Send the webhook request
          const response = await axios.post(webhook.url, payload, {
            headers: {
              'Content-Type': 'application/json',
              'X-Documenso-Signature': signature,
              'X-Documenso-Event': payload.event,
              'X-Documenso-Delivery': payload.id,
              'X-Documenso-Retry-Count': retry.retryCount.toString(),
            },
            timeout: 10000, // 10 seconds timeout
          });
          
          // Log the webhook delivery
          await this.logWebhookDelivery(webhook.id, payload.id, true, response.status, response.statusText);
          
          // Delete the retry
          await prisma.webhookRetry.delete({
            where: { id: retry.id },
          });
          
          return {
            retryId: retry.id,
            success: true,
            statusCode: response.status,
          };
        } catch (error) {
          // Log the failed webhook delivery
          const statusCode = error.response?.status || 0;
          const statusText = error.response?.statusText || error.message;
          
          // Update the retry count and next retry time
          const newRetryCount = retry.retryCount + 1;
          
          if (newRetryCount >= 5 || !this.shouldRetry(statusCode)) {
            // Max retries reached or should not retry, delete the retry
            await prisma.webhookRetry.delete({
              where: { id: retry.id },
            });
          } else {
            // Update the retry
            await prisma.webhookRetry.update({
              where: { id: retry.id },
              data: {
                retryCount: newRetryCount,
                nextRetryAt: this.calculateNextRetryTime(newRetryCount),
                lastError: statusText,
              },
            });
          }
          
          return {
            retryId: retry.id,
            success: false,
            statusCode,
            error: statusText,
            retryCount: newRetryCount,
          };
        }
      })
    );
    
    return {
      success: true,
      count: retries.length,
      results,
    };
  }
  
  /**
   * Determine if a webhook should be retried based on the status code.
   */
  private shouldRetry(statusCode: number): boolean {
    // Retry on network errors, server errors, and some specific status codes
    return (
      statusCode === 0 || // Network error
      statusCode >= 500 || // Server error
      statusCode === 429 || // Rate limit
      statusCode === 408 // Request timeout
    );
  }
  
  /**
   * Calculate the next retry time based on the retry count.
   */
  private calculateNextRetryTime(retryCount: number): Date {
    // Exponential backoff: 1min, 5min, 15min, 30min, 60min
    const delayMinutes = [1, 5, 15, 30, 60][retryCount] || 60;
    const nextRetryAt = new Date();
    nextRetryAt.setMinutes(nextRetryAt.getMinutes() + delayMinutes);
    return nextRetryAt;
  }
  
  /**
   * Generate a random webhook secret.
   */
  private generateSecret(): string {
    return require('crypto').randomBytes(32).toString('hex');
  }
  
  /**
   * Generate a unique ID for a webhook delivery.
   */
  private generateId(): string {
    return `wh_${require('crypto').randomBytes(16).toString('hex')}`;
  }
  
  /**
   * Create a signature for a webhook payload.
   */
  private createSignature(secret: string, payload: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }
}
