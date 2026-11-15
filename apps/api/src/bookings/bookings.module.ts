import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { OwnerBookingsController } from './owner-bookings.controller.js';
import { OwnerCalendarController } from './owner-calendar.controller.js';
import { OwnerCalendarService } from './owner-calendar.service.js';
import { OwnerEarningsController } from './owner-earnings.controller.js';
import { OwnerEarningsService } from './owner-earnings.service.js';

@Module({
  controllers: [
    BookingsController,
    OwnerBookingsController,
    OwnerEarningsController,
    OwnerCalendarController,
  ],
  providers: [BookingsService, OwnerEarningsService, OwnerCalendarService],
  // Stripe's webhook settles payments through it.
  exports: [BookingsService],
})
export class BookingsModule {}
