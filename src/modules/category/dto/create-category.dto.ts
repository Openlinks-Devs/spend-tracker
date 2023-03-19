import { ApiProperty } from '@nestjs/swagger';
import { Category } from '@prisma/client';

export class CreateCategoryDto implements Omit<Category, 'id'> {
  @ApiProperty()
  name: string;

  @ApiProperty()
  emoji: string;

  @ApiProperty({ required: false })
  parentId: number | null;
}
