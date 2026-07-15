import { Hono } from 'hono';
import { Env, uuidv4 } from '../db';
import { authMiddleware } from '../middleware/auth';

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

  if (!file) return c.json({ message: 'No file provided' }, 400);

  const id = uuidv4();
  const ext = file.name.split('.').pop();
  const objectKey = `${id}.${ext}`;

  // Upload to R2
  await c.env.STORAGE.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type }
  });

  // Save metadata to D1
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
  const object = await c.env.STORAGE.get(key);

  if (!object) return c.json({ message: 'File not found' }, 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);

  return new Response(object.body, { headers });
});

export default files;
