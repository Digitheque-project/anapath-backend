import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';

@Injectable()
export class Utf8Pipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata) {
    if (typeof value === 'string') {
      try {
        return decodeURIComponent(escape(value));
      } catch {
        return value;
      }
    }
    if (typeof value === 'object' && value !== null) {
      for (const key in value) {
        if (typeof value[key] === 'string') {
          try {
            value[key] = decodeURIComponent(escape(value[key]));
          } catch {
            // Ignorer
          }
        }
      }
    }
    return value;
  }
}
