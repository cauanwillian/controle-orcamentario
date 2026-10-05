import { Body, Controller, Get, Headers, Param, Patch } from "@nestjs/common";
import { AdminService } from "./admin.service.js";

@Controller("admin")
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get("users") users(@Headers("authorization") authorization?: string) { return this.adminService.users(authorization); }
  @Get("roles") roles(@Headers("authorization") authorization?: string) { return this.adminService.roles(authorization); }
  @Get("audit") audit(@Headers("authorization") authorization?: string) { return this.adminService.audit(authorization); }
  @Patch("users/:employeeCode/active") active(@Headers("authorization") authorization: string | undefined, @Param("employeeCode") employeeCode: string, @Body() body: { active?: boolean }) { return this.adminService.setActive(authorization, employeeCode, Boolean(body.active)); }
  @Patch("users/:employeeCode/roles") rolesForUser(@Headers("authorization") authorization: string | undefined, @Param("employeeCode") employeeCode: string, @Body() body: { roles?: string[] }) { return this.adminService.setRoles(authorization, employeeCode, body.roles ?? []); }
  @Patch("users/:employeeCode/password") password(@Headers("authorization") authorization: string | undefined, @Param("employeeCode") employeeCode: string, @Body() body: { password?: string }) { return this.adminService.resetPassword(authorization, employeeCode, body.password ?? ""); }
}
