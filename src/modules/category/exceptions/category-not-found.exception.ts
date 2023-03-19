import { NotFoundException } from '@nestjs/common';

export class CategoryNotFound extends NotFoundException {
  static readonly code = 'CATEGORY_NOT_FOUND';

  constructor() {
    super({
      message: 'Category not found',
      code: CategoryNotFound.code,
    });
  }
}
