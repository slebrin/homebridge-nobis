import { AguaError } from './agua/errors.js';
import { ConfigError } from './config.js';
import { DIAGNOSTIC_HELP, runDiagnostic } from './diagnostic.js';

const shutdown = new AbortController();
const stop = () => shutdown.abort();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

try {
  const result = await runDiagnostic(process.argv.slice(2), { signal: shutdown.signal });
  if (!result.connected) {
    process.stdout.write(DIAGNOSTIC_HELP);
  } else {
    process.stdout.write(`Read-only diagnostic complete: ${result.registerCount} register definitions`
      + (result.readingCount === undefined ? '. No buffer read.' : `; ${result.readingCount} raw buffer values.`)
      + '\nPrivate report saved in the requested storage/reports directory. Do not publish it without review.\n');
  }
} catch (error) {
  process.stderr.write(`${error instanceof AguaError || error instanceof ConfigError
    ? error.message : 'Nobis diagnostic failed. Private error details are not logged.'}\n`);
  process.exitCode = shutdown.signal.aborted ? 130 : 1;
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}
