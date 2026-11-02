import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware } from '../middleware/auth';
import { has, PERM } from '../services/privacy';
import { hasAllBranchAccess } from '../services/branch-scope';

const files = new Hono<{ Bindings: Env; Variables: { jwtPayload: any } }>();

// Auth required for all file operations
files.use('/*', authMiddleware);

files.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM files ORDER BY created_at DESC LIMIT 100').all();
  return c.json(results);
});

files.post('/', async (c) => {
  const userId = c.get('jwtPayload').sub;
  const body = await c.req.parseBody();
  const file = body['file'] as File;

  if (!file || typeof file === 'string') return c.json({ message: 'No file provided' }, 400);
  if (!c.env.STORAGE) return c.json({ message: 'File storage is not set up on this server' }, 503);
  if (file.size > 10 * 1024 * 1024) return c.json({ message: 'The file is larger than 10 MB' }, 413);

  const id = uuidv4();
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
  const objectKey = `${id}.${ext}`;

  // Upload to R2
  await c.env.STORAGE.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type }
  });

  // Save file metadata to database
  await c.env.DB.prepare(`
    INSERT INTO files (id, file_name, file_size, mime_type, object_key, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, file.name, file.size, file.type, objectKey, userId).run();

  const { results } = await c.env.DB.prepare('SELECT * FROM files WHERE id = ?').bind(id).all();
  return c.json(results[0], 201);
});

// Public download route
files.get('/:key', async (c) => {
  const key = c.req.param('key');
  // Employee files follow the employee record's privacy (Owner decision D3):
  // employment documents need payroll access, photos need employee access
  // (and, for branch-limited people, the employee must be in their branch).
  const emp = await c.env.DB.prepare(
    'SELECT branch_id, (document_key = ?) AS is_document FROM employees WHERE photo_key = ? OR document_key = ? LIMIT 1',
  ).bind(key, key, key).first() as any;
  if (emp) {
    const p = c.get('jwtPayload');
    const isDocument = emp.is_document === true || emp.is_document === 't' || emp.is_document === 1;
    const allowed = isDocument
      ? has(p, PERM.PAYROLL_VIEW)
      : has(p, 'manage_users') || has(p, PERM.EMPLOYEES_MANAGE) || has(p, PERM.PAYROLL_VIEW);
    const inBranch = hasAllBranchAccess(p) || (!!p?.branch_id && emp.branch_id === p.branch_id);
    if (!allowed || !inBranch) return c.json({ message: 'File not found' }, 404);
  }
  if (!c.env.STORAGE) return c.json({ message: 'File storage is not set up on this server' }, 503);
  const object = await c.env.STORAGE.get(key);

  if (!object) return c.json({ message: 'File not found' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);

  return new Response(object.body, { headers });
});

export default files;
