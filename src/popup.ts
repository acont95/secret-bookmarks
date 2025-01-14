interface NodeSettings {
    locked: boolean;
    iv?: string
    salt?: string
    key?: string
}

function createListItemSwitch(checked: boolean) {
    let inputElement;
    if (checked) {
        inputElement = `
            <input type="checkbox" 
                class="lock-toggle" checked>
        `;
    } else {
        inputElement = `
            <input type="checkbox" 
                class="lock-toggle">
        `;
    }
    let span = '<span class="slider round"></span>';
    return $('<label class="switch">').append(inputElement, span);      
}

function createListItemFieldset() {
    return $(`
        <fieldset class="password-enter-fieldset hide-item">
            <label>Passphrase</label>
            <input class="password password-enter-input" type="password"/>
            <div class="password-fail hide-item">Wrong password. Try again.</div>
            <button type="button" class="password-enter-button">Submit</button>
        </fieldset>
        <fieldset class="password-set-fieldset hide-item">
            <label>Passphrase</label>
            <input class="password password-set password-set-input" type="password"/>
            <label>Confirm Passphrase</label>
            <input class="password password-set password-set-confirm-input" type="password"/>
            <button type="button" class="password-set-button">Submit</button>
        </fieldset>
    `)
}

function createListItem(title: string, nodeId: string, checked: boolean) : JQuery<HTMLElement> {
    return $(`<li tabindex="1" data-node-id="${nodeId}">`).append(
        createListItemSwitch(checked),
        title,
        createListItemFieldset()
    );
}

async function traverseBookmarks(node: browser.bookmarks.BookmarkTreeNode, parentElement: any) {
    if (node.children == null) {
        return;
    }

    let newList = $("<ol>");
    parentElement.append(newList);
    for (let childNode of node.children) {
        if (childNode.type == "folder") {
            let nodeSettings = await getNodeSettings(childNode.id);
            let checked = false;
            let state = "unmanaged";
            if (!$.isEmptyObject(nodeSettings)) {
                checked = (<NodeSettings> nodeSettings).locked;
                state = (<NodeSettings> nodeSettings).locked ? "locked" : "unlocked";
                $("#messagebox").text("No encryption key found. Enter passphrase to enable encryption.");
            } 
            let listItem = createListItem(childNode.title, childNode.id, checked);
            listItem.addClass(state);
            newList.append(listItem);
        }
        await traverseBookmarks(childNode, newList);
    }
}

async function createTree(node: browser.bookmarks.BookmarkTreeNode) {
    let rootElement = $("<div id='tree-root-div'>");
    await traverseBookmarks(node, rootElement);
    rootElement.find("input").attr("id", function(index, id) {
        let uid = `input_${index}`;
        $(this).prevAll("label").first().attr("for", uid);
        return uid;
    });
    $('#bookmark_tree').append(rootElement);
}

/*
Get some key material to use as input to the deriveKey method.
The key material is a password supplied by the user.
*/
function getKeyMaterial(passphrase: string) : Promise<CryptoKey> {
    const enc = new TextEncoder();
    return window.crypto.subtle.importKey(
        "raw",
        enc.encode(passphrase),
        { name: "PBKDF2" },
        false,
        ["deriveBits", "deriveKey"],
    );
}

/*
Given some key material and some random salt
derive an AES-KW key using PBKDF2.
*/
function getKey(keyMaterial: CryptoKey, salt: Uint8Array) : Promise<CryptoKey> {
    return window.crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            salt,
            iterations: 100000,
            hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-KW", length: 256 },
        true,
        ["wrapKey", "unwrapKey"],
    );
}

/*
Wrap the given key.
*/
async function wrapCryptoKey(keyToWrap: CryptoKey, passphrase: string, salt: Uint8Array) : Promise<ArrayBuffer> {
    // get the key encryption key
    const keyMaterial = await getKeyMaterial(passphrase);
    const wrappingKey = await getKey(keyMaterial, salt);
    return window.crypto.subtle.wrapKey("raw", keyToWrap, wrappingKey, "AES-KW");
}

/*
Derive an AES-KW key using PBKDF2.
*/
async function getUnwrappingKey(password: string, salt: Uint8Array) : Promise<CryptoKey> {
    const keyMaterial = await getKeyMaterial(password);

    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: 100000,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-KW", length: 256 },
      true,
      ["wrapKey", "unwrapKey"],
    );
}

