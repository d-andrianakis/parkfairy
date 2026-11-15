import { Module } from '@nestjs/common';
import { OwnerModule } from '../owner/owner.module.js';
import { AdminAuditService } from './admin-audit.service.js';
import { AdminController } from './admin.controller.js';
import { AdminListingsService } from './admin-listings.service.js';

/** Staff review and the audit log (5.2, #66–#68). */
@Module({
  // The owner module's field crypto: tax values are read here only as their last characters.
  imports: [OwnerModule],
  controllers: [AdminController],
  providers: [AdminListingsService, AdminAuditService],
})
export class AdminModule {}
