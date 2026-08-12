export interface AuthenticatedUser {
  userId: string;
  name: string;
  firstname: string;
  email: string;
  roleName: string;
  permissions: string[];
}

declare module 'express' {
  interface Request {
    user?: AuthenticatedUser;
    token?: string;
  }
}
