// Local friend store — JSON file in the working directory

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { cwd } from "./shared.js";

const FRIENDS_FILE = join(cwd, ".claude-duo-friends.json");

function loadFriends() {
  if (!existsSync(FRIENDS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(FRIENDS_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function saveFriends(friends) {
  writeFileSync(FRIENDS_FILE, JSON.stringify(friends, null, 2));
}

export function getFriendKey(id) {
  const friends = loadFriends();
  return friends[id]?.key || null;
}

export function addFriend(id, name, key) {
  const friends = loadFriends();
  friends[id] = { name, key, added_at: new Date().toISOString() };
  saveFriends(friends);
}

export function removeFriend(id) {
  const friends = loadFriends();
  if (!friends[id]) return false;
  delete friends[id];
  saveFriends(friends);
  return true;
}

export function listFriends() {
  return loadFriends();
}

export function isFriend(id) {
  const friends = loadFriends();
  return !!friends[id];
}
