'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/use-fetch';
import { usePagedFetch, PAGE_SIZE } from '@/lib/use-paged-fetch';
import { useListFilters } from '@/lib/use-list-filters';
import { Dropdown } from '@/components/dropdown';
import { ListSection } from '@/components/list-section';
import { ListToolbar, SearchBox } from '@/components/list-toolbar';
import { Pagination } from '@/components/pagination';
import { Button, Card, EmptyState, ErrorBanner, SkeletonTable, SuccessBanner } from '@/components/ui';

interface DeletedFile {
  id: string;
  key: string;
  url: string;
  source: 'UNIT_PHOTO' | 'GROUP_PHOTO' | 'BANNER' | 'CATEGORY_IMAGE' | 'OTHER';
  label: string | null;
  deletedAt: string;
  deletedByType: 'OWNER' | 'ADMIN' | 'SYSTEM';
  removedAt: string | null;
}

const SOURCE: Record<DeletedFile['source'], string> = {
  UNIT_PHOTO: 'Unit photo',
  GROUP_PHOTO: 'Pooled item photo',
  BANNER: 'Banner picture',
  CATEGORY_IMAGE: 'Facility picture',
  OTHER: 'File',
};
const BY: Record<DeletedFile['deletedByType'], string> = { OWNER: 'an owner', ADMIN: 'an admin', SYSTEM: 'the system' };

const STATUS_OPTIONS = [
  { value: 'waiting', label: 'Waiting to be deleted' },
  { value: 'removed', label: 'Removed from the bucket' },
  { value: 'all', label: 'All' },
];

/**
 * The files the app stopped using (a removed unit photo, a replaced banner...). The bucket's key cannot delete, so they stay in R2 until they
 * are deleted there by hand: this page lists what is left, hands over the keys, finds the ones already gone and marks them.
 */
