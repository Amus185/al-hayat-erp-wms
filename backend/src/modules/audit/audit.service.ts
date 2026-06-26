import { Injectable } from '@nestjs/common';
import { AuditRepository } from './audit.repository';

@Injectable()
export class AuditService {
  constructor(private readonly audit: AuditRepository) {}

  async search(entityType?: string) {
    return (await this.audit.search(entityType)).rows;
  }

  async record(actorUserId: string | null, action: string, entityType: string, entityId: string | null, newValue: unknown) {
    return (await this.audit.create(actorUserId, action, entityType, entityId, undefined, newValue)).rows[0];
  }

  async logAction(
    userId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    oldValues?: Record<string, unknown>,
    newValues?: Record<string, unknown>,
    ipAddress?: string
  ) {
    return (await this.audit.create(userId, action, entityType, entityId, oldValues, newValues, ipAddress)).rows[0];
  }

  async findPaginated(filters: {
    action?: string;
    entityType?: string;
    userId?: string;
    startDate?: string;
    endDate?: string;
    page?: number;
    pageSize?: number;
  }) {
    return this.audit.findPaginated(filters);
  }
}


