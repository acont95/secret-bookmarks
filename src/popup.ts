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

interface State {
    nodeObject: {[key: string]: BookmarkNodeObject};
    rootNode?: browser.bookmarks.BookmarkTreeNode;
}
interface BookmarkNodeObject {
    nodeSettings: NodeSettings | {};
    node: browser.bookmarks.BookmarkTreeNode;
    passwordSet: boolean;
    passwordEnter: boolean;
}

const state: State = {
    nodeObject: {}
};

const defaultNodeSettings: NodeSettings = {
    locked: false
};

const renderNodeEvent = new CustomEvent('renderNode', {
    detail: { message: 'Re-render the node' },
    bubbles: true, // Allow event to bubble up
    composed: true, // Allow event to pass through shadow DOM boundaries
});

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

async function setBookmarkTreeState(node: browser.bookmarks.BookmarkTreeNode) {
    if (node.children == null) {
        return;
    }

    for (let childNode of node.children) {
        if (childNode.type == "folder") {
            let nodeSettings = await getNodeSettings(childNode.id);
            state.nodeObject[childNode.id] = {
                nodeSettings: nodeSettings,
                node: childNode,
                passwordEnter: false,
                passwordSet: false
            };
        }
        await setBookmarkTreeState(childNode);
    }
}

async function onReady() {
    let rootNode = (await browser.bookmarks.getTree())[0];
    state.rootNode = rootNode;
    await setBookmarkTreeState(rootNode);
    document.querySelector("#bookmark_tree")?.append(
        new BookmarkTree()
    );
}

function htmlToNode(html: string): DocumentFragment {
    const template = document.createElement('template');
    template.innerHTML = html.trim();
    return template.content;
}

class SliderCheckbox extends HTMLElement {
    get nodeId(): string { return this.dataset['nodeId']!; }
    get checkboxState() {
        return (<HTMLInputElement> this.shadowRoot!.querySelector("input.lock-toggle")).checked;
    }

    constructor() {
        // Always call super first in constructor
        super();  
        // Create a shadow root
        this.attachShadow({mode: 'open'});
    }

    render() {
        let nodeState = state.nodeObject[this.nodeId];

        let isManaged = !isEmpty(nodeState.nodeSettings);
        let nodeSettings = isManaged ? <NodeSettings> nodeState.nodeSettings: defaultNodeSettings;
        let sliderClass = isManaged ? (nodeSettings.locked ? 'locked' : 'unlocked') : undefined;

        const html = `
            <style>
                /* https://www.w3schools.com/howto/howto_css_switch.asp */
                /* The switch - the box around the slider */
                .switch {
                    position: relative;
                    display: inline-block;
                    width: 32px;
                    height: 20px;

                    margin-right: 0.25em;
                }

                /* Hide default HTML checkbox */
                .switch input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                }

                /* The slider */
                .slider {
                    position: absolute;
                    cursor: pointer;
                    top: 0;
                    left: 0;
                    right: 0;
                    bottom: 0;
                    background-color: #ccc;
                    -webkit-transition: .4s;
                    transition: .4s;
                }

                .slider.locked {
                    background-color: red;
                }

                .slider.unlocked {
                    background-color: lightgreen;
                }

                .slider:before {
                    position: absolute;
                    content: "";
                    height: 12px;
                    width: 12px;
                    left: 4px;
                    bottom: 4px;
                    background-color: white;
                    -webkit-transition: .4s;
                    transition: .4s;
                }

                /* input:checked + .slider {
                    background-color: lightgreen;      
                } */

                input:focus + .slider {
                    box-shadow: 0 0 1px lightgreen;
                }

                input:checked + .slider:before {
                    -webkit-transform: translateX(12px);
                    -ms-transform: translateX(12px);
                    transform: translateX(12px);
                }

                /* Rounded sliders */
                .slider.round {
                    border-radius: 34px;
                }

                .slider.round:before {
                    border-radius: 50%;
                } 
            </style>
            <label class="switch">
                <input type="checkbox" class="lock-toggle" ${nodeSettings.locked ? 'checked' : ''} />
                <span class="slider round ${sliderClass}"></span>
            </label> `;

        let element = htmlToNode(html);
    
        // Append it to the shadow root
        this.shadowRoot!.replaceChildren(element);
    }

    handleLabelClick(event: Event) {
        if (!(<HTMLElement> event.target).matches("input")) {
            event.stopPropagation();
        }
    }

    connectedCallback() {
        this.render();
        this.shadowRoot!.addEventListener("click", this.handleLabelClick);
    }

    disconnectedCallback() {
        this.shadowRoot!.removeEventListener("click", this.handleLabelClick);
    }}

class PasswordEnterFieldset extends HTMLElement {
    get nodeId(): string { return this.dataset['nodeId']!; }

