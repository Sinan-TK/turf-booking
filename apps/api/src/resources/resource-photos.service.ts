import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { AuthContext } from '../auth/auth.types';
import { ResourcesService } from './resources.service';

/** A unit shows at most this many photos on the customer's venue card. */
export const MAX_PHOTOS_PER_UNIT = 3;
/** Largest file accepted. The owner app shrinks photos before sending, so real uploads are far smaller. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** The image types accepted, recognised by their first bytes rather than the name or the type the browser claims. */
function sniffImageType(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

export interface UnitPhoto {
  id: string;
  url: string;
}

/**
 * Photos of one unit (pitch, court, table…): up to three, in the order the owner sets, the first being the card's
 * main picture. Managed by the venue's owner admin (or a Super Admin); the files live in object storage.
 */
@Injectable()
export class ResourcePhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly resources: ResourcesService,
  ) {}

  async list(resourceId: string, actor: AuthContext): Promise<UnitPhoto[]> {
    await this.ownedUnit(resourceId, actor);
    return this.photosOf(resourceId);
  }

  async add(resourceId: string, file: { buffer: Buffer; size: number } | undefined, actor: AuthContext): Promise<UnitPhoto[]> {
    const unit = await this.ownedUnit(resourceId, actor);
    if (!file || file.size === 0) throw new BadRequestException('Choose a photo to upload.');
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('That photo is too large (5 MB at most).');
    const type = sniffImageType(file.buffer);
    if (!type) throw new BadRequestException('Only JPEG, PNG or WebP photos can be uploaded.');

    const existing = await this.prisma.client.resourcePhoto.findMany({ where: { resourceId }, select: { sortOrder: true } });
    if (existing.length >= MAX_PHOTOS_PER_UNIT) {
      throw new BadRequestException(`A unit can have ${MAX_PHOTOS_PER_UNIT} photos at most. Remove one first.`);
    }

    // Upload first, then record it: a failed upload leaves nothing behind, and a failed insert only a stray file.
    const key = `venues/${unit.venueId}/units/${resourceId}/${randomUUID()}.${type.ext}`;
    await this.storage.put(key, file.buffer, type.mime);
    const nextOrder = existing.reduce((most, p) => Math.max(most, p.sortOrder + 1), 0);
    await this.prisma.client.resourcePhoto.create({ data: { resourceId, key, sortOrder: nextOrder } });
    return this.photosOf(resourceId);
  }

  async remove(resourceId: string, photoId: string, actor: AuthContext): Promise<UnitPhoto[]> {
    await this.ownedUnit(resourceId, actor);
    const photo = await this.prisma.client.resourcePhoto.findFirst({ where: { id: photoId, resourceId } });
    if (!photo) throw new NotFoundException('Photo not found');
    await this.prisma.client.resourcePhoto.delete({ where: { id: photo.id } });
    await this.storage.remove(photo.key);
    return this.photosOf(resourceId);
  }

  /** Puts the unit's photos in the given order (every photo of the unit, each once). The first is the main one. */
  async reorder(resourceId: string, photoIds: string[], actor: AuthContext): Promise<UnitPhoto[]> {
    await this.ownedUnit(resourceId, actor);
    const current = await this.prisma.client.resourcePhoto.findMany({ where: { resourceId }, select: { id: true } });
    const same = current.length === photoIds.length && new Set(photoIds).size === photoIds.length && current.every((p) => photoIds.includes(p.id));
    if (!same) throw new BadRequestException("List every one of the unit's photos, each once.");
    await this.prisma.client.$transaction(
      photoIds.map((id, sortOrder) => this.prisma.client.resourcePhoto.update({ where: { id }, data: { sortOrder } })),
    );
    return this.photosOf(resourceId);
  }

  /** The unit's photos as clients see them: id and public URL, main photo first. */
  async photosOf(resourceId: string): Promise<UnitPhoto[]> {
    const rows = await this.prisma.client.resourcePhoto.findMany({
      where: { resourceId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, key: true },
    });
    return rows.map((r) => ({ id: r.id, url: this.storage.publicUrl(r.key) }));
  }

  private async ownedUnit(resourceId: string, actor: AuthContext) {
    const unit = await this.prisma.client.resource.findUnique({ where: { id: resourceId }, select: { id: true, venueId: true } });
    if (!unit) throw new NotFoundException('Unit not found');
    await this.resources.assertCanManageVenue(unit.venueId, actor);
    return unit;
  }
}
