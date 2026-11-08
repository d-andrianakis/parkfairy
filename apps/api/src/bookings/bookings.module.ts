import { Module } from '@nestjs/common';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { OwnerBookingsController } from './owner-bookings.controller.js';

@Module({
  controllers: [BookingsController, OwnerBookingsController],
  providers: [BookingsService],
})
export class BookingsModule {}