async function encryptBookmarks(node: browser.bookmarks.BookmarkTreeNode, key: CryptoKey, iv: Uint8Array) {
    if (node.children == null){
        return;
    }
    let baseUrl = "data:text/plain;base64,";
    let encryptedTitle: ArrayBuffer;
    let encryptedUrl: ArrayBuffer;
    let encoder = new TextEncoder();
    for (let childNode of node.children) {
        if (childNode.type == "bookmark" && !childNode.url!.includes(baseUrl)) {
            encryptedTitle = await crypto.subtle.encrypt(
                {name: "AES-GCM", iv: iv},
                key,
                encoder.encode(childNode.title)
            );
    
            encryptedUrl = await crypto.subtle.encrypt(
                {name: "AES-GCM", iv: iv},
                key,
                encoder.encode(childNode.url)
            );

            let b64Title = bytesToBase64(new Uint8Array(encryptedTitle));
            let b64Url = bytesToBase64(new Uint8Array(encryptedUrl));

            await browser.bookmarks.update(
                childNode.id,
                {
                    title: b64Title,
                    url: `${baseUrl}${b64Url}`
                }
            );
        }
    }
}

async function decryptBookmarks(node: browser.bookmarks.BookmarkTreeNode, key: CryptoKey, iv: Uint8Array) {
    if (node.children == null){
        return;
    }
    let baseUrl = "data:text/plain;base64,";
    let decryptedTitle: ArrayBuffer;
    let decryptedUrl: ArrayBuffer;
    let decoder = new TextDecoder();

    for (let childNode of node.children) {
        if (childNode.type == "bookmark" && childNode.url!.includes(baseUrl)) {
            decryptedTitle = await crypto.subtle.decrypt(
                {name: "AES-GCM", iv: iv},
                key,
                base64ToBytes(childNode.title)
            );
    
            decryptedUrl = await crypto.subtle.decrypt(
                {name: "AES-GCM", iv: iv},
                key,
                base64ToBytes(childNode.url!.replace(baseUrl, ""))
            );
    
            browser.bookmarks.update(
                childNode.id,
                {
                    title: decoder.decode(decryptedTitle),
                    url: decoder.decode(decryptedUrl)
                }
            );
        }
    }
}

function bytesToBase64(bytes: Uint8Array) : string {
    const binString = Array.from(bytes, (byte) =>
        String.fromCodePoint(byte),
    ).join("");
    return btoa(binString);
}

function base64ToBytes(base64: string) : Uint8Array {
    const binString = atob(base64);
    return Uint8Array.from(binString, (m) => m.codePointAt(0)!);
}

/*
Convert an array of byte values to an ArrayBuffer.
*/
function bytesToArrayBuffer(bytes: Uint8Array) : ArrayBuffer {
    const bytesAsArrayBuffer = new ArrayBuffer(bytes.length);
    const bytesUint8 = new Uint8Array(bytesAsArrayBuffer);
    bytesUint8.set(bytes);
    return bytesAsArrayBuffer;
}

async function getNodeSettings(nodeId: string) : Promise<NodeSettings | {}> {
    let key = `node_settings/${nodeId}`;
    let settings = await browser.storage.sync.get(key);
    if (!$.isEmptyObject(settings)) {
        return settings[key] as NodeSettings;
    } else {
        return {};
    }
}

async function updateNodeSettings(nodeId: string, newSettings: NodeSettings) {
    let existingSettings = await getNodeSettings(nodeId);
    $.extend(existingSettings, newSettings);
    return browser.storage.sync.set({[`node_settings/${nodeId}`]: existingSettings});
}

async function getEncryptionDetailsFromNodeSettings(
    password: string,
    nodeSettings: NodeSettings
) : Promise<{initializationVector: Uint8Array<ArrayBuffer>, secretKey: CryptoKey}>  {
    let salt = base64ToBytes(nodeSettings.salt!);
    let initializationVector = base64ToBytes(nodeSettings.iv!);
    let wrappedKey = bytesToArrayBuffer(base64ToBytes(nodeSettings.key!));
    let unwrapKey = await getUnwrappingKey(password, salt);
    let secretKey = await crypto.subtle.unwrapKey(
        "raw", 
        wrappedKey, 
        unwrapKey,
        {name: "AES-KW"},
        {name: "AES-GCM"},
        true,
        ["encrypt", "decrypt"]
    );

    return {
        initializationVector : initializationVector,
        secretKey : secretKey
    }
}

