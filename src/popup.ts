import { 
    NodeSettings, 
    getNodeSettings,
    updateNodeSettings, 
    deleteNodeSettings,
    generateKeyPair, 
    importPublicKey,
    exportPublicKey, 
    wrapPrivateKey, 
    unwrapPrivateKey,
    bytesToBase64, 
    encryptBookmarks, 
    decryptBookmarks, 
    isEmpty
} from './common.js';

interface State {
    nodeObject: {[key: string]: BookmarkNodeObject};
    rootNode?: browser.bookmarks.BookmarkTreeNode;
}
interface BookmarkNodeObject {
    nodeSettings: NodeSettings | {};
    node: browser.bookmarks.BookmarkTreeNode;
}

const state: State = {
    nodeObject: {}
};

const passwordSubmitEvent = new CustomEvent('passwordSubmit', {
    detail: { password: "" },
    bubbles: true, // Allow event to bubble up
    composed: true, // Allow event to pass through shadow DOM boundaries
});

const passwordChangeEvent = new CustomEvent('passwordChange', {
    detail: { password: "" , oldPassword: ""},
    bubbles: true, // Allow event to bubble up
    composed: true, // Allow event to pass through shadow DOM boundaries
});

const resetOtherNodesEvent = new CustomEvent('resetOthers', {
    detail: { nodeId: "" },
    bubbles: true, // Allow event to bubble up
    composed: true, // Allow event to pass through shadow DOM boundaries
});

