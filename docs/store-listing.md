# Chrome Web Store listing

Name: OpenHoverZoom

Summary: Preview and download full-size images, videos, and audio without leaving the page.

Language: English

## Description

Hover over a thumbnail or media link to preview a larger image, video, or audio file without leaving the page.

- Browse detected galleries with the arrow keys.
- Press Enter to download the best available version of the visible media.
- Hold Ctrl to temporarily hide and disable previews.
- Customize shortcuts, hover delay, preview size, and media volume.
- Turn previews off for individual websites.

OpenHoverZoom is free and open source. No accounts, ads, tracking, or analytics. Settings stay in your browser.

Website access lets OpenHoverZoom find media on the pages you visit. Previews and downloads load content directly from the websites that host it. Some websites restrict access to full-size media, and audible playback depends on your browser's autoplay settings.

Source and support: https://github.com/tsahli/OpenHoverZoom

## Single purpose

Preview and optionally download media from the current web page without navigating away.

## Permission justifications

Storage: Saves preferences, keyboard shortcuts, and disabled-site settings locally using chrome.storage.local.

Downloads: Saves the previewed media when the user presses the configured download shortcut. Downloads are user initiated.

Host permissions: Hover previews work across websites. The content script inspects thumbnails and media links on the current page, including frames. The background worker fetches linked documents from their original hosts to resolve full-size media. Media hosts can differ from the page's host, so a fixed domain list would prevent the extension's core functionality. No browsing information is sent to a developer server.

Remote code: No. All executable code and media-resolution rules are included in the extension package. Fetched HTML is parsed as data to find media; it is not executed as extension code.

## Links

Homepage: https://github.com/tsahli/OpenHoverZoom

Support: https://github.com/tsahli/OpenHoverZoom/issues

Privacy policy (publish and verify before submission): https://github.com/tsahli/OpenHoverZoom/blob/main/PRIVACY.md

## Reviewer instructions

No account or login is required. Open a Wikimedia Commons image gallery, hover over an image thumbnail, and wait for the preview. Where a gallery is detected, use the left/right arrow keys to navigate. Press Enter to download the displayed media. Hold Ctrl to hide previews. Use the toolbar popup to disable previews for a site, and the options page to customize settings.

## Release files

- Extension: release/OpenHoverZoom-1.0.0.zip
- Screenshot: docs/store/screenshot-1280x800.png
- Small promotional image: docs/store/promo-440x280.png
- Icon: static/icons/icon-128.png
