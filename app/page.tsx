import { cookies } from 'next/headers';
import { openSession, SESSION_COOKIE } from '@/lib/zklogin/session';
import { AppShell } from './AppShell';
import { ZkLoginProvider } from '@/lib/useZkLogin';

/**
 * Server component, purely so the landing page is in the server-rendered HTML.
 *
 * The app shell is a client component — it owns the ephemeral key, the balance store and every view. But
 * because deciding "signed in?" needed browser storage, the first paint was a loading shell, and the landing
 * page only appeared after hydration. That is the wrong trade for a marketing page: crawlers that do not run
 * JavaScript saw nothing, and every signed-out visitor saw a flash.
 *
 * Reading the session cookie here is cheap and settles it before a single byte is sent. A visitor with no
 * cookie cannot be signed in, so the landing page renders immediately.
 *
 * This is a RENDERING hint and nothing more. It is never used for authorisation: every API route opens and
 * validates the sealed cookie itself, so the worst a tampered value could do is show someone the wrong first
 * frame before the client corrects it.
 */
export default async function Page() {
  const jar = await cookies();
  const initiallySignedIn = openSession(jar.get(SESSION_COOKIE)?.value) !== null;
  return (
    <ZkLoginProvider initiallySignedIn={initiallySignedIn}>
      <AppShell initiallySignedIn={initiallySignedIn} />
    </ZkLoginProvider>
  );
}
