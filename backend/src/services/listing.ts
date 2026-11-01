// One way for every list in the ERP to page, sort, search and export on the
// server, so no record is ever hidden behind a "latest 200" cap and screens
// stay fast with large data.
//
// A route opts in when the request carries ?page= (the staff app's lists).
// Without it the route keeps its old response (a plain array), which the AI
// assistant and older clients rely on.
//
//   ?page=1&pageSize=25          -> { items, total, page, pageSize, ...extra }
//   ?sort=<key>&dir=asc|desc     -> only keys the route allows (never raw SQL)
//   ?format=csv                  -> every matching row (up to EXPORT_LIMIT) as a CSV file
import type { Context } from 'hono';

export const PAGE_SIZES = [25, 50, 100];
export const EXPORT_LIMIT = 10_000;

export interface ListOptions {
  /** sort key (as sent by the client) -> SQL expression */
  sortable: Record<string, string>;
  defaultSort: string;
  defaultDir?: 'asc' | 'desc';
  /** tie-breaker so paging is stable, e.g. 'so.id' */
  tieBreaker: string;
}

export interface ListRequest {
  paged: boolean;
  csv: boolean;
  page: number;
  pageSize: number;
  offset: number;
  orderBy: string;
}

export function listRequest(c: Context, opts: ListOptions): ListRequest {
  const q = (k: string) => c.req.query(k);
  const csv = q('format') === 'csv';
  const paged = csv || q('page') !== undefined;
  const page = Math.max(1, Math.floor(Number(q('page'))) || 1);
  const size = Math.floor(Number(q('pageSize')));
  const pageSize = PAGE_SIZES.includes(size) ? size : PAGE_SIZES[0];
  const key = q('sort') && opts.sortable[q('sort') as string] ? (q('sort') as string) : opts.defaultSort;
  const dir = q('dir') === 'asc' || q('dir') === 'desc' ? q('dir') : (key === opts.defaultSort ? opts.defaultDir ?? 'desc' : 'asc');
  const orderBy = `${opts.sortable[key]} ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST, ${opts.tieBreaker} ${dir === 'asc' ? 'ASC' : 'DESC'}`;
  return { paged, csv, page, pageSize, offset: (page - 1) * pageSize, orderBy };
}

/** `%term%` for ILIKE, with LIKE wildcards in the term escaped. */
export function likeTerm(term: string): string {
  return `%${term.trim().replace(/[\\%_]/g, (m) => '\\' + m)}%`;
}

/** Inclusive date range on a timestamp column, from ?dateFrom= / ?dateTo= (YYYY-MM-DD). */
export function dateRange(c: Context, column: string, where: string[], params: unknown[]) {
  const from = c.req.query('dateFrom');
  const to = c.req.query('dateTo');
  const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  if (ok(from)) { where.push(`${column} >= ?::date`); params.push(from); }
  if (ok(to)) { where.push(`${column} < (?::date + INTERVAL '1 day')`); params.push(to); }
}

/**
 * Runs a paged list: the page of rows and the total count of everything that
 * matches (one query, COUNT(*) OVER ()). `base` is everything after SELECT
 * columns: "FROM … WHERE …" (without ORDER BY / LIMIT); `withSql` an optional
 * leading "WITH …" whose placeholders come first in `params`.
 */
export async function pagedRows(db: any, columns: string, base: string, params: unknown[], r: ListRequest, withSql = '') {
  const limit = r.csv ? EXPORT_LIMIT : r.pageSize;
  const offset = r.csv ? 0 : r.offset;
  const { results } = await db.prepare(
    `${withSql} SELECT ${columns}, COUNT(*) OVER () AS __total ${base} ORDER BY ${r.orderBy} LIMIT ? OFFSET ?`,
  ).bind(...params, limit, offset).all();
  const rows = (results || []) as any[];
  let total = rows.length ? Number(rows[0].__total) : 0;
  if (!rows.length && offset > 0) {
    // past the last page: still report the real total
    const cnt = await db.prepare(`${withSql} SELECT COUNT(*) AS n ${base}`).bind(...params).first() as any;
    total = Number(cnt?.n || 0);
  }
  for (const row of rows) delete row.__total;
  return { rows, total };
}

/** Exporting lists is limited to administrators and people with report access. */
export function canExport(c: Context): boolean {
  const p = (c as any).get('jwtPayload');
  return !!p && (p.role === 'admin' || p.permissions?.includes('view_reports') || p.permissions?.includes('*'));
}

export interface CsvColumn<T> { label: string; value: (row: T) => unknown }

/** A CSV file (UTF-8 with BOM so Excel shows Somali/Arabic text correctly). */
export function csvResponse<T>(c: Context, filename: string, columns: CsvColumn<T>[], rows: T[]): Response {
  if (!canExport(c)) return c.json({ message: 'Exporting is limited to administrators and people with report access.' }, 403);
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = v instanceof Date ? v.toISOString() : String(v);
    // Never let a cell start a spreadsheet formula (CSV injection).
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((col) => cell(col.label)).join(','), ...rows.map((r) => columns.map((col) => cell(col.value(r))).join(','))];
  const safe = filename.replace(/[^a-z0-9_-]+/gi, '-');
  return new Response('﻿' + lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safe}-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}

/** The paged JSON answer. */
export function pagedResponse(c: Context, r: ListRequest, rows: unknown[], total: number, extra: Record<string, unknown> = {}) {
  return c.json({ items: rows, total, page: r.page, pageSize: r.pageSize, ...extra });
}
