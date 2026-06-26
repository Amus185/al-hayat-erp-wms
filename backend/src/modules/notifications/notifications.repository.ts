import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class NotificationsRepository {
  constructor(private readonly db: DatabaseService) {}

  listForUser(userId: string) {
    return this.db.query(
      'SELECT id, title, body, event_type, read_at, created_at FROM notifications WHERE user_id = $1 OR user_id IS NULL ORDER BY created_at DESC LIMIT 100',
      [userId]
    );
  }

  markRead(id: string, userId: string) {
    return this.db.query(
      'UPDATE notifications SET read_at = now() WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) RETURNING *',
      [id, userId]
    );
  }

  create(title: string, body: string, eventType: string, userId?: string) {
    return this.db.query(
      'INSERT INTO notifications (user_id, title, body, event_type) VALUES ($1,$2,$3,$4) RETURNING *',
      [userId ?? null, title, body, eventType]
    );
  }
}