async function setBookmarkTreeState(node: browser.bookmarks.BookmarkTreeNode) {
    if (node.children == null) {
        return;
    }

    for (let childNode of node.children) {
        if (childNode.type == "folder") {
            let nodeSettings = await getNodeSettings(childNode.id);
            state.nodeObject[childNode.id] = {
                nodeSettings: nodeSettings,
                node: childNode
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
    #init = true;

    get locked(): boolean { return this.hasAttribute('locked'); }
    get unlocked(): boolean { return this.hasAttribute('unlocked'); }
    get checked(): boolean { return this.hasAttribute("checked"); }

    set checked(value) {
        if (value) {
            this.setAttribute('checked', '');
        } else {
            this.removeAttribute('checked');
        }
    }

    get #checkbox() {
        return <HTMLInputElement> this.shadowRoot!.querySelector("input.lock-toggle");
    }

    get #sliderSpan() {
        return this.shadowRoot!.querySelector("span.slider")!;
    }

    static observedAttributes = ["locked", "unlocked", "checked"];

    attributeChangedCallback(name: string, oldValue: string, newValue: string) {
        if (!this.#init) {
            switch (name) {
                case "locked":
                    if (newValue !== null) {
                        this.#sliderSpan.classList.replace("unlocked", "locked");
                        this.#sliderSpan.classList.add("locked");
                    } else {
                        this.#sliderSpan.classList.remove("locked");
                    }
                    break;                    
                case "unlocked":
                    if (newValue !== null) {
                        this.#sliderSpan.classList.replace("locked", "unlocked");
                        this.#sliderSpan.classList.add("unlocked");
                    } else {
                        this.#sliderSpan.classList.remove("unlocked");
                    }
                    break;
                case "checked":
                    this.#checkbox.checked = newValue !== null;
                    this.#checkbox.offsetHeight;
                    break;
                default:
                    break;
            }
        }
    }

    constructor() {
        // Always call super first in constructor
        super();  
        // Create a shadow root
        this.attachShadow({mode: 'open'});
        this.handleClick = this.handleClick.bind(this);
        this.handleCheckboxChanged = this.handleCheckboxChanged.bind(this);
    }

    render() {
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
                <input type="checkbox" class="lock-toggle" ${this.checked ? 'checked' : ''} />
                <span class="slider round ${this.locked ? "locked" : ""} ${this.unlocked ? "unlocked" : ""}"></span>
            </label> `;

        let element = htmlToNode(html);
    
        // Append it to the shadow root
        this.shadowRoot!.replaceChildren(element);
    }

    handleClick(event: Event) {
        this.checked = this.#checkbox.checked;
        if (!(<HTMLElement> event.target).matches("input")) {
            event.stopPropagation();
        }
    }

    handleCheckboxChanged(event: Event) {
        this.checked = this.#checkbox.checked;
    }

    connectedCallback() {
        this.render();
        this.#init = false;
        this.shadowRoot!.addEventListener("click", this.handleClick);
        // Add an event listener to update the checked state when the checkbox is clicked
        this.#checkbox.addEventListener('change', this.handleCheckboxChanged);
    }

    disconnectedCallback() {
        this.shadowRoot!.removeEventListener("click", this.handleClick);
        this.#checkbox.removeEventListener('change', this.handleCheckboxChanged);
    }
}

class PasswordEnterFieldset extends HTMLElement {
    #init = true;

    get #password() {
        return (<HTMLInputElement> this.shadowRoot!.querySelector("#password")).value;
    }

    get #passwordFail() {
        return (<HTMLInputElement> this.shadowRoot!.querySelector("div.password-fail"));
    }

    static observedAttributes = ["password-fail"];

    attributeChangedCallback(name: string, oldValue: string, newValue: string) {
        if (!this.#init) {
            switch (name) {
                case "password-fail":
                    if (this.hasAttribute("password-fail")) {
                        this.#passwordFail.hidden = false;
                    } else {
                        this.#passwordFail.hidden = true;
                    }
                    break;                    
                default:
                    break;
            }
        }
    }

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
                    border: 2px solid black;
                    border-radius: 10px;
                }
                /* Dark mode border color */
                @media (prefers-color-scheme: dark) {
                    fieldset {
                        border: 2px solid white;
                    }
                }                                       
                .password-fail {
                    font: 0.85em system-ui;
                    color: red;
                }
            </style>
            <fieldset class="password-enter-fieldset hide-item">
                <label for="password">Passphrase</label>
                <input id="password" class="password password-enter-input" type="password"/>
                <div class="password-fail" hidden>Wrong password. Try again.</div>
                <button id="password-enter-button" type="button">Submit</button>
            </fieldset>`;
        let element = htmlToNode(html);
    
        // Append it to the shadow root
        this.shadowRoot!.replaceChildren(element);
    }

    async handleClick(event: Event) {
        event.stopPropagation();
        passwordSubmitEvent.detail.password = this.#password;
        this.dispatchEvent(passwordSubmitEvent);
    }

    connectedCallback() {
        this.render();
        this.#init = false;
        this.shadowRoot!.querySelector("#password-enter-button")!.addEventListener('click', this.handleClick);
    }

    disconnectedCallback() {
        this.shadowRoot!.querySelector("#password-enter-button")!.removeEventListener('click', this.handleClick);
    }
}

class PasswordSetFieldset extends HTMLElement {
    get #password() {
        return (<HTMLInputElement> this.shadowRoot!.querySelector(`#password`)).value;
    }

    get #passwordConfirm() {
        return (<HTMLInputElement> this.shadowRoot!.querySelector(`#password-confirm`)).value;
    }

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
                    border: 2px solid black;
                    border-radius: 10px;
                }
                /* Dark mode border color */
                @media (prefers-color-scheme: dark) {
                    fieldset {
                        border: 2px solid white;
                    }
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
        let password = this.#password;
        let passwordConfirm = this.#passwordConfirm;
        (<HTMLButtonElement> this.shadowRoot!.querySelector("#password-set-button")).disabled = password != passwordConfirm;
    }

    async handleClick(event: Event) {
        event.stopPropagation();
        passwordSubmitEvent.detail.password = this.#password;
        this.dispatchEvent(passwordSubmitEvent);
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

class PasswordChangeFieldset extends HTMLElement {
    #init = true;

    get #passwordNew() {
        return (<HTMLInputElement> this.shadowRoot!.querySelector(`#password-new`)).value;
    }

    get #passwordConfirm() {
        return (<HTMLInputElement> this.shadowRoot!.querySelector(`#password-confirm`)).value;
    }

    get #passwordCurrent() {
        return (<HTMLInputElement> this.shadowRoot!.querySelector(`#password-current`)).value;
    }

    get #passwordFail() {
        return (<HTMLInputElement> this.shadowRoot!.querySelector("div.password-fail"));
    }

    static observedAttributes = ["password-fail"];

    attributeChangedCallback(name: string, oldValue: string, newValue: string) {
        if (!this.#init) {
            switch (name) {
                case "password-fail":
                    if (this.hasAttribute("password-fail")) {
                        this.#passwordFail.hidden = false;
                    } else {
                        this.#passwordFail.hidden = true;
                    }
                    break;                    
                default:
                    break;
            }
        }
    }

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
                    border: 2px solid black;
                    border-radius: 10px;
                }
                /* Dark mode border color */
                @media (prefers-color-scheme: dark) {
                    fieldset {
                        border: 2px solid white;
                    }
                }  
                .password-fail {
                    font: 0.85em system-ui;
                    color: red;
                }
            </style>
            <fieldset class="password-change-fieldset hide-item">
                <label for="password-current">Current Passphrase</label>
                <input id="password-current" class="password" type="password"/>
                <div class="password-fail" hidden>Wrong password. Try again.</div>
                <label for="password-new">New Passphrase</label>
                <input id="password-new" class="password" type="password"/>
                <label for="password-confirm">Confirm Passphrase</label>
                <input id="password-confirm" class="password" type="password"/>
                <button id="password-set-button" type="button" disabled>Submit</button>
            </fieldset>`;
        let element = htmlToNode(html);
    
        // Append it to the shadow root
        this.shadowRoot!.replaceChildren(element);
    }

    handleKeyup() {
        let password = this.#passwordNew;
        let passwordConfirm = this.#passwordConfirm;
        let passwordCurrent = this.#passwordCurrent;
        (<HTMLButtonElement> this.shadowRoot!.querySelector("#password-set-button")).disabled = (
            password != passwordConfirm ||
            password == passwordCurrent
        );
    }

    async handleClick(event: Event) {
        console.log("button click");
        event.stopPropagation();
        passwordChangeEvent.detail.password = this.#passwordNew;
        passwordChangeEvent.detail.oldPassword = this.#passwordCurrent;
        this.dispatchEvent(passwordChangeEvent);
    }

    connectedCallback() {
        this.render();
        this.#init = false;
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

class PasswordDeleteFieldset extends HTMLElement {
    #init = true;

    get passwordFail(): boolean { return this.hasAttribute("password-fail") };

    get #password() {
        return (<HTMLInputElement> this.shadowRoot!.querySelector("#password")).value;
    }

    get #passwordFail() {
        return (<HTMLInputElement> this.shadowRoot!.querySelector("div.password-fail"));
    }

    static observedAttributes = ["password-fail"];

    attributeChangedCallback(name: string, oldValue: string, newValue: string) {
        if (!this.#init) {
            switch (name) {
                case "password-fail":
                    if (this.passwordFail) {
                        this.#passwordFail.hidden = false;
                    } else {
                        this.#passwordFail.hidden = true;
                    }
                    break;                    
                default:
                    break;
            }
        }
    }

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
                    border: 2px solid black;
                    border-radius: 10px;
                }
                /* Dark mode border color */
                @media (prefers-color-scheme: dark) {
                    fieldset {
                        border: 2px solid white;
                    }
                }  
                .password-fail {
                    font: 0.85em system-ui;
                    color: red;
                }
            </style>
            <fieldset class="password-enter-fieldset hide-item">
                <label for="password">Passphrase</label>
                <input id="password" class="password password-enter-input" type="password"/>
                <div class="password-fail" hidden>Wrong password. Try again.</div>
                <button id="password-enter-button" type="button">Delete Keys</button>
            </fieldset>`;
        let element = htmlToNode(html);
    
        // Append it to the shadow root
        this.shadowRoot!.replaceChildren(element);
    }

    async handleClick(event: Event) {
        event.stopPropagation();
        passwordSubmitEvent.detail.password = this.#password;
        this.dispatchEvent(passwordSubmitEvent);
    }

    connectedCallback() {
        this.render();
        this.#init = false;
        this.shadowRoot!.querySelector("#password-enter-button")!.addEventListener('click', this.handleClick);
    }

    disconnectedCallback() {
        this.shadowRoot!.querySelector("#password-enter-button")!.removeEventListener('click', this.handleClick);
    }
}

