import { Injectable } from '@nestjs/common';
import { RealtimeService } from '../../realtime/realtime.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransfersRepository } from './transfers.repository';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class TransfersService {
  constructor(
    private readonly transfers: TransfersRepository,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return (await this.transfers.list()).rows;
  }

  async findById(id: string) {
    return (await this.transfers.findById(id)).rows[0];
  }

  async create(dto: CreateTransferDto, userId: string) {
    const transfer = await this.transfers.create(dto, userId);
    await this.audit.logAction(userId, 'CREATE_TRANSFER', 'transfers', transfer.id, undefined, transfer);

    this.realtime.emitTransferCreated({
      transferId: transfer.id,
      transferNumber: transfer.transfer_number as string,
      status: transfer.status as string,
      sourceWarehouseId: transfer.source_warehouse_id as string | undefined,
      sourceBranchId: transfer.source_branch_id as string | undefined,
      destinationWarehouseId: transfer.destination_warehouse_id as string | undefined,
      destinationBranchId: transfer.destination_branch_id as string | undefined,
      requestedBy: userId,
    });

    return transfer;
  }

  async approve(id: string, userId: string) {
    const transfer = (await this.transfers.setStatus(id, 'APPROVED', 'approved_by', 'approved_at', userId)).rows[0];
    await this.audit.logAction(userId, 'APPROVE_TRANSFER', 'transfers', transfer.id, undefined, transfer);

    this.realtime.emitTransferStatusChanged({
      transferId: transfer.id,
      transferNumber: transfer.transfer_number as string,
      status: 'APPROVED',
      sourceWarehouseId: transfer.source_warehouse_id as string | undefined,
      sourceBranchId: transfer.source_branch_id as string | undefined,
      destinationWarehouseId: transfer.destination_warehouse_id as string | undefined,
      destinationBranchId: transfer.destination_branch_id as string | undefined,
    });

    return transfer;
  }

  async reject(id: string, userId: string) {
    const transfer = (await this.transfers.setStatus(id, 'REJECTED', 'approved_by', 'approved_at', userId)).rows[0];
    await this.audit.logAction(userId, 'REJECT_TRANSFER', 'transfers', transfer.id, undefined, transfer);

    this.realtime.emitTransferStatusChanged({
      transferId: transfer.id,
      transferNumber: transfer.transfer_number as string,
      status: 'REJECTED',
      sourceWarehouseId: transfer.source_warehouse_id as string | undefined,
      sourceBranchId: transfer.source_branch_id as string | undefined,
      destinationWarehouseId: transfer.destination_warehouse_id as string | undefined,
      destinationBranchId: transfer.destination_branch_id as string | undefined,
    });

    return transfer;
  }

  async dispatch(id: string, userId: string) {
    const transfer = await this.transfers.dispatch(id, userId);
    await this.audit.logAction(userId, 'DISPATCH_TRANSFER', 'transfers', transfer.id, undefined, transfer);

    this.realtime.emitTransferStatusChanged({
      transferId: transfer.id,
      transferNumber: transfer.transfer_number as string,
      status: 'DISPATCHED',
      sourceWarehouseId: transfer.source_warehouse_id as string | undefined,
      sourceBranchId: transfer.source_branch_id as string | undefined,
      destinationWarehouseId: transfer.destination_warehouse_id as string | undefined,
      destinationBranchId: transfer.destination_branch_id as string | undefined,
    });

    return transfer;
  }

  async receive(id: string, userId: string) {
    const transfer = await this.transfers.receive(id, userId);
    await this.audit.logAction(userId, 'RECEIVE_TRANSFER', 'transfers', transfer.id, undefined, transfer);

    this.realtime.emitTransferStatusChanged({
      transferId: transfer.id,
      transferNumber: transfer.transfer_number as string,
      status: 'RECEIVED',
      sourceWarehouseId: transfer.source_warehouse_id as string | undefined,
      sourceBranchId: transfer.source_branch_id as string | undefined,
      destinationWarehouseId: transfer.destination_warehouse_id as string | undefined,
      destinationBranchId: transfer.destination_branch_id as string | undefined,
    });

    return transfer;
  }
}
