import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { PlacesService } from './places.service';
import type { MealTime, PlaceType } from './places.type';

@Controller()
export class PlacesController {
  constructor(private readonly placesService: PlacesService) {}

  @Get('stations/:stationId/places')
  findPlaces(
    @Param('stationId', ParseIntPipe) stationId: number,
    @Query('type') type: PlaceType,
    @Query('mealTime') mealTime?: MealTime,
  ) {
    return this.placesService.findPlacesByStation(stationId, type, mealTime);
  }

  @Get('stations/:stationId/place-recommendation')
  recommendPlace(
    @Param('stationId', ParseIntPipe) stationId: number,
    @Query('date') date: string,
  ) {
    return this.placesService.recommendPlaceByStationAndDate(stationId, date);
  }

  @Get('places/:placeKey')
  findPlaceDetail(@Param('placeKey') placeKey: string) {
    return this.placesService.findPlaceDetail(placeKey);
  }
}
