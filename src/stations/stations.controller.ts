import { Controller, Get, Post, Query } from '@nestjs/common';
import { StationsService } from './stations.service';

@Controller('stations')
export class StationsController {
  constructor(private readonly stationsService: StationsService) {}

  @Get()
  findAll(@Query('region') region?: string) {
    return this.stationsService.findAll(region);
  }

  @Post('travel-time-cache/rebuild')
  rebuildTravelTimeCache() {
    return this.stationsService.rebuildTravelTimeCache();
  }
}
