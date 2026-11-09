import { DatabaseStore, SessionRow, ProviderAdapter, ToolRegistry } from '@tendril/core';

export interface ServerOptions {
  port?: number;
  db: DatabaseStore;
  cliToken: string;
  configPath?: string;
  authPath?: string;
  staticDir?: string;
  providerAdapter?: ProviderAdapter;
  toolRegistry?: ToolRegistry;
}

export type AuthType = 'bearer' | 'cookie';

export interface AuthContext {
  type: AuthType;
  clientId?: string;
  tokenHash?: string;
  label?: string;
}

export interface TendrilEnv {
  Variables: {
    auth?: AuthContext;
    session?: SessionRow;
  };
}
