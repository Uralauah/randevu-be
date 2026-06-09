import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { TravelTimeCache } from '../stations/entities';
import { RandomService } from './random.service';

describe('RandomService', () => {
  let service: RandomService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RandomService,
        {
          provide: getRepositoryToken(TravelTimeCache),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<RandomService>(RandomService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
