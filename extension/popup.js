const MESSAGE_KEYS = {
  enableSync: "readinglists-browser-enable-sync-prompt",
  entryLimitExceeded: "readinglists-browser-list-entry-limit-exceeded",
  errorIntro: "readinglists-browser-error-intro",
  infoLinkText: "readinglists-browser-extension-info-link-text",
  loginButtonText: "login",
  loginPrompt: "readinglists-browser-login-prompt",
  success: "readinglists-browser-add-entry-success"
};

const ALLMESSAGES_QUERY = {
  action: "query",
  format: "json",
  formatversion: "2",
  meta: "allmessages",
  amenableparser: ""
};

let allReadingLists = [];
let listSelectionContext = null;

function objToQueryString(obj) {
  return Object.keys(obj)
    .map(key => `${key}=${obj[key]}`)
    .join("&");
}

function getReadingListsUrlForOrigin(origin, rlcontinue) {
  let result = `${origin}/w/api.php?action=query&meta=readinglists&rllimit=max&format=json`;
  if (rlcontinue) {
    result = result.concat(`&rlcontinue=${encodeURIComponent(rlcontinue)}`);
  }
  return result;
}

function readingListPostEntryUrlForOrigin(origin, listId, token) {
  return `${origin}/api/rest_v1/data/lists/${listId}/entries/?csrf_token=${encodeURIComponent(
    token
  )}`;
}

function readingListEntryLookupUrlForOrigin(origin, title, project) {
  return `${origin}/w/api.php?action=query&meta=readinglists&rlproject=${encodeURIComponent(
    project
  )}&rltitle=${encodeURIComponent(title)}&format=json`;
}

function csrfFetchUrlForOrigin(origin) {
  return `${origin}/w/api.php?action=query&format=json&formatversion=2&meta=tokens&type=csrf`;
}

function geti18nMessageUrl(origin, keys) {
  return `${origin}/w/api.php?${objToQueryString(
    Object.assign(ALLMESSAGES_QUERY, { ammessages: keys.join("|") })
  )}`;
}

function fetchBundledMessagesForLang(lang) {
  return fetch(browser.runtime.getURL(`i18n/${lang}.json`));
}

function getBundledMessage(lang, keys) {
  return fetchBundledMessagesForLang(lang)
    .then(res => res.json())
    .then(res => {
      const result = {};
      keys.forEach(key => {
        result[key] = res[key];
      });
      return result;
    });
}

/**
 * Get UI messages from the MediaWiki API (in the user's preferred UI lang), falling back to bundled
 * English strings if this fails.
 * @param {string} origin the origin of the site URL
 * @param {Array[string]} keys message keys to request
 */
function geti18nMessages(origin, keys) {
  return fetch(geti18nMessageUrl(origin, keys), { credentials: "same-origin" })
    .then(res => {
      if (!res.ok) {
        throw res;
      } else {
        return res.json();
      }
    })
    .then(res => {
      if (res.query && res.query.allmessages && res.query.allmessages.length) {
        const result = {};
        res.query.allmessages.forEach(messageObj => {
          result[messageObj.name] = messageObj.content;
        });
        return result;
      } else {
        return getBundledMessage("en", keys);
      }
    });
}

function getCurrentTab() {
  return browser.tabs
    .query({ currentWindow: true, active: true })
    .then(tabs => tabs[0]);
}

function getCsrfToken(origin) {
  return fetch(csrfFetchUrlForOrigin(origin), { credentials: "same-origin" })
    .then(res => res.json())
    .then(res => res.query.tokens.csrftoken);
}

function getReadingListsPage(url, rlcontinue) {
  return fetch(getReadingListsUrlForOrigin(url.origin, rlcontinue), {
    credentials: "same-origin"
  })
    .then(res => {
      if (res.status < 200 || res.status > 399) {
        return res.json().then(res => {
          // Must be thrown from here for Firefox
          throw res;
        });
      } else {
        return res.json();
      }
    })
    .then(res => {
      return res;
    });
}

function getAllReadingLists(url, rlcontinue, lists) {
  const combined = lists || [];
  return getReadingListsPage(url, rlcontinue).then(res => {
    const pageLists =
      res && res.query && res.query.readinglists ? res.query.readinglists : [];
    const nextLists = combined.concat(pageLists);
    const nextContinue =
      res && res.continue && res.continue.rlcontinue
        ? res.continue.rlcontinue
        : null;
    if (nextContinue) {
      return getAllReadingLists(url, nextContinue, nextLists);
    }
    return nextLists;
  });
}

function parseTitleFromUrl(href) {
  const url = new URL(href);
  return url.searchParams.has("title")
    ? url.searchParams.get("title")
    : url.pathname.replace("/wiki/", "");
}

function show(id) {
  // Use setTimeout to work around an extension popup resizing bug on Chrome
  // see https://bugs.chromium.org/p/chromium/issues/detail?id=428044
  setTimeout(() => {
    document.getElementById(id).style.display = "block";
  }, 200);
}

function hide(id) {
  document.getElementById(id).style.display = "none";
}

