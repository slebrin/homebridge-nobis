import { homedir } from 'node:os';
import { join } from 'node:path';

import { startDiagnosticBrowser } from './diagnostic-browser.js';

try {
  if (process.argv.length !== 2) {
    throw new Error('Arguments are not supported.');
  }
  const browser = await startDiagnosticBrowser(join(homedir(), '.homebridge-nobis-diagnostic', 'browser-storage'));
  process.stdout.write(`Diagnostic Nobis local : ${browser.url}\n`
    + 'Ouvrez cette adresse dans votre navigateur. Aucune connexion cloud avant votre clic.\n'
    + 'Mot de passe non enregistre. Ctrl+C pour arreter.\n');
  let closing = false;
  const close = () => {
    if (closing) {
      return;
    }
    closing = true;
    void browser.close().catch(() => {
      process.stderr.write('Echec de fermeture de l\'interface locale.\n');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
} catch {
  process.stderr.write('Impossible de demarrer le diagnostic navigateur. Aucun argument accepte ; details prives non journalises.\n');
  process.exitCode = 1;
}
