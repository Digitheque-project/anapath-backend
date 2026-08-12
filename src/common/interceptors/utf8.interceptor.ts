import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class Utf8Interceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();
    
    // Forcer l'encodage UTF-8 sur la requête
    if (request.headers['content-type']) {
      request.headers['content-type'] = request.headers['content-type'].replace(/charset=.*/, 'charset=utf-8');
    }
    
    return next.handle().pipe(
      map(data => {
        return data;
      }),
    );
  }
}
