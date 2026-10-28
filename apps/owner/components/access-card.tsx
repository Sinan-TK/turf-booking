import { Card } from '@/components/ui';
import { SvgIcon } from '@/components/svg-icons';
import { STAFF_CAN, STAFF_CANNOT } from '@/lib/access';

/**
 * What a staff login can and cannot do, in plain words. Shown to an owner admin when managing staff ("what am I giving
 * them?") and to staff themselves ("why can't I see earnings?"), so both read the same list.
 */
export function AccessCard({
  audience,
  venues,
}: {
  audience: 'owner' | 'staff';
  /** The venues the staff member works in (staff view only). */
  venues?: Array<{ id: string; name: string }>;
}) {
  const staff = audience === 'staff';
  return (
    <Card>
      <h2 className="text-sm font-semibold text-on-surface">{staff ? 'What you can do here' : 'What staff can do'}</h2>
      <p className="mt-0.5 text-xs text-on-surface-variant">
        {staff
          ? 'You are signed in as staff. You work only in the venues below.'
          : 'Staff only see the venues you assign to them. They never see money or settings.'}
      </p>
      {staff && venues && venues.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Your venues">
          {venues.map((v) => (
            <li key={v.id} className="rounded-full bg-surface-container px-2.5 py-0.5 text-xs font-medium text-on-surface">
              {v.name}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold text-on-surface">{staff ? 'You can' : 'Staff can'}</p>
          <ul className="space-y-1.5">
            {STAFF_CAN.map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm text-on-surface">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <SvgIcon name="check" className="h-3 w-3" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold text-on-surface">{staff ? 'Your owner admin looks after' : "Staff can't"}</p>
          <ul className="space-y-1.5">
            {STAFF_CANNOT.map((t) => (
              <li key={t} className="flex items-start gap-2 text-sm text-on-surface-variant">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-on-surface-variant">
                  <SvgIcon name="close" className="h-3 w-3" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}
