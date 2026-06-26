import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UsersRepository } from './users.repository';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly users: UsersRepository,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return (await this.users.list()).rows;
  }

  create(dto: CreateUserDto) {
    return this.users.create(dto);
  }

  async retrieve(id: string) {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async update(id: string, dto: UpdateUserDto, actorId: string) {
    const oldUser = await this.retrieve(id);
    const updatedUser = await this.users.update(id, dto);
    await this.audit.logAction(actorId, 'UPDATE_USER', 'users', id, oldUser, updatedUser);
    return updatedUser;
  }

  async listRoles() {
    return this.users.listRoles();
  }
}

