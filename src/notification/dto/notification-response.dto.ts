import { ApiProperty } from '@nestjs/swagger';

export class NotificationResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  type: string;

  @ApiProperty()
  title: string;

  @ApiProperty()
  message: string;

  @ApiProperty()
  priority: string;

  @ApiProperty()
  source: string;

  @ApiProperty()
  metadata: Record<string, any>;

  @ApiProperty()
  read: boolean;

  @ApiProperty()
  createdAt: Date;
}
