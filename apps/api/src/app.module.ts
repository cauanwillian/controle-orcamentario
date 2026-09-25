import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardService } from "./dashboard.service.js";
import { AccessController } from "./access.controller.js";
import { AccessService } from "./access.service.js";

@Module({
  controllers: [HealthController, DashboardController, AccessController],
  providers: [DashboardService, AccessService]
})
export class AppModule {}
