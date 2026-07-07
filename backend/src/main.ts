import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log', 'debug'] });
  const config = app.get(ConfigService);

  app.enableCors({
    origin: config.get<string>('WEB_ORIGIN')?.split(',') ?? true,
    credentials: true
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));

  const swagger = new DocumentBuilder()
    .setTitle('Al Hayat ERP API')
    .setDescription('Al Hayat Enterprise Resource Planning API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  // Health check endpoint (before global prefix)
  const httpAdapter = app.getHttpAdapter();
  httpAdapter.get('/health', (_req: unknown, res: { json: (body: unknown) => void }) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  logger.log(`🚀 API running on port ${port}`);
  logger.log(`📖 Swagger docs at /docs`);
}

void bootstrap();
