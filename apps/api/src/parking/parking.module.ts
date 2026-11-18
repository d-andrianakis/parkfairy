import { Module } from '@nestjs/common';

import { ParkingController } from './parking.controller.js';
import { ParkingService } from './parking.service.js';

@Module({
  controllers: [ParkingController],
  providers: [ParkingService],
  // Favourites list their listings as the home page does.
  exports: [ParkingService],
})
export class ParkingModule {}
