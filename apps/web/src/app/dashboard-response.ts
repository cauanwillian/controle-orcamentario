export async function readDashboardResponse<T>(response: Response, fallback: string): Promise<T> {
  if (response.ok) return response.json() as Promise<T>;
  if (response.status === 400) {
    const body = await response.json().catch(() => null);
    if (typeof body?.message === "string") throw new Error(body.message);
  }
  throw new Error(fallback);
}
