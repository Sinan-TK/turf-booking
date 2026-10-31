import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Banner, Prisma } from '@venue/database';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_IMAGE_BYTES, STORAGE_FOLDERS, sniffImageType } from '../storage/image-type';
import { StorageService } from '../storage/storage.service';
import type { CreateBannerDto, UpdateBannerDto } from './banner.dto';

/** A banner as clients see it: the picture as a URL, never the storage key. */
function shape(b: Banner, imageUrl: string | null) {
  const { imageKey, ...rest } = b;
  void imageKey;
  return { ...rest, imageUrl };
}

/** Advertising banners for the customer site's landing page. */
@Injectable()
export class BannersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private url(b: Banner) {
    return b.imageKey ? this.storage.publicUrl(b.imageKey) : null;
  }

  /** What the landing page shows: switched on, inside its dates, in order. Nothing internal (no dates, no switch). */
  async listLive(now = new Date()) {
    const rows = await this.prisma.client.banner.findMany({
      where: { isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    return rows.map((b) => ({ id: b.id, title: b.title, subtitle: b.subtitle, linkUrl: b.linkUrl, imageUrl: this.url(b) }));
  }

  async listAdmin(now = new Date()) {
    const rows = await this.prisma.client.banner.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] });
    return rows.map((b) => {
      const started = !b.startsAt || b.startsAt <= now;
      const notEnded = !b.endsAt || b.endsAt > now;
      return { ...shape(b, this.url(b)), live: b.isActive && started && notEnded, scheduled: b.isActive && !started, ended: !notEnded };
    });
  }

  async create(dto: CreateBannerDto, actor: AuthContext) {
    const created = await this.prisma.client.banner.create({ data: this.data(dto) as Prisma.BannerCreateInput });
    await this.audit.record({ actor, action: 'BANNER_CREATED', entityType: 'Banner', entityId: created.id, metadata: { title: created.title } });
    return shape(created, null);
  }

  async update(id: string, dto: UpdateBannerDto, actor: AuthContext) {
    const current = await this.must(id);
    // The dates must still be in order once only one of them is changed.
    const startsAt = dto.startsAt === undefined ? current.startsAt : dto.startsAt ? new Date(dto.startsAt) : null;
    const endsAt = dto.endsAt === undefined ? current.endsAt : dto.endsAt ? new Date(dto.endsAt) : null;
    if (startsAt && endsAt && endsAt <= startsAt) throw new BadRequestException('The end must be after the start.');
    const updated = await this.prisma.client.banner.update({ where: { id }, data: this.data(dto) });
    await this.audit.record({ actor, action: 'BANNER_UPDATED', entityType: 'Banner', entityId: id, metadata: JSON.parse(JSON.stringify(dto)) as Prisma.InputJsonValue });
    return shape(updated, this.url(updated));
  }

  async remove(id: string, actor: AuthContext) {
    const current = await this.must(id);
    await this.prisma.client.banner.delete({ where: { id } });
    if (current.imageKey) await this.storage.remove(current.imageKey);
    await this.audit.record({ actor, action: 'BANNER_DELETED', entityType: 'Banner', entityId: id, metadata: { title: current.title } });
    return { deleted: true };
  }

  /** Sets (or replaces) the picture, in the banners/ folder of the bucket; the picture it replaces is deleted. */
  async setImage(id: string, file: { buffer: Buffer; size: number } | undefined, actor: AuthContext) {
    const current = await this.must(id);
    if (!file || file.size === 0) throw new BadRequestException('Choose a picture to upload.');
    if (file.size > MAX_IMAGE_BYTES) throw new BadRequestException('That picture is too large (5 MB at most).');
    const type = sniffImageType(file.buffer);
    if (!type) throw new BadRequestException('Only JPEG, PNG or WebP pictures can be uploaded.');
    const key = `${STORAGE_FOLDERS.banners}/${id}/${randomUUID()}.${type.ext}`;
    await this.storage.put(key, file.buffer, type.mime);
    const updated = await this.prisma.client.banner.update({ where: { id }, data: { imageKey: key } });
    if (current.imageKey) await this.storage.remove(current.imageKey);
    await this.audit.record({ actor, action: 'BANNER_IMAGE_SET', entityType: 'Banner', entityId: id, metadata: { title: current.title } });
    return shape(updated, this.url(updated));
  }

  async removeImage(id: string, actor: AuthContext) {
    const current = await this.must(id);
    if (!current.imageKey) return shape(current, null);
    const updated = await this.prisma.client.banner.update({ where: { id }, data: { imageKey: null } });
    await this.storage.remove(current.imageKey);
    await this.audit.record({ actor, action: 'BANNER_IMAGE_REMOVED', entityType: 'Banner', entityId: id, metadata: { title: current.title } });
    return shape(updated, null);
  }

  private data(dto: CreateBannerDto | UpdateBannerDto): Prisma.BannerUpdateInput {
    return {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.subtitle !== undefined ? { subtitle: dto.subtitle?.trim() || null } : {}),
      ...(dto.linkUrl !== undefined ? { linkUrl: dto.linkUrl?.trim() || null } : {}),
      ...(dto.startsAt !== undefined ? { startsAt: dto.startsAt ? new Date(dto.startsAt) : null } : {}),
      ...(dto.endsAt !== undefined ? { endsAt: dto.endsAt ? new Date(dto.endsAt) : null } : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
    };
  }

  private async must(id: string) {
    const banner = await this.prisma.client.banner.findUnique({ where: { id } });
    if (!banner) throw new NotFoundException('Banner not found');
    return banner;
  }
}
