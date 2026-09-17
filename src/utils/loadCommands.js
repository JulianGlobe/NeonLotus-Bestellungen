import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

export async function loadCommands(client) {
  const commandsPath = path.resolve('src/commands');
  const files = fs.readdirSync(commandsPath)
    .filter(file => file.endsWith('.js'))
    .sort();

  for (const file of files) {
    const fileUrl = pathToFileURL(path.join(commandsPath, file)).href;
    const imported = await import(fileUrl);
    const command = imported.default;

    if (!command?.data || !command?.execute) {
      console.warn(`⚠️ Überspringe ${file}: data oder execute fehlt.`);
      continue;
    }

    client.commands.set(command.data.name, command);
  }
}
