import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminApiKeyGuard } from '../auth/admin-api-key.guard';
import { sendPrecompressedJson } from '../common/http/precompressed-json';
import { StationsService } from './stations.service';

const STATION_LIST_MAX_AGE_SECONDS = 300;

@Controller('stations')
export class StationsController {
  constructor(private readonly stationsService: StationsService) {}

  @Get('regions')
  findRegions() {
    return this.stationsService.findRegions();
  }

  /**
   * 역·노선 데이터는 데이터 반영 때만 바뀌므로 브라우저가 잠시 재사용하게 하고(Cache-Control),
   * 그 뒤에는 ETag로 바뀌지 않았는지만 확인하게 한다.
   */
  @Get()
  async findAll(
    @Req() request: Request,
    @Res() response: Response,
    @Query('region') region?: string,
  ) {
    const payload = await this.stationsService.getStationListPayload(region);

    sendPrecompressedJson(request, response, payload, {
      maxAgeSeconds: STATION_LIST_MAX_AGE_SECONDS,
    });
  }

  @Post('travel-time-cache/rebuild')
  @UseGuards(AdminApiKeyGuard)
  rebuildTravelTimeCache(@Query('region') region?: string) {
    return this.stationsService.rebuildTravelTimeCache(region);
  }
}
