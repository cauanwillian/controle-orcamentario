import { Injectable, OnModuleDestroy, UnauthorizedException, BadRequestException, ConflictException } from "@nestjs/common";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { Pool } from "pg";
import { AccessService, ViewerAccess } from "./access.service.js";

const scrypt = promisify(scryptCallback);
const SESSION_DAYS = 8;
type SessionEmployee = { employee_id: string; employee_code: string };

@Injectable()
export class AuthService implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });

  constructor(private readonly accessService: AccessService) {}

  async hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
    const derived = await scrypt(password, salt, 64) as Buffer;
    return `${salt}:${derived.toString("hex")}`;
  }

  private async passwordMatches(password: string, stored: string) {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const derived = await scrypt(password, salt, 64) as Buffer;
    return timingSafeEqual(Buffer.from(hash, "hex"), derived);
  }

  private validatePassword(password: string) {
    if (password.length < 8) throw new BadRequestException("A senha deve ter pelo menos 8 caracteres.");
  }

  private tokenHash(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }

  private async createSession(employeeId: string, employeeCode: string, mustChangePassword = false) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
    await this.pool.query("INSERT INTO auth_session (employee_id, token_hash, expires_at) VALUES ($1, $2, $3)", [employeeId, this.tokenHash(token), expiresAt]);
    const viewer = await this.accessService.resolve(employeeCode);
    return { token, expiresAt: expiresAt.toISOString(), viewer, mustChangePassword };
  }

  async bootstrap(employeeCode: string, password: string) {
    this.validatePassword(password);
    const count = await this.pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM employee_credential");
    if (Number(count.rows[0]?.count ?? 0) > 0) throw new ConflictException("O primeiro acesso já foi configurado. Use a tela de login.");
    const employee = await this.pool.query<SessionEmployee>("SELECT id AS employee_id, employee_code FROM employee WHERE active AND employee_code = $1", [employeeCode]);
    const row = employee.rows[0];
    if (!row) throw new UnauthorizedException("Colaborador ativo não encontrado.");
    await this.pool.query("INSERT INTO employee_credential (employee_id, password_hash, must_change_password) VALUES ($1, $2, FALSE)", [row.employee_id, await this.hashPassword(password)]);
    return this.createSession(row.employee_id, row.employee_code);
  }

  async login(employeeCode: string, password: string) {
    const result = await this.pool.query<SessionEmployee & { password_hash: string; must_change_password: boolean }>(
      `SELECT e.id AS employee_id, e.employee_code, c.password_hash, c.must_change_password
       FROM employee e JOIN employee_credential c ON c.employee_id = e.id
       WHERE e.active AND e.employee_code = $1`,
      [employeeCode]
    );
    const row = result.rows[0];
    if (!row || !(await this.passwordMatches(password, row.password_hash))) throw new UnauthorizedException("Código ou senha inválidos.");
    return this.createSession(row.employee_id, row.employee_code, row.must_change_password);
  }

  private async sessionEmployee(authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, "");
    if (!token) throw new UnauthorizedException("Faça login para acessar o dashboard.");
    const result = await this.pool.query<SessionEmployee>(`SELECT e.id AS employee_id, e.employee_code FROM auth_session s JOIN employee e ON e.id = s.employee_id WHERE s.token_hash = $1 AND s.expires_at > NOW() AND e.active`, [this.tokenHash(token)]);
    const row = result.rows[0];
    if (!row) throw new UnauthorizedException("Sua sessão expirou. Faça login novamente.");
    await this.pool.query("UPDATE auth_session SET last_seen_at = NOW() WHERE token_hash = $1", [this.tokenHash(token)]);
    return row;
  }

  async changePassword(authorization: string | undefined, password: string) {
    this.validatePassword(password);
    const employee = await this.sessionEmployee(authorization);
    await this.pool.query("UPDATE employee_credential SET password_hash = $1, must_change_password = FALSE, updated_at = NOW() WHERE employee_id = $2", [await this.hashPassword(password), employee.employee_id]);
    await this.pool.query("DELETE FROM auth_session WHERE employee_id = $1", [employee.employee_id]);
    return this.createSession(employee.employee_id, employee.employee_code);
  }

  async logout(authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, "");
    if (token) await this.pool.query("DELETE FROM auth_session WHERE token_hash = $1", [this.tokenHash(token)]);
    return { ok: true };
  }

  async viewer(authorization?: string): Promise<ViewerAccess> {
    const employee = await this.sessionEmployee(authorization);
    return this.accessService.resolve(employee.employee_code);
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
