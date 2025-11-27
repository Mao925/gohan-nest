import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import crypto from 'node:crypto';

const ALLOWED_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

const {
  PROFILE_IMAGE_BUCKET,
  PROFILE_IMAGE_REGION,
  PROFILE_IMAGE_ENDPOINT,
  PROFILE_IMAGE_PUBLIC_BASE_URL,
  PROFILE_IMAGE_MAX_SIZE_MB
} = process.env;

const maxSizeBytes = (Number(PROFILE_IMAGE_MAX_SIZE_MB) || 5) * 1024 * 1024;

function getBaseUrl(): string {
  const base = PROFILE_IMAGE_PUBLIC_BASE_URL?.replace(/\/+$/, '');
  if (!base) {
    throw new Error('PROFILE_IMAGE_PUBLIC_BASE_URL is not configured');
  }
  return base;
}

function createClient() {
  if (!PROFILE_IMAGE_BUCKET) {
    throw new Error('PROFILE_IMAGE_BUCKET is not configured');
  }
  if (!PROFILE_IMAGE_REGION) {
    throw new Error('PROFILE_IMAGE_REGION is not configured');
  }
  return new S3Client({
    region: PROFILE_IMAGE_REGION,
    endpoint: PROFILE_IMAGE_ENDPOINT || undefined,
    forcePathStyle: Boolean(PROFILE_IMAGE_ENDPOINT)
  });
}

function buildKey(userId: string, ext: string) {
  const safeExt = ext.replace(/[^a-z0-9.]/gi, '').toLowerCase();
  return `profile-images/${userId}/${Date.now()}-${crypto.randomUUID()}.${safeExt}`;
}

export async function uploadProfileImage(
  userId: string,
  file: Express.Multer.File
): Promise<string> {
  if (!ALLOWED_MIME_TYPES[file.mimetype]) {
    throw new Error('Unsupported image type');
  }
  if (file.size > maxSizeBytes) {
    throw new Error('File too large');
  }

  const client = createClient();
  const ext = ALLOWED_MIME_TYPES[file.mimetype];
  const Key = buildKey(userId, ext);
  const Bucket = PROFILE_IMAGE_BUCKET!;

  await client.send(
    new PutObjectCommand({
      Bucket,
      Key,
      Body: file.buffer,
      ContentType: file.mimetype,
      ACL: 'public-read'
    })
  );

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/${Key}`;
  if (!url.startsWith('https://')) {
    throw new Error('Public URL must start with https://');
  }
  return url;
}

export async function deleteProfileImageByUrl(url: string): Promise<void> {
  try {
    const baseUrl = getBaseUrl();
    if (!url.startsWith(`${baseUrl}/`)) {
      return;
    }
    const Key = url.slice(baseUrl.length + 1);
    if (!Key) return;
    const client = createClient();
    await client.send(
      new DeleteObjectCommand({
        Bucket: PROFILE_IMAGE_BUCKET!,
        Key
      })
    );
  } catch (err) {
    console.warn('[profile image] failed to delete image', err);
  }
}
