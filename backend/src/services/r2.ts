// Cloudflare R2 (S3-compatible) object storage, signed with AWS Signature V4
// using node:crypto only — no SDK, so the root lockfile Railway builds from
// is untouched. Used for product photos: staff upload straight from the
// browser to R2 with a short-lived presigned PUT; the backend only signs,
// checks (HEAD) and deletes.
import { createHash, createHmac } from 'node:crypto';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
}

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export function getR2Config(): R2Config | null {
  const e = process.env;
  if (!e.R2_ACCOUNT_ID || !e.R2_ACCESS_KEY_ID || !e.R2_SECRET_ACCESS_KEY || !e.R2_BUCKET || !e.R2_PUBLIC_BASE_URL) return null;
  return {
    accountId: e.R2_ACCOUNT_ID,
    accessKeyId: e.R2_ACCESS_KEY_ID,
    secretAccessKey: e.R2_SECRET_ACCESS_KEY,
    bucket: e.R2_BUCKET,
    publicBaseUrl: e.R2_PUBLIC_BASE_URL.replace(/\/$/, ''),
  };
}

export const publicUrl = (cfg: R2Config, key: string) => `${cfg.publicBaseUrl}/${key}`;

const sha256hex = (data: string) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest();
const EMPTY_SHA256 = sha256hex('');

/** RFC 3986 encoding as SigV4 requires. */
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const encPath = (p: string) => p.split('/').map(enc).join('/');

const amzDateOf = (d: Date) => d.toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20130524T000000Z

function signingKey(secret: string, date: string, region: string, service: string) {
  return hmac(hmac(hmac(hmac('AWS4' + secret, date), region), service), 'aws4_request');
}

export interface SigV4Input {
  method: string;
  host: string;
  path: string;                       // unencoded, begins with '/'
  query?: Record<string, string>;     // extra query params (unencoded)
  headers?: Record<string, string>;   // signed headers besides host (lower-case names)
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  amzDate: string;                    // 20130524T000000Z
  expires: number;                    // seconds
  payloadHash?: string;
}

/**
 * Query-string authentication (a presigned URL). Returns the full query
 * string including X-Amz-Signature. Verified against the AWS documentation
 * example in tests/storefront.test.ts.
 */
export function sigV4QueryString(i: SigV4Input): string {
  const date = i.amzDate.slice(0, 8);
  const scope = `${date}/${i.region}/${i.service}/aws4_request`;
  const headers: Record<string, string> = { host: i.host, ...(i.headers || {}) };
  const names = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const signedHeaders = names.join(';');
  const query: Record<string, string> = {
    ...(i.query || {}),
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${i.accessKeyId}/${scope}`,
    'X-Amz-Date': i.amzDate,
    'X-Amz-Expires': String(i.expires),
    'X-Amz-SignedHeaders': signedHeaders,
  };
  const canonicalQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&');
  const canonicalHeaders = names.map((n) => `${n}:${String(headers[n]).trim()}\n`).join('');
  const canonicalRequest = [
    i.method, encPath(i.path), canonicalQuery, canonicalHeaders, signedHeaders, i.payloadHash || 'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', i.amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(i.secretAccessKey, date, i.region, i.service)).update(stringToSign).digest('hex');
  return `${canonicalQuery}&X-Amz-Signature=${signature}`;
}

const hostOf = (cfg: R2Config) => `${cfg.accountId}.r2.cloudflarestorage.com`;
const pathOf = (cfg: R2Config, key: string) => `/${cfg.bucket}/${key}`;

/**
 * Presigned PUT for one photo. Content-Type and Content-Length are part of
 * the signature, so the browser can only upload exactly the declared type and
 * size; anything else is rejected by R2.
 */
export function presignPut(cfg: R2Config, key: string, contentType: string, contentLength: number, now = new Date(), expires = 300): string {
  const qs = sigV4QueryString({
    method: 'PUT', host: hostOf(cfg), path: pathOf(cfg, key),
    headers: { 'content-type': contentType, 'content-length': String(contentLength) },
    accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey,
    region: 'auto', service: 's3', amzDate: amzDateOf(now), expires,
  });
  return `https://${hostOf(cfg)}${encPath(pathOf(cfg, key))}?${qs}`;
}

/** Header-authenticated request (HEAD / DELETE) with an empty body. */
function signedHeaderRequest(cfg: R2Config, method: string, key: string, now: Date) {
  const amzDate = amzDateOf(now);
  const date = amzDate.slice(0, 8);
  const host = hostOf(cfg);
  const scope = `${date}/auto/s3/aws4_request`;
  const headers: Record<string, string> = { host, 'x-amz-content-sha256': EMPTY_SHA256, 'x-amz-date': amzDate };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(';');
  const canonicalRequest = [
    method, encPath(pathOf(cfg, key)), '', names.map((n) => `${n}:${headers[n]}\n`).join(''), signedHeaders, EMPTY_SHA256,
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(cfg.secretAccessKey, date, 'auto', 's3')).update(stringToSign).digest('hex');
  return {
    url: `https://${host}${encPath(pathOf(cfg, key))}`,
    headers: {
      'x-amz-content-sha256': EMPTY_SHA256,
      'x-amz-date': amzDate,
      Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; headers: { get(name: string): string | null } }>;

/** Size and type of an uploaded object, or null if it does not exist. */
export async function headObject(cfg: R2Config, key: string, fetchImpl: FetchLike = fetch as any, now = new Date()) {
  const req = signedHeaderRequest(cfg, 'HEAD', key, now);
  const res = await fetchImpl(req.url, { method: 'HEAD', headers: req.headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 HEAD failed with status ${res.status}`);
  return { size: Number(res.headers.get('content-length') || 0), contentType: res.headers.get('content-type') || '' };
}

export async function deleteObject(cfg: R2Config, key: string, fetchImpl: FetchLike = fetch as any, now = new Date()) {
  const req = signedHeaderRequest(cfg, 'DELETE', key, now);
  const res = await fetchImpl(req.url, { method: 'DELETE', headers: req.headers });
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE failed with status ${res.status}`);
}
