import 'dotenv/config';
import { start } from './app/AppBootstrap.js';

async function main() {
  await start();
}

main();
