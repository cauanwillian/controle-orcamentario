import { BadRequestException, Controller, Get, Headers, Query } from "@nestjs/common";
import { DashboardService } from "./dashboard.service.js";
import { AuthService } from "./auth.service.js";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService, private readonly authService: AuthService) {}

  @Get("overview")
  async overview(@Headers("authorization") authorization?: string, @Query("year") yearText?: string, @Query("dimension") dimensionText?: string, @Query("pa") paCode?: string, @Query("sector") sectorName?: string, @Query("group") groupName?: string, @Query("subgroup") subgroupName?: string, @Query("period") period?: string, @Query("account") accountSearch?: string) {
    const viewer = await this.authService.viewer(authorization);
    const year = yearText ? Number(yearText) : 2026;
    const dimension = dimensionText === "sector" ? "sector" : dimensionText === "subgroup" ? "subgroup" : dimensionText === "pa" ? "pa" : dimensionText === "account" ? "account" : dimensionText === "group" || !dimensionText ? "group" : null;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException("Ano inválido.");
    if (!dimension) throw new BadRequestException("Dimensão inválida.");
    return this.dashboardService.overview(year, dimension, { paCode, sectorName, groupName, subgroupName, period, accountSearch, employeeCode: viewer.employeeCode });
  }

  @Get("filters")
  async filters(@Headers("authorization") authorization?: string, @Query("year") yearText?: string) {
    const viewer = await this.authService.viewer(authorization);
    const year = yearText ? Number(yearText) : 2026;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException("Ano inválido.");
    return this.dashboardService.filters(year, viewer.employeeCode);
  }

  @Get("ledger-import-status")
  async ledgerImportStatus(@Headers("authorization") authorization?: string) {
    const viewer = await this.authService.viewer(authorization);
    return this.dashboardService.ledgerImportStatus(viewer.employeeCode);
  }

  @Get("ledger")
  async ledger(@Headers("authorization") authorization?: string, @Query("year") yearText?: string, @Query("sector") sectorName?: string, @Query("pa") paCode?: string, @Query("period") period?: string, @Query("account") accountSearch?: string) {
    const viewer = await this.authService.viewer(authorization);
    const year = yearText ? Number(yearText) : 2026;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException("Ano inválido.");
    if (!sectorName) throw new BadRequestException("Setor é obrigatório.");
    return this.dashboardService.ledgerEntries(year, sectorName, { paCode, period, accountSearch, employeeCode: viewer.employeeCode });
  }
}