class GearIcon extends HTMLElement {
    #init = true;

    constructor() {
        // Always call super first in constructor
        super();
        // Create a shadow root
        this.attachShadow({mode: 'open'});
    }

    // Render the component with replaced tokens
    render() {
        let html = `
            <style>
                :host {
                    display: inline-block;
                    cursor: pointer;
                    transition: transform 0.3s ease;
                    width: var(--size, 40px); /* Default size */
                    height: var(--size, 40px);
                }

                img {
                    width: 100%;
                    height: 100%;
                    transition: transform 0.3s ease;
                }

                :host(:hover) img {
                    transform: scale(1.2);
                }

                /* Default (light mode or no preference) */
                .svg-icon {
                    content: url('/public/images/gear-svgrepo-com.svg');
                }

                /* Dark mode */
                @media (prefers-color-scheme: dark) {
                    .svg-icon {
                        content: url('/public/images/gear-svgrepo-com-light.svg');
                    }
                }
            </style>
            <img class="svg-icon" src="{{src}}" alt="Gear Icon">
        `;

        const src = this.getAttribute('src') || '/public/images/gear-svgrepo-com-light.svg'; // Default to local 'gear-icon.svg'
        const size = this.getAttribute('size') || '40px'; // Default size

        // Replace the size and src in the template
        html = html.replace('{{src}}', src);

        // Apply the color and size to the styles
        this.style.setProperty('--size', size);

        let element = htmlToNode(html);
        // Append it to the shadow root
        this.shadowRoot!.replaceChildren(element);
    }

