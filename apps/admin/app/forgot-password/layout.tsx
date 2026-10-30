import { SignedInRedirect } from '@/components/signed-in-redirect';

export default function Layout({ children }: { children: React.ReactNode }) {
  return <SignedInRedirect>{children}</SignedInRedirect>;
}
