import { 
    NodeSettings, 
    getNodeSettings,
    updateNodeSettings, 
    generateKeyPair, 
    importPublicKey,
    exportPublicKey, 
    wrapPrivateKey, 
    unwrapPrivateKey,
    bytesToBase64, 
    encryptBookmarks, 
    decryptBookmarks, 
} from './common.js';

class BookmarkFolderNode {
    keyExists: boolean;
    locked: boolean;
    nodeId: string;
    bookmarkTitle: string;

    constructor(locked: boolean, keyExists: boolean, nodeId: string, bookmarkTitle: string) {
        this.locked = locked;
        this.keyExists = keyExists;
        this.nodeId = nodeId;
        this.bookmarkTitle = bookmarkTitle;
    }

    render(): HTMLElement {
        const template = document.createElement('template');
        let sliderClass = "";
        if (this.keyExists) {
            if (this.locked) {
                sliderClass = "locked";
            } else {
                sliderClass = "unlocked";
            }
        }
        template.innerHTML = 
            `<li data-node-id="${this.nodeId}" class="${this.locked ? 'locked' : 'unlocked'}"> 
                <label class="switch">
                    <input type="checkbox" class="lock-toggle" ${this.locked ? 'checked' : ''} />
                    <span class="slider round ${sliderClass}"></span>
                </label> 
                ${this.bookmarkTitle}
                <fieldset class="password-enter-fieldset hide-item">
                    <label for="input0-${this.nodeId}">Passphrase</label>
                    <input id="input0-${this.nodeId}" class="password password-enter-input" type="password"/>
                    <div class="password-fail hide-item">Wrong password. Try again.</div>
                    <button type="button" class="password-enter-button">Submit</button>
                </fieldset>
                <fieldset class="password-set-fieldset hide-item">
                    <label for="input1-${this.nodeId}">Passphrase</label>
                    <input id="input1-${this.nodeId}" class="password password-set password-set-input" type="password"/>
                    <label for="input2-${this.nodeId}">Confirm Passphrase</label>
                    <input id="input2-${this.nodeId}" class="password password-set password-set-confirm-input" type="password"/>
                    <button type="button" class="password-set-button">Submit</button>
                </fieldset>
            </li>`;

        return <HTMLElement> template.content.firstChild!;
    }
}

class BookmarkTree {
    rootNode: browser.bookmarks.BookmarkTreeNode;
    tree?: HTMLElement;

    constructor(rootNode: browser.bookmarks.BookmarkTreeNode) {
        this.rootNode = rootNode;
    }

    async traverseBookmarks(node: browser.bookmarks.BookmarkTreeNode, parentElement: HTMLElement) {
        if (node.children == null) {
            return;
        }
    
        let newList = document.createElement("ol");
        parentElement.append(newList);
        for (let childNode of node.children) {
            if (childNode.type == "folder") {
                let nodeSettings = await getNodeSettings(childNode.id);
                let listItem = new BookmarkFolderNode(
                    !isEmpty(nodeSettings) ? (<NodeSettings> nodeSettings).locked : false,  
                    !isEmpty(nodeSettings) ? true : false, 
                    childNode.id, 
                    childNode.title
                );
                newList.append(listItem.render());
            }
            await this.traverseBookmarks(childNode, newList);
        }
    }

    async createTree() {
        let rootElement = document.createElement("div");
        rootElement.setAttribute("id", "tree-root-div");
        await this.traverseBookmarks(this.rootNode, rootElement);
        this.tree = rootElement;
    }

