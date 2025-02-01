interface NodeSettings {
    locked: boolean;
    publicKey?: string
    salt?: string
    key?: string
    iv?: string
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

function getMessageSymmetricKey() {
    return window.crypto.subtle.generateKey(
        {
          name: "AES-GCM",
          length: 256,
        },
        true,
        ["encrypt", "decrypt"],
    );
      
}

function createDataUrl(
    baseUrl: string, 
    b64Url: string, 
    b64TitleIv: string, 
    b64UrlIv: string, 
    b64MessageKey: string
) {
    return `${baseUrl}${b64Url},${b64TitleIv},${b64UrlIv},${b64MessageKey}`;
}

function parseDataUrl(baseUrl:string, dataUrl: string) {
    let urlData = dataUrl.replace(baseUrl, "").split(",");
    let b64Url = urlData[0];
    let b64TitleIv = urlData[1];
    let b64UrlIv = urlData[2];
    let b64MessageKey = urlData[3];
    return {
        'b64Url': b64Url,
        'b64TitleIv': b64TitleIv,
        'b64UrlIv': b64UrlIv,
        'b64MessageKey': b64MessageKey
    }
}

async function encryptBookmarks(node: browser.bookmarks.BookmarkTreeNode, publicKey: CryptoKey) {
    if (node.children == null){
        return;
    }
    let baseUrl = "data:text/plain;base64,";
    let encoder = new TextEncoder();

    let messageKey = await getMessageSymmetricKey();
    let encryptedMessageKey = await crypto.subtle.wrapKey(
        "raw",
        messageKey,
        publicKey,
        {name: "RSA-OAEP"}
    );
    let b64MessageKey = bytesToBase64(new Uint8Array(encryptedMessageKey));

    for (let childNode of node.children) {
        if (childNode.type == "bookmark" && !childNode.url!.includes(baseUrl)) {
            const urlIv = window.crypto.getRandomValues(new Uint8Array(12));
            const titleIv = window.crypto.getRandomValues(new Uint8Array(12));

            let encryptedTitle = await crypto.subtle.encrypt(
                {name: "AES-GCM", iv: titleIv},
                messageKey,
                encoder.encode(childNode.title)
            );

            let encryptedUrl = await crypto.subtle.encrypt(
                {name: "AES-GCM", iv: urlIv},
                messageKey,
                encoder.encode(childNode.url)
            );

            let b64Title = bytesToBase64(new Uint8Array(encryptedTitle));
            let b64Url = bytesToBase64(new Uint8Array(encryptedUrl));
            let b64TitleIv = bytesToBase64(titleIv);
            let b64UrlIv = bytesToBase64(urlIv);

            await browser.bookmarks.update(
                childNode.id,
                {   
                    title: b64Title,
                    url: createDataUrl(baseUrl, b64Url, b64TitleIv, b64UrlIv, b64MessageKey)
                }
            );
        }
    }
}

async function decryptBookmarks(node: browser.bookmarks.BookmarkTreeNode, privateKey: CryptoKey) {
    if (node.children == null){
        return;
    }
    let baseUrl = "data:text/plain;base64,";
    let decoder = new TextDecoder();

    for (let childNode of node.children) {
        if (childNode.type == "bookmark" && childNode.url!.includes(baseUrl)) {
            let urlData = parseDataUrl(baseUrl, childNode.url!);
            let messageKey = await crypto.subtle.unwrapKey(
                "raw",
                base64ToBytes(urlData.b64MessageKey),
                privateKey,
                {name: "RSA-OAEP"},
                {name: "AES-GCM"},
                true,
                ["encrypt", "decrypt"]
            );

            let decryptedTitle = await crypto.subtle.decrypt(
                {name: "AES-GCM", iv: base64ToBytes(urlData.b64TitleIv)},
                messageKey,
                base64ToBytes(childNode.title)
            );
    
            let decryptedUrl = await crypto.subtle.decrypt(
                {name: "AES-GCM", iv: base64ToBytes(urlData.b64UrlIv)},
                messageKey,
                base64ToBytes(urlData.b64Url)
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
    let secretKey = await crypto.subtle.unwrapKey(
        "pkcs8", 
        wrappedKey, 
        unwrapKey,
        {name: "AES-GCM", iv: iv},
        {name: "RSA-OAEP", hash: "SHA-256"},
        true,
        ["unwrapKey"]
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
        ["wrapKey"]
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
        ["wrapKey", "unwrapKey"],
    );
}

function isEmpty(obj: object) {
    // Check if the object is null or undefined
    if (obj == null) {
      return true; 
    }
    // Use Object.keys to get an array of the object's keys
    const keys = Object.keys(obj); 
    // If the length of the keys array is 0, the object is empty
    return keys.length === 0; 
}

export { 
    NodeSettings, 
    getNodeSettings,
    updateNodeSettings, 
    generateKeyPair, 
    importPublicKey,
    exportPublicKey, 
    wrapPrivateKey, 
    unwrapPrivateKey,
    bytesToBase64, 
    base64ToBytes,
    encryptBookmarks, 
    decryptBookmarks, 
    isEmpty
};

