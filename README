
---

# Secret Bookmarks

A simple browser extension that allows encrypting bookmarks folders with password protection. 

## Features
- Encyrpt bookmark URL and Title
- Non-recurive encryption of all bookmarks in a folder
- Synchronized storage of encryption keys (if enabled)
- Password change
- Key deletion
- Key import/export
- Hyrbid encyrption scheme, RSA-2048 keypair used to encrypt per-bookmark AES-256 key. Private key is wrapped and password protected in PKCS 8 using AES-GCM with PBKDF2

## Limitations
- [Data URLs](https://developer.mozilla.org/en-US/docs/Web/URI/Schemes/data) are used to store encyrpted bookmarks, user supplied Data URLs are not supported in an encrypted bookmark folder and may result in decryption errors
- Moving an encrypted bookmark out of a folder will not prompt for your password
- Moving an encyrpted bookmark into another encrypted folder may result in decryptiion errors

## Installation

### For Chrome:
1. Download the extension files.
2. Open Chrome and navigate to `chrome://extensions/`.
3. Enable **Developer mode** by toggling the switch in the top right corner.
4. Click **Load unpacked** and select the folder containing the extension files.
5. The extension will now be installed and active in your browser.

### For Firefox:
1. Download the extension files.
2. Open Firefox and navigate to `about:debugging`.
3. Click on **This Firefox** in the sidebar.
4. Click the **Load Temporary Add-on** button.
5. Select the extension's manifest file (`manifest.json`) to load it.

## Usage

Once installed, the extension will be available in the toolbar. Click the icon to begin setting up encryption.

The extensions option page can be used to import and export encryption keys.

## Contributing

1. Clone this repository to your local machine.
1. Make your changes and commit them.
1. Create a pull request on GitLab.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
