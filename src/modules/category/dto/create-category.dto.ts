import { ApiProperty } from '@nestjs/swagger';
import { Category } from '@prisma/client';

export class CreateCategoryDto implements Category {
  @ApiProperty()
  id: number;

  @ApiProperty()
  name: string;

  @ApiProperty()
  emoji: string;

  @ApiProperty({ required: false })
  parentId: number | null;
}
