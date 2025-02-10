const JSONToFile = (obj: object, filename: string) => {
    const blob = new Blob([JSON.stringify(obj, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filename}.json`;
    a.click();
    URL.revokeObjectURL(url);
};

function onReady() {
    const importButton = document.getElementById("import")!;
    const exportButton = document.getElementById("export")!;
    const fileInput = document.getElementById("fileInput")!;

    exportButton.addEventListener("click", async () => {
        let settings = await browser.storage.sync.get(null);
        JSONToFile(settings, "secret_bookmarks_backup.json");
    });

    importButton.addEventListener("click", () => {
        fileInput.click();
    });

    fileInput.addEventListener("change", async function() {
        console.log("Changed.");
        const files = (<HTMLInputElement> fileInput).files!;
        console.log(files.length);
        if (files.length === 1) {
            let file = files[0];

            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const fileContent = e.target?.result;
                    if (typeof fileContent === 'string') { 
                        const jsonObj = JSON.parse(fileContent);
                        await browser.storage.sync.set(jsonObj);
                    } else {
                        console.error("File content is not a valid string.");
                    }
                } catch (error) {
                    console.error("Error parsing JSON file:", error);
                }
            };
        
            // Read the file as text
            reader.readAsText(file);
        }
    });
}

document.addEventListener("DOMContentLoaded", onReady);
