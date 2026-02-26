import { resolve } from 'node:path';
import { config } from 'dotenv';

export const loadEnvFile = (filePath = '.env'): void => {
  config({ path: resolve(process.cwd(), filePath) });
};
