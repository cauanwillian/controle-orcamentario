import { ForbiddenException, Injectable, OnModuleDestroy } from "@nestjs/common";
import { Pool } from "pg";

export type ViewerAccess = { employeeCode: string; employeeName: string; roles: string[]; scopes: string[]; fullAccess: boolean };

@Injectable()
export class AccessService {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });

  async profiles() {
    const result = await this.pool.query<{ employee_code: string; employee_name: string; roles: string[] }>(
      `SELECT e.employee_code, e.name AS employee_name, ARRAY_AGG(DISTINCT r.name ORDER BY r.name) AS roles
       FROM employee e JOIN employee_role er ON er.employee_id = e.id JOIN job_role r ON r.id = er.role_id
       WHERE e.active GROUP BY e.employee_code, e.name ORDER BY e.name`
    );
    return result.rows.map((row) => ({ employeeCode: row.employee_code, employeeName: row.employee_name, roles: row.roles }));
  }

  async resolve(employeeCode: string | undefined): Promise<ViewerAccess> {
    if (!employeeCode) throw new ForbiddenException("Selecione um colaborador para aplicar as permissões.");
    const result = await this.pool.query<{ employee_code: string; employee_name: string; roles: string[]; scopes: string[] }>(
      `SELECT e.employee_code, e.name AS employee_name, ARRAY_AGG(DISTINCT r.name ORDER BY r.name) AS roles,
              ARRAY_AGG(DISTINCT p.sector_name ORDER BY p.sector_name) AS scopes
       FROM employee e
       JOIN employee_role er ON er.employee_id = e.id
       JOIN job_role r ON r.id = er.role_id
       JOIN role_sector_permission p ON p.role_id = r.id
       WHERE e.active AND e.employee_code = $1
       GROUP BY e.employee_code, e.name`,
      [employeeCode]
    );
    const row = result.rows[0];
    if (!row) throw new ForbiddenException("Colaborador sem perfil de acesso ativo.");
    return { employeeCode: row.employee_code, employeeName: row.employee_name, roles: row.roles, scopes: row.scopes.filter((scope) => scope !== "TUDO"), fullAccess: row.scopes.includes("TUDO") };
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
