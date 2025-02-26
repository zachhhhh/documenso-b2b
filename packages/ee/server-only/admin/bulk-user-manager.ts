import { prisma } from '@documenso/prisma';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { hash } from 'bcrypt';

// Define schema for bulk user import
const BulkUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(['USER', 'ADMIN']).optional().default('USER'),
  teamId: z.number().optional(),
});

type BulkUserInput = z.infer<typeof BulkUserSchema>;

interface BulkUserResult {
  success: boolean;
  email: string;
  message?: string;
  userId?: number;
}

/**
 * Service for bulk user management in enterprise environments.
 */
export class BulkUserManager {
  /**
   * Process a CSV file for bulk user import.
   */
  async processCSV(csvContent: string): Promise<BulkUserResult[]> {
    const lines = csvContent.split('\n');
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    
    const results: BulkUserResult[] = [];
    
    // Process each line (skip header)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const values = line.split(',').map(v => v.trim());
      const userData: Record<string, string> = {};
      
      // Map CSV columns to user data
      headers.forEach((header, index) => {
        if (values[index]) {
          userData[header] = values[index];
        }
      });
      
      try {
        // Validate user data
        const parsedUser = BulkUserSchema.parse({
          email: userData.email,
          name: userData.name,
          role: userData.role?.toUpperCase() as 'USER' | 'ADMIN',
          teamId: userData.teamid ? parseInt(userData.teamid) : undefined,
        });
        
        // Create or update user
        const result = await this.createOrUpdateUser(parsedUser);
        results.push(result);
      } catch (error) {
        results.push({
          success: false,
          email: userData.email || `Row ${i}`,
          message: error instanceof Error ? error.message : 'Invalid user data',
        });
      }
    }
    
    return results;
  }
  
  /**
   * Create or update a single user.
   */
  async createOrUpdateUser(userData: BulkUserInput): Promise<BulkUserResult> {
    try {
      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { email: userData.email },
      });
      
      if (existingUser) {
        // Update existing user
        const updatedUser = await prisma.user.update({
          where: { id: existingUser.id },
          data: {
            name: userData.name,
            roles: [userData.role],
          },
        });
        
        // Handle team assignment if provided
        if (userData.teamId) {
          await this.assignUserToTeam(updatedUser.id, userData.teamId);
        }
        
        return {
          success: true,
          email: updatedUser.email,
          userId: updatedUser.id,
          message: 'User updated successfully',
        };
      } else {
        // Generate a temporary password
        const tempPassword = Math.random().toString(36).slice(-8);
        const hashedPassword = await hash(tempPassword, 10);
        
        // Create new user
        const newUser = await prisma.user.create({
          data: {
            email: userData.email,
            name: userData.name,
            password: hashedPassword,
            roles: [userData.role],
          },
        });
        
        // Handle team assignment if provided
        if (userData.teamId) {
          await this.assignUserToTeam(newUser.id, userData.teamId);
        }
        
        // In a real implementation, send an email with the temporary password
        console.log(`Created user ${newUser.email} with temporary password: ${tempPassword}`);
        
        return {
          success: true,
          email: newUser.email,
          userId: newUser.id,
          message: 'User created successfully',
        };
      }
    } catch (error) {
      return {
        success: false,
        email: userData.email,
        message: error instanceof Error ? error.message : 'Failed to create/update user',
      };
    }
  }
  
  /**
   * Assign a user to a team.
   */
  private async assignUserToTeam(userId: number, teamId: number) {
    // Check if team exists
    const team = await prisma.team.findUnique({
      where: { id: teamId },
    });
    
    if (!team) {
      throw new Error(`Team with ID ${teamId} not found`);
    }
    
    // Check if user is already a member of the team
    const existingMembership = await prisma.teamMember.findFirst({
      where: {
        userId,
        teamId,
      },
    });
    
    if (!existingMembership) {
      // Add user to team
      await prisma.teamMember.create({
        data: {
          userId,
          teamId,
          role: 'MEMBER',
        },
      });
    }
  }
  
  /**
   * Remove users in bulk.
   */
  async removeUsers(userIds: number[]) {
    const results = await Promise.all(
      userIds.map(async (userId) => {
        try {
          const user = await prisma.user.findUnique({
            where: { id: userId },
          });
          
          if (!user) {
            return {
              success: false,
              userId,
              message: 'User not found',
            };
          }
          
          // Soft delete by disabling the user
          await prisma.user.update({
            where: { id: userId },
            data: { disabled: true },
          });
          
          return {
            success: true,
            userId,
            email: user.email,
            message: 'User disabled successfully',
          };
        } catch (error) {
          return {
            success: false,
            userId,
            message: error instanceof Error ? error.message : 'Failed to remove user',
          };
        }
      })
    );
    
    return results;
  }
}
