import { Module } from '@nestjs/common';
import { ParkingController } from './parking.controller.js';
import { ParkingService } from './parking.service.js';

@Module({ controllers: [ParkingController], providers: [ParkingService] })
export class ParkingModule {}