    connectedCallback() {
        this.render();
        this.#init = false;
    }
}

class TrashIcon extends HTMLElement {
    #init = true;

    constructor() {
        // Always call super first in constructor
        super();
        // Create a shadow root
        this.attachShadow({mode: 'open'});
    }

    // Render the component with replaced tokens
    render() {
        let html = `
            <style>
                :host {
                    display: inline-block;
                    cursor: pointer;
                    transition: transform 0.3s ease;
                    width: var(--size, 40px); /* Default size */
                    height: var(--size, 40px);
                }

                img {
                    width: 100%;
                    height: 100%;
                    transition: transform 0.3s ease;
                }

                :host(:hover) img {
                    transform: scale(1.2);
                }

                /* Default (light mode or no preference) */
                .svg-icon {
                    content: url('/public/images/trash-svgrepo-com.svg');
                }

                /* Dark mode */
                @media (prefers-color-scheme: dark) {
                    .svg-icon {
                        content: url('/public/images/trash-svgrepo-com-light.svg');
                    }
                }
            </style>
            <img class="svg-icon" src="{{src}}" alt="Trash Icon">
        `;

        const src = this.getAttribute('src') || '/public/images/trash-svgrepo-com-light.svg'; // Default to local 'gear-icon.svg'
        const size = this.getAttribute('size') || '40px'; // Default size

        // Replace the size and src in the template
        html = html.replace('{{src}}', src);

        // Apply the color and size to the styles
        this.style.setProperty('--size', size);

        let element = htmlToNode(html);
        // Append it to the shadow root
        this.shadowRoot!.replaceChildren(element);
    }

    connectedCallback() {
        this.render();
        this.#init = false;
    }
}

class BookmarkNode extends HTMLElement {
    #init = true;

    get nodeId(): string { return this.dataset['nodeId']!; }
    get reset(): boolean { return this.hasAttribute("reset"); }

