chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "FETCH_EXTERNAL_PAGE") {
        fetch(message.url)
            .then(async (response) => {
                const html = await response.text();
                sendResponse({
                    ok: response.ok,
                    status: response.status,
                    html
                });
            })
            .catch((error) => {
                sendResponse({
                    ok: false,
                    error: String(error)
                });
            });
        return true;
    }
});