function setListStatus(text) {
  const status = document.getElementById("listStatus");
  if (text) {
    status.textContent = text;
    status.style.display = "block";
  } else {
    status.textContent = "";
    status.style.display = "none";
  }
}

function setListLoading(isLoading) {
  document.getElementById("listLoading").style.display = isLoading
    ? "block"
    : "none";
}

function normalizeListName(name) {
  return (name || "").toLowerCase();
}

function renderReadingLists() {
  const listResults = document.getElementById("listResults");
  const listEmpty = document.getElementById("listEmpty");
  const filter = normalizeListName(
    document.getElementById("listSearchInput").value
  );

  listResults.textContent = "";
  const filtered = allReadingLists.filter(list =>
    normalizeListName(list.name).includes(filter)
  );

  if (!filtered.length) {
    listEmpty.style.display = "block";
    return;
  }

  listEmpty.style.display = "none";
  filtered.forEach(list => {
    const listItem = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "listButton";
    button.dataset.listId = list.id;

    const name = document.createElement("span");
    name.className = "listName";
    name.textContent = list.name;
    button.appendChild(name);

    const meta = document.createElement("span");
    meta.className = "listMeta";

    if (list.default) {
      const defaultTag = document.createElement("span");
      defaultTag.className = "listDefaultTag";
      defaultTag.textContent = "Default";
      meta.appendChild(defaultTag);
    }

    if (typeof list.size === "number") {
      const sizeTag = document.createElement("span");
      sizeTag.className = "listSizeTag";
      sizeTag.textContent = `${list.size}`;
      meta.appendChild(sizeTag);
    }

    if (list.hasEntry) {
      const savedIcon = document.createElement("span");
      savedIcon.className = "listSavedIcon";
      savedIcon.title = "Saved in this list";
      meta.appendChild(savedIcon);
    }

    if (meta.childNodes.length) {
      button.appendChild(meta);
    }

    button.addEventListener("click", () => handleListSelection(list));
    listItem.appendChild(button);
    listResults.appendChild(listItem);
  });
}

function setListUiDisabled(disabled) {
  document.getElementById("listSearchInput").disabled = disabled;
  document.querySelectorAll(".listButton").forEach(button => {
    button.disabled = disabled;
  });
}

function showListSelection() {
  hide("loginPromptContainer");
  hide("addToListSuccessContainer");
  hide("addToListFailedContainer");
  show("listSelectionContainer");
}

function showLoginPage(url, title) {
  let loginUrl = `${
    url.origin
  }/wiki/Special:UserLogin?returnto=${encodeURIComponent(title)}`;
  if (url.search) {
    loginUrl = loginUrl.concat(
      `&returntoquery=${encodeURIComponent(url.search.slice(1))}`
    );
  }
  browser.tabs.update({ url: loginUrl });
}

function showLoginPrompt(tab, url) {
  return geti18nMessages(url.origin, [
    MESSAGE_KEYS.loginPrompt,
    MESSAGE_KEYS.loginButtonText
  ]).then(messages =>
    getCanonicalPageTitle(tab).then(title => {
      hide("listSelectionContainer");
      document.getElementById("loginPromptText").textContent =
        messages[MESSAGE_KEYS.loginPrompt];
      document.getElementById("loginButton").textContent =
        messages[MESSAGE_KEYS.loginButtonText];
      document.getElementById("loginButton").onclick = () =>
        showLoginPage(url, title);
      show("loginPromptContainer");
    })
  );
}

function showAddToListSuccessMessage(tab, url, list) {
  return geti18nMessages(url.origin, [MESSAGE_KEYS.success]).then(messages =>
    getCanonicalPageTitle(tab).then(title => {
      hide("listSelectionContainer");
      const placeholder = "$1";
      const successTextContainer = document.getElementById("successText");
      const titleText = decodeURIComponent(title).replace(/_/g, " ");
      const titleElem = document.createElement("span");
      titleElem.className = "successTitle";
      titleElem.textContent = titleText;
      const listName = list && list.name ? list.name : "reading list";
      let message = messages[MESSAGE_KEYS.success];
      message = message.replace(/<[^>]+>/g, "");
      message = message
        .replace(/\[\[\$2\|\$3\]\]/g, listName)
        .replace("$2", listName)
        .replace("$3", listName);
      if (message.includes(placeholder)) {
        successTextContainer.textContent = message;
        const newTextNode = successTextContainer.firstChild.splitText(
          message.indexOf(placeholder)
        );
        newTextNode.deleteData(0, placeholder.length);
        successTextContainer.insertBefore(titleElem, newTextNode);
      } else {
        successTextContainer.textContent = message;
      }
      show("addToListSuccessContainer");
    })
  );
}

