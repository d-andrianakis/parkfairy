import { Module } from '@nestjs/common';

import { ParkingModule } from '../parking/parking.module.js';
import { FavouritesController } from './favourites.controller.js';
import { FavouritesService } from './favourites.service.js';

@Module({
  imports: [ParkingModule],
  controllers: [FavouritesController],
  providers: [FavouritesService],
})
export class FavouritesModule {}
