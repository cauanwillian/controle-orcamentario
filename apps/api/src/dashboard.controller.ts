import { BadRequestException, Controller, Get, Headers, Query } from "@nestjs/common";
import { DashboardService } from "./dashboard.service.js";
import { AuthService } from "./auth.service.js";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService, private readonly authService: AuthService) {}

  @Get("overview")
  async overview(@Headers("authorization") authorization?: string, @Query("year") yearText?: string, @Query("dimension") dimensionText?: string, @Query("pa") paCode?: string, @Query("sector") sectorName?: string, @Query("group") groupName?: string, @Query("subgroup") subgroupName?: string, @Query("period") period?: string, @Query("account") accountSearch?: string, @Query("ledgerOnly") ledgerOnly?: string, @Query("search") search?: string, @Query("searchType") searchType?: string, @Query("reportDimension") reportDimensionText?: string) {
    const viewer = await this.authService.viewer(authorization);
    const year = yearText ? Number(yearText) : 2026;
    const dimension = dimensionText === "sector" ? "sector" : dimensionText === "subgroup" ? "subgroup" : dimensionText === "pa" ? "pa" : dimensionText === "account" ? "account" : dimensionText === "group" || !dimensionText ? "group" : null;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException("Ano inválido.");
    if (!dimension) throw new BadRequestException("Dimensão inválida.");
    const reportDimension = reportDimensionText === "group" || reportDimensionText === "sector" ? reportDimensionText : !reportDimensionText ? undefined : null;
    if (reportDimension === null) throw new BadRequestException("Dimensão do relatório inválida.");
    return this.dashboardService.overview(year, dimension, { paCode, sectorName, groupName, subgroupName, period, accountSearch, entrySearch: search, entrySearchType: searchType, reportDimension, employeeCode: viewer.employeeCode, ledgerOnly: ledgerOnly === "true" });
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
  async ledger(@Headers("authorization") authorization?: string, @Query("year") yearText?: string, @Query("sector") sectorName?: string, @Query("pa") paCode?: string, @Query("period") period?: string, @Query("account") accountSearch?: string, @Query("search") search?: string, @Query("searchType") searchType?: string) {
    const viewer = await this.authService.viewer(authorization);
    const year = yearText ? Number(yearText) : 2026;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException("Ano inválido.");
    if (!sectorName) throw new BadRequestException("Setor é obrigatório.");
    return this.dashboardService.ledgerEntries(year, sectorName, { paCode, period, accountSearch, entrySearch: search, entrySearchType: searchType, employeeCode: viewer.employeeCode });
  }

  @Get("group-ledger")
  async groupLedger(@Headers("authorization") authorization?: string, @Query("year") yearText?: string, @Query("group") groupName?: string, @Query("pa") paCode?: string, @Query("period") period?: string, @Query("account") accountCode?: string, @Query("sector") sectorName?: string, @Query("subgroup") subgroupName?: string, @Query("search") search?: string, @Query("searchType") searchType?: string) {
    const viewer = await this.authService.viewer(authorization);
    const year = yearText ? Number(yearText) : 2026;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new BadRequestException("Ano inválido.");
    if (!groupName) throw new BadRequestException("Grupo é obrigatório.");
    if (!paCode) throw new BadRequestException("PA é obrigatória.");
    if (!accountCode) throw new BadRequestException("Conta é obrigatória.");
    return this.dashboardService.groupLedgerEntries(year, groupName, { paCode, period, accountSearch: accountCode, sectorName, subgroupName, entrySearch: search, entrySearchType: searchType, employeeCode: viewer.employeeCode });
  }
}