export default function DeletedFilesPage() {
  const { values, set, clear, active, page, setPage, query } = useListFilters({ search: '', status: 'waiting' });
  const { rows, total, error, loading, refetch } = usePagedFetch<DeletedFile>('/admin/deleted-files', query, page);
  const summary = useFetch<{ waiting: number; removed: number }>('/admin/deleted-files/summary');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const reload = () => {
    refetch();
    summary.refetch();
  };

  async function run(label: string, action: () => Promise<string>) {
    setBusy(label);
    setNotice(null);
    setProblem(null);
    try {
      setNotice(await action());
      reload();
    } catch (err) {
      setProblem(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  }

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const copyAllWaiting = () =>
    run('copy', async () => {
      const text = await api.getText('/admin/deleted-files/export');
      const count = text.split('\n').filter(Boolean).length;
      if (count === 0) return 'Nothing is waiting to be deleted.';
      return (await copy(text)) ? `Copied ${count} file name${count === 1 ? '' : 's'}, one per line.` : 'Could not copy. Your browser blocked it.';
    });

  const checkBucket = () =>
    run('check', async () => {
      const r = await api.post<{ checked: number; nowGone: number; stillThere: number; failed: number; reopened: number; recheckFailed: number; remaining: number }>('/admin/deleted-files/check', { recheckRemoved: true });
      // The files marked removed are looked at too: any that can still be reached were not really deleted, and are waiting again.
      const parts: string[] = [];
      if (r.checked > 0) parts.push(`Checked ${r.checked} waiting: ${r.nowGone} already gone, ${r.stillThere} still in the bucket`);
      if (r.reopened > 0) parts.push(`${r.reopened} marked removed ${r.reopened === 1 ? 'is' : 'are'} still in the bucket and ${r.reopened === 1 ? 'was' : 'were'} put back on the waiting list`);
      if (r.failed + r.recheckFailed > 0) parts.push(`${r.failed + r.recheckFailed} could not be checked, try again`);
      if (r.remaining > r.stillThere + r.failed + r.reopened) parts.push('more are waiting, press Check bucket again');
      return parts.length > 0 ? `${parts.join('. ')}.` : 'Nothing is waiting, and the removed files are all really gone.';
    });

  const clearHistory = () =>
    run('clear', async () => {
      const r = await api.delete<{ cleared: number }>('/admin/deleted-files/removed');
      setConfirmingClear(false);
      return r.cleared === 0 ? 'There was no history to clear.' : `Deleted ${r.cleared} record${r.cleared === 1 ? '' : 's'} of removed files.`;
    });

  /**
   * The list keeps itself up to date: the page looks at the waiting files when it opens and each time you come back to it (after deleting
   * in Cloudflare), and the ones that are gone leave the list. Nothing is ticked or marked by hand.
   */
  const lastCheck = useRef(0);
  const autoCheck = useRef<() => Promise<void>>(async () => undefined);
  autoCheck.current = async () => {
    if (Date.now() - lastCheck.current < 15_000) return;
    lastCheck.current = Date.now();
    try {
      const r = await api.post<{ nowGone: number }>('/admin/deleted-files/check');
      if (r.nowGone > 0) {
        setNotice(`${r.nowGone} file${r.nowGone === 1 ? ' was' : 's were'} found gone from the bucket and cleared from the list.`);
        reload();
      }
    } catch {
      // the Check bucket button shows a failure; the automatic look stays quiet
    }
  };
  useEffect(() => {
    void autoCheck.current();
    const onBack = () => document.visibilityState === 'visible' && void autoCheck.current();
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => {
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
    };
  }, []);

  return (
    <div>
      <ListSection
        title="Deleted files"
        subtitle={
          summary.data
            ? `${summary.data.waiting} waiting to be deleted from the bucket, ${summary.data.removed} confirmed removed.`
            : ''
        }
      >
        <Card className="mb-4 text-sm text-gray-600">
          <p className="font-medium text-gray-900">How to clear these out of R2</p>
          <ol className="mt-1.5 list-decimal space-y-0.5 pl-5">
            <li>Press <strong>Copy all waiting keys</strong> and delete those files in the Cloudflare dashboard (or with a tool such as rclone).</li>
            <li>Come back to this page. It looks at the files by itself and clears the ones that are gone (press <strong>Check bucket</strong> to look right now; it also looks at the files marked removed, and puts any that can still be reached back on the waiting list).</li>
            <li>In the <strong>Removed</strong> view, <strong>Clear removed history</strong> deletes those records from the database.</li>
          </ol>
        </Card>
        <ListToolbar
          search={<SearchBox value={values.search} onChange={(v) => set('search', v)} placeholder="Search by file name or what it was…" label="Search deleted files" />}
          active={active}
          total={total}
          noun="file"
          onClear={clear}
        >
          <Dropdown label="Show" value={values.status} neutral="waiting" options={STATUS_OPTIONS} onChange={(v) => set('status', v)} />
        </ListToolbar>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => void copyAllWaiting()} loading={busy === 'copy'}>
            Copy all waiting keys
          </Button>
          <Button variant="secondary" onClick={() => void checkBucket()} loading={busy === 'check'}>
            Check bucket
          </Button>
          {values.status !== 'waiting' && (summary.data?.removed ?? 0) > 0 && !confirmingClear && (
            <Button variant="secondary" onClick={() => setConfirmingClear(true)}>
              Clear removed history
            </Button>
          )}
          {confirmingClear && (
            <span className="inline-flex flex-wrap items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-sm text-red-800">
              Delete the {summary.data?.removed ?? 0} removed record{(summary.data?.removed ?? 0) === 1 ? '' : 's'} from the database?
              <Button variant="danger" className="!px-3 !py-1" onClick={() => void clearHistory()} loading={busy === 'clear'}>
                Yes, delete
              </Button>
              <Button variant="secondary" className="!px-3 !py-1" onClick={() => setConfirmingClear(false)}>
                Cancel
              </Button>
            </span>
          )}
        </div>
      </ListSection>

      {notice && (
        <div className="mb-3">
          <SuccessBanner message={notice} />
        </div>
      )}
      {(problem || error) && (
        <div className="mb-3">
          <ErrorBanner message={(problem ?? error)!} />
        </div>
      )}

      {loading && rows.length === 0 && <SkeletonTable columns={5} />}
      {!loading && !error && total === 0 && (
        <EmptyState message={active && values.search ? 'No files match your search.' : values.status === 'waiting' ? 'Nothing is waiting. Every deleted file is gone from the bucket.' : 'Nothing here yet.'} />
      )}
      {rows.length > 0 && (
        <Card className={`overflow-x-auto p-0 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50/70 text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">What it was</th>
                <th className="px-4 py-3">Deleted</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} className="border-b border-gray-100 align-middle transition-colors hover:bg-brand-50/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <a href={f.url} target="_blank" rel="noopener noreferrer" className="block h-10 w-14 shrink-0 overflow-hidden rounded-md bg-gray-100 ring-1 ring-gray-200" title="Open the file">
                        <img src={f.url} alt="" loading="lazy" className="h-full w-full object-cover" onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')} />
                      </a>
                      <div className="min-w-0">
                        <p className="max-w-[22rem] truncate font-mono text-xs text-gray-800" title={f.key}>
                          {f.key}
                        </p>
                        <button
                          type="button"
                          onClick={() => void copy(f.key).then((ok) => setNotice(ok ? 'File name copied.' : 'Could not copy. Your browser blocked it.'))}
                          className="text-xs font-medium text-brand-700 hover:underline"
                          aria-label={`Copy the file name ${f.key}`}
                        >
                          Copy name
                        </button>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-gray-900">{SOURCE[f.source]}</p>
                    {f.label && <p className="text-xs text-gray-500">{f.label}</p>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                    {new Date(f.deletedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    <p className="text-xs text-gray-500">by {BY[f.deletedByType]}</p>
                  </td>
                  <td className="px-4 py-3">
                    {f.removedAt ? (
                      <span className="inline-flex rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700 ring-1 ring-inset ring-green-200">
                        Removed
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-yellow-50 px-2 py-0.5 text-[11px] font-semibold text-yellow-800 ring-1 ring-inset ring-yellow-200">
                        Waiting
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPage={setPage} />
        </Card>
      )}
    </div>
  );
}
