'use client';

export type SortDir = 'asc' | 'desc';

/** A clickable table header cell that shows and toggles the sort direction. */
export function SortHeader<K extends string>({
  label,
  k,
  sortKey,
  dir,
  onSort,
}: {
  label: string;
  k: K;
  sortKey: K;
  dir: SortDir;
  onSort: (k: K) => void;
}) {
  const active = sortKey === k;
  return (
    <th className="px-4 py-3" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onSort(k)}
        className={`group inline-flex items-center gap-1 uppercase tracking-wide ${active ? 'text-gray-900' : 'hover:text-gray-800'}`}
      >
        {label}
        <span className={`text-[10px] ${active ? 'text-brand-600' : 'text-gray-300 group-hover:text-gray-400'}`}>
          {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );
}
