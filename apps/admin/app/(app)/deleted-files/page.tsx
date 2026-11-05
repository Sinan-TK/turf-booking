'use client';

import { useState } from 'react';
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
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const reload = () => {
    refetch();
    summary.refetch();
    setPicked(new Set());
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
      const r = await api.post<{ checked: number; nowGone: number; stillThere: number; failed: number; remaining: number }>('/admin/deleted-files/check');
      if (r.checked === 0) return 'Nothing is waiting to be checked.';
      const parts = [`Checked ${r.checked}: ${r.nowGone} already gone`, `${r.stillThere} still in the bucket`];
      if (r.failed > 0) parts.push(`${r.failed} could not be checked, try again`);
      if (r.remaining > r.stillThere + r.failed) parts.push('more are waiting, press Check bucket again');
      return `${parts.join(', ')}.`;
    });

  const markRemoved = (ids: string[]) =>
    run('mark', async () => {
      const r = await api.post<{ marked: number }>('/admin/deleted-files/mark-removed', { ids });
      return `${r.marked} file${r.marked === 1 ? '' : 's'} marked as removed.`;
    });

  const waitingRows = rows.filter((r) => !r.removedAt);
  const allPicked = waitingRows.length > 0 && waitingRows.every((r) => picked.has(r.id));
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

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
            <li>Press <strong>Copy all waiting keys</strong> and delete those files in the Cloudflare dashboard (or a tool such as rclone).</li>
            <li>Press <strong>Check bucket</strong>. It looks at each file and marks the ones that are gone.</li>
            <li>Anything left can be ticked and marked removed by hand.</li>
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
          {picked.size > 0 && (
            <Button onClick={() => void markRemoved([...picked])} loading={busy === 'mark'}>
              Mark {picked.size} selected as removed
            </Button>
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
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label="Select every waiting file on this page"
                    checked={allPicked}
                    disabled={waitingRows.length === 0}
                    onChange={() => setPicked(allPicked ? new Set() : new Set(waitingRows.map((r) => r.id)))}
                  />
                </th>
                <th className="px-4 py-3">File</th>
                <th className="px-4 py-3">What it was</th>
                <th className="px-4 py-3">Deleted</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => (
                <tr key={f.id} className="border-b border-gray-100 align-middle transition-colors hover:bg-brand-50/40">
                  <td className="px-4 py-3">
                    {!f.removedAt && <input type="checkbox" aria-label={`Select ${f.key}`} checked={picked.has(f.id)} onChange={() => toggle(f.id)} />}
                  </td>
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
                  <td className="px-4 py-3 text-right">
                    {!f.removedAt && (
                      <button type="button" onClick={() => void markRemoved([f.id])} disabled={busy !== null} className="text-sm font-medium text-gray-900 hover:underline disabled:opacity-50">
                        Mark removed
                      </button>
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