    render(): HTMLElement {
        return this.tree!;
    }
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

async function onSubmitPasswordSet(listItem : HTMLElement, selectedNodeId: string) {
    let password = (<HTMLInputElement> listItem.querySelector("input.password-set-input")).value;
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

    document.querySelectorAll(".password").forEach((value) => (<HTMLInputElement> value).value = "");
    listItem.querySelector("fieldset.password-set-fieldset")?.classList.add("hide-item");

    let bookmarkNode = (await browser.bookmarks.getSubTree(selectedNodeId))[0];
    await encryptBookmarks(bookmarkNode, keyPair.publicKey);
    (<HTMLElement> listItem.querySelector(".slider")).classList.remove("unlocked");
    (<HTMLElement> listItem.querySelector(".slider")).classList.add("locked");
}

async function onSubmitPasswordEnter(listItem : HTMLElement, selectedNodeId: string) {
    let bookmarkNode = (await browser.bookmarks.getSubTree(selectedNodeId))[0];
    let nodeSettings = <NodeSettings> await getNodeSettings(selectedNodeId);
    let password = (<HTMLInputElement> listItem.querySelector("input.password-enter-input")).value;

    try {
        let privateKey = await unwrapPrivateKey(password, nodeSettings.key!, nodeSettings.salt!, nodeSettings.iv!);
        await decryptBookmarks(bookmarkNode, privateKey);
        await updateNodeSettings(selectedNodeId, {locked:false});
        listItem.querySelector("fieldset.password-enter-fieldset")?.classList.add("hide-item");
        (<HTMLElement> listItem.querySelector(".slider")).classList.remove("locked");
        (<HTMLElement> listItem.querySelector(".slider")).classList.add("unlocked");
    } catch (error) {
        console.log(error);
        listItem.querySelector("div.password-fail")?.classList.remove("hide-item");
        console.log("Wrong Password");
    }
}

function resetListItems(element: Element): void {
    let nodeId = (<HTMLElement> element).dataset["nodeId"]!;
    let nodeSettings: NodeSettings | {};
    getNodeSettings(nodeId).then((value) => {
        nodeSettings = value;
        return browser.bookmarks.get(nodeId);
    }).then((value) => {
        element.replaceWith(new BookmarkFolderNode(
            !isEmpty(nodeSettings) ? (<NodeSettings> nodeSettings).locked : false,  
            !isEmpty(nodeSettings) ? true : false, 
            nodeId, 
            value[0].title
        ).render());
    });
}

async function onClickLock(listItem: HTMLElement, selectedNodeId: string) {
    document.querySelectorAll(`li:not([data-node-id=${selectedNodeId}])`).forEach(resetListItems);
    document.querySelectorAll(".password").forEach((value) => (<HTMLInputElement> value).value = "");

    let nodeCheckbox: HTMLInputElement = listItem.querySelector("input.lock-toggle")!;
    let nodeSettings = await getNodeSettings(selectedNodeId);

    if (isEmpty(nodeSettings)) {
        listItem.querySelector("fieldset.password-set-fieldset")?.classList.add("hide-item");
    } else {
        if (nodeCheckbox.checked) {
            let publicKey = await importPublicKey((<NodeSettings> nodeSettings).publicKey!);
            let bookmarkNode = (await browser.bookmarks.getSubTree(selectedNodeId))[0];
            if (!(<NodeSettings> nodeSettings).locked) {
                await encryptBookmarks(bookmarkNode, publicKey);
                await updateNodeSettings(selectedNodeId, {locked:true});
            }
            (<HTMLElement> listItem.querySelector(".slider")).classList.remove("unlocked");
            (<HTMLElement> listItem.querySelector(".slider")).classList.add("locked");
            listItem.querySelector("fieldset.password-enter-fieldset")?.classList.add("hide-item");
        } else {
            listItem.querySelector("fieldset.password-enter-fieldset")?.classList.remove("hide-item");
        }
    }
}

function onBookmarkClick(event: Event) {
    let listItem = (<HTMLElement> event.target).closest("li")!;
    let selectedNodeId = listItem.dataset["nodeId"]!;

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

function onPasswordKeyup(listItem : HTMLElement) {
    let password = (<HTMLInputElement> listItem.querySelector("input.password-set-input")).value;
    let passwordConfirm = (<HTMLInputElement> listItem.querySelector("input.password-set-confirm-input")).value;
    (<HTMLButtonElement> document.querySelector("button.password-set-button:visible")).disabled =  password != passwordConfirm;
}

function onBookmarkKeyup(event: Event) {
    let listItem = (<HTMLElement> event.target).closest("li")!;
    if ((<HTMLElement> event.target).classList.contains("password-set")) {
        onPasswordKeyup(listItem);
    }
}

async function onReady() {
    let rootNode = (await browser.bookmarks.getTree())[0];
    let bookmarkTree = new BookmarkTree(rootNode);
    await bookmarkTree.createTree();
    document.getElementById("bookmark_tree")!.append(bookmarkTree.render());
    document.querySelector("#bookmark_tree")?.addEventListener("click", onBookmarkClick);
    document.querySelector("#bookmark_tree")?.addEventListener("keyup", onBookmarkKeyup);
}

document.addEventListener("DOMContentLoaded", onReady);
  