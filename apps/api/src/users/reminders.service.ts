import { Inject, Injectable } from '@nestjs/common';
import type { ReminderPreferences } from '@parkfairy/contracts';
import { type Database, schema } from '@parkfairy/database';
import { eq } from 'drizzle-orm';

import { DB } from '../database/database.module.js';

const users = schema.users;

/** The driver's choice about the two reminders around a stay (5A.3): theirs alone, on until they say. */
@Injectable()
export class RemindersService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async get(userId: string): Promise<ReminderPreferences> {
    const [row] = await this.db
      .select({ reminderEmails: users.reminderEmails })
      .from(users)
      .where(eq(users.id, userId));
    // The session found the account a moment ago; one gone since is the default, not an error.
    return { reminderEmails: row?.reminderEmails ?? true };
  }

  async set(userId: string, { reminderEmails }: ReminderPreferences): Promise<ReminderPreferences> {
    await this.db.update(users).set({ reminderEmails }).where(eq(users.id, userId));
    return { reminderEmails };
  }
}
