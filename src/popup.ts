interface NodeSettings {
    locked: boolean;
    publicKey?: string
    salt?: string
    key?: string
    iv?: string
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

function createListItem(title: string, nodeId: string, checked: boolean) : JQuery<HTMLLIElement> {
    return <JQuery<HTMLLIElement>> $(`<li tabindex="1" data-node-id="${nodeId}">`).append(
        createListItemSwitch(checked),
        title,
        createListItemFieldset()
    );
}

function createListItemFromNodeSettings(
    node: browser.bookmarks.BookmarkTreeNode, 
    nodeSettings: NodeSettings | {}
) : JQuery<HTMLLIElement> {
    let checked = false;
    let state = "unmanaged";
    if (!$.isEmptyObject(nodeSettings)) {
        checked = (<NodeSettings> nodeSettings).locked;
        state = (<NodeSettings> nodeSettings).locked ? "locked" : "unlocked";
    } 
    return createListItem(node.title, node.id, checked).addClass(state);
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
            let listItem = createListItemFromNodeSettings(childNode, nodeSettings);
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
derive an AES-GCM key using PBKDF2.
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
        { name: "AES-GCM", length: 256 },
        true,
        ["wrapKey", "unwrapKey"],
    );
}

/*
Wrap the given key.
*/
async function wrapCryptoKey(keyToWrap: CryptoKey, passphrase: string, salt: Uint8Array, iv: Uint8Array) : Promise<ArrayBuffer> {
    // get the key encryption key
    const keyMaterial = await getKeyMaterial(passphrase);
    const wrappingKey = await getKey(keyMaterial, salt);
    return window.crypto.subtle.wrapKey("pkcs8", keyToWrap, wrappingKey, {
        name: "AES-GCM", 
        iv: iv
    });
}

/*
Derive an AES-GCM key using PBKDF2.
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
      { name: "AES-GCM", length: 256 },
      true,
      ["wrapKey", "unwrapKey"],
    );
}

async function encryptBookmarks(node: browser.bookmarks.BookmarkTreeNode, key: CryptoKey) {
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
                {name: "RSA-OAEP"},
                key,
                encoder.encode(childNode.title)
            );
    
            encryptedUrl = await crypto.subtle.encrypt(
                {name: "RSA-OAEP"},
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

async function decryptBookmarks(node: browser.bookmarks.BookmarkTreeNode, key: CryptoKey) {
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
                {name: "RSA-OAEP"},
                key,
                base64ToBytes(childNode.title)
            );
    
            decryptedUrl = await crypto.subtle.decrypt(
                {name: "RSA-OAEP"},
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

/*
https://developer.mozilla.org/en-US/docs/Web/API/Window/btoa
*/
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

async function unwrapPrivateKey(
    password: string,
    keyString: string, 
    saltString: string,
    ivString: string
) : Promise<CryptoKey>  {
    let salt = base64ToBytes(saltString);
    let wrappedKey = bytesToArrayBuffer(base64ToBytes(keyString));
    let iv = bytesToArrayBuffer(base64ToBytes(ivString));
    let unwrapKey = await getUnwrappingKey(password, salt);
    console.log("unwrap key");
    let secretKey = await crypto.subtle.unwrapKey(
        "pkcs8", 
        wrappedKey, 
        unwrapKey,
        {name: "AES-GCM", iv: iv},
        {name: "RSA-OAEP", hash: "SHA-256"},
        true,
        ["decrypt"]
    );

    return secretKey;
}

async function wrapPrivateKey(password: string, key: CryptoKey, salt: Uint8Array, iv: Uint8Array): Promise<string> {
    let wrappedPrivateKey = await wrapCryptoKey(key, password, salt, iv);
    return bytesToBase64(new Uint8Array(wrappedPrivateKey))
}

async function importPublicKey(keyString: string) : Promise<CryptoKey>  {
    // fetch the part of the PEM string between header and footer
    let pemHeader = "-----BEGIN PUBLIC KEY-----";
    let pemFooter = "-----END PUBLIC KEY-----";
    let pemContents = keyString.substring(
        pemHeader.length,
        keyString.length - pemFooter.length - 1,
    );
    let publicKey = await crypto.subtle.importKey(
        "spki",
        bytesToArrayBuffer(base64ToBytes(pemContents)),
        {
            name: "RSA-OAEP",
            hash: "SHA-256",
        },
        true,
        ["encrypt"]
    );

    return publicKey;
}

