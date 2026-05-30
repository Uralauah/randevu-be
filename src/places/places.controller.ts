import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PlacesService } from './places.service';
import type { MealTime, PlaceType } from './places.type';

@Controller('stations/:stationId/places')
export class PlacesController {
  constructor(private readonly placesService: PlacesService) {}

  @Get()
  findPlaces(
    @Param('stationId', ParseIntPipe) stationId: number,
    @Query('type') type: PlaceType,
    @Query('mealTime') mealTime?: MealTime,
  ) {
    return this.placesService.findPlacesByStation(stationId, type, mealTime);
  }
}
