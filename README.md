# OpenHoverZoom

<img src="static/icons/ohz-logo.svg" alt="OpenHoverZoom OHZ logo" width="96">

OpenHoverZoom lets you preview larger images and supported media without leaving
the page you are browsing. Point at a thumbnail or media link to open a preview;
when a gallery is available, use the arrow keys to move through it. Press Enter
while previewing an image to save it to your Downloads folder. You can change
the download shortcut from the extension's options.

## Why OpenHoverZoom?

OpenHoverZoom is built from scratch to be open, understandable, and cautious:

- The complete source code is public and can be reviewed.
- It has no tracking, analytics, accounts, ads, or remote service.
- It never downloads executable code or website rules.
- Settings stay in your browser.
- It activates only when a link or thumbnail provides good evidence that media
  is available, instead of probing every link on a page.

The extension needs access to pages you visit so it can inspect thumbnails and
load their larger media. It does not collect or send your browsing activity,
page content, form data, or credentials.

## Run it locally

You will need [Node.js](https://nodejs.org/) version 22 or newer and a Chromium
browser such as Brave or Chrome.

1. Download or clone this repository, then open a terminal in its folder.
2. Install the local build tools and create the extension:

```sh
npm install
npm run build
```

3. Open `brave://extensions` in Brave or `chrome://extensions` in Chrome.
4. Turn on **Developer mode**.
5. Choose **Load unpacked** and select the `dist` folder in this repository.
6. Open or refresh a webpage, then hover over an image thumbnail to try it.

After changing the code, run `npm run build`, click **Reload** on the extension's
card, and refresh the page you are testing.

To run all automated checks:

```sh
npm run check
```

## License

MIT. See [LICENSE](LICENSE).
