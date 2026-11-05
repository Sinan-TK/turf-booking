import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { contains } from '../common/list-filters';
import type { AuthContext } from '../auth/auth.types';

export type DeletedFileStatus = 'waiting' | 'removed' | 'all';

/** The files the app stopped using: still in the bucket (waiting for the Super Admin to delete them there) or confirmed gone. */
@Injectable()
export class DeletedFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  private where(status: DeletedFileStatus, q?: string) {
    return {
      removedAt: status === 'waiting' ? null : status === 'removed' ? { not: null } : undefined,
      OR: q ? [{ key: contains(q) }, { label: contains(q) }] : undefined,
    };
  }

  async list(params: { status: DeletedFileStatus; q?: string; limit: number; offset: number }) {
    const rows = await this.prisma.client.deletedFile.findMany({
      where: this.where(params.status, params.q),
      orderBy: [{ deletedAt: 'desc' }, { id: 'asc' }],
      take: params.limit,
      skip: params.offset,
    });
    return rows.map((r) => ({ ...r, url: this.storage.publicUrl(r.key) }));
  }

  count(status: DeletedFileStatus, q?: string) {
    return this.prisma.client.deletedFile.count({ where: this.where(status, q) });
  }

  async summary() {
    const [waiting, removed] = await Promise.all([this.count('waiting'), this.count('removed')]);
    return { waiting, removed };
  }

  /** Every key still waiting, one per line, oldest first (to paste into a bulk delete in Cloudflare or a tool such as rclone). */
  async exportWaiting(): Promise<string> {
    const rows = await this.prisma.client.deletedFile.findMany({ where: { removedAt: null }, orderBy: [{ deletedAt: 'asc' }, { id: 'asc' }], select: { key: true }, take: 5000 });
    return rows.map((r) => r.key).join('\n') + (rows.length > 0 ? '\n' : '');
  }

  /** The admin says these are gone from the bucket. Ones already marked are left as they are. */
  async markRemoved(ids: string[], actor: AuthContext) {
    const { count } = await this.prisma.client.deletedFile.updateMany({
      where: { id: { in: ids }, removedAt: null },
      data: { removedAt: new Date(), removedByAdminId: actor.id },
    });
    if (count > 0) {
      await this.audit.record({ actor, action: 'DELETED_FILES_MARKED_REMOVED', entityType: 'DeletedFile', entityId: ids[0]!, metadata: { count, ids } });
    }
    return { marked: count };
  }

  /**
   * Looks at up to 50 waiting files (the oldest first) and marks the ones that are no longer in the bucket as removed, so after deleting
   * in Cloudflare the admin presses one button instead of ticking each row. A file that cannot be checked right now stays waiting.
   */
  async check(actor: AuthContext, options: { recheckRemoved?: boolean } = {}) {
    const waiting = await this.prisma.client.deletedFile.findMany({ where: { removedAt: null }, orderBy: [{ deletedAt: 'asc' }, { id: 'asc' }], take: 50 });
    const gone: string[] = [];
    let stillThere = 0;
    let failed = 0;
    for (let i = 0; i < waiting.length; i += 5) {
      const chunk = waiting.slice(i, i + 5);
      const answers = await Promise.all(chunk.map((f) => this.storage.exists(f.key).then((here) => ({ f, here }), () => ({ f, here: null as boolean | null }))));
      for (const { f, here } of answers) {
        if (here === null) failed++;
        else if (here) stillThere++;
        else gone.push(f.id);
      }
    }
    const { marked } = gone.length > 0 ? await this.markRemoved(gone, actor) : { marked: 0 };

    // A file marked removed may not really be gone (the delete in the bucket failed or was undone): when asked, look at the most recently
    // removed ones too, and put any that can still be reached back on the waiting list.
    let reopened = 0;
    let recheckFailed = 0;
    if (options.recheckRemoved) {
      const removed = await this.prisma.client.deletedFile.findMany({ where: { removedAt: { not: null } }, orderBy: [{ removedAt: 'desc' }, { id: 'asc' }], take: 50 });
      const back: string[] = [];
      for (let i = 0; i < removed.length; i += 5) {
        const chunk = removed.slice(i, i + 5);
        const answers = await Promise.all(chunk.map((f) => this.storage.exists(f.key).then((here) => ({ f, here }), () => ({ f, here: null as boolean | null }))));
        for (const { f, here } of answers) {
          if (here === null) recheckFailed++;
          else if (here) back.push(f.id);
        }
      }
      if (back.length > 0) {
        const res = await this.prisma.client.deletedFile.updateMany({ where: { id: { in: back }, removedAt: { not: null } }, data: { removedAt: null, removedByAdminId: null } });
        reopened = res.count;
        await this.audit.record({ actor, action: 'DELETED_FILES_REOPENED', entityType: 'DeletedFile', entityId: back[0]!, metadata: { count: reopened, ids: back } });
      }
    }
    return { checked: waiting.length, nowGone: marked, stillThere, failed, reopened, recheckFailed, remaining: await this.count('waiting') };
  }

  /** Deletes the history: the list entries of files already confirmed gone. Waiting files stay. */
  async clearRemoved(actor: AuthContext) {
    const { count } = await this.prisma.client.deletedFile.deleteMany({ where: { removedAt: { not: null } } });
    if (count > 0) await this.audit.record({ actor, action: 'DELETED_FILES_HISTORY_CLEARED', entityType: 'DeletedFile', entityId: actor.id, metadata: { count } });
    return { cleared: count };
  }
}