async function exportPublicKey(key: CryptoKey) : Promise<string> {
    let publicKey = await window.crypto.subtle.exportKey(
        "spki",
        key
    );

    let base64PublicKey = bytesToBase64(new Uint8Array(publicKey));
    return `-----BEGIN PUBLIC KEY-----\n${base64PublicKey}\n-----END PUBLIC KEY-----`;
}

function generateKeyPair() {
    return window.crypto.subtle.generateKey(
        {
            name: "RSA-OAEP",
            modulusLength: 2048,
            publicExponent: new Uint8Array([1, 0, 1]),
            hash: "SHA-256",
        },
        true,
        ["encrypt", "decrypt"],
    );
}

async function onSubmitPasswordSet(listItem : JQuery<HTMLLIElement>, selectedNodeId: string) {
    console.log("SUBMIT");
    let password = listItem.find("input.password-set-input").val()!.toString();
    let salt = crypto.getRandomValues(new Uint8Array(16));
    let iv = window.crypto.getRandomValues(new Uint8Array(12));

    let keyPair = await generateKeyPair();
    let publicKeyPem = await exportPublicKey(keyPair.publicKey);
    let wrappedPrivateKey = await wrapPrivateKey(password, keyPair.privateKey, salt, iv);

    await updateNodeSettings(selectedNodeId, {
        locked: true,
        publicKey: publicKeyPem,
        salt: bytesToBase64(salt),
        key: wrappedPrivateKey,
        iv: bytesToBase64(iv)
    });

    $('.password').val("");
    listItem.find("fieldset.password-set-fieldset").addClass("hide-item");

    let bookmarkNode = (await browser.bookmarks.getSubTree(selectedNodeId))[0];
    await encryptBookmarks(bookmarkNode, keyPair.publicKey);
    $("#messagebox").text("Encryption successful.");
}

async function onSubmitPasswordEnter(listItem : JQuery<HTMLLIElement>, selectedNodeId: string) {
    console.log("Password Enter Submit");
    let bookmarkNode = (await browser.bookmarks.getSubTree(selectedNodeId))[0];
    let nodeSettings = <NodeSettings> await getNodeSettings(selectedNodeId);
    let password = listItem.find("input.password-enter-input").val()!.toString();

    try {
        let privateKey = await unwrapPrivateKey(password, nodeSettings.key!, nodeSettings.salt!, nodeSettings.iv!);
        console.log(privateKey);
        await decryptBookmarks(bookmarkNode, privateKey);
        await updateNodeSettings(selectedNodeId, {locked:false});
        listItem.find("fieldset.password-enter-fieldset").addClass("hide-item");
        listItem.removeClass("transition");
    } catch (error) {
        console.log(error);
        listItem.find("div.password-fail").removeClass("hide-item");
        console.log("Wrong Password");
    }
}

function resetListItems(this: HTMLElement, index: number, element: HTMLElement): void {
    let nodeId = $(this).data("node-id");
    let nodeSettings: NodeSettings | {};
    getNodeSettings(nodeId).then((value) => {
        nodeSettings = value;
        return browser.bookmarks.get(nodeId);
    }).then((value) => {
        $(this).replaceWith(createListItemFromNodeSettings(value[0], nodeSettings));
    });
}

async function onClickLock(listItem: JQuery<HTMLLIElement>, selectedNodeId: string) {
    console.log("LOCK");
    $("li").not(listItem).each(resetListItems);
    $(".password").val("");
    let nodeCheckbox = listItem.find("input.lock-toggle");
    let nodeSettings = await getNodeSettings(selectedNodeId);

    if ($.isEmptyObject(nodeSettings)) {
        listItem.children("fieldset.password-set-fieldset").toggleClass("hide-item");
    } else {
        if (nodeCheckbox.prop("checked")) {
            let publicKey = await importPublicKey((<NodeSettings> nodeSettings).publicKey!);
            let bookmarkNode = (await browser.bookmarks.getSubTree(selectedNodeId))[0];
            await encryptBookmarks(bookmarkNode, publicKey);
            await updateNodeSettings(selectedNodeId, {locked:true});
        } else {
            listItem.children("fieldset.password-enter-fieldset").toggleClass("hide-item");
        }
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
  