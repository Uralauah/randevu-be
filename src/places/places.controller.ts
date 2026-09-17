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
    @Query('excludedPlaceKeys') excludedPlaceKeys?: string,
    @Query('category') category?: string,
  ) {
    return this.placesService.findPlacesByStation(
      stationId,
      type,
      mealTime,
      excludedPlaceKeys,
      category,
    );
  }

  @Get('stations/:stationId/place-recommendation')
  recommendPlace(
    @Param('stationId', ParseIntPipe) stationId: number,
    @Query('date') date: string,
    @Query('excludedPlaceKeys') excludedPlaceKeys?: string,
  ) {
    return this.placesService.recommendPlaceByStationAndDate(
      stationId,
      date,
      excludedPlaceKeys,
    );
  }

  @Get('places/search')
  searchPlaces(
    @Query('query') query: string,
    @Query('type') type: PlaceType,
    @Query('stationId', new ParseIntPipe({ optional: true }))
    stationId?: number,
  ) {
    return this.placesService.searchPlacesByKeyword(query, type, stationId);
  }

  @Get('places/:placeKey')
  findPlaceDetail(@Param('placeKey') placeKey: string) {
    return this.placesService.findPlaceDetail(placeKey);
  }
}
