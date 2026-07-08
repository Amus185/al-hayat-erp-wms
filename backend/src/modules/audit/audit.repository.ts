import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class AuditRepository {
  constructor(private readonly db: DatabaseService) {}

  search(entityType?: string) {
    return this.db.query(
      `SELECT a.id, a.actor_user_id AS user_id, a.action, a.entity_type, a.entity_id,
              a.old_value, a.new_value, a.ip_address, a.created_at,
              u.full_name AS actor_name, u.email AS actor_email
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE ($1::varchar IS NULL OR a.entity_type = $1)
       ORDER BY a.created_at DESC
       LIMIT 200`,
      [entityType ?? null]
    );
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
    const page = Number(filters.page ?? 1);
    const pageSize = Number(filters.pageSize ?? 10);
    const offset = (page - 1) * pageSize;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (filters.action) {
      conditions.push(`a.action = $${idx++}`);
      values.push(filters.action);
    }
    if (filters.entityType) {
      conditions.push(`a.entity_type = $${idx++}`);
      values.push(filters.entityType);
    }
    if (filters.userId) {
      conditions.push(`a.actor_user_id = $${idx++}`);
      values.push(filters.userId);
    }
    if (filters.startDate) {
      conditions.push(`a.created_at >= $${idx++}`);
      values.push(filters.startDate);
    }
    if (filters.endDate) {
      conditions.push(`a.created_at <= $${idx++}`);
      values.push(filters.endDate);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `
      SELECT COUNT(*)::int as total
      FROM audit_logs a
      ${whereClause}
    `;
    const countResult = await this.db.query<{ total: number }>(countSql, values);
    const total = countResult.rows[0]?.total ?? 0;

    const dataSql = `
      SELECT a.id, a.actor_user_id AS user_id, a.action, a.entity_type, a.entity_id,
             a.old_value, a.new_value, a.ip_address, a.created_at,
             u.full_name AS actor_name, u.email AS actor_email
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_user_id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT $${idx++} OFFSET $${idx}
    `;
    const dataValues = [...values, pageSize, offset];
    const dataResult = await this.db.query(dataSql, dataValues);

    const totalPages = Math.ceil(total / pageSize);

    return {
      data: dataResult.rows,
      total,
      page,
      pageSize,
      totalPages,
    };
  }

  create(
    actorUserId: string | null,
    action: string,
    entityType: string,
    entityId: string | null,
    oldValues?: unknown,
    newValues?: unknown,
    ipAddress?: string
  ) {
    return this.db.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, old_value, new_value, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7::inet) RETURNING *`,
      [
        actorUserId,
        action,
        entityType,
        entityId,
        oldValues ? JSON.stringify(oldValues) : null,
        newValues ? JSON.stringify(newValues) : null,
        ipAddress ?? null,
      ]
    );
  }
}


