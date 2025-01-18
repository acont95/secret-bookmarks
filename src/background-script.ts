// This will run when a bookmark is created.
browser.bookmarks.onCreated.addListener(async (id, bookmark) => {
    console.log("BACKGROUND");
    if (bookmark.type == "bookmark") {
        console.log("IS BOOKMARK");
        let parentNode = (await browser.bookmarks.getSubTree(id))[0];
        console.log(parentNode);
        let nodeSettings = await getNodeSettings(parentNode.id);
        console.log(nodeSettings);
        console.log("HUH");
        if (!$.isEmptyObject(nodeSettings) && (<NodeSettings> nodeSettings).locked) {
            let publicKey = await importPublicKey((<NodeSettings> nodeSettings).publicKey!);
            let bookmarkNode = (await browser.bookmarks.getSubTree(parentNode.id))[0];
            await encryptBookmarks(bookmarkNode, publicKey);
        }
    }
});
