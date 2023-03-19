import { Test, TestingModule } from '@nestjs/testing';
import { CategoryService } from './category.service';
import { PrismaService } from '../../providers/prisma/prisma.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category } from '@prisma/client';
import { CATEGORY_MOCK } from './category.mock';

describe('CategoryService', () => {
  let service: CategoryService;
  let prismaService: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CategoryService,
        {
          provide: PrismaService,
          useValue: {
            category: {
              create: jest.fn(),
              findMany: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        },
      ],
    }).compile();

    service = module.get<CategoryService>(CategoryService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('create', () => {
    it('should create a category', async () => {
      const createCategoryDto: CreateCategoryDto = CATEGORY_MOCK;
      const expectedCategory: Category = CATEGORY_MOCK;
      jest
        .spyOn(prismaService.category, 'create')
        .mockResolvedValue(expectedCategory);
      const result = await service.create(createCategoryDto);
      expect(result).toEqual(expectedCategory);
    });
  });

  describe('findAll', () => {
    it('should return an array of categories', async () => {
      const expectedCategories: Category[] = [
        { ...CATEGORY_MOCK, id: 1, name: 'Category 1' },
        { ...CATEGORY_MOCK, id: 2, name: 'Category 2' },
      ];
      jest
        .spyOn(prismaService.category, 'findMany')
        .mockResolvedValue(expectedCategories);
      const result = await service.findAll();
      expect(result).toEqual(expectedCategories);
    });
  });

  describe('findOne', () => {
    it('should return a category', async () => {
      const expectedCategory: Category = CATEGORY_MOCK;
      jest
        .spyOn(prismaService.category, 'findUnique')
        .mockResolvedValue(expectedCategory);
      const result = await service.findOne(1);
      expect(result).toEqual(expectedCategory);
    });
  });

  describe('update', () => {
    it('should update a category', async () => {
      const updateCategoryDto: UpdateCategoryDto = CATEGORY_MOCK;
      const expectedCategory: Category = CATEGORY_MOCK;
      jest
        .spyOn(prismaService.category, 'update')
        .mockResolvedValue(expectedCategory);
      const result = await service.update(1, updateCategoryDto);
      expect(result).toEqual(expectedCategory);
    });
  });

  describe('remove', () => {
    it('should remove a category', async () => {
      const expectedCategory: Category = CATEGORY_MOCK;
      jest
        .spyOn(prismaService.category, 'delete')
        .mockResolvedValue(expectedCategory);
      const result = await service.remove(1);
      expect(result).toEqual(expectedCategory);
    });
  });
});