async function onSubmitPasswordSet(listItem : JQuery<HTMLLIElement>, selectedNodeId: string) {
    console.log("SUBMIT");
    let password = listItem.find("input.password-set-input").val()!.toString();
    let iv = crypto.getRandomValues(new Uint8Array(12));
    let salt = crypto.getRandomValues(new Uint8Array(16));

    let secretKey = await window.crypto.subtle.generateKey(
        {name: "AES-GCM", length: 256},
        true,
        ["encrypt", "decrypt"],
    );

    let wrappedKey = await wrapCryptoKey(secretKey, password, salt);

    let jsonSettings = {
        locked: true,
        iv: bytesToBase64(iv),
        salt: bytesToBase64(salt),
        key: bytesToBase64(new Uint8Array(wrappedKey))
    };

    await updateNodeSettings(selectedNodeId, jsonSettings);

    $('.password').val("");
    listItem.find("fieldset.password-set-fieldset").addClass("hide-item");
    listItem.find("input.lock-toggle").prop("checked", true);

    let bookmarkNode = (await browser.bookmarks.getSubTree(selectedNodeId))[0];
    await encryptBookmarks(bookmarkNode, secretKey, iv);
    $("#messagebox").text("Encryption successful.");
}

async function onSubmitPasswordEnter(listItem : JQuery<HTMLLIElement>, selectedNodeId: string) {
    console.log("Password Enter Submit");
    let nodeCheckbox = listItem.find("input.lock-toggle");
    let bookmarkNode = (await browser.bookmarks.getSubTree(selectedNodeId))[0];
    let nodeSettings = await getNodeSettings(selectedNodeId);
    let password = listItem.find("input.password-enter-input").val()!.toString();

    try {
        let encryptionDetails = await getEncryptionDetailsFromNodeSettings(password, <NodeSettings> nodeSettings);
        switch (nodeCheckbox.prop("checked")) {
            case true:
                console.log("ENCRYPT");
                await encryptBookmarks(bookmarkNode, encryptionDetails.secretKey, encryptionDetails.initializationVector);
                await updateNodeSettings(selectedNodeId, {locked:true});
                break;
            case false:
                console.log("DECRYPT");
                await decryptBookmarks(bookmarkNode, encryptionDetails.secretKey, encryptionDetails.initializationVector);
                await updateNodeSettings(selectedNodeId, {locked:false});
                break;
        }
        listItem.find("fieldset.password-enter-fieldset").addClass("hide-item");
    } catch (error) {
        // $(eventTarget).prop("checked", !eventTarget.checked);
        listItem.find("div.password-fail").removeClass("hide-item");
        console.log("Wrong Password");
    }
}

async function onClickLock(listItem : JQuery<HTMLLIElement>, selectedNodeId: string) {
    console.log("LOCK");
    let nodeSettings = await getNodeSettings(selectedNodeId);
    $("li").not(listItem).children("fieldset").addClass("hide-item");
    $("li").not(listItem).children("div.password-fail").addClass("hide-item");
    $(".password").val("");

    if ($.isEmptyObject(nodeSettings)) {
        // $(eventTarget).prop("checked", !eventTarget.checked);
        listItem.children("fieldset.password-set-fieldset").toggle();
    } else {
        // $(eventTarget).prop("checked", !eventTarget.checked);
        listItem.children("fieldset.password-enter-fieldset").toggle();
    }
}

async function onBookmarkClick(event: JQuery.TriggeredEvent) {
    let listItem = $(event.target).closest("li");
    let selectedNodeId = listItem.data("node-id");

    switch ((<HTMLElement> event.target).className) {
        case "lock-toggle":
            onClickLock(listItem, selectedNodeId);
            break;
        case "password-set-button":
            onSubmitPasswordSet(listItem, selectedNodeId);
            break;
        case "password-enter-button":
            onSubmitPasswordEnter(listItem, selectedNodeId);
            break;
        default:
            break;
    }
}

function onPasswordKeyup(listItem : JQuery<HTMLLIElement>) {
    console.log("onPasswordKeyup");
    let password = listItem.find("input.password-set-input").val();
    let passwordConfirm = listItem.find("input.password-set-confirm-input").val();
    $("button.password-set-button:visible").prop("disabled", password != passwordConfirm);
}

function onBookmarkKeyup(event: JQuery.TriggeredEvent) {
    console.log("onBookmarkKeyup");
    let listItem = $(event.target).closest("li");
    if ((<HTMLElement> event.target).classList.contains("password-set")) {
        onPasswordKeyup(listItem);
    }
}

async function onReady() {
    let rootNode = (await browser.bookmarks.getTree())[0];
    await createTree(rootNode);
    $("#bookmark_tree").on("click", onBookmarkClick);
    $("#bookmark_tree").on("keyup", onBookmarkKeyup);
}

$(onReady);
  