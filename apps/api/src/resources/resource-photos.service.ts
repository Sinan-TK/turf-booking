import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import type { AuthContext } from '../auth/auth.types';
import { ResourcesService } from './resources.service';
import { sniffImageType } from '../storage/image-type';

/** A unit shows at most this many photos on the customer's venue card. */
export const MAX_PHOTOS_PER_UNIT = 3;
/** Largest file accepted. The owner app shrinks photos before sending, so real uploads are far smaller. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export interface UnitPhoto {
  id: string;
  url: string;
}

/** A photo the owner already has on another unit or pooled item, offered for reuse. */
export interface LibraryPhoto {
  id: string;
  url: string;
  /** Where it is used now, e.g. "Greenfield Arena · Turf A". */
  from: string;
}

/** Whose photos: a unit's, or a pooled group's (a kayak fleet). */
type Owner = { resourceId: string } | { resourceGroupId: string };

/**
 * Photos of one unit (pitch, court, table…) or of one pooled group: up to three, in the order the owner sets, the first being the card's
 * main picture. Managed by the venue's owner admin (or a Super Admin); the files live in object storage.
 */
@Injectable()
export class ResourcePhotosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly resources: ResourcesService,
  ) {}

  list(resourceId: string, actor: AuthContext): Promise<UnitPhoto[]> {
    return this.listFor({ resourceId }, actor);
  }
  add(resourceId: string, file: { buffer: Buffer; size: number } | undefined, actor: AuthContext): Promise<UnitPhoto[]> {
    return this.addFor({ resourceId }, file, actor);
  }
  remove(resourceId: string, photoId: string, actor: AuthContext): Promise<UnitPhoto[]> {
    return this.removeFor({ resourceId }, photoId, actor);
  }
  reorder(resourceId: string, photoIds: string[], actor: AuthContext): Promise<UnitPhoto[]> {
    return this.reorderFor({ resourceId }, photoIds, actor);
  }
  listGroup(resourceGroupId: string, actor: AuthContext): Promise<UnitPhoto[]> {
    return this.listFor({ resourceGroupId }, actor);
  }
  addGroup(resourceGroupId: string, file: { buffer: Buffer; size: number } | undefined, actor: AuthContext): Promise<UnitPhoto[]> {
    return this.addFor({ resourceGroupId }, file, actor);
  }
  removeGroup(resourceGroupId: string, photoId: string, actor: AuthContext): Promise<UnitPhoto[]> {
    return this.removeFor({ resourceGroupId }, photoId, actor);
  }
  reorderGroup(resourceGroupId: string, photoIds: string[], actor: AuthContext): Promise<UnitPhoto[]> {
    return this.reorderFor({ resourceGroupId }, photoIds, actor);
  }
  library(resourceId: string, actor: AuthContext): Promise<LibraryPhoto[]> {
    return this.libraryFor({ resourceId }, actor);
  }
  libraryGroup(resourceGroupId: string, actor: AuthContext): Promise<LibraryPhoto[]> {
    return this.libraryFor({ resourceGroupId }, actor);
  }
  reuse(resourceId: string, photoId: string, actor: AuthContext): Promise<UnitPhoto[]> {
    return this.reuseFor({ resourceId }, photoId, actor);
  }
  reuseGroup(resourceGroupId: string, photoId: string, actor: AuthContext): Promise<UnitPhoto[]> {
    return this.reuseFor({ resourceGroupId }, photoId, actor);
  }

  private async listFor(owner: Owner, actor: AuthContext): Promise<UnitPhoto[]> {
    await this.owned(owner, actor);
    return this.photosFor(owner);
  }

  private async addFor(owner: Owner, file: { buffer: Buffer; size: number } | undefined, actor: AuthContext): Promise<UnitPhoto[]> {
    const { venueId } = await this.owned(owner, actor);
    if (!file || file.size === 0) throw new BadRequestException('Choose a photo to upload.');
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('That photo is too large (5 MB at most).');
    const type = sniffImageType(file.buffer);
    if (!type) throw new BadRequestException('Only JPEG, PNG or WebP photos can be uploaded.');

    const existing = await this.prisma.client.resourcePhoto.findMany({ where: owner, select: { sortOrder: true } });
    if (existing.length >= MAX_PHOTOS_PER_UNIT) {
      throw new BadRequestException(`A unit can have ${MAX_PHOTOS_PER_UNIT} photos at most. Remove one first.`);
    }

    // Upload first, then record it: a failed upload leaves nothing behind, and a failed insert only a stray file.
    const folder = 'resourceId' in owner ? `units/${owner.resourceId}` : `groups/${owner.resourceGroupId}`;
    const key = `venues/${venueId}/${folder}/${randomUUID()}.${type.ext}`;
    await this.storage.put(key, file.buffer, type.mime);
    const nextOrder = existing.reduce((most, p) => Math.max(most, p.sortOrder + 1), 0);
    await this.prisma.client.resourcePhoto.create({ data: { ...owner, key, sortOrder: nextOrder } });
    return this.photosFor(owner);
  }

  private async removeFor(owner: Owner, photoId: string, actor: AuthContext): Promise<UnitPhoto[]> {
    await this.owned(owner, actor);
    const photo = await this.prisma.client.resourcePhoto.findFirst({ where: { id: photoId, ...owner } });
    if (!photo) throw new NotFoundException('Photo not found');
    await this.prisma.client.resourcePhoto.delete({ where: { id: photo.id } });
    // A photo can be shared (another unit or venue of the same owner uses the same file): the file goes only with its last use.
    if ((await this.prisma.client.resourcePhoto.count({ where: { key: photo.key } })) === 0) await this.storage.remove(photo.key);
    return this.photosFor(owner);
  }

  /**
   * The photos the actor's organization already has on its other units and pooled items (across all its venues), without repeats and
   * without the ones this unit already shows, so one picture can serve several units without being uploaded again.
   */
  private async libraryFor(owner: Owner, actor: AuthContext): Promise<LibraryPhoto[]> {
    const { organizationId } = await this.orgOf(owner, actor);
    const mine = new Set((await this.prisma.client.resourcePhoto.findMany({ where: owner, select: { key: true } })).map((p) => p.key));
    const rows = await this.prisma.client.resourcePhoto.findMany({
      where: { OR: [{ resource: { venue: { organizationId } } }, { resourceGroup: { venue: { organizationId } } }] },
      orderBy: [{ createdAt: 'asc' }],
      select: {
        id: true,
        key: true,
        resource: { select: { name: true, venue: { select: { name: true } } } },
        resourceGroup: { select: { name: true, venue: { select: { name: true } } } },
      },
    });
    const seen = new Set<string>();
    const out: LibraryPhoto[] = [];
    for (const r of rows) {
      if (mine.has(r.key) || seen.has(r.key)) continue;
      seen.add(r.key);
      const where = r.resource ?? r.resourceGroup;
      out.push({ id: r.id, url: this.storage.publicUrl(r.key), from: where ? `${where.venue.name} · ${where.name}` : '' });
    }
    return out.sort((a, b) => a.from.localeCompare(b.from));
  }

  /** Gives this unit a photo another of the organization's units already has: the same stored file, shown here too. */
  private async reuseFor(owner: Owner, photoId: string, actor: AuthContext): Promise<UnitPhoto[]> {
    const { organizationId } = await this.orgOf(owner, actor);
    const source = await this.prisma.client.resourcePhoto.findFirst({
      where: { id: photoId, OR: [{ resource: { venue: { organizationId } } }, { resourceGroup: { venue: { organizationId } } }] },
      select: { key: true },
    });
    if (!source) throw new NotFoundException('That photo is not available to use here.');
    const existing = await this.prisma.client.resourcePhoto.findMany({ where: owner, select: { key: true, sortOrder: true } });
    if (existing.some((p) => p.key === source.key)) throw new BadRequestException('This unit already has that photo.');
    if (existing.length >= MAX_PHOTOS_PER_UNIT) {
      throw new BadRequestException(`A unit can have ${MAX_PHOTOS_PER_UNIT} photos at most. Remove one first.`);
    }
    const nextOrder = existing.reduce((most, p) => Math.max(most, p.sortOrder + 1), 0);
    await this.prisma.client.resourcePhoto.create({ data: { ...owner, key: source.key, sortOrder: nextOrder } });
    return this.photosFor(owner);
  }

  /** The organization the unit or group belongs to, after checking the actor may manage it. */
  private async orgOf(owner: Owner, actor: AuthContext): Promise<{ organizationId: string }> {
    const { venueId } = await this.owned(owner, actor);
    const venue = await this.prisma.client.venue.findUniqueOrThrow({ where: { id: venueId }, select: { organizationId: true } });
    return { organizationId: venue.organizationId };
  }

  /** Puts the photos in the given order (every photo, each once). The first is the main one. */
  private async reorderFor(owner: Owner, photoIds: string[], actor: AuthContext): Promise<UnitPhoto[]> {
    await this.owned(owner, actor);
    const current = await this.prisma.client.resourcePhoto.findMany({ where: owner, select: { id: true } });
    const same = current.length === photoIds.length && new Set(photoIds).size === photoIds.length && current.every((p) => photoIds.includes(p.id));
    if (!same) throw new BadRequestException("List every one of the unit's photos, each once.");
    await this.prisma.client.$transaction(
      photoIds.map((id, sortOrder) => this.prisma.client.resourcePhoto.update({ where: { id }, data: { sortOrder } })),
    );
    return this.photosFor(owner);
  }

  /** The unit's photos as clients see them: id and public URL, main photo first. */
  photosOf(resourceId: string): Promise<UnitPhoto[]> {
    return this.photosFor({ resourceId });
  }

  private async photosFor(owner: Owner): Promise<UnitPhoto[]> {
    const rows = await this.prisma.client.resourcePhoto.findMany({
      where: owner,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, key: true },
    });
    return rows.map((r) => ({ id: r.id, url: this.storage.publicUrl(r.key) }));
  }

  /** The unit or group exists and belongs to a venue the actor may manage; answers with that venue's id. */
  private async owned(owner: Owner, actor: AuthContext): Promise<{ venueId: string }> {
    const found =
      'resourceId' in owner
        ? await this.prisma.client.resource.findUnique({ where: { id: owner.resourceId }, select: { venueId: true } })
        : await this.prisma.client.resourceGroup.findUnique({ where: { id: owner.resourceGroupId }, select: { venueId: true } });
    if (!found) throw new NotFoundException('resourceId' in owner ? 'Unit not found' : 'Group not found');
    await this.resources.assertCanManageVenue(found.venueId, actor);
    return found;
  }
}
