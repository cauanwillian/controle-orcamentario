import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";
import { DashboardController } from "./dashboard.controller.js";
import { DashboardService } from "./dashboard.service.js";
import { AccessController } from "./access.controller.js";
import { AccessService } from "./access.service.js";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { AdminController } from "./admin.controller.js";
import { AdminService } from "./admin.service.js";
import { LedgerUploadController } from "./ledger-upload.controller.js";
import { LedgerUploadService } from "./ledger-upload.service.js";

@Module({
  controllers: [HealthController, DashboardController, AccessController, AuthController, AdminController, LedgerUploadController],
  providers: [DashboardService, AccessService, AuthService, AdminService, LedgerUploadService]
})
export class AppModule {}
