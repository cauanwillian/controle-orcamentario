import { Body, Controller, Headers, Post } from "@nestjs/common";
import { AuthService } from "./auth.service.js";

type Credentials = { employeeCode?: string; password?: string };

@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("bootstrap")
  bootstrap(@Body() body: Credentials) {
    return this.authService.bootstrap(body.employeeCode?.trim() ?? "", body.password ?? "");
  }

  @Post("login")
  login(@Body() body: Credentials) {
    return this.authService.login(body.employeeCode?.trim() ?? "", body.password ?? "");
  }

  @Post("me")
  me(@Headers("authorization") authorization?: string) {
    return this.authService.viewer(authorization);
  }

  @Post("change-password")
  changePassword(@Headers("authorization") authorization: string | undefined, @Body() body: { password?: string }) {
    return this.authService.changePassword(authorization, body.password ?? "");
  }

  @Post("logout")
  logout(@Headers("authorization") authorization?: string) {
    return this.authService.logout(authorization);
  }
}
