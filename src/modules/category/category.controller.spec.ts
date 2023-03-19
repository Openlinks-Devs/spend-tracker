import { Test, TestingModule } from '@nestjs/testing';
import { CategoryController } from './category.controller';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Category } from '@prisma/client';
import { CategoryNotFound } from './exceptions/category-not-found.exception';
import { CATEGORY_MOCK } from './category.mock';

describe('CategoryController', () => {
  let controller: CategoryController;
  let categoryService: CategoryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [CategoryController],
      providers: [
        {
          provide: CategoryService,
          useValue: {
            create: jest.fn(),
            findAll: jest.fn(),
            findOne: jest.fn(),
            update: jest.fn(),
            remove: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<CategoryController>(CategoryController);
    categoryService = module.get<CategoryService>(CategoryService);
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('create', () => {
    it('should create a category', async () => {
      const createCategoryDto: CreateCategoryDto = CATEGORY_MOCK;
      const expectedCategory: Category = CATEGORY_MOCK;
      jest.spyOn(categoryService, 'create').mockResolvedValue(expectedCategory);
      const result = await controller.create(createCategoryDto);
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
        .spyOn(categoryService, 'findAll')
        .mockResolvedValue(expectedCategories);
      const result = await controller.findAll();
      expect(result).toEqual(expectedCategories);
    });
  });

  describe('findOne', () => {
    it('should return a category', async () => {
      const expectedCategory: Category = CATEGORY_MOCK;
      jest
        .spyOn(categoryService, 'findOne')
        .mockResolvedValue(expectedCategory);
      const result = await controller.findOne('1');
      expect(result).toEqual(expectedCategory);
    });

    it('should throw CategoryNotFound if category is not found', async () => {
      jest.spyOn(categoryService, 'findOne').mockResolvedValue(null);
      await expect(controller.findOne('1')).rejects.toThrow(CategoryNotFound);
    });
  });

  describe('update', () => {
    it('should update a category', async () => {
      const updateCategoryDto: UpdateCategoryDto = { name: 'Updated category' };
      const expectedCategory: Category = CATEGORY_MOCK;
      jest.spyOn(categoryService, 'update').mockResolvedValue(expectedCategory);
      const result = await controller.update('1', updateCategoryDto);
      expect(result).toEqual(expectedCategory);
    });
  });

  describe('remove', () => {
    it('should remove a category', async () => {
      const expectedCategory: Category = CATEGORY_MOCK;
      jest.spyOn(categoryService, 'remove').mockResolvedValue(expectedCategory);
      const result = await controller.remove('1');
      expect(result).toEqual(expectedCategory);
    });
  });
});
