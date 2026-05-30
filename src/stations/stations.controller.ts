import { Controller, Get, Post } from '@nestjs/common';
import { StationsService } from './stations.service';
import { SubwayStation } from './entities';

@Controller('stations')
export class StationsController {
  constructor(private readonly stationsService: StationsService) {}

  @Get()
  findAll() {
    return this.stationsService.findAll();
  }

  @Post('travel-time-cache/rebuild')
  rebuildTravelTimeCache() {
    return this.stationsService.rebuildTravelTimeCache();
  }
}
