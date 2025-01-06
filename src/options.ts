interface NodeSettings {
    enabled: boolean;
    locked: boolean;
    iv: string
    salt: string
    key: string
}

function getSelectedNodeId() : string {
    return $("input[type='radio'][name='folder']:checked").val()!.toString();
}

function traverseBookmarks(node: browser.bookmarks.BookmarkTreeNode, parentList: any) {
    if (node.children == null) {
        return;
    }

    let newList = $("<ol>");
    parentList.append(newList);
    for (let childNode of node.children) {
        if (childNode.type == "folder") {
            newList.append($('<li tabindex="1">')
                .html(childNode.title)
                .prepend(`<input type="radio" name="folder" value="${childNode.id}">`));
        }
        traverseBookmarks(childNode, newList);
    }
}

function createTree(node: browser.bookmarks.BookmarkTreeNode) {
    let rootList = $("<ol>");
    rootList.append($("<li>").html('Bookmark Folders'));
    $('#bookmark_tree').append(rootList);
    traverseBookmarks(node, rootList);
}

async function onReady() {
    $("#bookmark_tree").on("click", "input[type='radio'][name='folder']", onFolderSelect);
    $("#enabled").on("click", onClickEnable);
    $("#locked").on("click", onClickLock);
    $(".password").on("keyup", onPasswordKeyup);
    $("#submit").on("click", onSubmit);

    let rootNode = (await browser.bookmarks.getTree())[0];
    createTree(rootNode);
}

function updateDomFromNodeSettings(nodeSettings: NodeSettings | {}) {
    let enabled = false;
    let locked = false;
    if (!$.isEmptyObject(nodeSettings)) {
        enabled = (<NodeSettings> nodeSettings).enabled;
        locked = (<NodeSettings> nodeSettings).locked;
    }
    $("#enabled").prop("checked", enabled);
    $("#locked").prop("checked", locked);
}

async function onFolderSelect() {
    let selectedNodeId = getSelectedNodeId();
    $("#enabled").prop("disabled", false);
    $("#locked").prop("disabled", false);
    let nodeSettings = await getNodeSettings(selectedNodeId);
    updateDomFromNodeSettings(nodeSettings);
}

async function onClickEnable(event: JQuery.TriggeredEvent) {
    let selectedNodeId = getSelectedNodeId();
    let nodeSettings = await getNodeSettings(selectedNodeId);
    let bookmarkNode = (await browser.bookmarks.getSubTree(selectedNodeId))[0];

    let eventTarget = <HTMLInputElement> event.target;
    onPasswordKeyup();
    
    switch (eventTarget.checked) {
        case true:
            $('.password').prop("disabled", false);
            break;
        case false:
            if ($.isEmptyObject(nodeSettings)) {
                let encryptionDetails = await getEncryptionDetailsFromSettings(<NodeSettings> nodeSettings);
                decryptBookmarks(bookmarkNode, encryptionDetails.secretKey, encryptionDetails.initializationVector);
                browser.storage.sync.remove(`node_settings/${selectedNodeId}`);
            }
            $('.password').prop("disabled", true);
            $('.password').val("");
            $('#submit').prop("disabled", true);
            break;
    }
}

function onPasswordKeyup() {
    let password = $("#passphrase").val();
    let passwordConfirm = $("#confirm_passphrase").val();
    $('#submit').prop("disabled", password != passwordConfirm);
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
async function getUnwrappingKey(salt: Uint8Array) {
    let password = window.prompt("Enter your password")!;
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

function bytesToBase64(bytes: Uint8Array) {
    const binString = Array.from(bytes, (byte) =>
        String.fromCodePoint(byte),
    ).join("");
    return btoa(binString);
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
        if (childNode.type == "bookmark") {
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

function base64ToBytes(base64: string) {
    const binString = atob(base64);
    return Uint8Array.from(binString, (m) => m.codePointAt(0)!);
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
        if (childNode.type == "bookmark") {
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

async function onSubmit() {
    let selectedNodeId = getSelectedNodeId();
    let password = $("#passphrase").val()!.toString();
    let iv = crypto.getRandomValues(new Uint8Array(12));
    let salt = crypto.getRandomValues(new Uint8Array(16));

    let secretKey = await window.crypto.subtle
        .generateKey(
            {
                name: "AES-GCM",
                length: 256,
            },
            true,
            ["encrypt", "decrypt"],
        );

    let wrappedKey = await wrapCryptoKey(secretKey, password, salt);

    let jsonSettings = {
        enabled: true,
        locked: true,
        iv: bytesToBase64(iv),
        salt: bytesToBase64(salt),
        key: bytesToBase64(new Uint8Array(wrappedKey))
    };

    await updateNodeSettings(selectedNodeId, jsonSettings);

    updateDomFromNodeSettings(jsonSettings);
    $('.password').prop("disabled", true);
    $('.password').val("");
    $('#submit').prop("disabled", true);
    $('#locked').prop("disabled", false);

    let bookmarkNode = (await browser.bookmarks.getSubTree(selectedNodeId))[0];
    await encryptBookmarks(bookmarkNode, secretKey, iv);
}

async function updateNodeSettings(nodeId: string, newSettings: NodeSettings) {
    let existingSettings = await getNodeSettings(nodeId);
    $.extend(existingSettings, newSettings);
    return browser.storage.sync.set({[`node_settings/${nodeId}`]: existingSettings});
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

async function getEncryptionDetailsFromSettings(nodeSettings: NodeSettings) {
    let salt = base64ToBytes(nodeSettings.salt);
    let initializationVector = base64ToBytes(nodeSettings.iv);
    let wrappedKey = bytesToArrayBuffer(base64ToBytes(nodeSettings.key));
    let unwrapKey = await getUnwrappingKey(salt);
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

async function onClickLock(event: JQuery.TriggeredEvent) {
    let selectedNodeId = getSelectedNodeId();
    let bookmarkFolder = (await browser.bookmarks.getSubTree(selectedNodeId))[0];
    let nodeSettings = await getNodeSettings(selectedNodeId);
    let eventTarget = <HTMLInputElement> event.target;
    let encryptionDetails = await getEncryptionDetailsFromSettings(<NodeSettings> nodeSettings);

    switch (eventTarget.checked) {
        case true:
            await encryptBookmarks(bookmarkFolder, encryptionDetails.secretKey, encryptionDetails.initializationVector);
            break;
        case false:
            await decryptBookmarks(bookmarkFolder, encryptionDetails.secretKey, encryptionDetails.initializationVector);
            break;
    }
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

$(onReady);
  