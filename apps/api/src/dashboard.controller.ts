import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { DashboardService } from "./dashboard.service.js";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get("overview")
  overview(@Query("year") yearText?: string, @Query("dimension") dimensionText?: string, @Query("pa") paCode?: string, @Query("sector") sectorName?: string, @Query("group") groupName?: string, @Query("subgroup") subgroupName?: string, @Query("period") period?: string, @Query("account") accountSearch?: string, @Query("employee") employeeCode?: string) {
    const year = yearText ? Number(yearText) : 2026;
    const dimension = dimensionText === "sector" ? "sector" : dimensionText === "subgroup" ? "subgroup" : dimensionText === "pa" ? "pa" : dimensionText === "account" ? "account" : dimensionText === "group" || !dimensionText ? "group" : null;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException("Ano inválido.");
    if (!dimension) throw new BadRequestException("Dimensão inválida.");
    return this.dashboardService.overview(year, dimension, { paCode, sectorName, groupName, subgroupName, period, accountSearch, employeeCode });
  }

  @Get("filters")
  filters(@Query("year") yearText?: string, @Query("employee") employeeCode?: string) {
    const year = yearText ? Number(yearText) : 2026;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException("Ano inválido.");
    return this.dashboardService.filters(year, employeeCode);
  }

  @Get("ledger")
  ledger(@Query("year") yearText?: string, @Query("sector") sectorName?: string, @Query("pa") paCode?: string, @Query("period") period?: string, @Query("account") accountSearch?: string, @Query("employee") employeeCode?: string) {
    const year = yearText ? Number(yearText) : 2026;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException("Ano inválido.");
    if (!sectorName) throw new BadRequestException("Setor é obrigatório.");
    return this.dashboardService.ledgerEntries(year, sectorName, { paCode, period, accountSearch, employeeCode });
  }
}
