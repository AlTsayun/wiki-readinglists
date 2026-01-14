importScripts("dist/browser-polyfill.min.js");

const supportedHosts = ["wikipedia.org", "wikivoyage.org"];

const supportedNamespaces = [
  0 // NS_MAIN
];

function isSupportedHost(hostname) {
  for (let i = 0; i < supportedHosts.length; i++) {
    const host = supportedHosts[i];
    if (hostname.endsWith(host)) {
      return true;
    }
  }
  return false;
}

function isSupportedNamespace(ns) {
  return supportedNamespaces.includes(ns);
}

function isSavablePage(path, params) {
  return (
    path.includes("/wiki/") ||
    (path.includes("index.php") && params.has("title"))
  );
}

function shouldShowPageAction(url, ns) {
  return (
    isSupportedHost(url.hostname) &&
    isSupportedNamespace(ns) &&
    isSavablePage(url.pathname, url.searchParams)
  );
}

function initializePageAction(tab) {
  if (!tab || !tab.url) return;
  const url = new URL(tab.url);
  const action = browser.action || browser.pageAction;
  browser.tabs
    .sendMessage(tab.id, { type: "wikiExtensionGetPageNamespace" })
    .then(res => {
      if (shouldShowPageAction(url, res.ns)) {
        action.show(tab.id);
      } else {
        action.hide(tab.id);
      }
    })
    .catch(() => {
      action.hide(tab.id);
    });
}

function initializeAllTabs() {
  browser.tabs.query({}).then(tabs => {
    for (let tab of tabs) initializePageAction(tab);
  });
}

browser.runtime.onInstalled.addListener(() => initializeAllTabs());
browser.runtime.onStartup.addListener(() => initializeAllTabs());

browser.tabs.onUpdated.addListener((id, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    initializePageAction(tab);
  }
});

browser.tabs.onActivated.addListener(activeInfo => {
  browser.tabs.get(activeInfo.tabId).then(tab => initializePageAction(tab));
});
