import { z } from 'zod';

// Zod's JIT probes `new Function`, which our CSP (correctly) blocks and reports as a
// violation. Jitless mode skips the probe; form-sized schemas don't need the speed-up.
// The probe runs when a schema is built, so this must be the first import of every client
// component that validates with zod (ahead of @parkfairy/contracts). Pages without forms
// don't ship zod at all.
z.config({ jitless: true });
