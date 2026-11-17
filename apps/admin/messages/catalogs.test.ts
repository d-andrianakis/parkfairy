import {
  ADMIN_ERROR_CODES,
  AREAS,
  AUDIT_ACTIONS,
  LISTING_OWNER_ROLES,
  LISTING_STATUSES,
  type Locale,
  OWNER_KINDS,
  OWNER_VERIFICATION_STATES,
  PROOF_KINDS,
  SUPPORTED_LOCALES,
} from '@parkfairy/contracts';
import { describe, expect, it } from 'vitest';

import { AUTH_ERROR_KEYS } from '@/lib/auth-errors';

import el from './el.json';
import en from './en.json';

type Catalog = { [key: string]: string | Catalog };
const catalogs: Record<Locale, Catalog> = { el, en };
const reference = flatten(en);

function flatten(catalog: Catalog, prefix = ''): Record<string, string> {
  return Object.fromEntries(
    Object.entries(catalog).flatMap(([key, value]) =>
      typeof value === 'string'
        ? [[`${prefix}${key}`, value]]
        : Object.entries(flatten(value, `${prefix}${key}.`)),
    ),
  );
}

/** ICU argument names in a message (braces at odd depth open arguments). */
function icuArguments(message: string): string[] {
  const names = new Set<string>();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    if (message[i] === '{') {
      depth++;
      if (depth % 2 === 1) {
        const match = /^\s*([A-Za-z_]\w*)/.exec(message.slice(i + 1));
        if (match?.[1]) names.add(match[1]);
      }
    } else if (message[i] === '}') {
      depth--;
    }
  }
  return [...names].sort();
}

describe('the staff app’s message catalogs', () => {
  for (const locale of SUPPORTED_LOCALES) {
    describe(locale, () => {
      const flat = flatten(catalogs[locale]);

      it('has exactly the keys English has', () => {
        expect(Object.keys(flat).sort()).toEqual(Object.keys(reference).sort());
      });

      it('has no empty message', () => {
        for (const [key, message] of Object.entries(flat)) {
          expect(message.trim(), key).not.toBe('');
        }
      });

      it('uses the same ICU arguments as English in every message', () => {
        for (const [key, message] of Object.entries(flat)) {
          expect(icuArguments(message), key).toEqual(icuArguments(reference[key] ?? ''));
        }
      });
    });
  }

  it('says every auth error the sign-in forms can show', () => {
    const errors = Object.keys(en.AuthErrors);
    for (const key of AUTH_ERROR_KEYS) expect(errors, key).toContain(key);
  });

  it('names every area, status, kind, role, verification, proof, action and error it can meet', () => {
    const admin = en.Admin;
    for (const area of AREAS) expect(admin.areas, area.id).toHaveProperty(area.id);
    for (const status of LISTING_STATUSES) {
      expect(admin.status, status).toHaveProperty(status);
      expect(en.AdminReview.status, status).toHaveProperty(status);
    }
    for (const kind of PROOF_KINDS) expect(admin.proofKinds, kind).toHaveProperty(kind);
    for (const kind of OWNER_KINDS) expect(admin.review.kinds, kind).toHaveProperty(kind);
    for (const role of LISTING_OWNER_ROLES) expect(admin.review.roles, role).toHaveProperty(role);
    for (const state of OWNER_VERIFICATION_STATES) {
      expect(admin.review.verification, state).toHaveProperty(state);
    }
    for (const action of AUDIT_ACTIONS) {
      const [group, name] = action.split('.') as [string, string];
      expect(reference[`Admin.audit.actions.${group}.${name}`], action).toBeTruthy();
    }
    for (const code of [...ADMIN_ERROR_CODES, 'MFA_REQUIRED', 'INVALID_ORIGIN']) {
      if (code === 'PROOF_NOT_FOUND') continue; // a download link, never a form
      expect(en.AdminErrors, code).toHaveProperty(code);
    }
    expect(en.AdminErrors).toHaveProperty('TOO_MANY_REQUESTS');
    expect(en.AdminErrors).toHaveProperty('SESSION_ENDED');
    expect(en.AdminErrors).toHaveProperty('UNKNOWN');
  });

  it('keeps the Greek the terms the public site settled on', () => {
    // «χώρος» and «στάθμευση», as the rest of the catalog; bare «κωδικός» means the 2FA code.
    expect(el.SignIn.password).toBe('Κωδικός πρόσβασης');
    expect(el.Admin.review.spaceCount).toContain('χώρος');
  });
});
