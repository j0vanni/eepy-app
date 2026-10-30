// Keeps Metro from crawling local agent worktrees (full copies of the app under .claude/worktrees).
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// Anchored to this project's own .claude/worktrees, so a build run from inside a worktree (whose
// root is itself under .claude/worktrees) doesn't block its own files.
const worktrees = path.join(__dirname, '.claude', 'worktrees').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const extra = new RegExp(`^${worktrees}[/\\\\].*`);
const existing = config.resolver.blockList;
config.resolver.blockList = existing ? [].concat(existing, extra) : extra;

module.exports = config;
