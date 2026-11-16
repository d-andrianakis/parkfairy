import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module.js';
import { OwnerModule } from '../owner/owner.module.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminController } from './admin.controller.js';
import { AdminListingsService } from './admin-listings.service.js';
import { AdminUsersService } from './admin-users.service.js';

/** Staff review, the audit log (5.2, #66–#68) and support's way into an account (5.2c, #13). */
@Module({
  // The owner module's field crypto: tax values are read here only as their last characters.
  // Bookings: suspending a listing may call off what is booked on it (#78).
  imports: [OwnerModule, BookingsModule],
  controllers: [AdminController],
  providers: [AdminListingsService, AdminAuditService, AdminUsersService],
})
export class AdminModule {}
