import { Body, Controller, Post } from '@nestjs/common';
import { CreateRandomSubwayDto } from './dto/create-random-subway.dto';
import { RandomService } from './random.service';

@Controller('random')
export class RandomController {
  constructor(private readonly randomService: RandomService) {}

  @Post('subway')
  createSubwayRandom(@Body() dto: CreateRandomSubwayDto) {
    return this.randomService.createSubwayRandom(dto);
  }
}