function showAddToListFailureMessage(url, res) {
  return geti18nMessages(url.origin, [
    MESSAGE_KEYS.enableSync,
    MESSAGE_KEYS.infoLinkText,
    MESSAGE_KEYS.entryLimitExceeded,
    MESSAGE_KEYS.errorIntro
  ]).then(messages => {
    hide("listSelectionContainer");
    let message;
    if (res.title === "readinglists-db-error-not-set-up") {
      message = messages[MESSAGE_KEYS.enableSync];
      const learnMoreLink = document.getElementById("learnMoreLink");
      learnMoreLink.textContent = messages[MESSAGE_KEYS.infoLinkText];
      learnMoreLink.onclick = () =>
        browser.tabs.create({ url: learnMoreLink.href });
      document.getElementById("learnMoreLinkContainer").style.display = "block";
    } else if (res.title === "readinglists-db-error-entry-limit") {
      const maxEntries =
        si.query.general["readinglists-config"].maxEntriesPerList;
      message = messages[MESSAGE_KEYS.entryLimitExceeded].replace(
        "$1",
        maxEntries.toString()
      );
    } else {
      const detail = res.detail
        ? res.detail
        : res.title
          ? res.title
          : res.type
            ? res.type
            : typeof res === "object"
              ? JSON.stringify(res)
              : res;
      message = messages[MESSAGE_KEYS.errorIntro].replace("$1", detail);
    }
    document.getElementById("failureReason").textContent = message;
    show("addToListFailedContainer");
  });
}

function mobileToCanonicalHost(url) {
  url.hostname = url.hostname.replace(/^m\./, "").replace(".m.", ".");
  return url;
}

function getAddToListPostBody(url, title) {
  return JSON.stringify({
    project: mobileToCanonicalHost(url).origin,
    title
  });
}

function getAddToListPostOptions(url, title) {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "same-origin",
    body: getAddToListPostBody(url, title)
  };
}

function handleAddPageToListResult(tab, url, res, list) {
  if (res.id) showAddToListSuccessMessage(tab, url, list);
  else showAddToListFailureMessage(url, res);
}

function getCanonicalPageTitle(tab) {
  return browser.tabs
    .sendMessage(tab.id, { type: "wikiExtensionGetPageTitle" })
    .then(res => parseTitleFromUrl(res.href))
    .catch(() => parseTitleFromUrl(tab.url));
}

function addPageToList(tab, url, listId, token, list) {
  return getCanonicalPageTitle(tab)
    .then(title =>
      fetch(
        readingListPostEntryUrlForOrigin(url.origin, listId, token),
        getAddToListPostOptions(url, title)
      )
    )
    .then(res => res.json())
    .then(res => handleAddPageToListResult(tab, url, res, list));
}

function handleListSelection(list) {
  if (!listSelectionContext) return;
  setListUiDisabled(true);
  setListStatus(`Saving to "${list.name}"...`);
  return addPageToList(
    listSelectionContext.tab,
    listSelectionContext.url,
    list.id,
    listSelectionContext.token,
    list
  )
    .catch(err => showAddToListFailureMessage(listSelectionContext.url, err))
    .finally(() => {
      setListUiDisabled(false);
      setListStatus("");
    });
}

function getProjectOrigin(url) {
  return mobileToCanonicalHost(new URL(url.href)).origin;
}

function getListsContainingEntry(url, title) {
  return fetch(
    readingListEntryLookupUrlForOrigin(
      url.origin,
      title,
      getProjectOrigin(url)
    ),
    { credentials: "same-origin" }
  )
    .then(res => {
      if (!res.ok) return new Set();
      return res.json().then(data => {
        const lists =
          data && data.query && data.query.readinglists
            ? data.query.readinglists
            : [];
        return new Set(lists.map(list => list.id));
      });
    })
    .catch(() => new Set());
}

function markListsWithEntryStatus(tab, url, lists) {
  return getCanonicalPageTitle(tab)
    .then(title => getListsContainingEntry(url, title))
    .then(savedListIds =>
      lists.map(list =>
        Object.assign({}, list, { hasEntry: savedListIds.has(list.id) })
      )
    );
}

function handleTokenResult(tab, url, token) {
  if (token === "+\\") {
    return showLoginPrompt(tab, url);
  }

  listSelectionContext = { tab, url, token };
  showListSelection();
  setListLoading(true);
  setListStatus("");
  setListUiDisabled(true);
  hide("listEmpty");
  document.getElementById("listResults").textContent = "";

  return getAllReadingLists(url)
    .then(lists => {
      allReadingLists = lists.sort((a, b) => {
        if (a.default === b.default) return 0;
        return a.default ? -1 : 1;
      });
      setListLoading(false);
      renderReadingLists();
      setListUiDisabled(false);
      document.getElementById("listSearchInput").value = "";
      setListStatus("Checking saved status...");
      return markListsWithEntryStatus(tab, url, allReadingLists)
        .then(updatedLists => {
          allReadingLists = updatedLists;
          renderReadingLists();
        })
        .catch(() => {})
        .finally(() => {
          setListStatus("");
        });
    })
    .catch(err => {
      setListLoading(false);
      setListUiDisabled(false);
      return showAddToListFailureMessage(url, err);
    });
}

function handleClick(tab, url) {
  return getCsrfToken(url.origin).then(token =>
    handleTokenResult(tab, url, token)
  );
}

document
  .getElementById("listSearchInput")
  .addEventListener("input", renderReadingLists);

getCurrentTab().then(tab => {
  const url = new URL(tab.url);
  return handleClick(tab, url).catch(err =>
    showAddToListFailureMessage(url, err)
  );
});
