import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CalculatorService } from '../service/calculator-service.ts';
import { JsonFileStore } from '../storage/file-store.ts';
import { createAppServer } from './server.ts';

const DEFAULT_PORT = 3210;
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_DATA_FILE = 'history.json';
const MAX_PORT = 65535;

function readPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > MAX_PORT) {
    throw new Error(`PORT must be an integer from 0 to ${MAX_PORT}, got '${raw}'`);
  }
  return port;
}

function main(): void {
  const port = readPort(process.env['PORT']);
  const host = process.env['HOST'] ?? DEFAULT_HOST;
  const dataFile = resolve(process.env['DATA_FILE'] ?? DEFAULT_DATA_FILE);
  const publicDir = fileURLToPath(new URL('./public/', import.meta.url));

  const service = new CalculatorService(new JsonFileStore(dataFile));
  const server = createAppServer({ service, publicDir });

  server.on('error', (error) => {
    console.error(`Server error: ${error.message}`);
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`Calculator listening on http://${host}:${port} (data file: ${dataFile})`);
  });

  const shutdown = (signal: string): void => {
    console.log(`${signal} received, shutting down`);
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main();
