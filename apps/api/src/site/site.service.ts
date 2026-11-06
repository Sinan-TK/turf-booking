import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import type { AuthContext } from '../auth/auth.types';

const GOOGLE_KEY = 'googleSignIn';
/** The most venues the landing page's "Featured venues" can hold. */
export const MAX_FEATURED = 12;

/**
 * What the Super Admin controls about the public site: whether Google sign-in is on (it stays off until Google has approved the app),
 * and which venues the landing page features. Both are read by the customer site without signing in.
 */
@Injectable()
export class SiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  /** Whether customers can sign in with Google. Off unless an admin turned it on. */
  async googleSignInEnabled(): Promise<boolean> {
    const row = await this.prisma.client.platformSetting.findUnique({ where: { key: GOOGLE_KEY } });
    return row?.value === 'true';
  }

  /** Refuses a Google sign-in while it is switched off. */
  async assertGoogleSignInEnabled(): Promise<void> {
    if (!(await this.googleSignInEnabled())) throw new ForbiddenException('Google sign-in is not available right now. Use your email and password.');
  }

  async publicConfig() {
    return { googleSignIn: await this.googleSignInEnabled() };
  }

  async setGoogleSignIn(enabled: boolean, actor: AuthContext) {
    await this.prisma.client.platformSetting.upsert({
      where: { key: GOOGLE_KEY },
      create: { key: GOOGLE_KEY, value: String(enabled) },
      update: { value: String(enabled) },
    });
    await this.audit.record({
      actor,
      action: enabled ? 'SITE_GOOGLE_SIGNIN_ENABLED' : 'SITE_GOOGLE_SIGNIN_DISABLED',
      entityType: 'PlatformSetting',
      entityId: GOOGLE_KEY,
    });
    return { googleSignIn: enabled };
  }

  /** Venues for the landing page: live ones only, in the admin's order, each with a picture and the kinds of facility it has. */
  async featuredVenues() {
    const rows = await this.prisma.client.venue.findMany({
      where: { featuredOrder: { not: null }, status: 'ACTIVE', deletedAt: null },
      orderBy: [{ featuredOrder: 'asc' }, { name: 'asc' }],
      take: MAX_FEATURED,
      select: {
        id: true,
        name: true,
        address: true,
        facilityCode: true,
        area: { select: { name: true } },
        photos: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
        resources: {
          where: { status: 'ACTIVE' },
          select: { category: { select: { name: true } }, photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 1, select: { key: true } } },
        },
      },
    });
    return rows.map((v) => {
      const unitPhoto = v.resources.find((r) => r.photos[0])?.photos[0]?.key;
      return {
        id: v.id,
        name: v.name,
        address: v.address,
        area: v.area?.name ?? null,
        facilityCode: v.facilityCode,
        photoUrl: unitPhoto ? this.storage.publicUrl(unitPhoto) : (v.photos[0]?.url ?? null),
        facilities: [...new Set(v.resources.map((r) => r.category.name))].slice(0, 3),
      };
    });
  }

  /** Everything the admin page shows: the Google switch and the featured venues in order. */
  async adminView() {
    const rows = await this.prisma.client.venue.findMany({
      where: { featuredOrder: { not: null }, deletedAt: null },
      orderBy: [{ featuredOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, address: true, status: true },
    });
    return { googleSignIn: await this.googleSignInEnabled(), maxFeatured: MAX_FEATURED, featured: rows };
  }

  /** The featured list, in this order. Anything not listed stops being featured. Only venues that exist can be featured. */
  async setFeatured(venueIds: string[], actor: AuthContext) {
    const unique = [...new Set(venueIds)];
    if (unique.length > MAX_FEATURED) throw new BadRequestException(`You can feature up to ${MAX_FEATURED} venues.`);
    const found = await this.prisma.client.venue.findMany({ where: { id: { in: unique }, deletedAt: null }, select: { id: true } });
    if (found.length !== unique.length) throw new BadRequestException('One of those venues does not exist.');
    await this.prisma.client.$transaction([
      this.prisma.client.venue.updateMany({ where: { featuredOrder: { not: null } }, data: { featuredOrder: null } }),
      ...unique.map((id, i) => this.prisma.client.venue.update({ where: { id }, data: { featuredOrder: i } })),
    ]);
    await this.audit.record({
      actor,
      action: 'SITE_FEATURED_VENUES_CHANGED',
      entityType: 'PlatformSetting',
      entityId: 'featuredVenues',
      metadata: { venueIds: unique },
    });
    return this.adminView();
  }
}
