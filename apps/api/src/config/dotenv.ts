import { config } from 'dotenv';
import { resolve } from 'node:path';

export const loadEnvFile = (filePath = '.env'): void => {
  config({ path: resolve(process.cwd(), filePath) });
};
