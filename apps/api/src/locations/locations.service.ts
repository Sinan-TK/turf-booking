import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@venue/database';
import { AuditService } from '../audit/audit.service';
import type { AuthContext } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

/** Prisma returns decimals as strings; the town centre goes out as plain numbers (or null). */
function withCentre<T extends { lat: { toString(): string } | null; lng: { toString(): string } | null }>(area: T) {
  return {
    ...area,
    lat: area.lat === null ? null : Number(area.lat.toString()),
    lng: area.lng === null ? null : Number(area.lng.toString()),
  };
}

const ACTIVE = 'ACTIVE' as const;

/** A name or code that is already taken is the admin's to fix: say which, instead of a bare server error. */
function taken(err: unknown, what: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
    const fields = Array.isArray(err.meta?.target) ? (err.meta!.target as string[]) : [];
    const field = fields.includes('code') ? 'code' : 'name';
    throw new ConflictException(`${what} with that ${field} already exists.`);
  }
  throw err;
}

@Injectable()
export class LocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  createCountry(dto: { name: string; isoCode: string }) {
    return this.prisma.client.country.create({ data: dto });
  }

  listCountries() {
    return this.prisma.client.country.findMany({ orderBy: { name: 'asc' } });
  }

  // ---- states --------------------------------------------------------------------------------------------------------

  async createState(dto: { countryId: string; name: string; code: string }, actor?: AuthContext) {
    try {
      const state = await this.prisma.client.state.create({ data: dto });
      await this.record(actor, 'LOCATION_STATE_CREATED', 'State', state.id, { name: state.name, code: state.code });
      return state;
    } catch (err) {
      return taken(err, 'A state');
    }
  }

  /** Customers and forms: states that are switched on. */
  listStates(countryId?: string) {
    return this.prisma.client.state.findMany({
      where: { status: ACTIVE, ...(countryId ? { countryId } : {}) },
      orderBy: { name: 'asc' },
    });
  }

  /** The Super Admin's list: every state, switched on or off. */
  listStatesAdmin(countryId?: string) {
    return this.prisma.client.state.findMany({ where: countryId ? { countryId } : undefined, orderBy: { name: 'asc' } });
  }

  /** The code is part of every facility code made in the state, so only the name and the on/off switch can change. */
  async updateState(id: string, dto: { name?: string; status?: 'ACTIVE' | 'INACTIVE' }, actor: AuthContext) {
    await this.mustExist(this.prisma.client.state.findUnique({ where: { id }, select: { id: true } }), 'State');
    try {
      const state = await this.prisma.client.state.update({ where: { id }, data: dto });
      await this.record(actor, 'LOCATION_STATE_UPDATED', 'State', id, dto);
      return state;
    } catch (err) {
      return taken(err, 'A state');
    }
  }

  // ---- districts -----------------------------------------------------------------------------------------------------

  /**
   * A District cannot exist without its FacilityCodeSequence — created
   * together in one transaction so FacilityCodeService never has to
   * special-case a missing sequence row for an otherwise-valid district.
   */
  async createDistrict(dto: { stateId: string; name: string; code: string; timezone: string }, actor?: AuthContext) {
    await this.mustExist(this.prisma.client.state.findUnique({ where: { id: dto.stateId }, select: { id: true } }), 'State');
    try {
      const district = await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.district.create({ data: dto });
        await tx.facilityCodeSequence.create({ data: { districtId: created.id } });
        return created;
      });
      await this.record(actor, 'LOCATION_DISTRICT_CREATED', 'District', district.id, { name: district.name, code: district.code });
      return district;
    } catch (err) {
      return taken(err, 'A district in this state');
    }
  }

  listDistricts(stateId?: string) {
    return this.prisma.client.district.findMany({
      where: { status: ACTIVE, state: { status: ACTIVE }, ...(stateId ? { stateId } : {}) },
      orderBy: { name: 'asc' },
    });
  }

  listDistrictsAdmin(stateId?: string) {
    return this.prisma.client.district.findMany({ where: stateId ? { stateId } : undefined, orderBy: { name: 'asc' } });
  }

  async updateDistrict(id: string, dto: { name?: string; timezone?: string; status?: 'ACTIVE' | 'INACTIVE' }, actor: AuthContext) {
    await this.mustExist(this.prisma.client.district.findUnique({ where: { id }, select: { id: true } }), 'District');
    try {
      const district = await this.prisma.client.district.update({ where: { id }, data: dto });
      await this.record(actor, 'LOCATION_DISTRICT_UPDATED', 'District', id, dto);
      return district;
    } catch (err) {
      return taken(err, 'A district in this state');
    }
  }

  // ---- areas (towns) -------------------------------------------------------------------------------------------------

  async createArea(dto: { districtId: string; name: string; lat?: number; lng?: number }, actor?: AuthContext) {
    await this.mustExist(this.prisma.client.district.findUnique({ where: { id: dto.districtId }, select: { id: true } }), 'District');
    try {
      const area = withCentre(await this.prisma.client.area.create({ data: dto }));
      await this.record(actor, 'LOCATION_AREA_CREATED', 'Area', area.id, { name: area.name, districtId: dto.districtId });
      return area;
    } catch (err) {
      return taken(err, 'An area in this district');
    }
  }

  async listAreas(districtId?: string) {
    const areas = await this.prisma.client.area.findMany({
      where: { status: ACTIVE, district: { status: ACTIVE, state: { status: ACTIVE } }, ...(districtId ? { districtId } : {}) },
      orderBy: { name: 'asc' },
    });
    return areas.map(withCentre);
  }

  async listAreasAdmin(districtId?: string) {
    const areas = await this.prisma.client.area.findMany({ where: districtId ? { districtId } : undefined, orderBy: { name: 'asc' } });
    return areas.map(withCentre);
  }

  async updateArea(
    id: string,
    dto: { name?: string; lat?: number | null; lng?: number | null; status?: 'ACTIVE' | 'INACTIVE' },
    actor: AuthContext,
  ) {
    await this.mustExist(this.prisma.client.area.findUnique({ where: { id }, select: { id: true } }), 'Area');
    try {
      const area = withCentre(await this.prisma.client.area.update({ where: { id }, data: dto }));
      await this.record(actor, 'LOCATION_AREA_UPDATED', 'Area', id, dto);
      return area;
    } catch (err) {
      return taken(err, 'An area in this district');
    }
  }

  /**
   * Every place a customer can search from, in one list: each active area with its district and state, so the picker can show
   * "Edappal, Malappuram, Kerala" and filter all of them as the customer types, whatever state they are in.
   */
  async listPlaces() {
    const areas = await this.prisma.client.area.findMany({
      where: { status: ACTIVE, district: { status: ACTIVE, state: { status: ACTIVE } } },
      include: { district: { select: { id: true, name: true, state: { select: { id: true, name: true } } } } },
      orderBy: [{ name: 'asc' }],
    });
    return areas.map((a) => ({
      id: a.id,
      name: a.name,
      lat: a.lat === null ? null : Number(a.lat.toString()),
      lng: a.lng === null ? null : Number(a.lng.toString()),
      districtId: a.district.id,
      districtName: a.district.name,
      stateId: a.district.state.id,
      stateName: a.district.state.name,
    }));
  }

  private async mustExist(lookup: Promise<unknown>, what: string) {
    if (!(await lookup)) throw new NotFoundException(`${what} not found`);
  }

  private async record(actor: AuthContext | undefined, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>) {
    if (!actor) return;
    await this.audit.record({ actor, action, entityType, entityId, metadata: JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue });
  }
}
