// Preserve old bookmarks without shipping a separate application or dashboard.
const section = location.hash.slice(1);
const allowed = ["tasks", "notes", "activity", "settings", "learning"];
location.replace(chrome.runtime.getURL(`newtab.html#${allowed.includes(section) ? section : "chat"}`));
