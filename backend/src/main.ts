import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { DatabaseService } from './database/database.service';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log', 'debug'] });
  const config = app.get(ConfigService);

  app.enableCors({
    origin: config.get<string>('WEB_ORIGIN')?.split(',') ?? true,
    credentials: true,
    maxAge: 86400,
  });

  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new AllExceptionsFilter());

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

  // Prevent Railway cold starts — keep DB pool connections alive
  if (process.env.RAILWAY_ENVIRONMENT) {
    const db = app.get(DatabaseService);
    setInterval(() => {
      db.query('SELECT 1').catch(() => {});
    }, 30_000);
    logger.log('🔥 Railway keepalive enabled (30s interval)');
  }
}

void bootstrap();
