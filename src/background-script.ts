import { 
    NodeSettings, 
    getNodeSettings,
    importPublicKey,
    encryptBookmarks, 
    isEmpty
} from './common.js';

// This will run when a bookmark is created.
browser.bookmarks.onCreated.addListener(async (id, bookmark) => {
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
});
