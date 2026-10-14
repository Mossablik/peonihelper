const { EmbedBuilder } = require('discord.js');
const config = require('../../config.json');

const colors = {
  primary: config.colors?.primary || config.embedColor || '#5865F2',
  success: config.colors?.success || '#57F287',
  error: config.colors?.error || '#ED4245',
  warning: config.colors?.warning || '#FEE75C',
  premium: config.colors?.premium || '#FEE75C',
  moderation: config.colors?.moderation || '#EB459E',
  info: config.colors?.info || '#3498DB',
};

/** Bare embed with the bot colour and a timestamp already set. */
function base(color = colors.primary) {
  return new EmbedBuilder().setColor(color).setTimestamp();
}

/** Green success embed. */
function success(description, title) {
  const embed = base(colors.success).setDescription(description);
  return title ? embed.setTitle(title) : embed;
}

/** Red error embed. */
function error(description, title) {
  const embed = base(colors.error).setDescription(description);
  return title ? embed.setTitle(title) : embed;
}

/** Blue information embed. */
function info(description, title) {
  const embed = base(colors.info).setDescription(description);
  return title ? embed.setTitle(title) : embed;
}

/** Yellow warning embed. */
function warn(description, title) {
  const embed = base(colors.warning).setDescription(description);
  return title ? embed.setTitle(title) : embed;
}

/** Gold premium embed. */
function premium(description, title) {
  const embed = base(colors.premium).setDescription(description);
  return title ? embed.setTitle(title) : embed;
}

/** Pink moderation embed. */
function moderation(description, title) {
  const embed = base(colors.moderation).setDescription(description);
  return title ? embed.setTitle(title) : embed;
}

module.exports = { colors, base, success, error, info, warn, premium, moderation, EmbedBuilder };
