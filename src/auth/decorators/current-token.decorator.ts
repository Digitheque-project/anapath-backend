import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentToken = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.token;
  },
);
