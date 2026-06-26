import { Injectable, NotFoundException } from '@nestjs/common';
import { BranchesRepository } from './branches.repository';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Injectable()
export class BranchesService {
  constructor(private readonly branches: BranchesRepository) {}

  async list() {
    return (await this.branches.list()).rows;
  }

  async retrieve(id: string) {
    const result = await this.branches.findById(id);
    if (result.rowCount === 0) {
      throw new NotFoundException(`Branch with ID ${id} not found`);
    }
    return result.rows[0];
  }

  async update(id: string, dto: UpdateBranchDto) {
    const result = await this.branches.update(id, dto);
    if (result.rowCount === 0) {
      throw new NotFoundException(`Branch with ID ${id} not found`);
    }
    return result.rows[0];
  }

  async inventory(branchId: string) {
    return (await this.branches.inventory(branchId)).rows;
  }

  async performance(branchId: string) {
    return (await this.branches.performance(branchId)).rows[0];
  }
}


