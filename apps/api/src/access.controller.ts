import { Controller, Get } from "@nestjs/common";
import { AccessService } from "./access.service.js";

@Controller("access")
export class AccessController {
  constructor(private readonly accessService: AccessService) {}

  @Get("profiles")
  profiles() {
    return this.accessService.profiles();
  }
}
