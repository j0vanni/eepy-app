// Keeps Metro from crawling local agent worktrees (full copies of the app under .claude/worktrees).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const extra = /[/\\]\.claude[/\\]worktrees[/\\].*/;
const existing = config.resolver.blockList;
config.resolver.blockList = existing ? [].concat(existing, extra) : extra;

module.exports = config;
