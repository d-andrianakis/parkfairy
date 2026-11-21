import { Module } from '@nestjs/common';

import { RemindersController } from './reminders.controller.js';
import { RemindersService } from './reminders.service.js';
import { UsersController } from './users.controller.js';

@Module({ controllers: [UsersController, RemindersController], providers: [RemindersService] })
export class UsersModule {}
