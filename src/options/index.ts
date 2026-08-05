import { loadSettings, saveSettings, type Settings } from "../shared/settings";

const form = requiredElement<HTMLFormElement>("settings-form");
const hoverDelay = requiredElement<HTMLInputElement>("hover-delay");
const previewSize = requiredElement<HTMLInputElement>("preview-size");
const sameSize = requiredElement<HTMLInputElement>("same-size");
const sitesList = requiredElement<HTMLUListElement>("disabled-sites");
const emptySites = requiredElement<HTMLElement>("empty-sites");
const status = requiredElement<HTMLElement>("status");
let settings: Settings;

void initialize();

async function initialize(): Promise<void> {
  settings = await loadSettings();
  render();
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      settings = {
        ...settings,
        hoverDelayMs: hoverDelay.valueAsNumber,
        maxPreviewPercent: previewSize.valueAsNumber,
        showSameSizeImages: sameSize.checked,
      };
      await saveSettings(settings);
      settings = await loadSettings();
      render();
      status.textContent = "Options saved.";
    })();
  });
}

function render(): void {
  hoverDelay.value = String(settings.hoverDelayMs);
  previewSize.value = String(settings.maxPreviewPercent);
  sameSize.checked = settings.showSameSizeImages;
  sitesList.replaceChildren();
  emptySites.hidden = settings.disabledSites.length > 0;
  for (const site of settings.disabledSites) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = site;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      void (async () => {
        settings = {
          ...settings,
          disabledSites: settings.disabledSites.filter((entry) => entry !== site),
        };
        await saveSettings(settings);
        render();
      })();
    });
    item.append(label, remove);
    sitesList.append(item);
  }
}

function requiredElement<ElementType extends HTMLElement>(id: string): ElementType {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as ElementType;
}
