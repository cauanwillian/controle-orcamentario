import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  const allowedOrigins = (process.env.WEB_ORIGIN ?? "http://localhost:3000").split(",").map((origin) => origin.trim()).filter(Boolean);
  await app.register(cors, { origin: allowedOrigins });
  await app.register(multipart, { limits: { files: 1, fileSize: 100 * 1024 * 1024 } });
  await app.listen(Number(process.env.API_PORT ?? 3001), "0.0.0.0");
}

bootstrap();