    constructor() {
        // Always call super first in constructor
        super();  
        // Create a shadow root
        this.attachShadow({mode: 'open'});
        this.handleClick = this.handleClick.bind(this);
    }
    render() {
        const html = `
            <style>
                fieldset {
                    display: flex;
                    flex-direction: column;
                    margin-top: 0.25em;
                    align-items: flex-start;
                    row-gap: 0.5em;
                }
                .password-fail {
                    font: 0.85em system-ui;
                    color: red;
                }
            </style>
            <fieldset class="password-enter-fieldset hide-item">
                <label for="password">Passphrase</label>
                <input id="password" class="password password-enter-input" type="password"/>
                <div class="password-fail hide-item">Wrong password. Try again.</div>
                <button id="password-enter-button" type="button">Submit</button>
            </fieldset>`;
        let element = htmlToNode(html);
    
        // Append it to the shadow root
        this.shadowRoot!.replaceChildren(element);
    }

    async handleClick() {
        let bookmarkNode = (await browser.bookmarks.getSubTree(this.nodeId))[0];
        let nodeSettings = <NodeSettings> await getNodeSettings(this.nodeId);
        let password = (<HTMLInputElement> this.shadowRoot!.querySelector("#password")).value;
        let nodeState = state.nodeObject[this.nodeId];

        try {
            let privateKey = await unwrapPrivateKey(password, nodeSettings.key!, nodeSettings.salt!, nodeSettings.iv!);
            await decryptBookmarks(bookmarkNode, privateKey);
            nodeState.passwordEnter = false;
            nodeState.passwordSet = false;
            (<NodeSettings> nodeState.nodeSettings).locked = false;
            await updateNodeSettings(this.nodeId, <NodeSettings> nodeState.nodeSettings);
            this.dispatchEvent(renderNodeEvent);
        } catch (error) {
            console.log(error);
            this.shadowRoot!.querySelector("div.password-fail")?.classList.remove("hide-item");
            console.log("Wrong Password");
        }
    }

    connectedCallback() {
        this.render();
        this.shadowRoot!.querySelector("#password-enter-button")!.addEventListener('click', this.handleClick);
    }

    disconnectedCallback() {
        this.shadowRoot!.querySelector("#password-enter-button")!.removeEventListener('click', this.handleClick);
    }
}

class PasswordSetFieldset extends HTMLElement {
    get nodeId(): string { return this.dataset['nodeId']!; }

    constructor() {
        // Always call super first in constructor
        super();
        // Create a shadow root
        this.attachShadow({mode: 'open'});
        this.handleKeyup = this.handleKeyup.bind(this);
        this.handleClick = this.handleClick.bind(this);
    }

    render() {
        const html = `
            <style>
                fieldset {
                    display: flex;
                    flex-direction: column;
                    margin-top: 0.25em;
                    align-items: flex-start;
                    row-gap: 0.5em;
                }
            </style>
            <fieldset class="password-set-fieldset hide-item">
                <label for="password">Passphrase</label>
                <input id="password" class="password" type="password"/>
                <label for="password-confirm">Confirm Passphrase</label>
                <input id="password-confirm" class="password" type="password"/>
                <button id="password-set-button" type="button">Submit</button>
            </fieldset>`;
        let element = htmlToNode(html);
    
        // Append it to the shadow root
        this.shadowRoot!.replaceChildren(element);
    }

    handleKeyup() {
        let password = (<HTMLInputElement> this.shadowRoot!.querySelector(`#password`)).value;
        let passwordConfirm = (<HTMLInputElement> this.shadowRoot!.querySelector(`#password-confirm`)).value;
        (<HTMLButtonElement> this.shadowRoot!.querySelector("#password-set-button")).disabled = password != passwordConfirm;
    }

    async handleClick() {
        let password = (<HTMLInputElement> this.shadowRoot!.querySelector(`#password`)).value;
        let salt = crypto.getRandomValues(new Uint8Array(16));
        let iv = window.crypto.getRandomValues(new Uint8Array(12));
    
        let keyPair = await generateKeyPair();
        let publicKeyPem = await exportPublicKey(keyPair.publicKey);
        let wrappedPrivateKey = await wrapPrivateKey(password, keyPair.privateKey, salt, iv);
        let nodeState = state.nodeObject[this.nodeId];
        nodeState.passwordSet = false;
        nodeState.passwordEnter = false;
        nodeState.nodeSettings = {
            locked: true,
            publicKey: publicKeyPem,
            salt: bytesToBase64(salt),
            key: wrappedPrivateKey,
            iv: bytesToBase64(iv)
        };
    
        let bookmarkNode = (await browser.bookmarks.getSubTree(this.nodeId))[0];
        await updateNodeSettings(this.nodeId, <NodeSettings> nodeState.nodeSettings);
        await encryptBookmarks(bookmarkNode, keyPair.publicKey);
        this.dispatchEvent(renderNodeEvent);
    }

    connectedCallback() {
        this.render();

        this.shadowRoot!.querySelectorAll(".password").forEach((value) => {
            value.addEventListener('keyup', this.handleKeyup)
        });

        this.shadowRoot!.querySelector("#password-set-button")!.addEventListener('click', this.handleClick);
    }

    disconnectedCallback() {
        this.shadowRoot!.querySelectorAll(".password").forEach((value) => {
            value.removeEventListener('keyup', this.handleKeyup)
        });

        this.shadowRoot!.querySelector("#password-set-button")!.removeEventListener('click', this.handleClick);    
    }
}

