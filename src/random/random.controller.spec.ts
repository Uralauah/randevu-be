import { Test, TestingModule } from '@nestjs/testing';
import { RandomController } from './random.controller';
import { RandomService } from './random.service';

describe('RandomController', () => {
  let controller: RandomController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RandomController],
      providers: [
        {
          provide: RandomService,
          useValue: {},
        },
      ],
    }).compile();

    controller = module.get<RandomController>(RandomController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
