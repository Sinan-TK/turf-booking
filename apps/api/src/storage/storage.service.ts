import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { loadEnv } from '@venue/config';
import { PrismaService } from '../prisma/prisma.service';

/** What a removed file was, so the Super Admin's list can say where it came from. */
export interface RemovedFileInfo {
  source: 'UNIT_PHOTO' | 'GROUP_PHOTO' | 'BANNER' | 'CATEGORY_IMAGE' | 'OTHER';
  label?: string;
  venueId?: string;
  by?: { type: 'OWNER' | 'ADMIN' | 'SYSTEM'; id?: string };
}

/** Where photos are kept on disk when no bucket is configured (development and tests only). Served at /media. */
export const LOCAL_MEDIA_DIR = resolve(process.cwd(), '.media');

/**
 * Stores uploaded files (unit photos) in the S3-compatible bucket from the STORAGE_* settings (Cloudflare R2 in
 * production) and turns a stored key into its public URL. Without a bucket, development and tests fall back to a
 * local folder served by this API, so uploads work before the keys exist; production refuses instead.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly env = loadEnv();
  private readonly s3: S3Client | null;

  constructor(private readonly prisma: PrismaService) {
    const e = this.env;
    const configured = e.STORAGE_ENDPOINT && e.STORAGE_BUCKET && e.STORAGE_ACCESS_KEY_ID && e.STORAGE_SECRET_ACCESS_KEY && e.STORAGE_PUBLIC_URL;
    this.s3 = configured
      ? new S3Client({
          endpoint: e.STORAGE_ENDPOINT,
          region: e.STORAGE_REGION,
          // bucket in the path (endpoint/bucket/key), which R2 and every S3-compatible store accept
          forcePathStyle: true,
          credentials: { accessKeyId: e.STORAGE_ACCESS_KEY_ID!, secretAccessKey: e.STORAGE_SECRET_ACCESS_KEY! },
        })
      : null;
    if (!this.s3 && e.NODE_ENV !== 'production') {
      this.logger.warn(`Object storage is not configured: photos are saved in ${LOCAL_MEDIA_DIR} (development only).`);
    }
  }

  /** True when uploads can be stored right now. */
  get available(): boolean {
    return this.s3 !== null || this.env.NODE_ENV !== 'production';
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    if (this.s3) {
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.env.STORAGE_BUCKET,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Keys are never reused (each upload gets a new id), so browsers and CDNs may keep a copy for good.
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return;
    }
    if (!this.available) throw new ServiceUnavailableException('Photo uploads are not set up yet.');
    const path = this.localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  /**
   * A file the app no longer uses. It is always written to the Deleted files list (so the Super Admin can see what is left in the bucket);
   * the file itself is deleted right away only where that is possible: the local folder in development, or a bucket whose key may delete
   * (STORAGE_DELETE_FILES). A failure never reaches the caller: the row is gone either way and a stray file costs a few KB.
   */
  async remove(key: string, info: RemovedFileInfo = { source: 'OTHER' }): Promise<void> {
    let gone = false;
    try {
      if (this.s3) {
        if (this.env.STORAGE_DELETE_FILES) {
          await this.s3.send(new DeleteObjectCommand({ Bucket: this.env.STORAGE_BUCKET, Key: key }));
          gone = true;
        }
      } else {
        await rm(this.localPath(key), { force: true });
      }
    } catch (err) {
      this.logger.warn(`Could not delete stored file ${key}: ${(err as Error).message}`);
    }
    try {
      await this.prisma.client.deletedFile.upsert({
        where: { key },
        create: {
          key,
          source: info.source,
          label: info.label,
          venueId: info.venueId,
          deletedByType: info.by?.type ?? 'SYSTEM',
          deletedById: info.by?.id,
          removedAt: gone ? new Date() : null,
        },
        update: {},
      });
    } catch (err) {
      this.logger.warn(`Could not list the deleted file ${key}: ${(err as Error).message}`);
    }
  }

  /** Is the file still in the bucket? A bucket is asked through its public address (no credentials needed); the local folder is looked at. */
  async exists(key: string): Promise<boolean> {
    if (this.s3) {
      const res = await fetch(this.publicUrl(key), { method: 'HEAD' });
      if (res.status === 404 || res.status === 410) return false;
      if (res.ok) return true;
      throw new Error(`The bucket answered ${res.status}`);
    }
    try {
      await access(this.localPath(key));
      return true;
    } catch {
      return false;
    }
  }

  publicUrl(key: string): string {
    const base = this.s3 ? this.env.STORAGE_PUBLIC_URL! : `${this.env.API_PUBLIC_URL}/media`;
    return `${base.replace(/\/$/, '')}/${key}`;
  }

  private localPath(key: string): string {
    const path = resolve(LOCAL_MEDIA_DIR, key);
    // Keys are built by this API, but never let one climb out of the media folder.
    if (!path.startsWith(LOCAL_MEDIA_DIR)) throw new Error('Invalid storage key');
    return join(path);
  }
}
