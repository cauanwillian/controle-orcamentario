import { Controller, Get, Headers, Param, Post, Req } from "@nestjs/common";
import { LedgerUploadService } from "./ledger-upload.service.js";

@Controller("ledger-upload")
export class LedgerUploadController {
  constructor(private readonly uploads: LedgerUploadService) {}
  @Get("history")
  async history(@Headers("authorization") authorization: string | undefined) {
    return this.uploads.history(authorization);
  }
  @Post(":uploadId/reprocess")
  async reprocess(@Headers("authorization") authorization: string | undefined, @Param("uploadId") uploadId: string) {
    return this.uploads.reprocess(authorization, uploadId);
  }
  @Post()
  async upload(@Headers("authorization") authorization: string | undefined, @Req() request: { file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> }> }) {
    const file = await request.file();
    return this.uploads.upload(authorization, file.filename, await file.toBuffer());
  }
}
