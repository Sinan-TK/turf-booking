import Link from 'next/link';
import { LEGAL, LEGAL_LINKS } from '@/lib/legal';

export interface LegalSection {
  id: string;
  title: string;
  body: React.ReactNode;
}

/** Body text of a section. */
export const P = ({ children }: { children: React.ReactNode }) => <p className="mt-3 text-pretty text-[0.9375rem] leading-relaxed text-slate-700">{children}</p>;

/** A bulleted list inside a section. */
export const UL = ({ children }: { children: React.ReactNode }) => <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[0.9375rem] leading-relaxed text-slate-700 marker:text-brand-600">{children}</ul>;

/** Where to reach us, worded for whichever contact details have been set. */
export function ContactLine() {
  return (
    <P>
      Write to us through the <Link href="/support" className="font-bold text-brand-700 underline underline-offset-2">Support page</Link>
      {LEGAL.email ? (
        <>
          {' '}or at <a href={`mailto:${LEGAL.email}`} className="font-bold text-brand-700 underline underline-offset-2">{LEGAL.email}</a>
        </>
      ) : null}
      .{LEGAL.address ? ` Our address is ${LEGAL.address}.` : ''}
    </P>
  );
}

/** The shared frame of every legal page: header, title with date, a contents list, the sections, and links to the other policies. */
export function LegalPage({ title, intro, sections }: { title: string; intro: React.ReactNode; sections: LegalSection[] }) {
  const focus = 'outline-none focus-visible:ring-4 focus-visible:ring-brand-600/25';
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="border-b border-slate-200/80 bg-white">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" aria-label={`${LEGAL.brand} home`} className={`select-none rounded-md text-[1.75rem] font-black italic leading-none tracking-tight text-slate-900 ${focus}`}>
            Turf<span className="text-brand-600">X</span>
          </Link>
          <Link href="/explore" className={`rounded-md px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 hover:text-brand-700 ${focus}`}>
            Explore venues
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        <h1 className="text-balance text-3xl font-black leading-tight tracking-tight text-slate-900 sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm font-semibold text-slate-500">Last updated {LEGAL.updated}</p>
        <div className="mt-5 max-w-3xl text-pretty text-base leading-relaxed text-slate-700">{intro}</div>

        <div className="mt-10 grid gap-10 lg:grid-cols-[14rem_minmax(0,1fr)] lg:gap-14">
          <nav aria-label="On this page" className="lg:sticky lg:top-6 lg:self-start">
            <p className="text-sm font-extrabold text-slate-900">On this page</p>
            <ol className="mt-3 space-y-1.5 border-l border-slate-200 text-sm">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className={`-ml-px block border-l border-transparent py-0.5 pl-3 font-medium text-slate-600 hover:border-brand-600 hover:text-brand-700 ${focus}`}>
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className="max-w-3xl">
            {sections.map((s) => (
              <section key={s.id} id={s.id} className="scroll-mt-6 border-t border-slate-100 py-7 first:border-0 first:pt-0">
                <h2 className="text-balance text-xl font-black tracking-tight text-slate-900">{s.title}</h2>
                {s.body}
              </section>
            ))}
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-slate-50">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-6 text-sm sm:px-6">
          <nav aria-label="Legal" className="flex flex-wrap gap-x-5 gap-y-2 font-bold text-slate-600">
            {LEGAL_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={`rounded-md hover:text-brand-700 ${focus}`}>
                {l.label}
              </Link>
            ))}
          </nav>
          <p className="text-slate-500">&copy; {new Date().getFullYear()} {LEGAL.operator}. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
