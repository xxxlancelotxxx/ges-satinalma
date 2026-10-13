import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

const rootDir = process.cwd();
const envLocal = path.join(rootDir, '.env.local');
const envFile = path.join(rootDir, '.env');

if (fs.existsSync(envLocal)) {
  dotenv.config({ path: envLocal });
}
if (fs.existsSync(envFile)) {
  dotenv.config({ path: envFile });
}
