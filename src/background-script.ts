import { 
    NodeSettings, 
    getNodeSettings,
    importPublicKey,
    encryptBookmarks, 
    isEmpty
} from './common.js';

async function handleChangedBookmark(bookmark: browser.bookmarks.BookmarkTreeNode) {
    if (bookmark.type == "bookmark") {
        try {
            let nodeSettings = await getNodeSettings(bookmark.parentId!);
            if (!isEmpty(nodeSettings) && (<NodeSettings> nodeSettings).locked) {
                let publicKey = await importPublicKey((<NodeSettings> nodeSettings).publicKey!);
                let parentNodeTree = (await browser.bookmarks.getSubTree(bookmark.parentId!))[0];
                await encryptBookmarks(parentNodeTree, publicKey);
            }
        } catch (error) {
            console.log(error);
        }
    }
}

// This will run when a bookmark is created.
browser.bookmarks.onCreated.addListener(async (id, bookmark) => {
    await handleChangedBookmark(bookmark);
});

// This will run when a bookmark is moved.
browser.bookmarks.onMoved.addListener(async (id, moveInfo) => {
    let bookmark = (await browser.bookmarks.get(id))[0];
    await handleChangedBookmark(bookmark);
});

browser.runtime.onInstalled.addListener(async ({ reason, temporary }) => {
    switch (reason) {
        case "install":
            const url = browser.runtime.getURL("public/html/installed.html");
            await browser.tabs.create({ url });
            break;
    }
});
