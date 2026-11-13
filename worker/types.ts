export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> };
  APP_ENV?: string; APP_ORIGIN?: string; LOCAL_DEMO?: string; LOCAL_DEMO_ORIGIN?: string;
  SESSION_SECRET?: string; SESSION_VERSION?: string;
  ADMIN_EMAIL?: string; ADMIN_GOOGLE_SUB?: string;
  GOOGLE_CLIENT_ID?: string; GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REFRESH_TOKEN?: string; GOOGLE_SCRIPT_DEPLOYMENT_ID?: string;
  GOOGLE_INVENTORY_REFRESH_TOKEN?: string; GOOGLE_INVENTORY_DEPLOYMENT_ID?: string;
  BUSINESS_TIMEZONE?: string;
}
export interface AdminSession {
  sub: string; email: string; name: string; mode: 'sample' | 'google';
  csrf: string; exp: number; version: string;
}
export type Fetcher = typeof fetch;
export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}
