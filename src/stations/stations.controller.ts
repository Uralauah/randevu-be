import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AdminApiKeyGuard } from '../auth/admin-api-key.guard';
import { StationsService } from './stations.service';

@Controller('stations')
export class StationsController {
  constructor(private readonly stationsService: StationsService) {}

  @Get('regions')
  findRegions() {
    return this.stationsService.findRegions();
  }

  @Get()
  findAll(@Query('region') region?: string) {
    return this.stationsService.findAll(region);
  }

  @Post('travel-time-cache/rebuild')
  @UseGuards(AdminApiKeyGuard)
  rebuildTravelTimeCache(@Query('region') region?: string) {
    return this.stationsService.rebuildTravelTimeCache(region);
  }
}
