import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Pool } from "pg";
import { AuthService } from "./auth.service.js";

type AdminUser = { employeeCode: string; employeeName: string; active: boolean; roles: string[]; sectors: string[]; passwordConfigured: boolean };

@Injectable()
export class AdminService {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });

  constructor(private readonly authService: AuthService) {}

  private async requireAdmin(authorization?: string) {
    const viewer = await this.authService.viewer(authorization);
    if (!viewer.fullAccess) throw new ForbiddenException("Somente perfis com acesso total podem administrar usuários.");
    return viewer;
  }

  private async record(actorCode: string, targetEmployeeId: string, action: string, details: Record<string, unknown> = {}) {
    const actor = await this.pool.query<{ id: string }>("SELECT id FROM employee WHERE employee_code = $1", [actorCode]);
    await this.pool.query(
      "INSERT INTO access_audit_log (actor_employee_id, target_employee_id, action, details) VALUES ($1, $2, $3, $4::jsonb)",
      [actor.rows[0]?.id ?? null, targetEmployeeId, action, JSON.stringify(details)]
    );
  }

  async users(authorization?: string) {
    await this.requireAdmin(authorization);
    const result = await this.pool.query<{ employee_code: string; employee_name: string; active: boolean; roles: string[] | null; sectors: string[] | null; password_configured: boolean }>(
      `SELECT e.employee_code, e.name AS employee_name, e.active,
              COALESCE(ARRAY_AGG(DISTINCT r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles,
              COALESCE(ARRAY_AGG(DISTINCT p.sector_name) FILTER (WHERE p.sector_name IS NOT NULL), '{}') AS sectors,
              EXISTS(SELECT 1 FROM employee_credential c WHERE c.employee_id = e.id) AS password_configured
       FROM employee e
       LEFT JOIN employee_role er ON er.employee_id = e.id
       LEFT JOIN job_role r ON r.id = er.role_id
       LEFT JOIN role_sector_permission p ON p.role_id = r.id
       GROUP BY e.id, e.employee_code, e.name, e.active
       ORDER BY e.name`
    );
    return result.rows.map((row): AdminUser => ({ employeeCode: row.employee_code, employeeName: row.employee_name, active: row.active, roles: row.roles ?? [], sectors: row.sectors ?? [], passwordConfigured: row.password_configured }));
  }

  async roles(authorization?: string) {
    await this.requireAdmin(authorization);
    const result = await this.pool.query<{ name: string; sectors: string[] | null }>(
      `SELECT r.name, COALESCE(ARRAY_AGG(DISTINCT p.sector_name) FILTER (WHERE p.sector_name IS NOT NULL), '{}') AS sectors
       FROM job_role r LEFT JOIN role_sector_permission p ON p.role_id = r.id GROUP BY r.id, r.name ORDER BY r.name`
    );
    return result.rows.map((row) => ({ name: row.name, sectors: row.sectors ?? [] }));
  }

  async audit(authorization?: string) {
    await this.requireAdmin(authorization);
    const result = await this.pool.query<{ created_at: Date; actor_name: string | null; target_name: string; action: string; details: Record<string, unknown> }>(
      `SELECT a.created_at, actor.name AS actor_name, target.name AS target_name, a.action, a.details
       FROM access_audit_log a
       LEFT JOIN employee actor ON actor.id = a.actor_employee_id
       JOIN employee target ON target.id = a.target_employee_id
       ORDER BY a.created_at DESC LIMIT 50`
    );
    return result.rows.map((row) => ({ createdAt: row.created_at.toISOString(), actorName: row.actor_name ?? "Sistema", targetName: row.target_name, action: row.action, details: row.details ?? {} }));
  }

  async setActive(authorization: string | undefined, employeeCode: string, active: boolean) {
    const viewer = await this.requireAdmin(authorization);
    const result = await this.pool.query("UPDATE employee SET active = $1, updated_at = NOW() WHERE employee_code = $2 RETURNING id", [active, employeeCode]);
    if (!result.rowCount) throw new NotFoundException("Colaborador não encontrado.");
    if (!active) await this.pool.query("DELETE FROM auth_session WHERE employee_id = $1", [result.rows[0].id]);
    await this.record(viewer.employeeCode, result.rows[0].id, active ? "ativou" : "desativou");
    return { ok: true };
  }

  async setRoles(authorization: string | undefined, employeeCode: string, roleNames: string[]) {
    const viewer = await this.requireAdmin(authorization);
    if (!Array.isArray(roleNames) || !roleNames.length) throw new BadRequestException("Selecione pelo menos um cargo.");
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const employee = await client.query<{ id: string }>("SELECT id FROM employee WHERE employee_code = $1", [employeeCode]);
      if (!employee.rowCount) throw new NotFoundException("Colaborador não encontrado.");
      const roles = await client.query<{ id: string; name: string }>("SELECT id, name FROM job_role WHERE name = ANY($1::text[])", [roleNames]);
      if (roles.rowCount !== roleNames.length) throw new BadRequestException("Um ou mais cargos são inválidos.");
      await client.query("DELETE FROM employee_role WHERE employee_id = $1", [employee.rows[0].id]);
      for (const role of roles.rows) await client.query("INSERT INTO employee_role (employee_id, role_id) VALUES ($1, $2)", [employee.rows[0].id, role.id]);
      await client.query("DELETE FROM auth_session WHERE employee_id = $1", [employee.rows[0].id]);
      await client.query("COMMIT");
      await this.record(viewer.employeeCode, employee.rows[0].id, "alterou cargos", { roles: roleNames });
      return { ok: true };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async resetPassword(authorization: string | undefined, employeeCode: string, password: string) {
    const viewer = await this.requireAdmin(authorization);
    if (password.length < 8) throw new BadRequestException("A senha deve ter pelo menos 8 caracteres.");
    const employee = await this.pool.query<{ id: string }>("SELECT id FROM employee WHERE employee_code = $1", [employeeCode]);
    if (!employee.rowCount) throw new NotFoundException("Colaborador não encontrado.");
    const passwordHash = await this.authService.hashPassword(password);
    await this.pool.query(
      `INSERT INTO employee_credential (employee_id, password_hash, must_change_password, updated_at)
       VALUES ($1, $2, TRUE, NOW())
       ON CONFLICT (employee_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, must_change_password = TRUE, updated_at = NOW()`,
      [employee.rows[0].id, passwordHash]
    );
    await this.pool.query("DELETE FROM auth_session WHERE employee_id = $1", [employee.rows[0].id]);
    await this.record(viewer.employeeCode, employee.rows[0].id, "redefiniu senha");
    return { ok: true };
  }
}
