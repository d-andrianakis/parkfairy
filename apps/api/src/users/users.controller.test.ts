import type { AuthUser } from '@parkfairy/auth';
import { describe, expect, it } from 'vitest';
import { UsersController } from './users.controller.js';

const user = {
  id: '6eae16ad-2ef5-451c-a2b8-301747d83f7e',
  name: 'Maria',
  email: 'maria@example.gr',
  emailVerified: true,
  image: null,
  role: 'user',
  locale: 'el',
  twoFactorEnabled: null,
  createdAt: new Date('2026-10-28T15:43:07.307Z'),
  updatedAt: new Date('2026-10-28T15:43:07.307Z'),
} as unknown as AuthUser;

describe('UsersController.getMe', () => {
  const controller = new UsersController();

  it('returns exactly the public contract shape', () => {
    expect(controller.getMe(user)).toEqual({
      id: user.id,
      name: 'Maria',
      email: 'maria@example.gr',
      emailVerified: true,
      role: 'user',
      locale: 'el',
      twoFactorEnabled: false,
      createdAt: '2026-10-28T15:43:07.307Z',
    });
  });

  it('never leaks fields outside the contract', () => {
    const withExtras = { ...user, banned: true, password: 'hash' } as unknown as AuthUser;
    expect(Object.keys(controller.getMe(withExtras))).not.toEqual(
      expect.arrayContaining(['banned', 'password', 'image', 'updatedAt']),
    );
  });
});
