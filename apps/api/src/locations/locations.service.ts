import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Prisma returns decimals as strings; the town centre goes out as plain numbers (or null). */
function withCentre<T extends { lat: { toString(): string } | null; lng: { toString(): string } | null }>(area: T) {
  return {
    ...area,
    lat: area.lat === null ? null : Number(area.lat.toString()),
    lng: area.lng === null ? null : Number(area.lng.toString()),
  };
}

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  createCountry(dto: { name: string; isoCode: string }) {
    return this.prisma.client.country.create({ data: dto });
  }

  listCountries() {
    return this.prisma.client.country.findMany({ orderBy: { name: 'asc' } });
  }

  createState(dto: { countryId: string; name: string; code: string }) {
    return this.prisma.client.state.create({ data: dto });
  }

  listStates(countryId?: string) {
    return this.prisma.client.state.findMany({
      where: countryId ? { countryId } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  /**
   * A District cannot exist without its FacilityCodeSequence — created
   * together in one transaction so FacilityCodeService never has to
   * special-case a missing sequence row for an otherwise-valid district.
   */
  async createDistrict(dto: { stateId: string; name: string; code: string; timezone: string }) {
    return this.prisma.client.$transaction(async (tx) => {
      const district = await tx.district.create({ data: dto });
      await tx.facilityCodeSequence.create({ data: { districtId: district.id } });
      return district;
    });
  }

  listDistricts(stateId?: string) {
    return this.prisma.client.district.findMany({
      where: stateId ? { stateId } : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async createArea(dto: { districtId: string; name: string; lat?: number; lng?: number }) {
    return withCentre(await this.prisma.client.area.create({ data: dto }));
  }

  async listAreas(districtId?: string) {
    const areas = await this.prisma.client.area.findMany({
      where: districtId ? { districtId } : undefined,
      orderBy: { name: 'asc' },
    });
    return areas.map(withCentre);
  }
}