class BookmarkNode extends HTMLElement {
    get nodeId(): string { return this.dataset['nodeId']!; }

    constructor() {
        // Always call super first in constructor
        super();
        // Create a shadow root
        this.attachShadow({mode: 'open'});
        this.handleClick = this.handleClick.bind(this);
        this.handleRenderNode = this.handleRenderNode.bind(this);
    }

    render() {
        let nodeState = state.nodeObject[this.nodeId];

        const html = `
            <div> 
                <slider-checkbox data-node-id="${this.nodeId}"></slider-checkbox>
                ${nodeState.node.title}
                ${nodeState.passwordEnter ? `<password-enter-fieldset data-node-id="${this.nodeId}"></password-enter-fieldset>`: ""} 
                ${nodeState.passwordSet ? `<password-set-fieldset data-node-id="${this.nodeId}"></password-set-fieldset>`: ""} 
            </div>`;
        let element = htmlToNode(html);
        // Append it to the shadow root
        this.shadowRoot!.replaceChildren(element);
    }

    async handleClick(e: Event) {
        let checkbox: SliderCheckbox = this.shadowRoot!.querySelector("slider-checkbox")!;
        let nodeState = state.nodeObject[this.nodeId];
    
        if (isEmpty(nodeState.nodeSettings)) {
            console.log("EMPTY");
            nodeState.passwordEnter = false;
            nodeState.passwordSet = true;
        } else {
            if (checkbox.checkboxState) {
                console.log("CHECKED");
                let publicKey = await importPublicKey((<NodeSettings> nodeState.nodeSettings).publicKey!);
                let bookmarkSubTree = (await browser.bookmarks.getSubTree(this.nodeId))[0];
                await encryptBookmarks(bookmarkSubTree, publicKey);
                nodeState.passwordEnter = false;
                nodeState.passwordSet = false;
                (<NodeSettings> nodeState.nodeSettings).locked = true;
            } else {
                console.log("NOT CHECKED");
                nodeState.passwordEnter = true;     
                nodeState.passwordSet = false;
                (<NodeSettings> nodeState.nodeSettings).locked = false;
            }
        }
        await updateNodeSettings(this.nodeId, <NodeSettings> nodeState.nodeSettings);
        this.render();
    }

    handleRenderNode(e: Event) {
        e.stopPropagation();
        console.log("renderNode handler");
        this.render();
    }

    connectedCallback() {
        this.render();
        this.shadowRoot!.querySelector("slider-checkbox")!.addEventListener('click', this.handleClick);
        this.addEventListener('renderNode', this.handleRenderNode);
    }

    disconnectedCallback() {
        this.shadowRoot!.querySelector("slider-checkbox")!.removeEventListener("click", this.handleClick);
        this.removeEventListener('renderNode', this.handleRenderNode);
    }
}

class BookmarkNodeList extends HTMLElement {
    constructor() {
        // Always call super first in constructor
        super();  
    }
    static getList(node: browser.bookmarks.BookmarkTreeNode): string {
        // if (node.children == null) {return ""};
        const listItems = `${node.children?.map((item): string => {
            let result = "";
            if (item.type == "folder") {
                result += `
                <li>
                    <bookmark-node data-node-id="${item.id}"></bookmark-node>
                </li>`;
                result += this.getList(item);
            };
            return result;
        }).join("")}`;
        const html = listItems.length >= 0 ? `
            <ol>
                ${listItems}
            </ol>`: "";
        return html;
    }

    render() { 
        // Create a shadow root
        const shadow = this.attachShadow({mode: 'open'});

        const html = `
            <style>
                ol {
                    margin-inline-start: 0;
                    padding-inline-start: 20px;
                }

                ol:first-child {
                    padding-left: 0;
                }

                ol li {
                    list-style-type: none;
                    font: 1em system-ui;
                    margin-bottom: 0.25em;
                }
            </style>
            ${BookmarkNodeList.getList(state.rootNode!)}
        `;
        let element = htmlToNode(html);
    
        // Append it to the shadow root
        shadow.appendChild(element);
    }

    connectedCallback() {
        this.render();
    }
}

class BookmarkTree extends HTMLElement {
    constructor() {
      // Always call super first in constructor
      super();  
    }
    render() {
      // Create a shadow root
      const shadow = this.attachShadow({mode: 'open'});

      const html = `
        <div id=tree-root-div>
            <bookmark-node-list></bookmark-node-list>
        </div>`;
      let element = htmlToNode(html);
  
      // Append it to the shadow root
      shadow.appendChild(element);
    }

    connectedCallback() {
        this.render();
    }
}

customElements.define("slider-checkbox", SliderCheckbox);
customElements.define("password-enter-fieldset", PasswordEnterFieldset);
customElements.define("password-set-fieldset", PasswordSetFieldset);
customElements.define("bookmark-node", BookmarkNode);
customElements.define("bookmark-node-list", BookmarkNodeList);
customElements.define("bookmark-tree", BookmarkTree);

document.addEventListener("DOMContentLoaded", onReady);
  