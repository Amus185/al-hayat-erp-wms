import { Injectable } from '@nestjs/common';
import { hash } from 'bcrypt';
import { DatabaseService } from '../../database/database.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersRepository {
  constructor(private readonly db: DatabaseService) {}

  list() {
    return this.db.query('SELECT id, email, full_name, phone, branch_id, warehouse_id, is_active, created_at FROM users ORDER BY created_at DESC');
  }

  async create(dto: CreateUserDto) {
    return this.db.transaction(async (client) => {
      const user = await client.query(
        'INSERT INTO users (email, password_hash, full_name, branch_id, warehouse_id, phone) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, email, full_name, phone',
        [dto.email, await hash(dto.password, 12), dto.fullName, dto.branchId ?? null, dto.warehouseId ?? null, dto.phone ?? null]
      );
      for (const roleId of dto.roleIds) {
        await client.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [user.rows[0].id, roleId]);
      }
      return user.rows[0];
    });
  }

  async findById(id: string) {
    const userRes = await this.db.query(
      `SELECT id, email, full_name, phone, branch_id, warehouse_id, is_active, created_at, updated_at
       FROM users WHERE id = $1`,
      [id]
    );
    if (userRes.rowCount === 0) return null;
    
    const rolesRes = await this.db.query(
      `SELECT r.* FROM roles r
       JOIN user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = $1`,
      [id]
    );

    return {
      ...userRes.rows[0],
      roles: rolesRes.rows,
    };
  }

  async update(id: string, dto: UpdateUserDto) {
    return this.db.transaction(async (client) => {
      const fields: string[] = [];
      const values: unknown[] = [];
      let idx = 1;

      if (dto.fullName !== undefined) {
        fields.push(`full_name = $${idx++}`);
        values.push(dto.fullName);
      }
      if (dto.phone !== undefined) {
        fields.push(`phone = $${idx++}`);
        values.push(dto.phone ?? null);
      }
      if (dto.branchId !== undefined) {
        fields.push(`branch_id = $${idx++}`);
        values.push(dto.branchId ?? null);
      }
      if (dto.warehouseId !== undefined) {
        fields.push(`warehouse_id = $${idx++}`);
        values.push(dto.warehouseId ?? null);
      }
      if (dto.isActive !== undefined) {
        fields.push(`is_active = $${idx++}`);
        values.push(dto.isActive);
      }

      if (fields.length > 0) {
        fields.push(`updated_at = NOW()`);
        values.push(id);
        await client.query(
          `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}`,
          values
        );
      }

      if (dto.roleIds !== undefined) {
        await client.query('DELETE FROM user_roles WHERE user_id = $1', [id]);
        for (const roleId of dto.roleIds) {
          await client.query(
            'INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
            [id, roleId]
          );
        }
      }

      const userRes = await client.query(
        `SELECT id, email, full_name, phone, branch_id, warehouse_id, is_active, created_at, updated_at
         FROM users WHERE id = $1`,
        [id]
      );
      if (userRes.rowCount === 0) return null;

      const rolesRes = await client.query(
        `SELECT r.* FROM roles r
         JOIN user_roles ur ON ur.role_id = r.id
         WHERE ur.user_id = $1`,
        [id]
      );

      return {
        ...userRes.rows[0],
        roles: rolesRes.rows,
      };
    });
  }

  async listRoles() {
    const res = await this.db.query('SELECT id, code, name FROM roles ORDER BY name');
    return res.rows;
  }
}


