import { Injectable } from '@nestjs/common';
import { NotificationsRepository } from './notifications.repository';

@Injectable()
export class NotificationsService {
  constructor(private readonly notifications: NotificationsRepository) {}

  async listForUser(userId: string) {
    return (await this.notifications.listForUser(userId)).rows;
  }

  async markRead(id: string, userId: string) {
    return (await this.notifications.markRead(id, userId)).rows[0];
  }

  async create(title: string, body: string, eventType: string, userId?: string) {
    return (await this.notifications.create(title, body, eventType, userId)).rows[0];
  }
}

