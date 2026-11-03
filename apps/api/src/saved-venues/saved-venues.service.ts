import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

/**
 * A customer's saved/favorited venues — lets "Book a Venue" (both the
 * WhatsApp menu and the web search results) offer a saved venue as a
 * shortcut instead of always making the customer search from scratch.
 * Deliberately customer-self-service only: no admin/owner surface,
 * since this is purely a personal shortcut with no business meaning.
 */
@Injectable()
export class SavedVenuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Idempotent — saving an already-saved venue is a no-op, not an
   * error, since both the WhatsApp button and the web "Save" toggle
   * can't easily know in advance whether it's already saved. */
  async save(customerId: string, venueId: string) {
    const venue = await this.prisma.client.venue.findUnique({ where: { id: venueId } });
    if (!venue) throw new NotFoundException('Venue not found');

    return this.prisma.client.savedVenue.upsert({
      where: { customerId_venueId: { customerId, venueId } },
      update: {},
      create: { customerId, venueId },
    });
  }

  async unsave(customerId: string, venueId: string): Promise<void> {
    // deleteMany (not delete) so unsaving something already unsaved is
    // also a safe no-op rather than a 404 the caller has to special-case.
    await this.prisma.client.savedVenue.deleteMany({ where: { customerId, venueId } });
  }

  async list(customerId: string) {
    const saved = await this.prisma.client.savedVenue.findMany({
      where: { customerId },
      include: {
        venue: {
          select: {
            id: true,
            name: true,
            facilityCode: true,
            address: true,
            status: true,
            lat: true,
            lng: true,
            googleMapsUrl: true,
            photos: { orderBy: { sortOrder: 'asc' }, take: 1, select: { url: true } },
            // The units a customer can book now, each with its main photo (for the saved card's picture strip).
            resources: {
              where: { isBookable: true, status: 'ACTIVE' },
              orderBy: { createdAt: 'asc' },
              select: { id: true, name: true, category: { select: { iconKey: true, iconSvg: true } }, photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 1, select: { key: true } } },
            },
            resourceGroups: {
              where: { isBookable: true, totalUnits: { gt: 0 } },
              orderBy: { createdAt: 'asc' },
              select: { id: true, name: true, category: { select: { iconKey: true, iconSvg: true } }, photos: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], take: 1, select: { key: true } } },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    // A saved venue the platform later deactivated (DRAFT/INACTIVE/
    // SUSPENDED) shouldn't be offered as a bookable shortcut — filtered
    // here rather than at save time, since "saved" and "currently
    // bookable" are different facts that can drift apart over time.
    return saved
      .filter((s) => s.venue.status === 'ACTIVE')
      .map(({ venue: v }) => ({
        id: v.id,
        name: v.name,
        facilityCode: v.facilityCode,
        address: v.address,
        lat: Number(v.lat),
        lng: Number(v.lng),
        googleMapsUrl: v.googleMapsUrl,
        photoUrl: v.photos[0]?.url ?? null,
        units: [...v.resources, ...v.resourceGroups].map((u) => ({
          id: u.id,
          name: u.name,
          photoUrl: u.photos[0] ? this.storage.publicUrl(u.photos[0].key) : null,
          iconKey: u.category.iconKey,
          iconSvg: u.category.iconSvg,
        })),
      }));
  }
}
