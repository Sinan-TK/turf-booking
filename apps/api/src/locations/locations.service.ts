import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

  createArea(dto: { districtId: string; name: string }) {
    return this.prisma.client.area.create({ data: dto });
  }

  listAreas(districtId?: string) {
    return this.prisma.client.area.findMany({
      where: districtId ? { districtId } : undefined,
      orderBy: { name: 'asc' },
    });
  }
}
