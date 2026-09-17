import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Prüft, ob der Bot erreichbar ist.'),

  async execute(interaction) {
    await interaction.reply(`🏓 Pong! ${interaction.client.ws.ping} ms`);
  }
};
