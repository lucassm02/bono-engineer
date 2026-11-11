import { discordConfig } from './config.ts';
import { startDiscordRadio } from './main.ts';

try {
  const test = process.argv.includes('--test');
  const close = startDiscordRadio(discordConfig(process.env), test, (message, error) => {
    if (error) console.error(`[Rádio] ${message}`);
    else console.log(`[Rádio] ${message}`);
  });
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch (error) {
  console.error(`[Rádio] ${(error as Error).message}`);
  process.exitCode = 1;
}