    get #passwordEnterFieldset() {
        const slot = <HTMLSlotElement> this.shadowRoot!.querySelector('slot[name="fieldset-slot"]');
        if (slot.assignedNodes()[0] instanceof PasswordEnterFieldset) {
            return slot.assignedNodes()[0];
        }
    }

    get #passwordSetFieldset() {
        const slot = <HTMLSlotElement> this.shadowRoot!.querySelector('slot[name="fieldset-slot"]');
        if (slot.assignedNodes()[0] instanceof PasswordSetFieldset) {
            return slot.assignedNodes()[0];
        }
    }

    get #passwordChangeFieldset() {
        const slot = <HTMLSlotElement> this.shadowRoot!.querySelector('slot[name="fieldset-slot"]');
        if (slot.assignedNodes()[0] instanceof PasswordChangeFieldset) {
            return slot.assignedNodes()[0];
        }
    }

    get #passwordDeleteFieldset() {
        const slot = <HTMLSlotElement> this.shadowRoot!.querySelector('slot[name="fieldset-slot"]');
        if (slot.assignedNodes()[0] instanceof PasswordDeleteFieldset) {
            return slot.assignedNodes()[0];
        }
    }

    get #sliderCheckbox() {
        return <SliderCheckbox> this.shadowRoot!.querySelector("slider-checkbox")!;
    }

    get #settingsButton() {
        return <SliderCheckbox> this.shadowRoot!.querySelector("gear-icon")!;
    }

    get #deleteButton() {
        return <SliderCheckbox> this.shadowRoot!.querySelector("trash-icon")!;
    }

    static observedAttributes = ["reset"];

    attributeChangedCallback(name: string, oldValue: string, newValue: string) {
        if (!this.#init) {
            switch (name) {
                case "reset":
                    let nodeState = state.nodeObject[this.nodeId];
                    let managed = !isEmpty(nodeState.nodeSettings);
                    let nodeSettings = <NodeSettings> nodeState.nodeSettings;
                    let checked = managed && nodeSettings.locked ? "checked" : "";
                    let locked = managed && nodeSettings.locked ? "locked" : "";
                    let unlocked = managed && !nodeSettings.locked ? "unlocked" : "";

                    if (checked) {
                        this.#sliderCheckbox.setAttribute("checked", "");
                    } else {
                        this.#sliderCheckbox.removeAttribute("checked");
                    }
                    if (locked) {
                        this.#sliderCheckbox.setAttribute("locked", "");
                    } else {
                        this.#sliderCheckbox.removeAttribute("locked");
                    }
                    if (unlocked) {
                        this.#sliderCheckbox.setAttribute("unlocked", "");
                    } else {
                        this.#sliderCheckbox.removeAttribute("unlocked");
                    }

                    this.#clearFieldsets();
                    this.removeAttribute("reset");
                    break;                    
                default:
                    break;
            }
        }
    }

    constructor() {
        // Always call super first in constructor
        super();
        // Create a shadow root
        this.attachShadow({mode: 'open'});
        this.handleClick = this.handleClick.bind(this);
        this.handlePasswordSubmit = this.handlePasswordSubmit.bind(this);
        this.handleSettingsClick = this.handleSettingsClick.bind(this);
        this.handleTrashClick = this.handleTrashClick.bind(this);
        this.handlePasswordChange = this.handlePasswordChange.bind(this);
    }

    render() {
        let nodeState = state.nodeObject[this.nodeId];
        let managed = !isEmpty(nodeState.nodeSettings);
        let nodeSettings = <NodeSettings> nodeState.nodeSettings;
        let checked = managed && nodeSettings.locked ? "checked" : "";
        let locked = managed && nodeSettings.locked ? "locked" : "";
        let unlocked = managed && !nodeSettings.locked ? "unlocked" : "";

        const html = `
            <style>
                gear-icon, trash-icon {
                    vertical-align: middle; /* Aligns it vertically with the middle of the text */
                }
                [hidden] { display: none; }
            </style>
            <slider-checkbox ${locked} ${unlocked} ${checked}></slider-checkbox>
            ${nodeState.node.title}
            <gear-icon size=16px ${managed ? "" : "hidden"}></gear-icon>
            <trash-icon size=16px ${managed ? "" : "hidden"}></trash-icon>
            <slot name="fieldset-slot"></slot>`;
        let element = htmlToNode(html);
        // Append it to the shadow root
        this.shadowRoot!.replaceChildren(element);
    }

    #showPasswordEnter() {
        if (this.shadowRoot!.querySelector("password-enter-fieldset") == null) {
            let node = htmlToNode(`<password-enter-fieldset slot="fieldset-slot"></password-enter-fieldset>`);
            this.replaceChildren(node);
        }
    }

    #showPasswordSet() {
        if (this.shadowRoot!.querySelector("password-set-fieldset") == null) {
            let node = htmlToNode(`<password-set-fieldset slot="fieldset-slot"></password-set-fieldset>`);
            this.replaceChildren(node);
        }
    }

    #showPasswordChange() {
        if (this.shadowRoot!.querySelector("password-change-fieldset") == null) {
            let node = htmlToNode(`<password-change-fieldset slot="fieldset-slot"></password-change-fieldset>`);
            this.replaceChildren(node);
        }
    }

    #showPasswordDelete() {
        if (this.shadowRoot!.querySelector("password-delete-fieldset") == null) {
            let node = htmlToNode(`<password-delete-fieldset slot="fieldset-slot"></password-delete-fieldset>`);
            this.replaceChildren(node);
        }
    }

    #clearFieldsets() {
        this.replaceChildren();
    }

    async handleClick(e: Event) {
        resetOtherNodesEvent.detail.nodeId = this.nodeId;
        this.dispatchEvent(resetOtherNodesEvent);
        let nodeState = state.nodeObject[this.nodeId];
    
        if (isEmpty(nodeState.nodeSettings)) {
            if (this.#sliderCheckbox.checked) {
                this.#showPasswordSet();
            } else {
                this.#clearFieldsets();
            }
        } else {
            if (this.#sliderCheckbox.checked) {
                this.#clearFieldsets();
                let publicKey = await importPublicKey((<NodeSettings> nodeState.nodeSettings).publicKey!);
                let bookmarkSubTree = (await browser.bookmarks.getSubTree(this.nodeId))[0];
                (<NodeSettings> nodeState.nodeSettings).locked = true;
                await updateNodeSettings(this.nodeId, <NodeSettings> nodeState.nodeSettings);
                await encryptBookmarks(bookmarkSubTree, publicKey);
                this.#sliderCheckbox.setAttribute("locked", "");
                this.#sliderCheckbox.removeAttribute("unlocked");
            } else {
                this.#showPasswordEnter();
            }
        }
    }

    async handleSettingsClick(e: Event) {
        resetOtherNodesEvent.detail.nodeId = this.nodeId;
        this.dispatchEvent(resetOtherNodesEvent);
        this.#showPasswordChange();
    }

    async handleTrashClick(e: Event) {
        resetOtherNodesEvent.detail.nodeId = this.nodeId;
        this.dispatchEvent(resetOtherNodesEvent);
        this.#showPasswordDelete();
    }

    async #passwordEnter(password: string) {
        let bookmarkNode = (await browser.bookmarks.getSubTree(this.nodeId))[0];
        let nodeSettings = <NodeSettings> await getNodeSettings(this.nodeId);
        let nodeState = state.nodeObject[this.nodeId];

        try {
            let privateKey = await unwrapPrivateKey(password, nodeSettings.key!, nodeSettings.salt!, nodeSettings.iv!);
            await decryptBookmarks(bookmarkNode, privateKey);
            (<NodeSettings> nodeState.nodeSettings).locked = false;
            await updateNodeSettings(this.nodeId, <NodeSettings> nodeState.nodeSettings);
            this.#clearFieldsets();
            this.#sliderCheckbox.setAttribute("unlocked", "");
            this.#sliderCheckbox.removeAttribute("locked");
        } catch (error) {
            console.log(error);
            (<PasswordEnterFieldset> this.#passwordEnterFieldset).setAttribute("password-fail", "");
            console.log("Wrong Password");
        }
    }

    async #passwordSet(password: string) {
        let salt = crypto.getRandomValues(new Uint8Array(16));
        let iv = window.crypto.getRandomValues(new Uint8Array(12));
    
        let keyPair = await generateKeyPair();
        let publicKeyPem = await exportPublicKey(keyPair.publicKey);
        let wrappedPrivateKey = await wrapPrivateKey(password, keyPair.privateKey, salt, iv);
        let nodeState = state.nodeObject[this.nodeId];
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
        this.#sliderCheckbox.setAttribute("locked", "");
        this.#sliderCheckbox.removeAttribute("unlocked");
        this.#settingsButton.hidden = false;
        this.#deleteButton.hidden = false;
    }

    async #passwordDelete(password: string) {
        let bookmarkNode = (await browser.bookmarks.getSubTree(this.nodeId))[0];
        let nodeState = state.nodeObject[this.nodeId];
        let nodeSettings = <NodeSettings> nodeState.nodeSettings;

        try {
            let privateKey = await unwrapPrivateKey(password, nodeSettings.key!, nodeSettings.salt!, nodeSettings.iv!);
            await decryptBookmarks(bookmarkNode, privateKey);
            state.nodeObject[this.nodeId].nodeSettings = {};
            await deleteNodeSettings(this.nodeId);
            this.#clearFieldsets();
            this.#sliderCheckbox.removeAttribute("unlocked");
            this.#sliderCheckbox.removeAttribute("locked");
            this.#sliderCheckbox.removeAttribute("checked");
            this.#settingsButton.hidden = true;
            this.#deleteButton.hidden = true;
        } catch (error) {
            console.log(error);
            console.log(this.#passwordDeleteFieldset);
            (<PasswordDeleteFieldset> this.#passwordDeleteFieldset).setAttribute("password-fail", "");
            console.log("Wrong Password");
        }    
    }

    async handlePasswordSubmit(e: Event) {
        e.stopPropagation();
        if (e.target instanceof PasswordEnterFieldset) {
            this.#passwordEnter((<CustomEvent> e).detail.password)
        } else if (e.target instanceof PasswordSetFieldset) {
            this.#clearFieldsets();
            this.#passwordSet((<CustomEvent> e).detail.password);
        } else if (e.target instanceof PasswordDeleteFieldset) {
            this.#passwordDelete((<CustomEvent> e).detail.password);
        }
    }

    async handlePasswordChange(e: Event) {
        e.stopPropagation();
        console.log("handlePasswordChange");
        let nodeState = state.nodeObject[this.nodeId];
        let nodeSettings = <NodeSettings> nodeState.nodeSettings;
        let eventDetail = (<CustomEvent> e).detail;
        let salt = crypto.getRandomValues(new Uint8Array(16));
        let iv = window.crypto.getRandomValues(new Uint8Array(12));
        try {
            let privateKey = await unwrapPrivateKey(eventDetail.oldPassword, nodeSettings.key!, nodeSettings.salt!, nodeSettings.iv!);
            let wrappedPrivateKey = await wrapPrivateKey(eventDetail.password, privateKey, salt, iv);
            nodeSettings.key = wrappedPrivateKey;
            nodeSettings.salt = bytesToBase64(salt);
            nodeSettings.iv = bytesToBase64(iv);
            await updateNodeSettings(this.nodeId, nodeSettings);
            this.#clearFieldsets();
        } catch (error) {
            console.log(error);
            (<PasswordChangeFieldset> this.#passwordChangeFieldset).setAttribute("password-fail", "");
            console.log("Wrong Password");
        }
    }

    connectedCallback() {
        this.render();
        this.#init = false;
        this.shadowRoot!.querySelector("slider-checkbox")!.addEventListener('click', this.handleClick);
        this.shadowRoot!.querySelector("gear-icon")!.addEventListener('click', this.handleSettingsClick);
        this.shadowRoot!.querySelector("trash-icon")!.addEventListener('click', this.handleTrashClick);
        this.addEventListener('passwordSubmit', this.handlePasswordSubmit);
        this.addEventListener('passwordChange', this.handlePasswordChange);
    }

    disconnectedCallback() {
        this.shadowRoot!.querySelector("slider-checkbox")!.removeEventListener("click", this.handleClick);
        this.shadowRoot!.querySelector("gear-icon")!.removeEventListener("click", this.handleSettingsClick);
        this.shadowRoot!.querySelector("trash-icon")!.removeEventListener("click", this.handleTrashClick);
        this.removeEventListener('passwordSubmit', this.handlePasswordSubmit);
        this.removeEventListener('passwordChange', this.handlePasswordChange);
    }
}

class BookmarkNodeList extends HTMLElement {
    constructor() {
        // Always call super first in constructor
        super();  
    }
    static getList(node: browser.bookmarks.BookmarkTreeNode): string {
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
        return listItems.length >= 0 ? `
            <ol>
                ${listItems}
            </ol>`: "";
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

    resetOtherNodes(event: Event) {
        let excludeId = (<CustomEvent> event).detail.nodeId;
        if (excludeId !== "") {
            this.shadowRoot!.querySelectorAll("bookmark-node").forEach((value) => {
                let node = <BookmarkNode> value;
                if (excludeId !== node.nodeId) {
                    node.setAttribute("reset", "");
                }
            });
        }
    }

    connectedCallback() {
        this.render();
        this.addEventListener('resetOthers', this.resetOtherNodes);
    }

    disconnectedCallback() {
        this.removeEventListener('resetOthers', this.resetOtherNodes);
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
customElements.define('password-change-fieldset', PasswordChangeFieldset);
customElements.define("password-delete-fieldset", PasswordDeleteFieldset);
customElements.define("bookmark-node", BookmarkNode);
customElements.define("bookmark-node-list", BookmarkNodeList);
customElements.define("bookmark-tree", BookmarkTree);
customElements.define('gear-icon', GearIcon);
customElements.define('trash-icon', TrashIcon);

document.addEventListener("DOMContentLoaded", onReady);
  