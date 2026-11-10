import { Module } from '@nestjs/common';
import { PlacesController } from './places.controller.js';
import type { FetchFn } from './mapbox-search.js';
import { PLACES_FETCH, PlacesService } from './places.service.js';

const send: FetchFn = (url, init) => fetch(url, init);

@Module({
  controllers: [PlacesController],
  // Tests swap in a fake Mapbox here; nothing else does.
  providers: [PlacesService, { provide: PLACES_FETCH, useValue: send }],
})
export class PlacesModule {}
