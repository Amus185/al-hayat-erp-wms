import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { CreateTransferDto } from './dto/create-transfer.dto';

@Injectable()
export class TransfersRepository {
  constructor(private readonly db: DatabaseService) {}

  list() {
    return this.db.query('SELECT * FROM transfers ORDER BY requested_at DESC LIMIT 100');
  }

  findById(id: string) {
    return this.db.query(
      `SELECT t.*, json_agg(
         json_build_object(
           'id', tl.id, 'variant_id', tl.variant_id,
           'quantity_requested', tl.quantity_requested,
           'quantity_dispatched', tl.quantity_dispatched,
           'quantity_received', tl.quantity_received
         )
       ) AS lines
       FROM transfers t
       LEFT JOIN transfer_lines tl ON tl.transfer_id = t.id
       WHERE t.id = $1
       GROUP BY t.id`,
      [id]
    );
  }

  async create(dto: CreateTransferDto, userId: string) {
    return this.db.transaction(async (client) => {
      const number = `TR-${Date.now()}`;
      const transfer = await client.query(
        `INSERT INTO transfers
         (transfer_number, status, source_owner_type, source_warehouse_id, source_branch_id, destination_owner_type, destination_warehouse_id, destination_branch_id, requested_by)
         VALUES ($1,'PENDING_APPROVAL',$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [number, dto.sourceOwnerType, dto.sourceWarehouseId ?? null, dto.sourceBranchId ?? null, dto.destinationOwnerType, dto.destinationWarehouseId ?? null, dto.destinationBranchId ?? null, userId]
      );
      for (const line of dto.lines) {
        await client.query(
          'INSERT INTO transfer_lines (transfer_id, variant_id, quantity_requested) VALUES ($1,$2,$3)',
          [transfer.rows[0].id, line.variantId, line.quantityRequested]
        );
      }
      return transfer.rows[0];
    });
  }

  setStatus(id: string, status: string, actorColumn: string, dateColumn: string, userId: string) {
    return this.db.query(
      `UPDATE transfers SET status = $1, ${actorColumn} = $2, ${dateColumn} = now() WHERE id = $3 RETURNING *`,
      [status, userId, id]
    );
  }

  async dispatch(id: string, userId: string) {
    return this.db.transaction(async (client) => {
      const transferResult = await client.query('SELECT * FROM transfers WHERE id = $1 FOR UPDATE', [id]);
      const transfer = transferResult.rows[0];
      const lines = await client.query<{ variant_id: string; quantity_requested: number }>(
        'SELECT variant_id, quantity_requested FROM transfer_lines WHERE transfer_id = $1',
        [id]
      );

      for (const line of lines.rows) {
        await client.query(
          `UPDATE inventory_stock
           SET quantity_on_hand = quantity_on_hand - $1, updated_at = now()
           WHERE variant_id = $2
             AND owner_type = $3
             AND warehouse_id IS NOT DISTINCT FROM $4
             AND branch_id IS NOT DISTINCT FROM $5`,
          [line.quantity_requested, line.variant_id, transfer.source_owner_type, transfer.source_warehouse_id, transfer.source_branch_id]
        );
        await client.query(
          `INSERT INTO inventory_transactions
           (variant_id, transaction_type, quantity, source_owner_type, source_warehouse_id, source_branch_id, reference_type, reference_id, created_by)
           VALUES ($1,'TRANSFER_OUT',$2,$3,$4,$5,'TRANSFER',$6,$7)`,
          [line.variant_id, -line.quantity_requested, transfer.source_owner_type, transfer.source_warehouse_id, transfer.source_branch_id, id, userId]
        );
        await client.query('UPDATE transfer_lines SET quantity_dispatched = quantity_requested WHERE transfer_id = $1 AND variant_id = $2', [id, line.variant_id]);
      }

      const updated = await client.query(
        "UPDATE transfers SET status = 'DISPATCHED', dispatched_by = $1, dispatched_at = now() WHERE id = $2 RETURNING *",
        [userId, id]
      );
      return updated.rows[0];
    });
  }

  async receive(id: string, userId: string) {
    return this.db.transaction(async (client) => {
      const transferResult = await client.query('SELECT * FROM transfers WHERE id = $1 FOR UPDATE', [id]);
      const transfer = transferResult.rows[0];
      const lines = await client.query<{ variant_id: string; quantity_dispatched: number }>(
        'SELECT variant_id, quantity_dispatched FROM transfer_lines WHERE transfer_id = $1',
        [id]
      );

      for (const line of lines.rows) {
        const updatedStock = await client.query(
          `UPDATE inventory_stock
           SET quantity_on_hand = quantity_on_hand + $1, updated_at = now()
           WHERE variant_id = $2
             AND owner_type = $3
             AND warehouse_id IS NOT DISTINCT FROM $4
             AND branch_id IS NOT DISTINCT FROM $5`,
          [line.quantity_dispatched, line.variant_id, transfer.destination_owner_type, transfer.destination_warehouse_id, transfer.destination_branch_id]
        );
        if (updatedStock.rowCount === 0) {
          await client.query(
            `INSERT INTO inventory_stock (variant_id, owner_type, warehouse_id, branch_id, quantity_on_hand)
             VALUES ($1,$2,$3,$4,$5)`,
            [line.variant_id, transfer.destination_owner_type, transfer.destination_warehouse_id, transfer.destination_branch_id, line.quantity_dispatched]
          );
        }
        await client.query(
          `INSERT INTO inventory_transactions
           (variant_id, transaction_type, quantity, destination_owner_type, destination_warehouse_id, destination_branch_id, reference_type, reference_id, created_by)
           VALUES ($1,'TRANSFER_IN',$2,$3,$4,$5,'TRANSFER',$6,$7)`,
          [line.variant_id, line.quantity_dispatched, transfer.destination_owner_type, transfer.destination_warehouse_id, transfer.destination_branch_id, id, userId]
        );
        await client.query('UPDATE transfer_lines SET quantity_received = quantity_dispatched WHERE transfer_id = $1 AND variant_id = $2', [id, line.variant_id]);
      }

      const updated = await client.query(
        "UPDATE transfers SET status = 'RECEIVED', received_by = $1, received_at = now() WHERE id = $2 RETURNING *",
        [userId, id]
      );
      return updated.rows[0];
    });
  }
}
