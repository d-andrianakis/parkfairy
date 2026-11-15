/**
 * Runs once when the server starts. Auth is built on first use, so without this a bad
 * configuration would boot and look healthy while sign-in itself is broken.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { requireServerEnv } = await import('./lib/server-env');
  requireServerEnv(process.env);
}
